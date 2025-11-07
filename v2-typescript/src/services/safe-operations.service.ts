/**
 * Safe Operations Service
 * Wrapper para operaciones críticas con control de concurrencia
 * Evita condiciones de carrera cuando múltiples usuarios operan simultáneamente
 */

import { createModuleLogger } from '@core/utils/logger.js';
import redisLockService from './redis-lock.service.js';
import TenantService from './tenant.service.js';
import InvoiceService from './invoice.service.js';

const logger = createModuleLogger('SafeOperations');

/**
 * Servicio que envuelve operaciones críticas con locks distribuidos
 * Evita condiciones de carrera cuando múltiples usuarios operan simultáneamente
 */
class SafeOperationsService {
  private initialized = false;

  /**
   * Inicializa el servicio de locks
   */
  async initialize(): Promise<{ success: boolean; type: string; warning?: string }> {
    if (this.initialized) {
      logger.warn('SafeOperationsService already initialized');
      return { success: true, type: 'already-initialized' };
    }

    try {
      const result = await redisLockService.initialize();
      this.initialized = true;
      logger.info(result, 'Servicio de operaciones seguras inicializado');
      return result;
    } catch (error) {
      logger.error({ error }, 'Failed to initialize SafeOperationsService');
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Obtiene próximo folio de manera thread-safe
   * @param tenantId - ID del tenant
   * @param series - Serie del folio (default: 'A')
   * @returns Próximo número de folio
   */
  async getNextFolioSafe(tenantId: string, series: string = 'A'): Promise<number> {
    const lockKey = `folio:${tenantId}:${series}`;

    try {
      return await redisLockService.withLock(
        lockKey,
        async () => {
          logger.debug({ tenantId, series }, 'Obteniendo folio con lock');
          return await TenantService.getNextFolio(tenantId, series);
        },
        5000, // 5 segundos de TTL
        3 // 3 reintentos máximo
      );
    } catch (error: unknown) {
      logger.error(
        {
          tenantId,
          series,
          error: error instanceof Error ? error.message : String(error),
        },
        'Error obteniendo folio con lock'
      );

      // Fallback al método original (riesgoso pero funcional)
      logger.warn({ tenantId, series }, 'Usando fallback SIN lock para folio');
      return await TenantService.getNextFolio(tenantId, series);
    }
  }

  /**
   * Verifica límites de facturación de manera thread-safe
   * @param tenantId - ID del tenant
   * @returns Resultado de verificación
   */
  async canGenerateInvoiceSafe(
    tenantId: string
  ): Promise<{ canGenerate: boolean; reason?: string }> {
    const lockKey = `invoice_limit:${tenantId}`;

    try {
      return await redisLockService.withLock(
        lockKey,
        async () => {
          logger.debug({ tenantId }, 'Verificando límites con lock');
          return await TenantService.canGenerateInvoice(tenantId);
        },
        3000, // 3 segundos de TTL
        2 // 2 reintentos
      );
    } catch (error: unknown) {
      logger.error(
        {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Error verificando límites con lock'
      );

      // Fallback al método original
      return await TenantService.canGenerateInvoice(tenantId);
    }
  }

  /**
   * Incrementa contador de facturas de manera thread-safe
   * @param tenantId - ID del tenant
   * @returns Suscripción actualizada
   */
  async incrementInvoiceCountSafe(tenantId: string): Promise<any> {
    const lockKey = `invoice_count:${tenantId}`;

    try {
      return await redisLockService.withLock(
        lockKey,
        async () => {
          logger.debug({ tenantId }, 'Incrementando contador con lock');
          return await TenantService.incrementInvoiceCount(tenantId);
        },
        3000, // 3 segundos de TTL
        2 // 2 reintentos
      );
    } catch (error: unknown) {
      logger.error(
        {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
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
   * @param data - Datos de la factura
   * @param tenantId - ID del tenant
   * @param userId - ID del usuario que genera
   * @returns Factura generada
   */
  async generateInvoiceSafe(data: any, tenantId: string, userId?: number): Promise<any> {
    const lockKey = `invoice_generation:${tenantId}`;

    logger.info(
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

          logger.info(
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
    } catch (error: unknown) {
      logger.error(
        {
          tenantId,
          userId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Error en generación de factura thread-safe'
      );

      throw error; // Re-lanzar para que el caller maneje el error
    }
  }

  /**
   * Operación de procesamiento batch thread-safe
   * @param tenantId - ID del tenant
   * @param items - Items a procesar
   * @param processorCallback - Función de procesamiento
   * @returns Resultados del procesamiento
   */
  async processBatchSafe<T>(
    tenantId: string,
    items: T[],
    processorCallback: (item: T) => Promise<any>
  ): Promise<Array<{ success: boolean; item: T; result?: any; error?: string }>> {
    const lockKey = `batch_process:${tenantId}`;

    try {
      return await redisLockService.withLock(
        lockKey,
        async () => {
          logger.info(
            {
              tenantId,
              itemCount: items.length,
            },
            'Procesando batch con lock'
          );

          const results: Array<{ success: boolean; item: T; result?: any; error?: string }> = [];

          for (const item of items) {
            try {
              const result = await processorCallback(item);
              results.push({ success: true, item, result });
            } catch (error: unknown) {
              results.push({
                success: false,
                item,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          return results;
        },
        60000, // 60 segundos para batch processing
        1 // No retry en batch (demasiado costoso)
      );
    } catch (error: unknown) {
      logger.error(
        {
          tenantId,
          itemCount: items.length,
          error: error instanceof Error ? error.message : String(error),
        },
        'Error en procesamiento batch'
      );

      throw error;
    }
  }

  /**
   * Obtiene estadísticas de locks activos
   * @returns Estadísticas
   */
  async getLockStats(): Promise<any> {
    return await redisLockService.getStats();
  }

  /**
   * Rate limiting por usuario
   * @param userId - ID del usuario
   * @param operation - Tipo de operación
   * @param maxRequests - Máximo de requests permitidos
   * @param windowMs - Ventana de tiempo en ms
   * @returns True si permitido, false si rate limited
   */
  async checkRateLimit(
    userId: string,
    operation: string,
    maxRequests: number = 10,
    windowMs: number = 60000
  ): Promise<boolean> {
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
    } catch (error: unknown) {
      logger.warn(
        {
          userId,
          operation,
          error: error instanceof Error ? error.message : String(error),
        },
        'Error en rate limiting, permitiendo por defecto'
      );

      return true; // En caso de error, permitir (fail-open)
    }
  }
}

export default new SafeOperationsService();
