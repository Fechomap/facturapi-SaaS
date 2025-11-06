// core/tenant/tenant.middleware.ts
import type { Request, Response, NextFunction } from 'express';
import TenantService from './tenant.service';
import logger from '../utils/logger';
import prisma from '../../lib/prisma';
import type { Context } from 'telegraf';

const middlewareLogger = logger.child({ module: 'tenant-middleware' });

// Extender tipos de Express
declare global {
  namespace Express {
    interface Request {
      tenant?: {
        id: string;
        businessName: string;
        email: string;
        isActive: boolean;
        facturapiApiKey: string | null;
      };
      getApiKey?: () => Promise<string>;
    }
  }
}

// Interface para el contexto del bot con tenant
export interface TenantBotContext extends Context {
  userState?: {
    tenantId?: string;
    tenantName?: string;
    userStatus?: string;
    [key: string]: any;
  };
  getTenantId?: () => string | undefined;
  isUserAuthorized?: () => boolean;
  hasTenant?: () => boolean;
}

/**
 * Middleware para añadir información del tenant al contexto de Telegraf
 */
export async function tenantContextMiddleware(ctx: TenantBotContext, next: () => Promise<void>) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return next();

  const middlewareStartTime = Date.now();

  try {
    ctx.userState = ctx.userState || {};

    middlewareLogger.debug(
      { telegramId: telegramId, userState: JSON.stringify(ctx.userState) },
      'Estado actual antes de verificar tenant'
    );

    if (!ctx.userState.tenantId || ctx.userState.userStatus === 'no_tenant') {
      const tenantQueryStartTime = Date.now();
      console.log(
        `[TENANT_METRICS] Usuario ${telegramId} - Consultando tenant en DB porque tenantId=${ctx.userState.tenantId}, userStatus=${ctx.userState.userStatus}`
      );

      const user = await TenantService.findUserByTelegramId(telegramId);

      const tenantQueryDuration = Date.now() - tenantQueryStartTime;
      console.log(
        `[TENANT_METRICS] Usuario ${telegramId} - DB query findUserByTelegramId tomó ${tenantQueryDuration}ms, userFound=${!!user}`
      );

      middlewareLogger.debug({ telegramId: telegramId, userFound: !!user }, 'Información de usuario consultada');

      if (user && user.tenant) {
        ctx.userState.tenantId = user.tenant.id;
        ctx.userState.tenantName = user.tenant.businessName;

        if (!user.isAuthorized) {
          ctx.userState.userStatus = 'pending_authorization';
        } else {
          ctx.userState.userStatus = 'authorized';
        }

        middlewareLogger.debug(
          {
            telegramId: telegramId,
            tenantId: user.tenant.id,
            tenantName: user.tenant.businessName,
            userStatus: ctx.userState.userStatus,
          },
          'Estado actualizado con información de tenant'
        );
      } else {
        ctx.userState.userStatus = 'no_tenant';
        middlewareLogger.debug({ telegramId: telegramId }, 'Usuario sin tenant asociado');
      }
    } else {
      console.log(
        `[TENANT_METRICS] Usuario ${telegramId} - SKIP DB query porque ya tiene tenantId=${ctx.userState.tenantId}, userStatus=${ctx.userState.userStatus}`
      );
    }

    // Añadir métodos de utilidad
    ctx.getTenantId = () => ctx.userState?.tenantId;
    ctx.isUserAuthorized = () => ctx.userState?.userStatus === 'authorized';
    ctx.hasTenant = () => !!ctx.userState?.tenantId;

    const middlewareDuration = Date.now() - middlewareStartTime;
    console.log(
      `[TENANT_METRICS] Usuario ${telegramId} - Middleware tenant TOTAL tomó ${middlewareDuration}ms`
    );

    return next();
  } catch (error: any) {
    const middlewareDuration = Date.now() - middlewareStartTime;
    console.error(
      `[TENANT_METRICS] Usuario ${telegramId} - Middleware tenant ERROR después de ${middlewareDuration}ms:`,
      error
    );
    middlewareLogger.error({ error, telegramId }, 'Error en tenant middleware');
    return next();
  }
}

/**
 * Middleware para validar que el usuario tenga un tenant asignado (API REST)
 */
export async function requireTenant(req: Request, res: Response, next: NextFunction): Promise<any> {
  try {
    const tenantId =
      req.headers['x-tenant-id'] || req.query.tenantId || (req.body as any)?.tenantId;

    if (!tenantId || typeof tenantId !== 'string') {
      middlewareLogger.warn({ path: req.path }, 'Solicitud sin tenant ID');
      return res.status(400).json({
        error: 'TenantRequired',
        message:
          'Debe proporcionar un tenant ID en el header X-Tenant-ID, query parameter o en el cuerpo de la solicitud',
      });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true,
        email: true,
        isActive: true,
        facturapiApiKey: true,
      },
    });

    if (!tenant) {
      middlewareLogger.warn({ tenantId, path: req.path }, 'Tenant no encontrado');
      return res.status(404).json({
        error: 'TenantNotFound',
        message: 'El tenant especificado no existe',
      });
    }

    if (!tenant.isActive) {
      middlewareLogger.warn({ tenantId, path: req.path }, 'Tenant inactivo');
      return res.status(403).json({
        error: 'TenantInactive',
        message: 'El tenant especificado está desactivado',
      });
    }

    req.tenant = tenant;

    req.getApiKey = async () => {
      return await TenantService.getDecryptedApiKey(tenantId);
    };

    middlewareLogger.debug({ tenantId, path: req.path }, 'Tenant validado correctamente');
    next();
  } catch (error: any) {
    middlewareLogger.error({ error, path: req.path }, 'Error en middleware requireTenant');
    next(error);
  }
}

export default tenantContextMiddleware;
