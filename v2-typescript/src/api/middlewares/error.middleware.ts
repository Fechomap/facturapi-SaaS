/**
 * Error Middleware
 * Centralized error handling for API
 */

import { Request, Response, NextFunction } from 'express';
import { createModuleLogger } from '@core/utils/logger.js';
import NotificationService from '@services/notification.service.js';
import type { TenantRequest } from '../../types/api.types.js';

const logger = createModuleLogger('ErrorMiddleware');

interface ErrorType {
  status: number;
  logLevel: 'warn' | 'error';
}

interface NormalizedError {
  type: string;
  message: string;
  status: number;
  details: unknown;
  logLevel: 'warn' | 'error';
  originalError: Error;
}

const ERROR_TYPES: Record<string, ErrorType> = {
  ValidationError: { status: 400, logLevel: 'warn' },
  UnauthorizedError: { status: 401, logLevel: 'warn' },
  ForbiddenError: { status: 403, logLevel: 'warn' },
  NotFoundError: { status: 404, logLevel: 'warn' },
  ConflictError: { status: 409, logLevel: 'warn' },
  RateLimitError: { status: 429, logLevel: 'warn' },
  FacturapiError: { status: 400, logLevel: 'error' },
  DatabaseError: { status: 500, logLevel: 'error' },
  InternalServerError: { status: 500, logLevel: 'error' },
};

/**
 * Normalize error to standard format
 */
function normalizeError(
  err: Error & {
    response?: { data?: unknown; status?: number };
    code?: string;
    statusCode?: number;
    details?: unknown;
    clientVersion?: string;
    meta?: unknown;
  }
): NormalizedError {
  if (err.name && ERROR_TYPES[err.name]) {
    return {
      type: err.name,
      message: err.message,
      status: ERROR_TYPES[err.name].status,
      details: err.details || null,
      logLevel: ERROR_TYPES[err.name].logLevel,
      originalError: err,
    };
  }

  // FacturAPI specific errors
  if (err.response && err.response.data) {
    return {
      type: 'FacturapiError',
      message: err.message || 'FacturAPI error',
      status: err.response.status || 400,
      details: err.response.data,
      logLevel: 'error',
      originalError: err,
    };
  }

  // Prisma errors
  if (err.code && (err.code.startsWith('P') || err.name === 'PrismaClientKnownRequestError')) {
    return {
      type: 'DatabaseError',
      message: 'Database error',
      status: 500,
      details: {
        code: err.code,
        clientVersion: err.clientVersion,
        meta: err.meta,
      },
      logLevel: 'error',
      originalError: err,
    };
  }

  return {
    type: err.name || 'InternalServerError',
    message: err.message || 'Internal server error',
    status: err.statusCode || 500,
    details: null,
    logLevel: 'error',
    originalError: err,
  };
}

/**
 * Error handling middleware
 */
async function errorMiddleware(err: Error, req: TenantRequest, res: Response, _next: NextFunction) {
  if (res.headersSent) {
    return;
  }

  const normalizedError = normalizeError(
    err as Error & {
      response?: { data?: unknown; status?: number };
      code?: string;
      statusCode?: number;
      details?: unknown;
    }
  );

  const logContext = {
    type: normalizedError.type,
    message: normalizedError.message,
    status: normalizedError.status,
    path: req.path,
    method: req.method,
    tenantId: req.tenant?.id,
    userId: req.user?.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };

  if (normalizedError.logLevel === 'error') {
    logger.error(
      {
        ...logContext,
        stack: normalizedError.originalError?.stack,
        details: normalizedError.details,
      },
      `API error: ${normalizedError.message}`
    );

    // Notify admins for critical errors
    try {
      const isProduction = process.env.NODE_ENV === 'production';
      const isRailway =
        process.env.IS_RAILWAY === 'true' || Boolean(process.env.RAILWAY_ENVIRONMENT);

      if (process.env.NOTIFY_CRITICAL_ERRORS === 'true' || (isProduction && isRailway)) {
        const platformName = isRailway ? 'Railway' : 'Production';

        const adminMessage =
          `🚨 *Critical API Error (${platformName})*\n\n` +
          `*Type:* ${normalizedError.type}\n` +
          `*Endpoint:* ${req.method} ${req.path}\n` +
          `*Tenant:* ${req.tenant?.id || 'N/A'}\n` +
          `*Message:* ${normalizedError.message}\n` +
          `*Time:* ${new Date().toISOString()}\n\n` +
          `Check logs for more details.`;

        NotificationService.notifySystemAdmins(adminMessage).catch((notifyError) => {
          logger.warn({ error: notifyError }, 'Error sending critical error notification');
        });
      }
    } catch (notifyError) {
      logger.warn({ error: notifyError }, 'Error processing critical error notification');
    }
  } else {
    logger.warn(logContext, `API warning: ${normalizedError.message}`);
  }

  const clientResponse: Record<string, unknown> = {
    error: normalizedError.type,
    message: normalizedError.message,
    path: req.path,
    timestamp: new Date().toISOString(),
  };

  const isDebug = process.env.DEBUG_ERRORS === 'true';
  if (
    normalizedError.details &&
    (process.env.NODE_ENV === 'development' ||
      isDebug ||
      ['ValidationError', 'FacturapiError'].includes(normalizedError.type))
  ) {
    clientResponse.details = normalizedError.details;
  }

  if (process.env.NODE_ENV === 'development' || isDebug) {
    clientResponse.stack = normalizedError.originalError?.stack;
  }

  res.status(normalizedError.status).json(clientResponse);
}

export default errorMiddleware;
