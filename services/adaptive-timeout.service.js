// services/adaptive-timeout.service.js
import { facturapiConfig } from '../config/services.js';
import logger from '../core/utils/logger.js';

// Logger específico para timeouts adaptativos
const timeoutLogger = logger.child({ module: 'adaptive-timeout' });

/**
 * Servicio para manejar timeouts adaptativos según el tipo de operación
 * Mejora el rendimiento y escalabilidad del sistema
 */
class AdaptiveTimeoutService {
  constructor() {
    // Historial de tiempos de respuesta para optimización dinámica
    this.responseTimeHistory = new Map();

    // Métricas de rendimiento
    this.metrics = {
      totalRequests: 0,
      timeoutErrors: 0,
      averageResponseTime: 0,
      slowestOperation: null,
      fastestOperation: null,
    };
  }

  /**
   * Obtener timeout apropiado para el tipo de operación
   * @param {string} operationType - Tipo de operación
   * @param {number} attempt - Número de intento (para backoff)
   * @returns {number} Timeout en milisegundos
   */
  getTimeout(operationType = 'normal', attempt = 1) {
    const baseTimeout = facturapiConfig.timeouts[operationType] || facturapiConfig.timeout;

    // Aplicar backoff exponencial en reintentos
    if (attempt > 1) {
      const backoffMultiplier = Math.pow(facturapiConfig.retryBackoff, attempt - 1);
      const adaptiveTimeout = Math.min(
        baseTimeout * backoffMultiplier,
        facturapiConfig.timeouts.critical
      );

      timeoutLogger.debug('Timeout adaptativo aplicado', {
        operationType,
        attempt,
        baseTimeout,
        adaptiveTimeout,
        backoffMultiplier,
      });

      return adaptiveTimeout;
    }

    return baseTimeout;
  }

  /**
   * Ejecutar operación con timeout adaptativo
   * @param {Function} operation - Función a ejecutar
   * @param {string} operationType - Tipo de operación
   * @param {Object} options - Opciones adicionales
   * @returns {Promise} Resultado de la operación
   */
  async executeWithTimeout(operation, operationType = 'normal', options = {}) {
    const { maxRetries = facturapiConfig.retries, context = {} } = options;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const timeout = this.getTimeout(operationType, attempt);
      const startTime = Date.now();

      try {
        // Crear promesa con timeout
        const result = await Promise.race([
          operation(),
          this.createTimeoutPromise(timeout, operationType, attempt),
        ]);

        // Registrar métricas de éxito
        const responseTime = Date.now() - startTime;
        this.recordMetrics(operationType, responseTime, true, context);

        timeoutLogger.debug('Operación completada exitosamente', {
          operationType,
          attempt,
          responseTime,
          timeout,
          context,
        });

        return result;
      } catch (error) {
        const responseTime = Date.now() - startTime;
        lastError = error;

        // Distinguir entre timeout y otros errores
        const isTimeout = error.message?.includes('timeout') || error.code === 'TIMEOUT';

        this.recordMetrics(operationType, responseTime, false, context);

        if (isTimeout) {
          timeoutLogger.warn('Timeout en operación', {
            operationType,
            attempt,
            timeout,
            responseTime,
            maxRetries,
            context,
          });

          // Si no es el último intento, continuar con retry
          if (attempt <= maxRetries) {
            const retryDelay = this.getRetryDelay(attempt);
            timeoutLogger.info(`Reintentando en ${retryDelay}ms`, {
              operationType,
              attempt: attempt + 1,
              maxRetries,
            });

            await this.delay(retryDelay);
            continue;
          }
        } else {
          // Error no relacionado con timeout, no reintentar
          timeoutLogger.error('Error en operación (no timeout)', {
            operationType,
            attempt,
            error: error.message,
            context,
          });
          throw error;
        }
      }
    }

    // Si llegamos aquí, todos los intentos fallaron
    timeoutLogger.error('Operación falló después de todos los reintentos', {
      operationType,
      maxRetries,
      lastError: lastError?.message,
      context,
    });

    throw new Error(
      `Operación ${operationType} falló después de ${maxRetries + 1} intentos: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Crear promesa que se rechaza después del timeout
   * @param {number} timeout - Timeout en milisegundos
   * @param {string} operationType - Tipo de operación
   * @param {number} attempt - Número de intento
   * @returns {Promise} Promesa que se rechaza por timeout
   */
  createTimeoutPromise(timeout, operationType, attempt) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Timeout: ${operationType} operation exceeded ${timeout}ms (attempt ${attempt})`
          )
        );
      }, timeout);
    });
  }

  /**
   * Obtener delay para reintentos con jitter
   * @param {number} attempt - Número de intento
   * @returns {number} Delay en milisegundos
   */
  getRetryDelay(attempt) {
    const baseDelay = 1000; // 1 segundo base
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);

    // Agregar jitter para evitar thundering herd
    const jitter = Math.random() * 500; // hasta 500ms de jitter

    return Math.min(exponentialDelay + jitter, 10000); // máximo 10 segundos
  }

  /**
   * Delay helper
   * @param {number} ms - Milisegundos a esperar
   * @returns {Promise} Promesa que se resuelve después del delay
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Registrar métricas de rendimiento
   * @param {string} operationType - Tipo de operación
   * @param {number} responseTime - Tiempo de respuesta
   * @param {boolean} success - Si la operación fue exitosa
   * @param {Object} context - Contexto adicional
   */
  recordMetrics(operationType, responseTime, success, context) {
    this.metrics.totalRequests++;

    if (!success && context.timeout) {
      this.metrics.timeoutErrors++;
    }

    // Actualizar tiempo promedio de respuesta
    this.metrics.averageResponseTime =
      (this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + responseTime) /
      this.metrics.totalRequests;

    // Actualizar operación más lenta/rápida
    if (!this.metrics.slowestOperation || responseTime > this.metrics.slowestOperation.time) {
      this.metrics.slowestOperation = { type: operationType, time: responseTime, success };
    }

    if (!this.metrics.fastestOperation || responseTime < this.metrics.fastestOperation.time) {
      this.metrics.fastestOperation = { type: operationType, time: responseTime, success };
    }

    // Mantener historial de tiempos de respuesta por tipo de operación
    if (!this.responseTimeHistory.has(operationType)) {
      this.responseTimeHistory.set(operationType, []);
    }

    const history = this.responseTimeHistory.get(operationType);
    history.push({ time: responseTime, success, timestamp: Date.now() });

    // Mantener solo los últimos 100 registros por tipo
    if (history.length > 100) {
      history.shift();
    }
  }

  /**
   * Obtener métricas de rendimiento
   * @returns {Object} Métricas actuales
   */
  getMetrics() {
    const timeoutRate =
      this.metrics.totalRequests > 0
        ? ((this.metrics.timeoutErrors / this.metrics.totalRequests) * 100).toFixed(2)
        : 0;

    return {
      ...this.metrics,
      timeoutRate: `${timeoutRate}%`,
      responseTimeHistory: Object.fromEntries(
        Array.from(this.responseTimeHistory.entries()).map(([type, history]) => [
          type,
          {
            count: history.length,
            averageTime:
              history.length > 0
                ? (history.reduce((sum, h) => sum + h.time, 0) / history.length).toFixed(2)
                : 0,
            successRate:
              history.length > 0
                ? ((history.filter((h) => h.success).length / history.length) * 100).toFixed(2) +
                  '%'
                : '0%',
          },
        ])
      ),
    };
  }

  /**
   * Resetear métricas
   */
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      timeoutErrors: 0,
      averageResponseTime: 0,
      slowestOperation: null,
      fastestOperation: null,
    };
    this.responseTimeHistory.clear();

    timeoutLogger.info('Métricas de timeout resetadas');
  }
}

// Instancia singleton
const adaptiveTimeoutService = new AdaptiveTimeoutService();

export default adaptiveTimeoutService;
