// services/batch-processor.service.ts
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import PDFAnalysisService from './pdf-analysis.service';
import InvoiceService from './invoice.service';
import facturapiQueueService from './facturapi-queue.service';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, '../temp');

interface TelegramDocument {
  file_id: string;
  file_name?: string;
  file_size?: number;
}

interface PDFInfo {
  filePath: string;
  fileName: string;
  originalName: string;
}

interface AnalysisResult {
  success: boolean;
  fileName: string;
  filePath: string;
  analysis?: any;
  error?: string;
  processingTime: number;
}

/**
 * Servicio para procesamiento en lotes de PDFs
 */
class BatchProcessorService {
  static generateBatchId(mediaGroupId: string | null | undefined, userId: number): string {
    if (mediaGroupId) {
      return mediaGroupId;
    }
    return `single_${Date.now()}_${userId}`;
  }

  static validateBatch(documents: TelegramDocument[]): boolean {
    const MAX_PDFS = 10;
    const MAX_TOTAL_SIZE = 100 * 1024 * 1024;

    if (!Array.isArray(documents) || documents.length === 0) {
      throw new Error('No se encontraron documentos en el lote');
    }

    if (documents.length > MAX_PDFS) {
      throw new Error(`Máximo ${MAX_PDFS} PDFs por lote. Recibidos: ${documents.length}`);
    }

    const nonPdfFiles = documents.filter((doc) => !doc.file_name?.match(/\.pdf$/i));
    if (nonPdfFiles.length > 0) {
      throw new Error(
        `Todos los archivos deben ser PDF. Archivos inválidos: ${nonPdfFiles.length}`
      );
    }

    const totalSize = documents.reduce((sum, doc) => sum + (doc.file_size || 0), 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      const totalMB = Math.round(totalSize / (1024 * 1024));
      throw new Error(`Tamaño total excede 100MB. Tamaño actual: ${totalMB}MB`);
    }

    return true;
  }

  static async downloadPDF(
    ctx: any,
    document: TelegramDocument,
    batchId: string
  ): Promise<PDFInfo> {
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
    } catch (error: any) {
      console.error(`Error descargando PDF ${fileName}:`, error.message);
      throw new Error(`Error descargando ${fileName}: ${error.message}`);
    }
  }

  static async analyzeSinglePDF(pdfInfo: PDFInfo, tenantId: string): Promise<AnalysisResult> {
    const startTime = Date.now();

    try {
      console.log(`🔍 Analizando: ${pdfInfo.originalName}`);

      const analysis = await Promise.race([
        PDFAnalysisService.analyzePDF(pdfInfo.filePath),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout de análisis')), 30000)
        ),
      ]);

      const processingTime = Date.now() - startTime;
      console.log(`✅ ${pdfInfo.originalName} analizado en ${processingTime}ms`);

      return {
        success: true,
        fileName: pdfInfo.originalName,
        filePath: pdfInfo.filePath,
        analysis,
        processingTime,
      };
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Error analizando ${pdfInfo.originalName}:`, error.message);

      return {
        success: false,
        fileName: pdfInfo.originalName,
        filePath: pdfInfo.filePath,
        error: error.message,
        processingTime,
      };
    }
  }

  static async processBatch(
    ctx: any,
    documents: TelegramDocument[],
    tenantId: string,
    mediaGroupId: string | null = null
  ) {
    const groupId = mediaGroupId || ctx.message?.media_group_id;
    const batchId = this.generateBatchId(groupId, ctx.from.id);

    console.log(`🚀 Iniciando procesamiento de lote: ${batchId}`);
    console.log(`📊 PDFs a procesar: ${documents.length}`);

    try {
      this.validateBatch(documents);

      const downloadedPDFs = [];
      for (const doc of documents) {
        const pdfInfo = await this.downloadPDF(ctx, doc, batchId);
        downloadedPDFs.push(pdfInfo);
      }

      const analysisResults = await Promise.all(
        downloadedPDFs.map((pdf) => this.analyzeSinglePDF(pdf, tenantId))
      );

      const successful = analysisResults.filter((r) => r.success);
      const failed = analysisResults.filter((r) => !r.success);

      return {
        batchId,
        total: documents.length,
        successful: successful.length,
        failed: failed.length,
        results: analysisResults,
      };
    } catch (error: any) {
      console.error(`❌ Error en procesamiento de lote ${batchId}:`, error.message);
      throw error;
    }
  }

  static async cleanupBatchFiles(batchId: string): Promise<void> {
    try {
      const files = fs.readdirSync(TEMP_DIR);
      const batchFiles = files.filter((f) => f.startsWith(batchId));

      for (const file of batchFiles) {
        const filePath = path.join(TEMP_DIR, file);
        fs.unlinkSync(filePath);
        console.log(`🗑️ Archivo eliminado: ${file}`);
      }

      console.log(`✅ Limpieza completada para lote ${batchId}`);
    } catch (error: any) {
      console.error(`Error limpiando archivos del lote ${batchId}:`, error.message);
    }
  }
}

export default BatchProcessorService;
