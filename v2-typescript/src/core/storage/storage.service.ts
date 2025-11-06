// core/storage/storage.service.ts
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { prisma } from '../../config/database';
import logger from '../utils/logger';
import { withTransaction } from '../utils/transaction';
import { fileURLToPath } from 'url';

const storageLogger = logger.child({ module: 'storage-service' });

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const access = promisify(fs.access);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_BASE_PATH = path.resolve(__dirname, '../../storage');

interface SaveInvoiceDocumentOptions {
  series?: string;
  folioNumber?: number;
}

interface FindDocumentsCriteria {
  invoiceId?: number;
  type?: string;
  dateFrom?: string | Date;
  dateTo?: string | Date;
  limit?: number;
  offset?: number;
}

/**
 * Servicio para gestión de almacenamiento de archivos
 */
class StorageService {
  /**
   * Crea directorios necesarios para un tenant
   */
  static async ensureTenantDirectories(tenantId: string): Promise<string> {
    const tenantPath = path.join(STORAGE_BASE_PATH, `tenant-${tenantId}`);
    const invoicesPath = path.join(tenantPath, 'invoices');
    const reportsPath = path.join(tenantPath, 'reports');

    storageLogger.debug({ tenantId }, 'Asegurando directorios para tenant');

    try {
      if (!fs.existsSync(tenantPath)) {
        await mkdir(tenantPath, { recursive: true });
      }

      if (!fs.existsSync(invoicesPath)) {
        await mkdir(invoicesPath, { recursive: true });
      }

      if (!fs.existsSync(reportsPath)) {
        await mkdir(reportsPath, { recursive: true });
      }

      storageLogger.debug({ tenantId, tenantPath }, 'Directorios creados correctamente');
      return tenantPath;
    } catch (error: any) {
      storageLogger.error({ error, tenantId }, 'Error al crear directorios del tenant');
      throw new Error(`Error al crear directorios para tenant: ${error.message}`);
    }
  }

  /**
   * Guarda un documento de factura (PDF o XML)
   */
  static async saveInvoiceDocument(
    tenantId: string,
    invoiceId: number,
    facturapiInvoiceId: string,
    type: string,
    content: Buffer,
    options: SaveInvoiceDocumentOptions = {}
  ) {
    const { series = 'A', folioNumber } = options;

    if (!['PDF', 'XML'].includes(type)) {
      throw new Error(`Tipo de documento no válido: ${type}. Debe ser 'PDF' o 'XML'.`);
    }

    if (!content || !(content instanceof Buffer)) {
      throw new Error('El contenido debe ser un Buffer válido');
    }

    storageLogger.info({ tenantId, invoiceId, type }, 'Guardando documento de factura');

    return withTransaction(
      async (tx) => {
        try {
          await this.ensureTenantDirectories(tenantId);

          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');

          const invoicesPath = path.join(STORAGE_BASE_PATH, `tenant-${tenantId}`, 'invoices');
          const typeFolder = path.join(invoicesPath, type.toLowerCase());
          const yearFolder = path.join(typeFolder, year.toString());
          const monthFolder = path.join(yearFolder, month);

          for (const folder of [typeFolder, yearFolder, monthFolder]) {
            if (!fs.existsSync(folder)) {
              await mkdir(folder, { recursive: true });
            }
          }

          const extension = type.toLowerCase();
          const fileName = `${series}${folioNumber}.${extension}`;
          const filePath = path.join(monthFolder, fileName);

          await writeFile(filePath, content);

          const document = await tx.tenantDocument.create({
            data: {
              tenantId,
              invoiceId,
              type,
              filePath: path.relative(STORAGE_BASE_PATH, filePath),
              fileSize: content.length,
              fileName,
              contentType: type === 'PDF' ? 'application/pdf' : 'application/xml',
            },
          });

          storageLogger.info(
            {
              documentId: document.id,
              tenantId,
              invoiceId,
              type,
              filePath: document.filePath,
            },
            'Documento guardado correctamente'
          );

          return document;
        } catch (error: any) {
          storageLogger.error(
            { error, tenantId, invoiceId, type },
            'Error al guardar documento de factura'
          );
          throw error;
        }
      },
      { description: 'Guardar documento de factura' }
    );
  }

  /**
   * Obtiene un documento de factura
   */
  static async getInvoiceDocument(tenantId: string, invoiceId: number, type: string) {
    storageLogger.debug({ tenantId, invoiceId, type }, 'Obteniendo documento de factura');

    try {
      const document = await prisma.tenantDocument.findFirst({
        where: {
          tenantId,
          invoiceId,
          type,
        },
      });

      if (!document) {
        storageLogger.warn({ tenantId, invoiceId, type }, 'Documento no encontrado');
        throw new Error(`Documento ${type} no encontrado para la factura ${invoiceId}`);
      }

      const fullPath = path.join(STORAGE_BASE_PATH, document.filePath);

      try {
        await access(fullPath, fs.constants.R_OK);
      } catch (error: any) {
        storageLogger.error(
          { error, path: fullPath },
          'Archivo no encontrado o sin permisos de lectura'
        );
        throw new Error(`No se puede acceder al archivo: ${error.message}`);
      }

      const content = await readFile(fullPath);

      // TODO: Agregar campo lastDownloaded al schema si es necesario
      // await prisma.tenantDocument.update({
      //   where: { id: document.id },
      //   data: { lastDownloaded: new Date() },
      // });

      storageLogger.debug(
        { documentId: document.id, tenantId, invoiceId, type },
        'Documento obtenido correctamente'
      );

      return {
        document,
        content,
      };
    } catch (error: any) {
      storageLogger.error(
        { error, tenantId, invoiceId, type },
        'Error al obtener documento de factura'
      );
      throw error;
    }
  }

  /**
   * Elimina un documento de factura
   */
  static async deleteDocument(tenantId: string, documentId: number): Promise<boolean> {
    storageLogger.info({ tenantId, documentId }, 'Eliminando documento');

    return withTransaction(
      async (tx) => {
        try {
          const document = await tx.tenantDocument.findFirst({
            where: {
              id: documentId,
              tenantId,
            },
          });

          if (!document) {
            throw new Error(`Documento con ID ${documentId} no encontrado`);
          }

          const fullPath = path.join(STORAGE_BASE_PATH, document.filePath);

          try {
            await access(fullPath, fs.constants.W_OK);
          } catch (error) {
            storageLogger.warn(
              { path: fullPath },
              'Archivo no encontrado o sin permisos de escritura, continuando con eliminación en BD'
            );
          }

          try {
            await unlink(fullPath);
          } catch (error: any) {
            storageLogger.warn(
              { error, path: fullPath },
              'No se pudo eliminar el archivo, continuando con eliminación en BD'
            );
          }

          await tx.tenantDocument.delete({
            where: { id: document.id },
          });

          storageLogger.info(
            { documentId, tenantId, filePath: document.filePath },
            'Documento eliminado correctamente'
          );

          return true;
        } catch (error: any) {
          storageLogger.error({ error, tenantId, documentId }, 'Error al eliminar documento');
          throw error;
        }
      },
      { description: 'Eliminar documento' }
    );
  }

  /**
   * Busca documentos de factura por criterios
   */
  static async findDocuments(tenantId: string, criteria: FindDocumentsCriteria = {}) {
    const { invoiceId, type, dateFrom, dateTo, limit = 100, offset = 0 } = criteria;

    storageLogger.debug({ tenantId, criteria }, 'Buscando documentos');

    const where: any = { tenantId };

    if (invoiceId) {
      where.invoiceId = invoiceId;
    }

    if (type) {
      where.type = type;
    }

    if (dateFrom || dateTo) {
      where.uploadDate = {};

      if (dateFrom) {
        where.uploadDate.gte = new Date(dateFrom);
      }

      if (dateTo) {
        where.uploadDate.lte = new Date(dateTo);
      }
    }

    try {
      const documents = await prisma.tenantDocument.findMany({
        where,
        orderBy: { uploadDate: 'desc' },
        take: limit,
        skip: offset,
      });

      storageLogger.debug({ tenantId, documentCount: documents.length }, 'Documentos encontrados');

      return documents;
    } catch (error: any) {
      storageLogger.error({ error, tenantId, criteria }, 'Error al buscar documentos');
      throw error;
    }
  }
}

export default StorageService;
