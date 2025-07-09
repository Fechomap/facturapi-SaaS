// api/middlewares/session.middleware.js - Middleware de sesiones para clustering
import crypto from 'crypto';
import redisSessionService from '../../services/redis-session.service.js';
import logger from '../../core/utils/logger.js';

const sessionLogger = logger.child({ module: 'session-middleware' });

/**
 * Middleware de sesiones compatible con clustering
 * Utiliza Redis para compartir sesiones entre workers
 */
export const sessionMiddleware = (options = {}) => {
  const {
    sessionName = 'facturapi_session',
    maxAge = 3600, // 1 hora por defecto
    secure = process.env.NODE_ENV === 'production',
    httpOnly = true,
    sameSite = 'lax'
  } = options;

  return async (req, res, next) => {
    try {
      // Generar o extraer session ID
      let sessionId = req.cookies?.[sessionName] || req.headers['x-session-id'];
      
      if (!sessionId) {
        // Crear nueva sesión
        sessionId = crypto.randomUUID();
        sessionLogger.debug(`Nueva sesión creada: ${sessionId}`);
      }

      // Obtener datos de sesión
      const sessionResult = await redisSessionService.getSession(sessionId);
      
      if (sessionResult.success) {
        req.session = sessionResult.data;
        sessionLogger.debug(`Sesión cargada: ${sessionId}`);
      } else {
        // Crear nueva sesión
        req.session = {
          id: sessionId,
          createdAt: new Date().toISOString(),
          lastAccess: new Date().toISOString()
        };
        sessionLogger.debug(`Nueva sesión inicializada: ${sessionId}`);
      }

      // Actualizar último acceso
      req.session.lastAccess = new Date().toISOString();
      req.sessionId = sessionId;

      // Función para guardar sesión
      req.saveSession = async () => {
        try {
          await redisSessionService.setSession(sessionId, req.session, maxAge);
          sessionLogger.debug(`Sesión guardada: ${sessionId}`);
          return { success: true };
        } catch (error) {
          sessionLogger.error(`Error al guardar sesión ${sessionId}:`, error);
          return { success: false, error: error.message };
        }
      };

      // Función para destruir sesión
      req.destroySession = async () => {
        try {
          await redisSessionService.deleteSession(sessionId);
          
          // Limpiar cookie
          res.clearCookie(sessionName);
          
          sessionLogger.debug(`Sesión destruida: ${sessionId}`);
          return { success: true };
        } catch (error) {
          sessionLogger.error(`Error al destruir sesión ${sessionId}:`, error);
          return { success: false, error: error.message };
        }
      };

      // Configurar cookie de sesión
      const cookieOptions = {
        maxAge: maxAge * 1000, // Convertir a milisegundos
        httpOnly,
        secure,
        sameSite
      };

      res.cookie(sessionName, sessionId, cookieOptions);

      // Middleware para guardar automáticamente al final de la request
      const originalSend = res.send;
      res.send = function(data) {
        // Guardar sesión antes de enviar respuesta
        req.saveSession().catch(error => {
          sessionLogger.error('Error al auto-guardar sesión:', error);
        });
        
        return originalSend.call(this, data);
      };

      next();
    } catch (error) {
      sessionLogger.error('Error en middleware de sesión:', error);
      
      // En caso de error, crear sesión básica en memoria
      req.session = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        lastAccess: new Date().toISOString(),
        _fallback: true
      };
      
      req.saveSession = async () => ({ success: false, error: 'Sesión en modo fallback' });
      req.destroySession = async () => ({ success: true });
      
      next();
    }
  };
};

/**
 * Middleware para requerir autenticación de sesión
 */
export const requireSession = (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      error: 'Sesión requerida',
      message: 'Debe iniciar sesión para acceder a este recurso'
    });
  }
  
  next();
};

/**
 * Middleware para información de sesión en respuestas
 */
export const sessionInfo = (req, res, next) => {
  // Agregar información de sesión a las respuestas
  const originalJson = res.json;
  res.json = function(data) {
    const responseData = {
      ...data,
      _session: {
        id: req.sessionId,
        authenticated: Boolean(req.session?.userId),
        lastAccess: req.session?.lastAccess
      }
    };
    
    return originalJson.call(this, responseData);
  };
  
  next();
};

export default {
  sessionMiddleware,
  requireSession,
  sessionInfo
};