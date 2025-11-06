// services/adaptive-timeout.service.ts
import logger from '../core/utils/logger';

const timeoutLogger = logger.child({ module: 'adaptive-timeout' });

interface OperationMetric {
  type: string;
  time: number;
  success: boolean;
}

interface Metrics {
  totalRequests: number;
  timeoutErrors: number;
  averageResponseTime: number;
  slowestOperation: OperationMetric | null;
  fastestOperation: OperationMetric | null;
}

interface HistoryEntry {
  time: number;
  success: boolean;
  timestamp: number;
}

interface ExecuteOptions {
  maxRetries?: number;
  context?: Record<string, any>;
}

const DEFAULT_TIMEOUTS: Record<string, number> = {
  normal: 15000,
  fast: 5000,
  slow: 30000,
  critical: 60000,
};

const DEFAULT_CONFIG = {
  timeout: 15000,
  retries: 3,
  retryBackoff: 1.5,
  timeouts: DEFAULT_TIMEOUTS,
};

/**
 * Servicio para manejar timeouts adaptativos
 */
class AdaptiveTimeoutService {
  private responseTimeHistory = new Map<string, HistoryEntry[]>();
  private metrics: Metrics = {
    totalRequests: 0,
    timeoutErrors: 0,
    averageResponseTime: 0,
    slowestOperation: null,
    fastestOperation: null,
  };

  getTimeout(operationType: string = 'normal', attempt: number = 1): number {
    const baseTimeout = DEFAULT_CONFIG.timeouts[operationType] || DEFAULT_CONFIG.timeout;

    if (attempt > 1) {
      const backoffMultiplier = Math.pow(DEFAULT_CONFIG.retryBackoff, attempt - 1);
      const adaptiveTimeout = Math.min(
        baseTimeout * backoffMultiplier,
        DEFAULT_CONFIG.timeouts.critical
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

  async executeWithTimeout<T>(
    operation: () => Promise<T>,
    operationType: string = 'normal',
    options: ExecuteOptions = {}
  ): Promise<T> {
    const { maxRetries = DEFAULT_CONFIG.retries, context = {} } = options;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const timeout = this.getTimeout(operationType, attempt);
      const startTime = Date.now();

      try {
        const result = await Promise.race([
          operation(),
          this.createTimeoutPromise(timeout, operationType, attempt),
        ]);

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
      } catch (error: any) {
        const responseTime = Date.now() - startTime;
        lastError = error;

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

  createTimeoutPromise(timeout: number, operationType: string, attempt: number): Promise<never> {
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

  getRetryDelay(attempt: number): number {
    const baseDelay = 1000;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 500;
    return Math.min(exponentialDelay + jitter, 10000);
  }

  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  recordMetrics(
    operationType: string,
    responseTime: number,
    success: boolean,
    context: Record<string, any>
  ): void {
    this.metrics.totalRequests++;

    if (!success && context.timeout) {
      this.metrics.timeoutErrors++;
    }

    this.metrics.averageResponseTime =
      (this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + responseTime) /
      this.metrics.totalRequests;

    if (!this.metrics.slowestOperation || responseTime > this.metrics.slowestOperation.time) {
      this.metrics.slowestOperation = { type: operationType, time: responseTime, success };
    }

    if (!this.metrics.fastestOperation || responseTime < this.metrics.fastestOperation.time) {
      this.metrics.fastestOperation = { type: operationType, time: responseTime, success };
    }

    if (!this.responseTimeHistory.has(operationType)) {
      this.responseTimeHistory.set(operationType, []);
    }

    const history = this.responseTimeHistory.get(operationType)!;
    history.push({ time: responseTime, success, timestamp: Date.now() });

    if (history.length > 100) {
      history.shift();
    }
  }

  getMetrics() {
    const timeoutRate =
      this.metrics.totalRequests > 0
        ? ((this.metrics.timeoutErrors / this.metrics.totalRequests) * 100).toFixed(2)
        : '0';

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
                : '0',
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

  resetMetrics(): void {
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

const adaptiveTimeoutService = new AdaptiveTimeoutService();

export default adaptiveTimeoutService;
