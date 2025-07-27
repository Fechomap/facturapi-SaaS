// services/queue.service.js - Servicio de Cola para Jobs Asíncronos
import Queue from 'bull';
import logger from '../core/utils/logger.js';

const queueLogger = logger.child({ module: 'queue' });

// Configuración Redis para Bull
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisOptions = {
  redis: redisUrl,
  settings: {
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    lazyConnect: true,
  },
};

// Crear colas especializadas
export const excelReportQueue = new Queue('excel-report', redisOptions);
export const fileCleanupQueue = new Queue('file-cleanup', redisOptions);

// Configuración de la cola de reportes Excel
excelReportQueue.process('generate-excel-report', 3, async (job) => {
  const { processExcelReportJob } = await import('../jobs/excel-report.job.js');
  return await processExcelReportJob(job);
});

// Configuración de la cola de limpieza de archivos
fileCleanupQueue.process('cleanup-temp-file', 5, async (job) => {
  const { processFileCleanupJob } = await import('../jobs/excel-report.job.js');
  return await processFileCleanupJob(job);
});

// Event listeners para monitoreo
excelReportQueue.on('completed', (job, result) => {
  queueLogger.info(`Job ${job.id} completed`, {
    jobId: job.id,
    duration: Date.now() - job.timestamp,
    result: result?.success,
  });
});

excelReportQueue.on('failed', (job, err) => {
  queueLogger.error(`Job ${job.id} failed`, {
    jobId: job.id,
    error: err.message,
    tenantId: job.data.tenantId,
    userId: job.data.userId,
  });
});

excelReportQueue.on('progress', (job, progress) => {
  queueLogger.info(`Job ${job.id} progress: ${progress}%`, {
    jobId: job.id,
    progress,
    tenantId: job.data.tenantId,
  });
});

// Event listeners para cola de limpieza
fileCleanupQueue.on('completed', (job, result) => {
  queueLogger.info(`Cleanup job ${job.id} completed`, {
    jobId: job.id,
    fileName: job.data.fileName,
    result: result?.success || 'unknown',
  });
});

fileCleanupQueue.on('failed', (job, err) => {
  queueLogger.error(`Cleanup job ${job.id} failed`, {
    jobId: job.id,
    error: err.message,
    fileName: job.data.fileName,
  });
});

/**
 * Agregar job de reporte Excel asíncrono
 */
export async function addExcelReportJob(jobData) {
  try {
    const job = await excelReportQueue.add('generate-excel-report', jobData, {
      attempts: 3,
      backoff: 'exponential',
      removeOnComplete: 10, // Mantener solo los últimos 10 completados
      removeOnFail: 5, // Mantener solo los últimos 5 fallidos
      delay: 1000, // 1 segundo de delay inicial
    });

    queueLogger.info('Excel report job added to queue', {
      jobId: job.id,
      tenantId: jobData.tenantId,
      estimatedInvoices: jobData.estimatedInvoices,
    });

    return job;
  } catch (error) {
    queueLogger.error('Error adding excel report job to queue', { error: error.message });
    throw error;
  }
}

/**
 * Obtener estado de un job
 */
export async function getJobStatus(jobId) {
  try {
    const job = await excelReportQueue.getJob(jobId);
    if (!job) {
      return { status: 'not_found' };
    }

    const state = await job.getState();
    const progress = job.progress();

    return {
      id: job.id,
      status: state,
      progress,
      data: job.data,
      createdAt: new Date(job.timestamp),
      processedOn: job.processedOn ? new Date(job.processedOn) : null,
      finishedOn: job.finishedOn ? new Date(job.finishedOn) : null,
      failedReason: job.failedReason,
    };
  } catch (error) {
    queueLogger.error('Error getting job status', { error: error.message, jobId });
    throw error;
  }
}

/**
 * Limpiar jobs antiguos
 */
export async function cleanOldJobs() {
  try {
    await excelReportQueue.clean(24 * 60 * 60 * 1000, 'completed'); // 24 horas
    await excelReportQueue.clean(7 * 24 * 60 * 60 * 1000, 'failed'); // 7 días
    queueLogger.info('Old jobs cleaned successfully');
  } catch (error) {
    queueLogger.error('Error cleaning old jobs', { error: error.message });
  }
}

/**
 * Obtener estadísticas de la cola
 */
export async function getQueueStats() {
  try {
    const waiting = await excelReportQueue.getWaiting();
    const active = await excelReportQueue.getActive();
    const completed = await excelReportQueue.getCompleted();
    const failed = await excelReportQueue.getFailed();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      total: waiting.length + active.length + completed.length + failed.length,
    };
  } catch (error) {
    queueLogger.error('Error getting queue stats', { error: error.message });
    return { error: error.message };
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

export default {
  excelReportQueue,
  fileCleanupQueue,
  addExcelReportJob,
  getJobStatus,
  cleanOldJobs,
  getQueueStats,
  estimateProcessingTime,
};
