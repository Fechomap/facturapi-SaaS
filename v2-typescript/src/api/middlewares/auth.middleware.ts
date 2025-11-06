/**
 * Auth Middleware
 * JWT authentication and role-based authorization
 */

import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '@config/database.js';
import type { TenantRequest } from '../../types/api.types.js';

interface DecodedToken {
  tenantId: string;
  userId?: number;
  email?: string;
  role?: string;
  isDev?: boolean;
}

function authMiddleware(req: TenantRequest, res: Response, next: NextFunction): void {
  (async () => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          error: 'AuthorizationError',
          message: 'No authentication token provided',
        });
        return;
      }

      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'facturapi-saas-secret-dev'
      ) as DecodedToken;

      if (!decoded.tenantId) {
        res.status(401).json({
          error: 'AuthorizationError',
          message: 'Invalid token: missing tenantId',
        });
        return;
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: decoded.tenantId },
      });

      if (!tenant) {
        res.status(401).json({
          error: 'AuthorizationError',
          message: 'Tenant not found',
        });
        return;
      }

      let user = null;
      if (decoded.userId) {
        user = await prisma.tenantUser.findUnique({
          where: { id: decoded.userId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
            isAuthorized: true,
            tenantId: true,
          },
        });

        if (!user && decoded.userId !== 0) {
          res.status(401).json({
            error: 'AuthorizationError',
            message: 'User not found',
          });
          return;
        }

        if (user && !user.isAuthorized && !decoded.isDev) {
          res.status(403).json({
            error: 'AuthorizationError',
            message: 'User not authorized',
          });
          return;
        }
      }

      req.user = user || {
        id: decoded.userId || 0,
        email: decoded.email,
        role: decoded.role || 'admin',
        tenantId: decoded.tenantId,
      };

      if (decoded.tenantId) {
        req.tenant = {
          id: decoded.tenantId,
          businessName: tenant.businessName,
          email: tenant.email,
          facturapiApiKey: tenant.facturapiApiKey,
          isActive: tenant.isActive,
        };
      }

      next();
    } catch (error) {
      if (
        (error as Error).name === 'JsonWebTokenError' ||
        (error as Error).name === 'TokenExpiredError'
      ) {
        res.status(401).json({
          error: 'AuthorizationError',
          message: 'Invalid or expired token',
        });
        return;
      }

      next(error);
    }
  })();
}

function requireRoles(...roles: string[]) {
  return (req: TenantRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'AuthorizationError',
        message: 'User not authenticated',
      });
      return;
    }

    if (!roles.includes(req.user.role || '')) {
      res.status(403).json({
        error: 'AuthorizationError',
        message: 'You do not have permission to perform this action',
      });
      return;
    }

    next();
  };
}

export { authMiddleware, requireRoles };
