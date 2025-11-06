// jobs/index.ts - Sistema de tareas programadas
import cron from 'node-cron';
import logger from '../core/utils/logger';
import { subscriptionJobs } from './subscription.job';
import { invoiceJobs } from './invoice.job';

const jobsLogger = logger.child({ module: 'jobs' });

interface JobConfig {
  schedule: string;
  task: () => Promise<void>;
  description: string;
}

/**
 * Registra todos los jobs programados en el sistema
 */
export function registerJobs(): void {
  jobsLogger.info('Iniciando registro de jobs programados');

  try {
    Object.entries(subscriptionJobs as Record<string, JobConfig>).forEach(([jobName, jobConfig]) => {
      if (jobConfig.schedule && jobConfig.task) {
        cron.schedule(
          jobConfig.schedule,
          async () => {
            jobsLogger.info(`Ejecutando job: ${jobName}`);
            try {
              await jobConfig.task();
              jobsLogger.info(`Job ${jobName} completado exitosamente`);
            } catch (error) {
              jobsLogger.error({ error }, `Error en job ${jobName}`);
            }
          },
          {
            scheduled: true,
            timezone: 'America/Mexico_City',
          }
        );

        jobsLogger.info(`Job registrado: ${jobName} (${jobConfig.schedule})`);
      }
    });

    Object.entries(invoiceJobs as Record<string, JobConfig>).forEach(([jobName, jobConfig]) => {
      if (jobConfig.schedule && jobConfig.task) {
        cron.schedule(
          jobConfig.schedule,
          async () => {
            jobsLogger.info(`Ejecutando job: ${jobName}`);
            try {
              await jobConfig.task();
              jobsLogger.info(`Job ${jobName} completado exitosamente`);
            } catch (error) {
              jobsLogger.error({ error }, `Error en job ${jobName}`);
            }
          },
          {
            scheduled: true,
            timezone: 'America/Mexico_City',
          }
        );

        jobsLogger.info(`Job registrado: ${jobName} (${jobConfig.schedule})`);
      }
    });

    jobsLogger.info('Todos los jobs han sido registrados correctamente');
  } catch (error) {
    jobsLogger.error({ error }, 'Error al registrar jobs');
  }
}

/**
 * Inicia el sistema de jobs
 */
export function startJobs(): void {
  jobsLogger.info('Iniciando sistema de jobs programados');
  registerJobs();
}

export default {
  registerJobs,
  startJobs,
};
