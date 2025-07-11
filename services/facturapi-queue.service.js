// services/facturapi-queue.service.js
import logger from '../core/utils/logger.js';
import adaptiveTimeoutService from './adaptive-timeout.service.js';

// Logger específico para la cola de FacturAPI
const queueLogger = logger.child({ module: 'facturapi-queue' });

/**
 * Sistema básico de cola para manejar solicitudes a FacturAPI
 * Previene sobrecarga y mejora la escalabilidad
 */
class FacturapiQueueService {
  constructor() {
    // Cola de solicitudes pendientes
    this.queue = [];

    // Solicitudes en procesamiento
    this.processing = new Set();

    // Configuración de la cola
    this.config = {
      maxConcurrent: 5, // Máximo 5 solicitudes concurrentes a FacturAPI
      maxQueueSize: 100, // Máximo 100 solicitudes en cola
      processingDelay: 200, // 200ms entre procesamiento de solicitudes
      retryDelay: 2000, // 2 segundos para reintento
      maxRetries: 3, // Máximo 3 reintentos
    };

    // Métricas de la cola
    this.metrics = {
      totalProcessed: 0,
      totalFailed: 0,
      currentQueueSize: 0,
      currentProcessing: 0,
      averageWaitTime: 0,
      peakQueueSize: 0,
    };

    // Iniciar procesamiento de la cola
    this.startQueueProcessor();
  }

  /**
   * Agregar solicitud a la cola
   * @param {Function} operation - Operación a ejecutar
   * @param {string} operationType - Tipo de operación
   * @param {Object} context - Contexto adicional
   * @param {number} priority - Prioridad (mayor número = mayor prioridad)
   * @returns {Promise} Promesa que se resuelve cuando la operación complete
   */
  async enqueue(operation, operationType = 'normal', context = {}, priority = 1) {
    return new Promise((resolve, reject) => {
      // Verificar que la cola no esté llena
      if (this.queue.length >= this.config.maxQueueSize) {
        const error = new Error(
          `Cola de FacturAPI llena (${this.config.maxQueueSize} solicitudes)`
        );
        queueLogger.error('Cola llena, rechazando solicitud', {
          queueSize: this.queue.length,
          operationType,
          context,
        });
        reject(error);
        return;
      }

      const queueItem = {
        id: this.generateId(),
        operation,
        operationType,
        context,
        priority,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        retries: 0,
        maxRetries: this.config.maxRetries,
      };

      // Insertar en la cola manteniendo orden de prioridad
      this.insertByPriority(queueItem);

      // Actualizar métricas
      this.metrics.currentQueueSize = this.queue.length;
      this.metrics.peakQueueSize = Math.max(this.metrics.peakQueueSize, this.queue.length);

      queueLogger.debug('Solicitud agregada a la cola', {
        id: queueItem.id,
        operationType,
        priority,
        queuePosition: this.queue.length,
        context,
      });
    });
  }

  /**
   * Insertar elemento en la cola manteniendo orden de prioridad
   * @param {Object} item - Elemento a insertar
   */
  insertByPriority(item) {
    let inserted = false;

    for (let i = 0; i < this.queue.length; i++) {
      if (item.priority > this.queue[i].priority) {
        this.queue.splice(i, 0, item);
        inserted = true;
        break;
      }
    }

    // Si no se insertó, agregar al final
    if (!inserted) {
      this.queue.push(item);
    }
  }

  /**
   * Procesador principal de la cola
   */
  async startQueueProcessor() {
    queueLogger.info('Iniciando procesador de cola FacturAPI', this.config);

    while (true) {
      try {
        // Si hay espacio para procesar más solicitudes
        if (this.processing.size < this.config.maxConcurrent && this.queue.length > 0) {
          const item = this.queue.shift();
          this.metrics.currentQueueSize = this.queue.length;

          // Procesar la solicitud de forma asíncrona
          this.processItem(item);
        }

        // Esperar antes del próximo ciclo
        await this.delay(this.config.processingDelay);
      } catch (error) {
        queueLogger.error('Error en procesador de cola', error);
        await this.delay(1000); // Esperar más tiempo si hay error
      }
    }
  }

  /**
   * Procesar un elemento de la cola
   * @param {Object} item - Elemento a procesar
   */
  async processItem(item) {
    this.processing.add(item.id);
    this.metrics.currentProcessing = this.processing.size;

    const waitTime = Date.now() - item.enqueuedAt;
    this.updateAverageWaitTime(waitTime);

    queueLogger.debug('Procesando solicitud', {
      id: item.id,
      operationType: item.operationType,
      waitTime,
      retries: item.retries,
      currentProcessing: this.processing.size,
    });

    try {
      // Ejecutar la operación con timeout adaptativo
      const result = await adaptiveTimeoutService.executeWithTimeout(
        item.operation,
        item.operationType,
        { context: item.context }
      );

      // Operación exitosa
      this.metrics.totalProcessed++;
      item.resolve(result);

      queueLogger.debug('Solicitud completada exitosamente', {
        id: item.id,
        operationType: item.operationType,
        processingTime: Date.now() - (item.enqueuedAt + waitTime),
      });
    } catch (error) {
      // Manejar error - posible reintento
      if (item.retries < item.maxRetries && this.shouldRetry(error)) {
        item.retries++;

        queueLogger.warn('Solicitud falló, reintentando', {
          id: item.id,
          operationType: item.operationType,
          error: error.message,
          retries: item.retries,
          maxRetries: item.maxRetries,
        });

        // Agregar de vuelta a la cola con menor prioridad
        setTimeout(() => {
          item.priority = Math.max(item.priority - 1, 0);
          this.insertByPriority(item);
          this.metrics.currentQueueSize = this.queue.length;
        }, this.config.retryDelay);
      } else {
        // Error final
        this.metrics.totalFailed++;
        item.reject(error);

        queueLogger.error('Solicitud falló definitivamente', {
          id: item.id,
          operationType: item.operationType,
          error: error.message,
          retries: item.retries,
        });
      }
    } finally {
      // Remover de procesamiento
      this.processing.delete(item.id);
      this.metrics.currentProcessing = this.processing.size;
    }
  }

  /**
   * Determinar si un error amerita reintento
   * @param {Error} error - Error a evaluar
   * @returns {boolean} Si debe reintentarse
   */
  shouldRetry(error) {
    // Reintentar solo en timeouts y errores de red
    const retryableErrors = [
      'timeout',
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'socket hang up',
    ];

    return retryableErrors.some(
      (retryableError) =>
        error.message?.toLowerCase().includes(retryableError.toLowerCase()) ||
        error.code?.toLowerCase().includes(retryableError.toLowerCase())
    );
  }

  /**
   * Actualizar tiempo promedio de espera
   * @param {number} waitTime - Tiempo de espera de la solicitud actual
   */
  updateAverageWaitTime(waitTime) {
    const totalRequests = this.metrics.totalProcessed + this.metrics.totalFailed + 1;
    this.metrics.averageWaitTime =
      (this.metrics.averageWaitTime * (totalRequests - 1) + waitTime) / totalRequests;
  }

  /**
   * Generar ID único para solicitudes
   * @returns {string} ID único
   */
  generateId() {
    return `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Helper para delay
   * @param {number} ms - Milisegundos a esperar
   * @returns {Promise} Promesa que se resuelve después del delay
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Obtener métricas de la cola
   * @returns {Object} Métricas actuales
   */
  getMetrics() {
    const totalRequests = this.metrics.totalProcessed + this.metrics.totalFailed;
    const successRate =
      totalRequests > 0 ? ((this.metrics.totalProcessed / totalRequests) * 100).toFixed(2) : 100;

    return {
      ...this.metrics,
      successRate: `${successRate}%`,
      averageWaitTime: Math.round(this.metrics.averageWaitTime),
      config: this.config,
    };
  }

  /**
   * Limpiar la cola (solo para emergencias)
   */
  clearQueue() {
    const rejectedCount = this.queue.length;

    this.queue.forEach((item) => {
      item.reject(new Error('Cola limpiada por administrador'));
    });

    this.queue = [];
    this.metrics.currentQueueSize = 0;

    queueLogger.warn('Cola limpiada por administrador', { rejectedCount });
  }

  /**
   * Obtener estado detallado de la cola
   * @returns {Object} Estado actual
   */
  getStatus() {
    return {
      isHealthy: this.queue.length < this.config.maxQueueSize * 0.8,
      queueItems: this.queue.map((item) => ({
        id: item.id,
        operationType: item.operationType,
        priority: item.priority,
        waitTime: Date.now() - item.enqueuedAt,
        retries: item.retries,
      })),
      processingItems: Array.from(this.processing),
      metrics: this.getMetrics(),
    };
  }
}

// Instancia singleton
const facturapiQueueService = new FacturapiQueueService();

export default facturapiQueueService;
