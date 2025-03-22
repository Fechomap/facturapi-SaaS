// core/storage/storage.service.js
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { prisma } from '../../config/database.js';
import logger from '../utils/logger.js';
import { withTransaction } from '../utils/transaction.js';
import { fileURLToPath } from 'url';

// Logger específico para almacenamiento
const storageLogger = logger.child({ module: 'storage-service' });

// Convertir métodos de fs a promesas
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const access = promisify(fs.access);

// Obtener el directorio base de almacenamiento
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_BASE_PATH = path.resolve(__dirname, '../../storage');

/**
 * Servicio para gestión de almacenamiento de archivos
 */
class StorageService {
  /**
   * Crea directorios necesarios para un tenant
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<string>} - Ruta base del tenant
   */
  static async ensureTenantDirectories(tenantId) {
    const tenantPath = path.join(STORAGE_BASE_PATH, `tenant-${tenantId}`);
    const invoicesPath = path.join(tenantPath, 'invoices');
    const reportsPath = path.join(tenantPath, 'reports');
    
    storageLogger.debug({ tenantId }, 'Asegurando directorios para tenant');
    
    try {
      // Crear directorio base para el tenant si no existe
      if (!fs.existsSync(tenantPath)) {
        await mkdir(tenantPath, { recursive: true });
      }
      
      // Crear directorios para facturas y reportes
      if (!fs.existsSync(invoicesPath)) {
        await mkdir(invoicesPath, { recursive: true });
      }
      
      if (!fs.existsSync(reportsPath)) {
        await mkdir(reportsPath, { recursive: true });
      }
      
      storageLogger.debug({ tenantId, tenantPath }, 'Directorios creados correctamente');
      return tenantPath;
    } catch (error) {
      storageLogger.error({ error, tenantId }, 'Error al crear directorios del tenant');
      throw new Error(`Error al crear directorios para tenant: ${error.message}`);
    }
  }
  
  /**
   * Guarda un documento de factura (PDF o XML)
   * @param {string} tenantId - ID del tenant
   * @param {number} invoiceId - ID de la factura en nuestra BD
   * @param {string} facturapiInvoiceId - ID de la factura en FacturAPI
   * @param {string} type - Tipo de documento ('PDF' o 'XML')
   * @param {Buffer} content - Contenido del archivo
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<Object>} - Documento guardado
   */
  static async saveInvoiceDocument(tenantId, invoiceId, facturapiInvoiceId, type, content, options = {}) {
    const { series = 'A', folioNumber } = options;
    
    if (!['PDF', 'XML'].includes(type)) {
      throw new Error(`Tipo de documento no válido: ${type}. Debe ser 'PDF' o 'XML'.`);
    }
    
    if (!content || !(content instanceof Buffer)) {
      throw new Error('El contenido debe ser un Buffer válido');
    }
    
    storageLogger.info({ tenantId, invoiceId, type }, 'Guardando documento de factura');
    
    return withTransaction(async (tx) => {
      try {
        // Asegurar que existan los directorios
        await this.ensureTenantDirectories(tenantId);
        
        // Crear estructura de directorios para el año/mes actual
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        
        const invoicesPath = path.join(STORAGE_BASE_PATH, `tenant-${tenantId}`, 'invoices');
        const typeFolder = path.join(invoicesPath, type.toLowerCase());
        const yearFolder = path.join(typeFolder, year.toString());
        const monthFolder = path.join(yearFolder, month);
        
        // Crear directorios si no existen
        for (const folder of [typeFolder, yearFolder, monthFolder]) {
          if (!fs.existsSync(folder)) {
            await mkdir(folder, { recursive: true });
          }
        }
        
        // Determinar nombre de archivo
        const extension = type.toLowerCase();
        const fileName = `${series}${folioNumber}.${extension}`;
        const filePath = path.join(monthFolder, fileName);
        
        // Guardar el archivo en el sistema de archivos
        await writeFile(filePath, content);
        
        // Registrar en la base de datos
        const document = await tx.tenantDocument.create({
          data: {
            tenantId,
            invoiceId,
            type,
            filePath: path.relative(STORAGE_BASE_PATH, filePath),
            fileSize: content.length,
            fileName,
            contentType: type === 'PDF' ? 'application/pdf' : 'application/xml'
          }
        });
        
        storageLogger.info(
          { 
            documentId: document.id, 
            tenantId, 
            invoiceId, 
            type, 
            filePath: document.filePath 
          }, 
          'Documento guardado correctamente'
        );
        
        return document;
      } catch (error) {
        storageLogger.error(
          { error, tenantId, invoiceId, type }, 
          'Error al guardar documento de factura'
        );
        throw error;
      }
    }, { description: 'Guardar documento de factura' });
  }
  
  /**
   * Obtiene un documento de factura
   * @param {string} tenantId - ID del tenant
   * @param {number} invoiceId - ID de la factura en nuestra BD
   * @param {string} type - Tipo de documento ('PDF' o 'XML')
   * @returns {Promise<Object>} - Datos del documento y su contenido
   */
  static async getInvoiceDocument(tenantId, invoiceId, type) {
    storageLogger.debug({ tenantId, invoiceId, type }, 'Obteniendo documento de factura');
    
    try {
      // Buscar el documento en la base de datos
      const document = await prisma.tenantDocument.findFirst({
        where: {
          tenantId,
          invoiceId,
          type
        }
      });
      
      if (!document) {
        storageLogger.warn({ tenantId, invoiceId, type }, 'Documento no encontrado');
        throw new Error(`Documento ${type} no encontrado para la factura ${invoiceId}`);
      }
      
      // Construir la ruta completa
      const fullPath = path.join(STORAGE_BASE_PATH, document.filePath);
      
      // Verificar que el archivo existe
      try {
        await access(fullPath, fs.constants.R_OK);
      } catch (error) {
        storageLogger.error(
          { error, path: fullPath }, 
          'Archivo no encontrado o sin permisos de lectura'
        );
        throw new Error(`No se puede acceder al archivo: ${error.message}`);
      }
      
      // Leer el archivo
      const content = await readFile(fullPath);
      
      // Actualizar la fecha de último acceso
      await prisma.tenantDocument.update({
        where: { id: document.id },
        data: { lastDownloaded: new Date() }
      });
      
      storageLogger.debug(
        { documentId: document.id, tenantId, invoiceId, type }, 
        'Documento obtenido correctamente'
      );
      
      return {
        document,
        content
      };
    } catch (error) {
      storageLogger.error(
        { error, tenantId, invoiceId, type }, 
        'Error al obtener documento de factura'
      );
      throw error;
    }
  }
  
  /**
   * Elimina un documento de factura
   * @param {string} tenantId - ID del tenant
   * @param {number} documentId - ID del documento
   * @returns {Promise<boolean>} - true si se eliminó correctamente
   */
  static async deleteDocument(tenantId, documentId) {
    storageLogger.info({ tenantId, documentId }, 'Eliminando documento');
    
    return withTransaction(async (tx) => {
      try {
        // Buscar el documento
        const document = await tx.tenantDocument.findFirst({
          where: {
            id: documentId,
            tenantId
          }
        });
        
        if (!document) {
          throw new Error(`Documento con ID ${documentId} no encontrado`);
        }
        
        // Construir la ruta completa
        const fullPath = path.join(STORAGE_BASE_PATH, document.filePath);
        
        // Verificar que el archivo existe
        try {
          await access(fullPath, fs.constants.W_OK);
        } catch (error) {
          storageLogger.warn(
            { path: fullPath }, 
            'Archivo no encontrado o sin permisos de escritura, continuando con eliminación en BD'
          );
        }
        
        // Intentar eliminar el archivo
        try {
          await unlink(fullPath);
        } catch (error) {
          storageLogger.warn(
            { error, path: fullPath }, 
            'No se pudo eliminar el archivo, continuando con eliminación en BD'
          );
        }
        
        // Eliminar el registro de la base de datos
        await tx.tenantDocument.delete({
          where: { id: document.id }
        });
        
        storageLogger.info(
          { documentId, tenantId, filePath: document.filePath }, 
          'Documento eliminado correctamente'
        );
        
        return true;
      } catch (error) {
        storageLogger.error(
          { error, tenantId, documentId }, 
          'Error al eliminar documento'
        );
        throw error;
      }
    }, { description: 'Eliminar documento' });
  }
  
  /**
   * Busca documentos de factura por criterios
   * @param {string} tenantId - ID del tenant
   * @param {Object} criteria - Criterios de búsqueda
   * @returns {Promise<Array>} - Documentos encontrados
   */
  static async findDocuments(tenantId, criteria = {}) {
    const { invoiceId, type, dateFrom, dateTo, limit = 100, offset = 0 } = criteria;
    
    storageLogger.debug({ tenantId, criteria }, 'Buscando documentos');
    
    const where = { tenantId };
    
    // Aplicar filtros si existen
    if (invoiceId) {
      where.invoiceId = invoiceId;
    }
    
    if (type) {
      where.type = type;
    }
    
    // Filtrar por fecha de subida
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
        skip: offset
      });
      
      storageLogger.debug(
        { tenantId, documentCount: documents.length }, 
        'Documentos encontrados'
      );
      
      return documents;
    } catch (error) {
      storageLogger.error(
        { error, tenantId, criteria }, 
        'Error al buscar documentos'
      );
      throw error;
    }
  }
}

export default StorageService;