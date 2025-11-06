/**
 * Rate Limit Middleware
 * Rate limiting for API endpoints
 */

import rateLimit from 'express-rate-limit';
import { createModuleLogger } from '@core/utils/logger.js';

const logger = createModuleLogger('RateLimit');

export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    error: 'Too many requests from this IP, try again in 15 minutes.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(
      { ip: req.ip, userAgent: req.get('User-Agent'), path: req.path, method: req.method },
      'Rate limit exceeded'
    );
    res.status(429).json({
      error: 'Too many requests from this IP, try again in 15 minutes.',
      retryAfter: '15 minutes',
    });
  },
});

export const invoiceRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: {
    error: 'Too many invoices created from this IP, try again in 5 minutes.',
    retryAfter: '5 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(
      { ip: req.ip, tenantId: req.headers['x-tenant-id'], userAgent: req.get('User-Agent') },
      'Invoice rate limit exceeded'
    );
    res.status(429).json({
      error: 'Too many invoices created from this IP, try again in 5 minutes.',
      retryAfter: '5 minutes',
    });
  },
});

export const queryRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: {
    error: 'Too many queries from this IP, try again in 1 minute.',
    retryAfter: '1 minute',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(
      { ip: req.ip, tenantId: req.headers['x-tenant-id'], path: req.path },
      'Query rate limit exceeded'
    );
    res.status(429).json({
      error: 'Too many queries from this IP, try again in 1 minute.',
      retryAfter: '1 minute',
    });
  },
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    error: 'Too many authentication attempts, try again in 15 minutes.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.error(
      { ip: req.ip, userAgent: req.get('User-Agent'), path: req.path },
      'Auth rate limit exceeded - possible attack'
    );
    res.status(429).json({
      error: 'Too many authentication attempts, try again in 15 minutes.',
      retryAfter: '15 minutes',
    });
  },
});

export const tenantRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => {
    return (
      (req.headers['x-tenant-id'] as string) ||
      (req.query.tenantId as string) ||
      req.ip ||
      'unknown'
    );
  },
  message: {
    error: 'Too many requests for this tenant, try again in 1 minute.',
    retryAfter: '1 minute',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(
      { tenantId: req.headers['x-tenant-id'] || req.query.tenantId, ip: req.ip, path: req.path },
      'Tenant rate limit exceeded'
    );
    res.status(429).json({
      error: 'Too many requests for this tenant, try again in 1 minute.',
      retryAfter: '1 minute',
    });
  },
});

export default {
  generalRateLimit,
  invoiceRateLimit,
  queryRateLimit,
  authRateLimit,
  tenantRateLimit,
};
