// services/retry.service.ts
import logger from '../core/utils/logger';

const retryLogger = logger.child({ module: 'retry-service' });

interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
  backoff?: boolean;
  backoffFactor?: number;
  description?: string;
  shouldRetry?: (error: any) => boolean;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  retryDelay: 1000,
  backoff: true,
  backoffFactor: 2,
  description: 'Operación con reintentos',
  shouldRetry: (error: any) => {
    const doNotRetry = ['Authentication', 'Authorization', 'NotFound', 'Forbidden'];

    if (error.name && doNotRetry.some((prefix) => error.name.includes(prefix))) {
      return false;
    }

    if (error.status) {
      return ![401, 403, 404].includes(error.status);
    }

    if (error.response && error.response.status) {
      return ![401, 403, 404].includes(error.response.status);
    }

    return true;
  },
};

/**
 * Ejecuta una función con reintentos automáticos
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const { maxRetries, retryDelay, backoff, backoffFactor, description, shouldRetry } = config;

  let lastError: any = null;
  let attempts = 0;

  while (attempts <= maxRetries) {
    try {
      if (attempts > 0) {
        retryLogger.info(
          { attempt: attempts, maxRetries, description },
          `Reintentando operación (${attempts}/${maxRetries})`
        );
      }

      return await fn();
    } catch (error: any) {
      lastError = error;
      attempts++;

      if (attempts > maxRetries) {
        retryLogger.error(
          { error, attempts, maxRetries, description },
          `Máximo de reintentos alcanzado para: ${description}`
        );
        throw error;
      }

      if (!shouldRetry(error)) {
        retryLogger.info(
          { error: error.message, attempts, description },
          `No se reintentará operación: ${description}`
        );
        throw error;
      }

      const delay = backoff ? retryDelay * Math.pow(backoffFactor, attempts - 1) : retryDelay;

      retryLogger.debug(
        { delay, attempt: attempts, description },
        `Esperando ${delay}ms antes del siguiente reintento`
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Decorador para añadir reintentos automáticos a un método
 */
export function withRetryDecorator(options: RetryOptions = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
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
