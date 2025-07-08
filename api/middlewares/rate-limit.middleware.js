// api/middlewares/rate-limit.middleware.js
import rateLimit from 'express-rate-limit';
import logger from '../../core/utils/logger.js';

// Logger específico para rate limiting
const rateLimitLogger = logger.child({ module: 'rate-limit' });

/**
 * Rate limiting general para todas las rutas
 * Previene abuso básico del API
 */
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por IP cada 15 minutos
  message: {
    error: 'Demasiadas solicitudes desde esta IP, intenta nuevamente en 15 minutos.',
    retryAfter: '15 minutos'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    rateLimitLogger.warn('Rate limit excedido', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method
    });
    
    res.status(429).json({
      error: 'Demasiadas solicitudes desde esta IP, intenta nuevamente en 15 minutos.',
      retryAfter: '15 minutos'
    });
  }
});

/**
 * Rate limiting estricto para endpoints de facturación
 * Previene spam de creación de facturas
 */
export const invoiceRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 10, // máximo 10 facturas por IP cada 5 minutos
  message: {
    error: 'Demasiadas facturas creadas desde esta IP, intenta nuevamente en 5 minutos.',
    retryAfter: '5 minutos'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    rateLimitLogger.warn('Rate limit de facturación excedido', {
      ip: req.ip,
      tenantId: req.headers['x-tenant-id'],
      userAgent: req.get('User-Agent')
    });
    
    res.status(429).json({
      error: 'Demasiadas facturas creadas desde esta IP, intenta nuevamente en 5 minutos.',
      retryAfter: '5 minutos'
    });
  }
});

/**
 * Rate limiting moderado para endpoints de consulta
 * Previene scraping masivo de datos
 */
export const queryRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 30, // máximo 30 consultas por IP cada minuto
  message: {
    error: 'Demasiadas consultas desde esta IP, intenta nuevamente en 1 minuto.',
    retryAfter: '1 minuto'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    rateLimitLogger.warn('Rate limit de consultas excedido', {
      ip: req.ip,
      tenantId: req.headers['x-tenant-id'],
      path: req.path
    });
    
    res.status(429).json({
      error: 'Demasiadas consultas desde esta IP, intenta nuevamente en 1 minuto.',
      retryAfter: '1 minuto'
    });
  }
});

/**
 * Rate limiting para autenticación
 * Previene ataques de fuerza bruta
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // máximo 5 intentos de auth por IP cada 15 minutos
  message: {
    error: 'Demasiados intentos de autenticación, intenta nuevamente en 15 minutos.',
    retryAfter: '15 minutos'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    rateLimitLogger.error('Rate limit de autenticación excedido - posible ataque', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path
    });
    
    res.status(429).json({
      error: 'Demasiados intentos de autenticación, intenta nuevamente en 15 minutos.',
      retryAfter: '15 minutos'
    });
  }
});

/**
 * Rate limiting per-tenant para evitar abuso por tenant específico
 */
export const tenantRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 20, // máximo 20 requests por tenant cada minuto
  keyGenerator: (req) => {
    // Rate limit basado en tenant ID en lugar de IP
    return req.headers['x-tenant-id'] || req.query.tenantId || req.ip;
  },
  message: {
    error: 'Demasiadas solicitudes para este tenant, intenta nuevamente en 1 minuto.',
    retryAfter: '1 minuto'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    rateLimitLogger.warn('Rate limit por tenant excedido', {
      tenantId: req.headers['x-tenant-id'] || req.query.tenantId,
      ip: req.ip,
      path: req.path
    });
    
    res.status(429).json({
      error: 'Demasiadas solicitudes para este tenant, intenta nuevamente en 1 minuto.',
      retryAfter: '1 minuto'
    });
  }
});

export default {
  generalRateLimit,
  invoiceRateLimit,
  queryRateLimit,
  authRateLimit,
  tenantRateLimit
};