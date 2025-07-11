// jobs/index.js - Sistema de tareas programadas
import cron from 'node-cron';
import logger from '../core/utils/logger.js';
import { subscriptionJobs } from './subscription.job.js';
import { invoiceJobs } from './invoice.job.js';

// Logger específico para jobs
const jobsLogger = logger.child({ module: 'jobs' });

/**
 * Registra todos los jobs programados en el sistema
 */
export function registerJobs() {
  jobsLogger.info('Iniciando registro de jobs programados');

  try {
    // Registrar jobs de suscripciones
    Object.entries(subscriptionJobs).forEach(([jobName, jobConfig]) => {
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

    // Registrar jobs de facturas
    Object.entries(invoiceJobs).forEach(([jobName, jobConfig]) => {
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
export function startJobs() {
  jobsLogger.info('Iniciando sistema de jobs programados');
  registerJobs();
}

export default {
  registerJobs,
  startJobs,
};
