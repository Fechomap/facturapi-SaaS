/**
 * Queue Service
 * Asynchronous job queue management with Bull
 */

import Queue from 'bull';
import { createModuleLogger } from '@core/utils/logger.js';

const logger = createModuleLogger('Queue');

// Redis configuration for Bull
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Create specialized queues
export const excelReportQueue = new Queue('excel-report', redisUrl);
export const fileCleanupQueue = new Queue('file-cleanup', redisUrl);

interface JobResult {
  success: boolean;
  [key: string]: unknown;
}

interface JobData {
  tenantId: string;
  userId?: number;
  estimatedInvoices?: number;
  fileName?: string;
  [key: string]: unknown;
}

interface JobStatus {
  id?: string;
  status: string;
  progress?: number;
  data?: JobData;
  createdAt?: Date;
  processedOn?: Date | null;
  finishedOn?: Date | null;
  failedReason?: string;
}

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  total: number;
  error?: string;
}

// Excel report queue processing
excelReportQueue.process('generate-excel-report', 3, async (job) => {
  const { tenantId, userId, filters, config } = job.data;

  logger.info({ jobId: job.id, tenantId, userId }, 'Procesando job de reporte Excel');

  try {
    // Importar el servicio de Excel Reports
    const ExcelReportService = (await import('./excel-report.service.js')).default;

    // Actualizar progreso: iniciando
    await job.progress(10);

    // Generar el reporte
    const result = await ExcelReportService.generateInvoiceReport(tenantId, {
      ...config,
      filters,
    });

    if (!result.success) {
      throw new Error(result.error || 'Error generando reporte');
    }

    // Actualizar progreso: completado
    await job.progress(100);

    logger.info(
      { jobId: job.id, tenantId, filePath: result.filePath },
      'Reporte Excel generado exitosamente'
    );

    return {
      success: true,
      filePath: result.filePath,
      fileName: result.fileName,
      rowCount: result.rowCount,
    };
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        tenantId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Error procesando job de Excel'
    );

    throw error; // Bull marcará el job como failed
  }
});

// File cleanup queue processing
fileCleanupQueue.process('cleanup-temp-file', 5, async (job) => {
  const { filePath, fileName } = job.data;

  logger.info({ jobId: job.id, filePath, fileName }, 'Procesando limpieza de archivo temporal');

  try {
    const fs = await import('fs/promises');

    // Verificar que el archivo existe
    try {
      await fs.access(filePath);
    } catch {
      logger.warn({ filePath }, 'Archivo no existe, considerando limpieza exitosa');
      return { success: true, alreadyDeleted: true };
    }

    // Eliminar el archivo
    await fs.unlink(filePath);

    logger.info({ jobId: job.id, filePath }, 'Archivo temporal eliminado');

    return { success: true, filePath, deletedAt: new Date() };
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        filePath,
        error: error instanceof Error ? error.message : String(error),
      },
      'Error eliminando archivo temporal'
    );

    // No re-lanzar - los archivos temporales no son críticos
    // Si falla, el sistema operativo eventualmente los limpiará
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Event listeners for monitoring
excelReportQueue.on('completed', (job, result: JobResult) => {
  logger.info(
    {
      jobId: job.id,
      duration: Date.now() - job.timestamp,
      result: result?.success,
    },
    `Job ${job.id} completed`
  );
});

excelReportQueue.on('failed', (job, err: Error) => {
  logger.error(
    {
      jobId: job.id,
      error: err.message,
      tenantId: job.data.tenantId,
      userId: job.data.userId,
    },
    `Job ${job.id} failed`
  );
});

excelReportQueue.on('progress', (job, progress: number) => {
  logger.info(
    {
      jobId: job.id,
      progress,
      tenantId: job.data.tenantId,
    },
    `Job ${job.id} progress: ${progress}%`
  );
});

// Event listeners for cleanup queue
fileCleanupQueue.on('completed', (job, result: JobResult) => {
  logger.info(
    {
      jobId: job.id,
      fileName: job.data.fileName,
      result: result?.success || 'unknown',
    },
    `Cleanup job ${job.id} completed`
  );
});

fileCleanupQueue.on('failed', (job, err: Error) => {
  logger.error(
    {
      jobId: job.id,
      error: err.message,
      fileName: job.data.fileName,
    },
    `Cleanup job ${job.id} failed`
  );
});

/**
 * Add Excel report job asynchronously
 */
export async function addExcelReportJob(jobData: JobData) {
  try {
    const job = await excelReportQueue.add('generate-excel-report', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 10,
      removeOnFail: 5,
      delay: 1000,
    });

    logger.info(
      {
        jobId: job.id,
        tenantId: jobData.tenantId,
        estimatedInvoices: jobData.estimatedInvoices,
      },
      'Excel report job added to queue'
    );

    return job;
  } catch (error) {
    logger.error({ error }, 'Error adding excel report job to queue');
    throw error;
  }
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string): Promise<JobStatus> {
  try {
    const job = await excelReportQueue.getJob(jobId);
    if (!job) {
      return { status: 'not_found' };
    }

    const state = await job.getState();
    const progress = job.progress();

    return {
      id: job.id?.toString(),
      status: state,
      progress: typeof progress === 'number' ? progress : undefined,
      data: job.data,
      createdAt: new Date(job.timestamp),
      processedOn: job.processedOn ? new Date(job.processedOn) : null,
      finishedOn: job.finishedOn ? new Date(job.finishedOn) : null,
      failedReason: job.failedReason,
    };
  } catch (error) {
    logger.error({ error, jobId }, 'Error getting job status');
    throw error;
  }
}

/**
 * Clean old jobs
 */
export async function cleanOldJobs(): Promise<void> {
  try {
    await excelReportQueue.clean(24 * 60 * 60 * 1000, 'completed'); // 24 hours
    await excelReportQueue.clean(7 * 24 * 60 * 60 * 1000, 'failed'); // 7 days
    logger.info('Old jobs cleaned successfully');
  } catch (error) {
    logger.error({ error }, 'Error cleaning old jobs');
  }
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<QueueStats> {
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
    logger.error({ error }, 'Error getting queue stats');
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      total: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Estimate processing time based on invoice count
 */
export function estimateProcessingTime(invoiceCount: number): string {
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
