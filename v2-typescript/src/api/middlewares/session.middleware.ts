/**
 * Session Middleware for API
 * Manages JWT authentication for API requests
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createModuleLogger } from '@core/utils/logger.js';
import { authConfig } from '@config/auth.js';

const logger = createModuleLogger('SessionMiddleware');

export interface SessionOptions {
  sessionName?: string;
  maxAge?: number;
  secure?: boolean;
  requireAuth?: boolean;
}

// User interface para JWT payload
export interface JWTUser {
  id: string;
  tenantId?: string;
  telegramId?: bigint | number;
  role?: string;
  permissions?: string[];
  username?: string;
  email?: string;
}

/**
 * Middleware para autenticación JWT en API REST
 * @param options - Opciones de configuración
 */
export function sessionMiddleware(options: SessionOptions = {}) {
  const { requireAuth = true } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Extraer token del header Authorization
      const authHeader = req.headers.authorization;
      let token: string | undefined;

      if (authHeader) {
        // Formato: "Bearer TOKEN"
        const parts = authHeader.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') {
          token = parts[1];
        } else {
          token = authHeader; // Aceptar token directo también
        }
      }

      // Si no hay token y se requiere autenticación
      if (!token) {
        if (requireAuth) {
          logger.warn({ path: req.path }, 'No token provided');
          res.status(401).json({
            success: false,
            error: 'No autorizado - Token requerido',
          });
          return;
        } else {
          // Permitir acceso sin autenticación
          next();
          return;
        }
      }

      // Verificar y decodificar token
      const jwtSecret = authConfig.jwt.secret;
      if (!jwtSecret) {
        logger.error('JWT_SECRET no configurado');
        res.status(500).json({
          success: false,
          error: 'Configuración de autenticación inválida',
        });
        return;
      }

      jwt.verify(token, jwtSecret, (err, decoded) => {
        if (err) {
          logger.warn({ error: err.message, path: req.path }, 'Invalid token');

          if (err.name === 'TokenExpiredError') {
            res.status(401).json({
              success: false,
              error: 'Token expirado',
              code: 'TOKEN_EXPIRED',
            });
          } else {
            res.status(401).json({
              success: false,
              error: 'Token inválido',
              code: 'INVALID_TOKEN',
            });
          }
          return;
        }

        // Token válido - agregar información del usuario al request
        const payload = decoded as any;
        (req as any).user = {
          id: String(payload.id || payload.userId),
          tenantId: payload.tenantId,
          telegramId: payload.telegramId,
          role: payload.role,
          permissions: payload.permissions || [],
          username: payload.username,
          email: payload.email,
        };
        (req as any).token = token;

        logger.debug(
          {
            userId: (req as any).user.id,
            tenantId: (req as any).user.tenantId,
            path: req.path,
          },
          'Request authenticated'
        );

        next();
      });
    } catch (error: unknown) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), path: req.path },
        'Error en session middleware'
      );
      res.status(500).json({
        success: false,
        error: 'Error interno de autenticación',
      });
    }
  };
}

/**
 * Middleware para verificar permisos específicos
 * @param requiredPermissions - Lista de permisos requeridos
 */
export function requirePermissions(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user;
    if (!user) {
      res.status(401).json({
        success: false,
        error: 'No autorizado - Usuario no autenticado',
      });
      return;
    }

    const userPermissions = user.permissions || [];
    const role = user.role;

    // Admin tiene todos los permisos
    if (role === 'admin' || userPermissions.includes('*')) {
      next();
      return;
    }

    // Verificar que el usuario tenga todos los permisos requeridos
    const hasAllPermissions = requiredPermissions.every((permission) =>
      userPermissions.includes(permission)
    );

    if (!hasAllPermissions) {
      logger.warn(
        {
          userId: user.id,
          requiredPermissions,
          userPermissions,
          path: req.path,
        },
        'Insufficient permissions'
      );

      res.status(403).json({
        success: false,
        error: 'Permisos insuficientes',
        requiredPermissions,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware para verificar rol específico
 * @param allowedRoles - Roles permitidos
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user;
    if (!user) {
      res.status(401).json({
        success: false,
        error: 'No autorizado - Usuario no autenticado',
      });
      return;
    }

    const userRole = user.role;

    if (!userRole || !allowedRoles.includes(userRole)) {
      logger.warn(
        {
          userId: user.id,
          userRole,
          allowedRoles,
          path: req.path,
        },
        'Insufficient role'
      );

      res.status(403).json({
        success: false,
        error: 'Rol insuficiente',
        allowedRoles,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware opcional - no requiere autenticación pero la procesa si existe
 */
export const optionalAuth = sessionMiddleware({ requireAuth: false });

/**
 * Middleware por defecto - requiere autenticación
 */
export default sessionMiddleware();
