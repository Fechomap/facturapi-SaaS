// jobs/excel-report.job.ts
import logger from '../core/utils/logger';

const jobLogger = logger.child({ module: 'excel-report-job' });

/**
 * Procesar job de reporte Excel asíncrono
 * TODO: Migrar implementación completa desde excel-report.job.js
 */
export async function processExcelReportJob(job: any): Promise<void> {
  const { tenantId, userId, filters, estimatedInvoices, chatId, requestId } = job.data;

  jobLogger.info('Starting async Excel report generation', {
    jobId: job.id,
    tenantId,
    userId,
    estimatedInvoices,
  });

  try {
    await job.progress(5);
    // TODO: Implementar generación completa
    await job.progress(100);

    jobLogger.info('Excel report job completed (stub)', { jobId: job.id });
  } catch (error: any) {
    jobLogger.error('Error in Excel report job', { error: error.message, jobId: job.id });
    throw error;
  }
}

export const excelReportJobs = {
  processExcelReport: {
    schedule: '*/30 * * * *',
    task: async () => {
      jobLogger.info('Excel report cleanup task (stub)');
    },
    description: 'Limpieza de reportes Excel antiguos cada 30 minutos',
  },
};

export default {
  processExcelReportJob,
  excelReportJobs,
};
