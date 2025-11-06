// core/utils/transaction.ts
import { prisma } from '../../config/database';
import logger from './logger';
import type { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

const transactionLogger = logger.child({ module: 'transaction' });

interface TransactionOptions {
  logParams?: boolean;
  description?: string;
}

interface AuditLogParams {
  tenantId?: string;
  userId?: number | null;
  action: string;
  entityType: string;
  entityId: string;
  details?: any;
  ipAddress?: string;
}

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Ejecuta una operación dentro de una transacción de base de datos
 */
export async function withTransaction<T>(
  callback: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const { logParams = false, description = 'Transacción' } = options;

  transactionLogger.debug(`Iniciando: ${description}`);

  try {
    const result = await prisma.$transaction(async (tx) => {
      return await callback(tx as TransactionClient);
    });

    if (logParams) {
      transactionLogger.debug({ result }, `Completada: ${description}`);
    } else {
      transactionLogger.debug(`Completada: ${description}`);
    }

    return result;
  } catch (error: any) {
    transactionLogger.error(
      { error: error.message, stack: error.stack },
      `Error en transacción: ${description}`
    );
    throw error;
  }
}

/**
 * Registra una operación en el log de auditoría
 */
export async function auditLog(
  prismaClient: TransactionClient | PrismaClient,
  params: AuditLogParams
): Promise<any> {
  const { tenantId, userId, action, entityType, entityId, details, ipAddress } = params;

  try {
    const log = await prismaClient.auditLog.create({
      data: {
        tenantId,
        userId,
        action,
        entityType,
        entityId,
        details: details || {},
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
  } catch (error: any) {
    transactionLogger.error(
      { error: error.message, params },
      'Error al registrar acción en auditoría'
    );
    return null;
  }
}

export default {
  withTransaction,
  auditLog,
};
