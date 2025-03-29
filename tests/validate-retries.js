// tests/validate-retries.js
import { withRetry } from '../services/retry.service.js';
import logger from '../core/utils/logger.js';

const testLogger = logger.child({ module: 'retry-validation' });

async function validateRetries() {
  testLogger.info('Iniciando validación de sistema de reintentos');
  
  // Contador de intentos para simulación
  let attempts = 0;
  
  try {
    // Probar función que falla las primeras veces
    const result = await withRetry(
      async () => {
        attempts++;
        console.log(`Intento ${attempts}...`);
        
        if (attempts < 3) {
          throw new Error(`Fallo simulado (intento ${attempts})`);
        }
        
        return `Éxito en el intento ${attempts}`;
      },
      {
        maxRetries: 3,
        retryDelay: 1000,
        description: 'Prueba de reintentos'
      }
    );
    
    console.log(`✅ Sistema de reintentos funcionando correctamente`);
    console.log(`Resultado final: ${result}`);
    
    // Probar que errorea correctamente cuando se superan los reintentos
    attempts = 0;
    try {
      await withRetry(
        async () => {
          attempts++;
          console.log(`Intento de error ${attempts}...`);
          throw new Error(`Fallo permanente simulado`);
        },
        {
          maxRetries: 2,
          retryDelay: 500,
          description: 'Prueba de error final'
        }
      );
      
      console.error('❌ La función debería haber fallado pero no lo hizo');
    } catch (error) {
      console.log(`✅ El sistema falla correctamente cuando se superan los reintentos`);
    }
    
  } catch (error) {
    testLogger.error({ error }, 'Error al validar sistema de reintentos');
    console.error('❌ Error en la validación de reintentos:', error.message);
  }
}

validateRetries()
  .then(() => {
    console.log('Script de validación finalizado');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error en el script de validación:', error);
    process.exit(1);
  });