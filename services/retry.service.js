// services/retry.service.js - Servicio para reintentos automáticos
import logger from '../core/utils/logger.js';

// Logger específico para reintentos
const retryLogger = logger.child({ module: 'retry-service' });

/**
 * Opciones por defecto para reintentos
 */
const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 3,
  retryDelay: 1000, // ms
  backoff: true, // Incrementar tiempo entre reintentos
  backoffFactor: 2, // Factor de multiplicación para backoff
  description: 'Operación con reintentos', // Descripción para logs
  shouldRetry: null, // Función personalizada para decidir si reintentar
};

/**
 * Ejecuta una función con reintentos automáticos en caso de error
 * @param {Function} fn - Función a ejecutar con reintentos
 * @param {Object} options - Opciones para los reintentos
 * @returns {Promise<any>} - Resultado de la función
 */
export async function withRetry(fn, options = {}) {
  // Combinar opciones con valores por defecto
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const { maxRetries, retryDelay, backoff, backoffFactor, description, shouldRetry } = config;

  let lastError = null;
  let attempts = 0;

  // Función para decidir si se debe reintentar
  const shouldRetryFn =
    shouldRetry ||
    ((error) => {
      // Por defecto, reintentamos todos los errores excepto los que indiquen
      // un problema de autorización/autenticación o que el recurso no existe
      const doNotRetry = ['Authentication', 'Authorization', 'NotFound', 'Forbidden'];

      // Si el error tiene un nombre específico que indica no reintentar
      if (error.name && doNotRetry.some((prefix) => error.name.includes(prefix))) {
        return false;
      }

      // Si el error tiene un código HTTP que indica no reintentar
      if (error.status) {
        return ![401, 403, 404].includes(error.status);
      }

      // Si el error es de respuesta HTTP
      if (error.response && error.response.status) {
        return ![401, 403, 404].includes(error.response.status);
      }

      // Por defecto, reintentar
      return true;
    });

  while (attempts <= maxRetries) {
    try {
      if (attempts > 0) {
        retryLogger.info(
          { attempt: attempts, maxRetries, description },
          `Reintentando operación (${attempts}/${maxRetries})`
        );
      }

      // Ejecutar la función
      return await fn();
    } catch (error) {
      lastError = error;
      attempts++;

      // Si hemos alcanzado el máximo de reintentos, lanzar el último error
      if (attempts > maxRetries) {
        retryLogger.error(
          { error, attempts, maxRetries, description },
          `Máximo de reintentos alcanzado para: ${description}`
        );
        throw error;
      }

      // Verificar si debemos reintentar según la función personalizada
      if (!shouldRetryFn(error)) {
        retryLogger.info(
          { error: error.message, attempts, description },
          `No se reintentará operación: ${description}`
        );
        throw error;
      }

      // Calcular el tiempo de espera para el siguiente reintento
      const delay = backoff ? retryDelay * Math.pow(backoffFactor, attempts - 1) : retryDelay;

      retryLogger.debug(
        { delay, attempt: attempts, description },
        `Esperando ${delay}ms antes del siguiente reintento`
      );

      // Esperar antes del siguiente reintento
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Este código no debería ejecutarse, pero por si acaso
  throw lastError;
}

/**
 * Decorador para añadir reintentos automáticos a un método de clase
 * @param {Object} options - Opciones para los reintentos
 * @returns {Function} - Decorador de método
 */
export function withRetryDecorator(options = {}) {
  return function (target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args) {
      return withRetry(() => originalMethod.apply(this, args), {
        ...options,
        description: options.description || `Método ${propertyKey}`,
      });
    };

    return descriptor;
  };
}

export default {
  withRetry,
  withRetryDecorator,
};
