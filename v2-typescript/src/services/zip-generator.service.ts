// services/zip-generator.service.ts
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import facturapIService from './facturapi.service';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, '../temp');

interface InvoiceResult {
  fileName?: string;
  invoice: {
    facturaId?: string;
    id?: string;
    folio?: string;
    folioNumber?: number;
    series?: string;
    serie?: string;
  };
}

interface InvoiceResults {
  batchId: string;
  successful: InvoiceResult[];
}

interface ZipInfo {
  filePath: string;
  fileName: string;
  fileCount: number;
  fileSizeBytes: number;
  fileSizeMB: number;
}

interface ZipCreationResult {
  batchId: string;
  pdfZip: ZipInfo;
  xmlZip: ZipInfo;
  invoiceCount: number;
  createdAt: string;
}

/**
 * Servicio para generar archivos ZIP con facturas
 */
class ZipGeneratorService {
  static async createInvoiceZips(
    invoiceResults: InvoiceResults,
    tenantId: string
  ): Promise<ZipCreationResult> {
    const { batchId, successful: successfulInvoices } = invoiceResults;

    if (!successfulInvoices || successfulInvoices.length === 0) {
      throw new Error('No hay facturas exitosas para crear ZIP');
    }

    console.log(`📦 Generando ZIPs para lote ${batchId} con ${successfulInvoices.length} facturas`);

    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const timestamp = Date.now();
    const pdfZipPath = path.join(TEMP_DIR, `facturas_pdf_${batchId}_${timestamp}.zip`);
    const xmlZipPath = path.join(TEMP_DIR, `facturas_xml_${batchId}_${timestamp}.zip`);

    try {
      const [pdfZipInfo, xmlZipInfo] = await Promise.all([
        this.createPDFZip(successfulInvoices, pdfZipPath, tenantId),
        this.createXMLZip(successfulInvoices, xmlZipPath, tenantId),
      ]);

      console.log(`✅ ZIPs generados para lote ${batchId}:`);
      console.log(`📄 PDF ZIP: ${pdfZipInfo.fileName} (${pdfZipInfo.fileCount} archivos)`);
      console.log(`🗂️ XML ZIP: ${xmlZipInfo.fileName} (${xmlZipInfo.fileCount} archivos)`);

      return {
        batchId,
        pdfZip: pdfZipInfo,
        xmlZip: xmlZipInfo,
        invoiceCount: successfulInvoices.length,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      this.cleanupZipFiles([pdfZipPath, xmlZipPath]);
      throw error;
    }
  }

  static async createPDFZip(
    invoices: InvoiceResult[],
    zipPath: string,
    tenantId: string
  ): Promise<ZipInfo> {
    console.log(`📄 Creando ZIP de PDFs: ${path.basename(zipPath)}`);

    const archive = archiver('zip', {
      zlib: { level: 6 },
    });

    const output = fs.createWriteStream(zipPath);
    archive.pipe(output);

    let addedFiles = 0;
    const facturapi = await facturapIService.getFacturapiClient(tenantId);

    for (const invoiceResult of invoices) {
      try {
        const invoice = invoiceResult.invoice;
        const facturaId = invoice.facturaId || invoice.id;

        if (!facturaId) {
          console.warn(`⚠️ ID de factura no encontrado para ${invoiceResult.fileName}`);
          continue;
        }

        console.log(`📥 Descargando PDF: ${facturaId}`);

        const pdfBuffer = await Promise.race([
          this.downloadInvoicePDF(facturapi, facturaId),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout descargando PDF')), 30000)
          ),
        ]);

        const fileName = this.generateFileName(invoiceResult, invoice, 'pdf');
        archive.append(pdfBuffer, { name: fileName });
        addedFiles++;

        console.log(`✅ PDF agregado al ZIP: ${fileName}`);
      } catch (error: any) {
        console.error(`❌ Error procesando PDF para ${invoiceResult.fileName}:`, error.message);
      }
    }

    await archive.finalize();

    await new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', reject);
    });

    const stats = fs.statSync(zipPath);

    return {
      filePath: zipPath,
      fileName: path.basename(zipPath),
      fileCount: addedFiles,
      fileSizeBytes: stats.size,
      fileSizeMB: Math.round((stats.size / (1024 * 1024)) * 100) / 100,
    };
  }

  static async createXMLZip(
    invoices: InvoiceResult[],
    zipPath: string,
    tenantId: string
  ): Promise<ZipInfo> {
    console.log(`🗂️ Creando ZIP de XMLs: ${path.basename(zipPath)}`);

    const archive = archiver('zip', {
      zlib: { level: 6 },
    });

    const output = fs.createWriteStream(zipPath);
    archive.pipe(output);

    let addedFiles = 0;
    const facturapi = await facturapIService.getFacturapiClient(tenantId);

    for (const invoiceResult of invoices) {
      try {
        const invoice = invoiceResult.invoice;
        const facturaId = invoice.facturaId || invoice.id;

        if (!facturaId) {
          console.warn(`⚠️ ID de factura no encontrado para ${invoiceResult.fileName}`);
          continue;
        }

        console.log(`📥 Descargando XML: ${facturaId}`);

        const xmlBuffer = await Promise.race([
          this.downloadInvoiceXML(facturapi, facturaId),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout descargando XML')), 30000)
          ),
        ]);

        const fileName = this.generateFileName(invoiceResult, invoice, 'xml');
        archive.append(xmlBuffer, { name: fileName });
        addedFiles++;

        console.log(`✅ XML agregado al ZIP: ${fileName}`);
      } catch (error: any) {
        console.error(`❌ Error procesando XML para ${invoiceResult.fileName}:`, error.message);
      }
    }

    await archive.finalize();

    await new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', reject);
    });

    const stats = fs.statSync(zipPath);

    return {
      filePath: zipPath,
      fileName: path.basename(zipPath),
      fileCount: addedFiles,
      fileSizeBytes: stats.size,
      fileSizeMB: Math.round((stats.size / (1024 * 1024)) * 100) / 100,
    };
  }

  static async downloadInvoicePDF(facturapi: any, facturaId: string): Promise<Buffer> {
    try {
      const axios = (await import('axios')).default;
      const apiUrl = `https://www.facturapi.io/v2/invoices/${facturaId}/pdf`;
      const apiKey = facturapi.apiKey || facturapi._apiKey;

      const response = await axios({
        method: 'GET',
        url: apiUrl,
        responseType: 'arraybuffer',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 30000,
      });

      return Buffer.from(response.data);
    } catch (error: any) {
      console.error(`Error descargando PDF ${facturaId}:`, error.message);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
      }
      throw new Error(`No se pudo descargar PDF de factura ${facturaId}`);
    }
  }

  static async downloadInvoiceXML(facturapi: any, facturaId: string): Promise<Buffer> {
    try {
      const axios = (await import('axios')).default;
      const apiUrl = `https://www.facturapi.io/v2/invoices/${facturaId}/xml`;
      const apiKey = facturapi.apiKey || facturapi._apiKey;

      const response = await axios({
        method: 'GET',
        url: apiUrl,
        responseType: 'arraybuffer',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 30000,
      });

      return Buffer.from(response.data);
    } catch (error: any) {
      console.error(`Error descargando XML ${facturaId}:`, error.message);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
      }
      throw new Error(`No se pudo descargar XML de factura ${facturaId}`);
    }
  }

  static generateFileName(invoiceResult: InvoiceResult, invoice: any, extension: string): string {
    const folio = invoice.folio || invoice.folioNumber || 'SIN_FOLIO';
    const serie = invoice.series || invoice.serie || 'A';
    return `${serie}${folio}.${extension}`;
  }

  static cleanupZipFiles(zipPaths: string[]): void {
    zipPaths.forEach((zipPath) => {
      try {
        if (fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath);
          console.log(`🗑️ ZIP temporal eliminado: ${path.basename(zipPath)}`);
        }
      } catch (error: any) {
        console.error(`Error eliminando ZIP ${zipPath}:`, error.message);
      }
    });
  }

  static scheduleCleanup(zipInfo: ZipCreationResult, delayMinutes: number = 30): void {
    const { pdfZip, xmlZip } = zipInfo;

    setTimeout(
      () => {
        this.cleanupZipFiles([pdfZip.filePath, xmlZip.filePath]);
        console.log(`🧹 Limpieza automática ejecutada para lote ${zipInfo.batchId}`);
      },
      delayMinutes * 60 * 1000
    );

    console.log(`⏰ Limpieza programada en ${delayMinutes} minutos para lote ${zipInfo.batchId}`);
  }

  static getZipInfo(zipPath: string): ZipInfo | null {
    try {
      if (!fs.existsSync(zipPath)) {
        return null;
      }

      const stats = fs.statSync(zipPath);
      return {
        filePath: zipPath,
        fileName: path.basename(zipPath),
        fileCount: 0,
        fileSizeBytes: stats.size,
        fileSizeMB: Math.round((stats.size / (1024 * 1024)) * 100) / 100,
      };
    } catch (error: any) {
      console.error(`Error obteniendo info del ZIP ${zipPath}:`, error.message);
      return null;
    }
  }
}

export default ZipGeneratorService;
