// core/utils/transaction.js
import { prisma } from '../../config/database.js';
import logger from './logger.js';

// Logger específico para transacciones
const transactionLogger = logger.child({ module: 'transaction' });

/**
 * Ejecuta una operación dentro de una transacción de base de datos
 * @param {Function} callback - Función a ejecutar dentro de la transacción
 * @param {Object} options - Opciones para la transacción
 * @returns {Promise<any>} - Resultado de la operación
 */
export async function withTransaction(callback, options = {}) {
  const { logParams = false, description = 'Transacción' } = options;

  transactionLogger.debug(`Iniciando: ${description}`);

  try {
    // Ejecutar la operación dentro de una transacción
    const result = await prisma.$transaction(async (tx) => {
      return await callback(tx);
    });

    if (logParams) {
      transactionLogger.debug({ result }, `Completada: ${description}`);
    } else {
      transactionLogger.debug(`Completada: ${description}`);
    }

    return result;
  } catch (error) {
    transactionLogger.error(
      { error: error.message, stack: error.stack },
      `Error en transacción: ${description}`
    );
    throw error;
  }
}

/**
 * Registra una operación en el log de auditoría
 * @param {Object} prismaClient - Cliente Prisma o transacción
 * @param {Object} params - Parámetros de la auditoría
 * @returns {Promise<Object>} - Registro de auditoría creado
 */
export async function auditLog(prismaClient, params) {
  const { tenantId, userId, action, entityType, entityId, details, ipAddress } = params;

  try {
    const log = await prismaClient.auditLog.create({
      data: {
        tenantId,
        userId,
        action,
        entityType,
        entityId,
        details,
        ipAddress,
      },
    });

    transactionLogger.info(
      {
        tenantId,
        userId,
        action,
        entityType,
        entityId,
      },
      'Acción registrada en auditoría'
    );

    return log;
  } catch (error) {
    transactionLogger.error(
      { error: error.message, params },
      'Error al registrar acción en auditoría'
    );
    // No re-lanzamos el error para evitar interrumpir la operación principal
    return null;
  }
}

export default {
  withTransaction,
  auditLog,
};
