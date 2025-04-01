// api/middlewares/error.middleware.js
import logger from '../../core/utils/logger.js';
import NotificationService from '../../services/notification.service.js';

// Logger específico para errores
const errorLogger = logger.child({ module: 'error-middleware' });

// Errores conocidos y sus códigos de estado
const ERROR_TYPES = {
  ValidationError: { status: 400, logLevel: 'warn' },
  UnauthorizedError: { status: 401, logLevel: 'warn' },
  ForbiddenError: { status: 403, logLevel: 'warn' },
  NotFoundError: { status: 404, logLevel: 'warn' },
  ConflictError: { status: 409, logLevel: 'warn' },
  RateLimitError: { status: 429, logLevel: 'warn' },
  FacturapiError: { status: 400, logLevel: 'error' },
  StripeError: { status: 400, logLevel: 'error' },
  DatabaseError: { status: 500, logLevel: 'error' },
  InternalServerError: { status: 500, logLevel: 'error' }
};

// Función para normalizar un error en un formato estándar
function normalizeError(err) {
  // Si ya tiene un tipo conocido, utilizarlo
  if (err.name && ERROR_TYPES[err.name]) {
    return {
      type: err.name,
      message: err.message,
      status: ERROR_TYPES[err.name].status,
      details: err.details || null,
      logLevel: ERROR_TYPES[err.name].logLevel,
      originalError: err
    };
  }
  
  // Errores específicos de FacturAPI
  if (err.response && err.response.data) {
    return {
      type: 'FacturapiError',
      message: err.message || 'Error en FacturAPI',
      status: err.response.status || 400,
      details: err.response.data,
      logLevel: 'error',
      originalError: err
    };
  }
  
  // Errores de Prisma
  if (err.code && (err.code.startsWith('P') || err.name === 'PrismaClientKnownRequestError')) {
    return {
      type: 'DatabaseError',
      message: 'Error en la base de datos',
      status: 500,
      details: {
        code: err.code,
        clientVersion: err.clientVersion,
        meta: err.meta
      },
      logLevel: 'error',
      originalError: err
    };
  }
  
  // Otros errores específicos según librerías
  
  // Por defecto, error interno del servidor
  return {
    type: err.name || 'InternalServerError',
    message: err.message || 'Error interno del servidor',
    status: err.statusCode || 500,
    details: null,
    logLevel: 'error',
    originalError: err
  };
}

/**
 * Middleware para manejo centralizado de errores
 */
function errorMiddleware(err, req, res, next) {
  // Si ya se envió una respuesta, pasar al siguiente middleware
  if (res.headersSent) {
    return next(err);
  }
  
  // Normalizar el error
  const normalizedError = normalizeError(err);
  
  // Log según nivel de gravedad
  const logMethod = normalizedError.logLevel === 'error' ? errorLogger.error : errorLogger.warn;
  
  // Crear objeto de log con contexto enriquecido
  const logContext = {
    type: normalizedError.type,
    message: normalizedError.message,
    status: normalizedError.status,
    path: req.path,
    method: req.method,
    tenantId: req.tenant?.id,
    userId: req.user?.id,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  };
  
  // Log completo del error con stack trace para errores críticos
  if (normalizedError.logLevel === 'error') {
    logContext.stack = normalizedError.originalError.stack;
    logContext.details = normalizedError.details;
    
    // Para errores críticos, notificar a administradores si están configurados
    try {
      const isHeroku = process.env.IS_HEROKU === 'true' || Boolean(process.env.DYNO);
      // Solo notificar si explícitamente se ha activado la notificación de errores
      if (process.env.NOTIFY_CRITICAL_ERRORS === 'true' || isHeroku) {
        // Crear mensaje de notificación para admins
        const adminMessage = `🚨 *Error Crítico en API*\n\n` +
          `*Tipo:* ${normalizedError.type}\n` +
          `*Endpoint:* ${req.method} ${req.path}\n` +
          `*Tenant:* ${req.tenant?.id || 'N/A'}\n` +
          `*Mensaje:* ${normalizedError.message}\n` +
          `*Hora:* ${new Date().toISOString()}\n\n` +
          `Ver logs para más detalles.`;
        
        // Enviar notificación asincrónica (no esperamos respuesta para no bloquear)
        NotificationService.notifySystemAdmins(adminMessage).catch(notifyError => {
          errorLogger.warn(
            { error: notifyError },
            'Error al enviar notificación de error crítico'
          );
        });
      }
    } catch (notifyError) {
      errorLogger.warn(
        { error: notifyError },
        'Error al procesar notificación de error crítico'
      );
    }
  }
  
  logMethod(logContext, `Error en la API: ${normalizedError.message}`);
  
  // Respuesta para el cliente
  const clientResponse = {
    error: normalizedError.type,
    message: normalizedError.message,
    path: req.path,
    timestamp: new Date().toISOString()
  };
  
  // Incluir detalles solo para tipos específicos de errores o en desarrollo/debug
  const isDebug = process.env.DEBUG_ERRORS === 'true';
  if (normalizedError.details && (
    process.env.NODE_ENV === 'development' || 
    isDebug ||
    ['ValidationError', 'FacturapiError'].includes(normalizedError.type)
  )) {
    clientResponse.details = normalizedError.details;
  }
  
  // Incluir stack trace solo en desarrollo o modo debug explícito
  if (process.env.NODE_ENV === 'development' || isDebug) {
    clientResponse.stack = normalizedError.originalError.stack;
  }
  
  res.status(normalizedError.status).json(clientResponse);
}

export default errorMiddleware;