// jobs/excel-report.job.js - Job Asíncrono para Reportes Excel Grandes
import ExcelReportService from '../services/excel-report.service.js';
import { notifyUserReportReady } from '../services/notification.service.js';
import logger from '../core/utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

const jobLogger = logger.child({ module: 'excel-report-job' });

/**
 * Procesar job de reporte Excel asíncrono
 */
export async function processExcelReportJob(job) {
  const { tenantId, userId, filters, estimatedInvoices, chatId, requestId } = job.data;

  jobLogger.info('Starting async Excel report generation', {
    jobId: job.id,
    tenantId,
    userId,
    estimatedInvoices,
  });

  try {
    // Actualizar progreso: Iniciando
    await job.progress(5);

    // Generar timestamp único para el archivo
    const timestamp = Date.now();
    const fileName = `reporte_facturas_async_${tenantId}_${timestamp}.xlsx`;

    // Actualizar progreso: Consultando datos
    await job.progress(15);

    // Generar el reporte con progreso personalizado
    const progressCallback = async (progress) => {
      // Mapear progreso de generación (15-85%)
      const mappedProgress = 15 + progress * 0.7;
      await job.progress(Math.floor(mappedProgress));
    };

    // Configurar opciones para el reporte
    const reportOptions = {
      limit: 5000,
      includeDetails: true,
      format: 'xlsx',
      useCache: false,
      dateRange: filters.dateRange || null,
      clientIds: filters.selectedClientIds || null,
    };

    const reportData = await ExcelReportService.generateInvoiceReport(tenantId, reportOptions);

    // Actualizar progreso: Finalizando
    await job.progress(95);

    // Verificar que el reporte se generó correctamente
    if (!reportData.success) {
      throw new Error(reportData.error || 'Error desconocido generando reporte');
    }

    // Verificar que el archivo se creó correctamente
    const stats = await fs.stat(reportData.filePath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    jobLogger.info('Excel report generated successfully', {
      jobId: job.id,
      tenantId,
      filePath: reportData.filePath,
      fileSizeMB,
      invoiceCount: reportData.stats.totalInvoices,
    });

    // Notificar al usuario que el reporte está listo
    await notifyUserReportReady({
      chatId,
      tenantId,
      userId,
      filePath: reportData.filePath,
      fileName,
      invoiceCount: reportData.stats.totalInvoices,
      fileSizeMB,
      requestId,
      jobId: job.id,
    });

    // Programar limpieza del archivo en 24 horas
    await scheduleFileCleanup(reportData.filePath, fileName);

    // Progreso final
    await job.progress(100);

    return {
      success: true,
      filePath: reportData.filePath,
      fileName,
      invoiceCount: reportData.stats.totalInvoices,
      fileSizeMB,
      completedAt: new Date(),
    };
  } catch (error) {
    jobLogger.error('Error processing Excel report job', {
      jobId: job.id,
      tenantId,
      error: error.message,
      stack: error.stack,
    });

    // Notificar error al usuario
    try {
      await notifyUserReportError({
        chatId,
        tenantId,
        userId,
        error: error.message,
        requestId,
        jobId: job.id,
      });
    } catch (notifyError) {
      jobLogger.error('Error notifying user about job failure', {
        jobId: job.id,
        notifyError: notifyError.message,
      });
    }

    throw error;
  }
}

/**
 * Programar limpieza automática del archivo
 */
async function scheduleFileCleanup(filePath, fileName) {
  try {
    // Crear job de limpieza con delay de 24 horas
    const queueModule = await import('../services/queue.service.js');

    await queueModule.fileCleanupQueue.add(
      'cleanup-temp-file',
      {
        filePath,
        fileName,
        createdAt: new Date(),
      },
      {
        delay: 24 * 60 * 60 * 1000, // 24 horas
        removeOnComplete: 1,
        removeOnFail: 1,
      }
    );

    jobLogger.info('File cleanup scheduled', { filePath, fileName });
  } catch (error) {
    jobLogger.warn('Could not schedule file cleanup', {
      filePath,
      fileName,
      error: error.message,
    });
  }
}

/**
 * Job para limpiar archivos temporales
 */
export async function processFileCleanupJob(job) {
  const { filePath, fileName } = job.data;

  try {
    await fs.unlink(filePath);
    jobLogger.info('Temporary file cleaned successfully', { filePath, fileName });

    return { success: true, deletedFile: fileName };
  } catch (error) {
    if (error.code === 'ENOENT') {
      jobLogger.info('File already deleted or not found', { filePath, fileName });
      return { success: true, message: 'File already deleted' };
    }

    jobLogger.error('Error cleaning temporary file', {
      filePath,
      fileName,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Estimar tiempo de procesamiento basado en cantidad de facturas
 */
export function estimateProcessingTime(invoiceCount) {
  // Estimaciones basadas en pruebas reales
  if (invoiceCount <= 100) return '30 segundos';
  if (invoiceCount <= 500) return '1-2 minutos';
  if (invoiceCount <= 1000) return '3-5 minutos';
  if (invoiceCount <= 2000) return '8-12 minutos';
  if (invoiceCount <= 5000) return '20-30 minutos';
  return '30+ minutos';
}

/**
 * Notificar error al usuario
 */
async function notifyUserReportError({ chatId, tenantId, userId, error, requestId, jobId }) {
  try {
    const { sendMessage } = await import('../bot/index.js');

    const errorMessage =
      `❌ **Error en Reporte Excel**\n\n` +
      `Lo siento, ocurrió un error al generar tu reporte:\n` +
      `\`${error}\`\n\n` +
      `🔄 Puedes intentar nuevamente con menos filtros o contactar soporte.\n\n` +
      `📋 ID: \`${requestId}\``;

    await sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });

    jobLogger.info('Error notification sent to user', {
      chatId,
      tenantId,
      userId,
      requestId,
      jobId,
    });
  } catch (notifyError) {
    jobLogger.error('Failed to send error notification', {
      chatId,
      tenantId,
      error: notifyError.message,
    });
  }
}

export default {
  processExcelReportJob,
  processFileCleanupJob,
  estimateProcessingTime,
};
