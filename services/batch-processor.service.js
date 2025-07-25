// services/batch-processor.service.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import PDFAnalysisService from './pdf-analysis.service.js';
import InvoiceService from './invoice.service.js';
import facturapiQueueService from './facturapi-queue.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, '../temp');

/**
 * Servicio para procesamiento en lotes de PDFs
 */
class BatchProcessorService {
  /**
   * Genera un ID único para el lote
   */
  static generateBatchId(mediaGroupId, userId) {
    // IMPORTANTE: Usar el mediaGroupId directamente para mantener consistencia
    // entre el progress tracker y los callbacks de botones
    if (mediaGroupId) {
      return mediaGroupId; // Usar el media_group_id tal cual
    }
    // Para casos single PDF sin media group
    return `single_${Date.now()}_${userId}`;
  }

  /**
   * Valida que el lote cumpla con los límites
   */
  static validateBatch(documents) {
    const MAX_PDFS = 10;
    const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100MB

    if (!Array.isArray(documents) || documents.length === 0) {
      throw new Error('No se encontraron documentos en el lote');
    }

    if (documents.length > MAX_PDFS) {
      throw new Error(`Máximo ${MAX_PDFS} PDFs por lote. Recibidos: ${documents.length}`);
    }

    // Validar que todos sean PDFs
    const nonPdfFiles = documents.filter(doc => !doc.file_name?.match(/\.pdf$/i));
    if (nonPdfFiles.length > 0) {
      throw new Error(`Todos los archivos deben ser PDF. Archivos inválidos: ${nonPdfFiles.length}`);
    }

    // Validar tamaño total
    const totalSize = documents.reduce((sum, doc) => sum + (doc.file_size || 0), 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      const totalMB = Math.round(totalSize / (1024 * 1024));
      throw new Error(`Tamaño total excede 100MB. Tamaño actual: ${totalMB}MB`);
    }

    return true;
  }

  /**
   * Descarga un PDF de Telegram
   */
  static async downloadPDF(ctx, document, batchId) {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const fileName = document.file_name || `document_${Date.now()}.pdf`;
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(TEMP_DIR, `${batchId}_${safeFileName}`);

    try {
      const fileLink = await ctx.telegram.getFileLink(document.file_id);
      const response = await axios({
        method: 'GET',
        url: fileLink.href,
        responseType: 'stream',
        timeout: 30000,
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`📁 PDF descargado: ${safeFileName}`);
          resolve({ filePath, fileName: safeFileName, originalName: fileName });
        });
        writer.on('error', reject);
      });
    } catch (error) {
      console.error(`Error descargando PDF ${fileName}:`, error.message);
      throw new Error(`Error descargando ${fileName}: ${error.message}`);
    }
  }

  /**
   * Analiza un PDF individual con timeout
   */
  static async analyzeSinglePDF(pdfInfo, tenantId) {
    const startTime = Date.now();
    
    try {
      console.log(`🔍 Analizando: ${pdfInfo.originalName}`);
      
      const analysis = await Promise.race([
        PDFAnalysisService.analyzePDF(pdfInfo.filePath),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout de análisis')), 30000)
        )
      ]);

      const processingTime = Date.now() - startTime;
      console.log(`✅ ${pdfInfo.originalName} analizado en ${processingTime}ms`);

      return {
        success: true,
        fileName: pdfInfo.originalName,
        filePath: pdfInfo.filePath,
        analysis,
        processingTime
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Error analizando ${pdfInfo.originalName}:`, error.message);

      return {
        success: false,
        fileName: pdfInfo.originalName,
        filePath: pdfInfo.filePath,
        error: error.message,
        processingTime
      };
    }
  }

  /**
   * Procesa un lote completo de PDFs
   */
  static async processBatch(ctx, documents, tenantId, mediaGroupId = null) {
    // Usar el mediaGroupId pasado como parámetro o intentar obtenerlo del contexto
    const groupId = mediaGroupId || ctx.message?.media_group_id;
    const batchId = this.generateBatchId(groupId, ctx.from.id);
    
    console.log(`🚀 Iniciando procesamiento de lote: ${batchId}`);
    console.log(`📊 PDFs a procesar: ${documents.length}`);

    try {
      // Validar lote
      this.validateBatch(documents);

      // Fase 1: Descarga paralela
      console.log('📥 Fase 1: Descargando PDFs...');
      const downloadPromises = documents.map(doc => 
        this.downloadPDF(ctx, doc, batchId).catch(error => ({
          success: false,
          fileName: doc.file_name || 'unknown',
          error: error.message
        }))
      );

      const downloadResults = await Promise.allSettled(downloadPromises);
      const successfulDownloads = downloadResults
        .filter(result => result.status === 'fulfilled' && result.value.filePath)
        .map(result => result.value);

      if (successfulDownloads.length === 0) {
        throw new Error('No se pudo descargar ningún PDF');
      }

      console.log(`✅ PDFs descargados: ${successfulDownloads.length}/${documents.length}`);

      // Fase 2: Análisis paralelo
      console.log('🔍 Fase 2: Analizando PDFs...');
      const analysisPromises = successfulDownloads.map(pdfInfo => 
        this.analyzeSinglePDF(pdfInfo, tenantId)
      );

      const analysisResults = await Promise.allSettled(analysisPromises);
      const processedResults = analysisResults
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value);

      // Limpiar archivos temporales
      this.cleanupTempFiles(successfulDownloads);

      const successCount = processedResults.filter(r => r.success).length;
      const failureCount = processedResults.filter(r => !r.success).length;

      console.log(`📊 Resultados del lote ${batchId}:`);
      console.log(`✅ Exitosos: ${successCount}`);
      console.log(`❌ Fallidos: ${failureCount}`);

      return {
        batchId,
        total: documents.length,
        successful: successCount,
        failed: failureCount,
        results: processedResults,
        tenantId
      };

    } catch (error) {
      console.error(`❌ Error en procesamiento de lote ${batchId}:`, error.message);
      throw error;
    }
  }

  /**
   * Genera facturas para un lote de análisis exitosos
   */
  static async generateBatchInvoices(batchResults, ctx) {
    const { batchId, results, tenantId } = batchResults;
    const successfulAnalyses = results.filter(r => r.success && r.analysis);

    if (successfulAnalyses.length === 0) {
      throw new Error('No hay análisis exitosos para generar facturas');
    }

    console.log(`🧾 Generando ${successfulAnalyses.length} facturas para lote ${batchId}`);

    const invoicePromises = successfulAnalyses.map(async (result, index) => {
      try {
        const analysis = result.analysis;
        
        // Buscar cliente en BD local
        const cliente = await this.findClientInDatabase(analysis.clientName, tenantId);
        
        if (!cliente) {
          return {
            fileName: result.fileName,
            success: false,
            error: `Cliente no encontrado: ${analysis.clientName}`
          };
        }

        // Usar el queue service existente para generar la factura
        const invoice = await facturapiQueueService.enqueue(
          async () => {
            return await InvoiceService.generateInvoice({
              clienteId: cliente.facturapiCustomerId,
              localCustomerDbId: cliente.id,
              clienteNombre: cliente.legalName,
              numeroPedido: analysis.orderNumber,
              claveProducto: '78101803', // Código genérico de servicios
              monto: analysis.totalAmount,
              userId: ctx.from.id
            }, tenantId);
          },
          'batch-processing',
          { 
            batchId, 
            fileName: result.fileName,
            clientName: analysis.clientName,
            orderNumber: analysis.orderNumber
          },
          2 // Prioridad media para lotes
        );

        console.log(`✅ Factura generada: ${result.fileName} → ${invoice.facturaId}`);

        return {
          fileName: result.fileName,
          success: true,
          invoice,
          client: cliente,
          analysis
        };

      } catch (error) {
        console.error(`❌ Error generando factura para ${result.fileName}:`, error.message);
        return {
          fileName: result.fileName,
          success: false,
          error: error.message
        };
      }
    });

    const invoiceResults = await Promise.allSettled(invoicePromises);
    const processedInvoices = invoiceResults
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);

    const successfulInvoices = processedInvoices.filter(r => r.success);
    const failedInvoices = processedInvoices.filter(r => !r.success);

    console.log(`📊 Facturas generadas para lote ${batchId}:`);
    console.log(`✅ Exitosas: ${successfulInvoices.length}`);
    console.log(`❌ Fallidas: ${failedInvoices.length}`);

    return {
      batchId,
      successful: successfulInvoices,
      failed: failedInvoices,
      total: processedInvoices.length
    };
  }

  /**
   * Busca un cliente en la base de datos local
   */
  static async findClientInDatabase(clientName, tenantId) {
    try {
      // Importar prisma aquí para evitar dependencias circulares
      const { default: prisma } = await import('../lib/prisma.js');
      
      // Buscar por nombre exacto primero
      let cliente = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          OR: [
            { legalName: { equals: clientName, mode: 'insensitive' } },
            { legalName: { contains: clientName, mode: 'insensitive' } }
          ]
        }
      });

      return cliente;
    } catch (error) {
      console.error('Error buscando cliente en BD:', error.message);
      return null;
    }
  }

  /**
   * Limpia archivos temporales
   */
  static cleanupTempFiles(downloadedFiles) {
    downloadedFiles.forEach(fileInfo => {
      try {
        if (fileInfo.filePath && fs.existsSync(fileInfo.filePath)) {
          fs.unlinkSync(fileInfo.filePath);
          console.log(`🗑️ Archivo temporal eliminado: ${fileInfo.fileName}`);
        }
      } catch (error) {
        console.error(`Error eliminando archivo temporal ${fileInfo.fileName}:`, error.message);
      }
    });
  }

  /**
   * Almacena los resultados del lote en la sesión del usuario
   */
  static async storeBatchResults(ctx, batchResults) {
    if (!ctx.userState) {
      ctx.userState = {};
    }
    if (!ctx.session) {
      ctx.session = {};
    }

    const batchData = {
      batchId: batchResults.batchId,
      results: batchResults,
      timestamp: Date.now(),
      status: 'completed'
    };

    // Guardar en userState (memoria local)
    ctx.userState.batchProcessing = batchData;
    
    // CRÍTICO: Guardar también en session (Redis persistente)
    ctx.session.batchProcessing = batchData;

    // Forzar guardado en Redis si la función existe
    try {
      if (ctx.saveSession && typeof ctx.saveSession === 'function') {
        await ctx.saveSession();
        console.log(`💾 Resultados del lote guardados en Redis: ${batchResults.batchId}`);
      }
    } catch (error) {
      console.error('Error guardando resultados en sesión Redis:', error);
    }

    console.log(`💾 Resultados del lote almacenados en sesión: ${batchResults.batchId}`);
  }
}

export default BatchProcessorService;