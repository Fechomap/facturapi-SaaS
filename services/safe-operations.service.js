// feature-multiuser/services/safe-operations.service.js
// Wrapper para operaciones críticas con control de concurrencia

import TenantService from '../../services/tenant.service.js';
import InvoiceService from '../../services/invoice.service.js';
import redisLockService from './redis-lock.service.js';
import logger from '../../core/utils/logger.js';

const safeOpsLogger = logger.child({ module: 'safe-operations' });

/**
 * Servicio que envuelve operaciones críticas con locks distribuidos
 * Evita condiciones de carrera cuando múltiples usuarios operan simultáneamente
 */
class SafeOperationsService {
  /**
   * Inicializa el servicio de locks
   */
  static async initialize() {
    const result = await redisLockService.initialize();
    safeOpsLogger.info(result, 'Servicio de operaciones seguras inicializado');
    return result;
  }

  /**
   * Obtiene próximo folio de manera thread-safe
   * @param {string} tenantId - ID del tenant
   * @param {string} series - Serie del folio (default: 'A')
   * @returns {Promise<number>} - Próximo número de folio
   */
  static async getNextFolioSafe(tenantId, series = 'A') {
    const lockKey = `folio:${tenantId}:${series}`;

    try {
      return await redisLockService.withLock(
        lockKey,
        async () => {
          safeOpsLogger.debug({ tenantId, series }, 'Obteniendo folio con lock');
          return await TenantService.getNextFolio(tenantId, series);
        },
        5000, // 5 segundos de TTL
        3 // 3 reintentos máximo
      );
    } catch (error) {
      safeOpsLogger.error(
        {
          tenantId,
          series,
          error: error.message,
        },
        'Error obteniendo folio con lock'
      );

      // Fallback al método original (riesgoso pero funcional)
      safeOpsLogger.warn({ tenantId, series }, 'Usando fallback SIN lock para folio');
      return await TenantService.getNextFolio(tenantId, series);
    }
  }

  /**
   * Verifica límites de facturación de manera thread-safe
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Resultado de verificación
   */
  static async canGenerateInvoiceSafe(tenantId) {
    const lockKey = `invoice_limit:${tenantId}`;

    try {
      return await redisLockService.withLock(
        lockKey,
        async () => {
          safeOpsLogger.debug({ tenantId }, 'Verificando límites con lock');
          return await TenantService.canGenerateInvoice(tenantId);
        },
        3000, // 3 segundos de TTL
        2 // 2 reintentos
      );
    } catch (error) {
      safeOpsLogger.error(
        {
          tenantId,
          error: error.message,
        },
        'Error verificando límites con lock'
      );

      // Fallback al método original
      return await TenantService.canGenerateInvoice(tenantId);
    }
  }

  /**
   * Incrementa contador de facturas de manera thread-safe
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Suscripción actualizada
   */
  static async incrementInvoiceCountSafe(tenantId) {
    const lockKey = `invoice_count:${tenantId}`;

    try {
      return await redisLockService.withLock(
        lockKey,
        async () => {
          safeOpsLogger.debug({ tenantId }, 'Incrementando contador con lock');
          return await TenantService.incrementInvoiceCount(tenantId);
        },
        3000, // 3 segundos de TTL
        2 // 2 reintentos
      );
    } catch (error) {
      safeOpsLogger.error(
        {
          tenantId,
          error: error.message,
        },
        'Error incrementando contador con lock'
      );

      // En este caso, mejor fallar que duplicar contadores
      throw error;
    }
  }

  /**
   * Genera factura de manera completamente thread-safe
   * Combina todas las operaciones críticas con locks apropiados
   * @param {Object} data - Datos de la factura
   * @param {string} tenantId - ID del tenant
   * @param {string|number} userId - ID del usuario que genera
   * @returns {Promise<Object>} - Factura generada
   */
  static async generateInvoiceSafe(data, tenantId, userId) {
    const lockKey = `invoice_generation:${tenantId}`;

    safeOpsLogger.info(
      {
        tenantId,
        userId,
        clienteId: data.clienteId,
      },
      'Iniciando generación de factura thread-safe'
    );

    try {
      return await redisLockService.withLock(
        lockKey,
        async () => {
          // 1. Verificar límites de manera atómica
          const canGenerate = await TenantService.canGenerateInvoice(tenantId);
          if (!canGenerate.canGenerate) {
            throw new Error(`No se puede generar factura: ${canGenerate.reason}`);
          }

          // 2. Generar factura (InvoiceService ya maneja el folio internamente)
          const factura = await InvoiceService.generateInvoice(data, tenantId);

          // 3. Incrementar contador de manera atómica
          await TenantService.incrementInvoiceCount(tenantId);

          safeOpsLogger.info(
            {
              tenantId,
              userId,
              facturaId: factura.id,
              folio: factura.folio_number,
            },
            'Factura generada exitosamente con locks'
          );

          return factura;
        },
        15000, // 15 segundos de TTL (generación puede tomar tiempo)
        1 // Solo 1 intento (no retry en generación completa)
      );
    } catch (error) {
      safeOpsLogger.error(
        {
          tenantId,
          userId,
          error: error.message,
        },
        'Error en generación de factura thread-safe'
      );

      throw error; // Re-lanzar para que el caller maneje el error
    }
  }

  /**
   * Operación de procesamiento batch thread-safe
   * @param {string} tenantId - ID del tenant
   * @param {Array} items - Items a procesar
   * @param {Function} processorCallback - Función de procesamiento
   * @returns {Promise<Array>} - Resultados del procesamiento
   */
  static async processBatchSafe(tenantId, items, processorCallback) {
    const lockKey = `batch_process:${tenantId}`;

    try {
      return await redisLockService.withLock(
        lockKey,
        async () => {
          safeOpsLogger.info(
            {
              tenantId,
              itemCount: items.length,
            },
            'Procesando batch con lock'
          );

          const results = [];
          for (const item of items) {
            try {
              const result = await processorCallback(item);
              results.push({ success: true, item, result });
            } catch (error) {
              results.push({ success: false, item, error: error.message });
            }
          }

          return results;
        },
        60000, // 60 segundos para batch processing
        1 // No retry en batch (demasiado costoso)
      );
    } catch (error) {
      safeOpsLogger.error(
        {
          tenantId,
          itemCount: items.length,
          error: error.message,
        },
        'Error en procesamiento batch'
      );

      throw error;
    }
  }

  /**
   * Obtiene estadísticas de locks activos
   * @returns {Promise<Object>} - Estadísticas
   */
  static async getLockStats() {
    return await redisLockService.getStats();
  }

  /**
   * Rate limiting por usuario
   * @param {string} userId - ID del usuario
   * @param {string} operation - Tipo de operación
   * @param {number} maxRequests - Máximo de requests permitidos
   * @param {number} windowMs - Ventana de tiempo en ms
   * @returns {Promise<boolean>} - True si permitido, false si rate limited
   */
  static async checkRateLimit(userId, operation, _maxRequests = 10, _windowMs = 60000) {
    const lockKey = `rate_limit:${userId}:${operation}`;

    try {
      return await redisLockService.withLock(
        lockKey,
        async () => {
          // Implementar lógica de rate limiting
          // Por simplicidad, permitir todo por ahora
          // TODO: Implementar contador con TTL en Redis
          return true;
        },
        1000, // 1 segundo
        1 // Sin retry
      );
    } catch (error) {
      safeOpsLogger.warn(
        {
          userId,
          operation,
          error: error.message,
        },
        'Error en rate limiting, permitiendo por defecto'
      );

      return true; // En caso de error, permitir (fail-open)
    }
  }
}

export default SafeOperationsService;
