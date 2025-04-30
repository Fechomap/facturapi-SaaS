// scripts/test-expired-subscriptions.js
import { processExpiredSubscriptions } from '../jobs/subscription.job.js';
import logger from '../core/utils/logger.js';

// Configurar el logger para mostrar información detallada
logger.level = 'debug';

async function main() {
  try {
    console.log('Iniciando procesamiento de suscripciones expiradas...');
    await processExpiredSubscriptions();
    console.log('Procesamiento completado.');
  } catch (error) {
    console.error('Error durante el procesamiento:', error);
  }
}

main();
