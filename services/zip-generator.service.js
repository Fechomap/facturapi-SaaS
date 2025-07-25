// services/zip-generator.service.js
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import facturapIService from './facturapi.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, '../temp');

/**
 * Servicio para generar archivos ZIP con facturas
 */
class ZipGeneratorService {
  /**
   * Crea archivos ZIP con PDFs y XMLs de facturas
   */
  static async createInvoiceZips(invoiceResults, tenantId) {
    const { batchId, successful: successfulInvoices } = invoiceResults;

    if (!successfulInvoices || successfulInvoices.length === 0) {
      throw new Error('No hay facturas exitosas para crear ZIP');
    }

    console.log(`📦 Generando ZIPs para lote ${batchId} con ${successfulInvoices.length} facturas`);

    // Asegurar que el directorio temporal existe
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const timestamp = Date.now();
    const pdfZipPath = path.join(TEMP_DIR, `facturas_pdf_${batchId}_${timestamp}.zip`);
    const xmlZipPath = path.join(TEMP_DIR, `facturas_xml_${batchId}_${timestamp}.zip`);

    try {
      // Crear ZIPs en paralelo
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
      // Limpiar archivos parciales en caso de error
      this.cleanupZipFiles([pdfZipPath, xmlZipPath]);
      throw error;
    }
  }

  /**
   * Crea un ZIP con todos los PDFs de las facturas
   */
  static async createPDFZip(invoices, zipPath, tenantId) {
    console.log(`📄 Creando ZIP de PDFs: ${path.basename(zipPath)}`);

    const archive = archiver('zip', {
      zlib: { level: 6 }, // Compresión media para balance entre tamaño y velocidad
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

        // Descargar PDF de FacturAPI con timeout
        const pdfBuffer = await Promise.race([
          this.downloadInvoicePDF(facturapi, facturaId),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout descargando PDF')), 30000)
          ),
        ]);

        // Generar nombre de archivo único
        const fileName = this.generateFileName(invoiceResult, invoice, 'pdf');

        // Agregar al ZIP
        archive.append(pdfBuffer, { name: fileName });
        addedFiles++;

        console.log(`✅ PDF agregado al ZIP: ${fileName}`);
      } catch (error) {
        console.error(`❌ Error procesando PDF para ${invoiceResult.fileName}:`, error.message);
        // Continuar con otros archivos aunque uno falle
      }
    }

    // Finalizar el ZIP
    await archive.finalize();

    // Esperar que se complete la escritura
    await new Promise((resolve, reject) => {
      output.on('close', resolve);
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

  /**
   * Crea un ZIP con todos los XMLs de las facturas
   */
  static async createXMLZip(invoices, zipPath, tenantId) {
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

        // Descargar XML de FacturAPI con timeout
        const xmlBuffer = await Promise.race([
          this.downloadInvoiceXML(facturapi, facturaId),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout descargando XML')), 30000)
          ),
        ]);

        // Generar nombre de archivo único
        const fileName = this.generateFileName(invoiceResult, invoice, 'xml');

        // Agregar al ZIP
        archive.append(xmlBuffer, { name: fileName });
        addedFiles++;

        console.log(`✅ XML agregado al ZIP: ${fileName}`);
      } catch (error) {
        console.error(`❌ Error procesando XML para ${invoiceResult.fileName}:`, error.message);
        // Continuar con otros archivos aunque uno falle
      }
    }

    // Finalizar el ZIP
    await archive.finalize();

    // Esperar que se complete la escritura
    await new Promise((resolve, reject) => {
      output.on('close', resolve);
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

  /**
   * Descarga el PDF de una factura desde FacturAPI
   */
  static async downloadInvoicePDF(facturapi, facturaId) {
    try {
      // Usar axios directamente ya que facturapi.invoices.pdf no existe
      const axios = (await import('axios')).default;
      const apiUrl = `https://www.facturapi.io/v2/invoices/${facturaId}/pdf`;

      // Obtener el API key del cliente facturapi
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
    } catch (error) {
      console.error(`Error descargando PDF ${facturaId}:`, error.message);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data: ${error.response.data ? error.response.data.toString() : 'N/A'}`);
      }
      throw new Error(`No se pudo descargar PDF de factura ${facturaId}`);
    }
  }

  /**
   * Descarga el XML de una factura desde FacturAPI
   */
  static async downloadInvoiceXML(facturapi, facturaId) {
    try {
      // Usar axios directamente ya que facturapi.invoices.xml no existe
      const axios = (await import('axios')).default;
      const apiUrl = `https://www.facturapi.io/v2/invoices/${facturaId}/xml`;

      // Obtener el API key del cliente facturapi
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
    } catch (error) {
      console.error(`Error descargando XML ${facturaId}:`, error.message);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data: ${error.response.data ? error.response.data.toString() : 'N/A'}`);
      }
      throw new Error(`No se pudo descargar XML de factura ${facturaId}`);
    }
  }

  /**
   * Genera un nombre de archivo único para la factura
   */
  static generateFileName(invoiceResult, invoice, extension) {
    const orderNumber = invoiceResult.analysis?.orderNumber || 'SIN_ORDEN';
    const folio = invoice.folio || invoice.folioNumber || 'SIN_FOLIO';
    const serie = invoice.series || invoice.serie || 'A'; // Soportar ambos campos por compatibilidad
    const clientName = invoiceResult.client?.legalName || 'CLIENTE';

    // Limpiar caracteres especiales
    const cleanOrderNumber = orderNumber.toString().replace(/[^a-zA-Z0-9]/g, '_');
    const cleanClientName = clientName
      .substring(0, 20)
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '_');

    return `${serie}${folio}_${cleanOrderNumber}_${cleanClientName}.${extension}`;
  }

  /**
   * Limpia archivos ZIP temporales
   */
  static cleanupZipFiles(zipPaths) {
    zipPaths.forEach((zipPath) => {
      try {
        if (fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath);
          console.log(`🗑️ ZIP temporal eliminado: ${path.basename(zipPath)}`);
        }
      } catch (error) {
        console.error(`Error eliminando ZIP ${zipPath}:`, error.message);
      }
    });
  }

  /**
   * Programa limpieza automática de ZIPs después de cierto tiempo
   */
  static scheduleCleanup(zipInfo, delayMinutes = 30) {
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

  /**
   * Obtiene información de un ZIP existente
   */
  static getZipInfo(zipPath) {
    try {
      if (!fs.existsSync(zipPath)) {
        return null;
      }

      const stats = fs.statSync(zipPath);
      return {
        filePath: zipPath,
        fileName: path.basename(zipPath),
        fileSizeBytes: stats.size,
        fileSizeMB: Math.round((stats.size / (1024 * 1024)) * 100) / 100,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
      };
    } catch (error) {
      console.error(`Error obteniendo info del ZIP ${zipPath}:`, error.message);
      return null;
    }
  }
}

export default ZipGeneratorService;
