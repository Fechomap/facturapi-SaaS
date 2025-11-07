/**
 * Redis Batch State Service
 * Gestiona el estado temporal de lotes de facturación (ESCOTEL, AXA, CHUBB, etc.)
 * Reemplaza el anti-patrón de cache global en memoria
 */

import { createModuleLogger } from '@core/utils/logger.js';
import redisSessionService from './redis-session.service.js';
import { v4 as uuidv4 } from 'uuid';

const logger = createModuleLogger('RedisBatchState');

const BATCH_EXPIRATION_SECONDS = 900; // 15 minutos

export interface BatchDataBase {
  batchId: string;
  userId: number;
  timestamp: number;
  clientName?: string;
  [key: string]: unknown;
}

export interface ServiceResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Redis Batch State Service Class
 */
class RedisBatchStateService {
  /**
   * Genera un ID único para un batch
   */
  generateBatchId(): string {
    return uuidv4();
  }

  /**
   * Guarda datos de un batch con ID único
   */
  async saveBatchData<T extends BatchDataBase>(
    userId: number,
    batchId: string,
    data: T
  ): Promise<ServiceResult<string>> {
    try {
      const key = `batch:${userId}:${batchId}`;

      const batchData: T = {
        ...data,
        batchId,
        userId,
        timestamp: Date.now(),
      };

      const result = await redisSessionService.setSession(
        key,
        batchData as Record<string, unknown>,
        BATCH_EXPIRATION_SECONDS
      );

      if (!result.success) {
        logger.error({ userId, batchId, error: result.error }, 'Error guardando batch data');
        return { success: false, error: result.error };
      }

      logger.info({ userId, batchId, ttl: BATCH_EXPIRATION_SECONDS }, 'Batch data guardado exitosamente');
      return { success: true, data: batchId };
    } catch (error) {
      logger.error({ userId, batchId, error }, 'Error guardando batch data');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      };
    }
  }

  /**
   * Obtiene datos de un batch específico
   */
  async getBatchData<T extends BatchDataBase>(
    userId: number,
    batchId: string
  ): Promise<ServiceResult<T>> {
    try {
      const key = `batch:${userId}:${batchId}`;

      const result = await redisSessionService.getSession(key);

      if (!result.success || !result.data) {
        logger.warn({ userId, batchId }, 'Batch data no encontrado o expirado');
        return { success: false, error: 'Batch no encontrado o expirado' };
      }

      logger.debug({ userId, batchId }, 'Batch data recuperado');
      return { success: true, data: result.data as T };
    } catch (error) {
      logger.error({ userId, batchId, error }, 'Error obteniendo batch data');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      };
    }
  }

  /**
   * Elimina datos de un batch (después de procesarlo o cancelarlo)
   */
  async deleteBatchData(userId: number, batchId: string): Promise<ServiceResult<void>> {
    try {
      const key = `batch:${userId}:${batchId}`;

      const result = await redisSessionService.deleteSession(key);

      if (!result.success) {
        logger.error({ userId, batchId, error: result.error }, 'Error eliminando batch data');
        return { success: false, error: result.error };
      }

      logger.info({ userId, batchId }, 'Batch data eliminado');
      return { success: true };
    } catch (error) {
      logger.error({ userId, batchId, error }, 'Error eliminando batch data');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      };
    }
  }

  /**
   * Actualiza datos de un batch existente (útil para agregar información durante el procesamiento)
   */
  async updateBatchData<T extends BatchDataBase>(
    userId: number,
    batchId: string,
    updates: Partial<T>
  ): Promise<ServiceResult<T>> {
    try {
      // Obtener datos actuales
      const currentResult = await this.getBatchData<T>(userId, batchId);

      if (!currentResult.success || !currentResult.data) {
        return { success: false, error: 'Batch no encontrado para actualizar' };
      }

      // Merge con nuevos datos
      const updatedData: T = {
        ...currentResult.data,
        ...updates,
        timestamp: Date.now(), // Actualizar timestamp
      };

      // Guardar actualización
      const saveResult = await this.saveBatchData(userId, batchId, updatedData);

      if (!saveResult.success) {
        return { success: false, error: saveResult.error };
      }

      logger.info({ userId, batchId }, 'Batch data actualizado');
      return { success: true, data: updatedData };
    } catch (error) {
      logger.error({ userId, batchId, error }, 'Error actualizando batch data');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      };
    }
  }
}

// Export singleton instance
const redisBatchStateService = new RedisBatchStateService();
export default redisBatchStateService;
