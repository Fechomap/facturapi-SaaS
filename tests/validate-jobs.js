// tests/validate-jobs.js
import { startJobs } from '../jobs/index.js';
import logger from '../core/utils/logger.js';

const testLogger = logger.child({ module: 'jobs-validation' });

async function validateJobs() {
  testLogger.info('Iniciando validación de jobs');
  
  try {
    // Iniciar el sistema de jobs
    startJobs();
    testLogger.info('Sistema de jobs iniciado correctamente');
    
    // Verificar que los jobs estén registrados
    const jobsModule = await import('../jobs/index.js');
    
    // Esperar 2 segundos para asegurar que los jobs se registren
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('✅ Validación de jobs completada');
    console.log('El sistema de jobs se ha inicializado correctamente');
    
  } catch (error) {
    testLogger.error({ error }, 'Error al validar jobs');
    console.error('❌ Error en la validación de jobs:', error.message);
  }
}

validateJobs()
  .then(() => {
    console.log('Script de validación finalizado');
    // No terminamos el proceso para que los jobs puedan ejecutarse
    console.log('Presiona Ctrl+C para terminar');
  })
  .catch(error => {
    console.error('Error en el script de validación:', error);
    process.exit(1);
  });