/**
 * Middleware de autorización multiusuario para Telegram
 */

import { prisma } from '@/config/database.js';
import type { BotContext, BotMiddleware } from '@/types/bot.types.js';
import { createModuleLogger } from '@core/utils/logger.js';

const logger = createModuleLogger('multi-auth-middleware');

/**
 * Roles de usuario disponibles
 */
export const USER_ROLES = {
  ADMIN: 'admin', // Puede todo + gestionar usuarios
  OPERATOR: 'operator', // Puede facturar y consultar
  VIEWER: 'viewer', // Solo consulta
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

/**
 * Permisos por rol
 */
export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  [USER_ROLES.ADMIN]: [
    'invoice:create',
    'invoice:view',
    'invoice:cancel',
    'client:manage',
    'report:view',
    'user:manage', // Solo admin puede gestionar usuarios
    'batch:process',
  ],
  [USER_ROLES.OPERATOR]: [
    'invoice:create',
    'invoice:view',
    'invoice:cancel',
    'client:manage',
    'report:view',
    'batch:process',
  ],
  [USER_ROLES.VIEWER]: ['invoice:view', 'report:view'],
};

/**
 * Estructura de datos cacheados de permisos
 */
interface CachedPermissions {
  tenantId: string;
  role: UserRole;
  permissions: string[];
  isAuthorized: boolean;
  lastUpdated: number;
}

/**
 * Estructura de acceso de usuario
 */
interface UserAccess {
  tenantId: string;
  role: UserRole;
  isAuthorized: boolean;
  tenant: {
    id: string;
    businessName: string;
    isActive: boolean;
  };
}

/**
 * Estructura de múltiples accesos
 */
interface MultipleAccess {
  multipleAccess: true;
  availableAccess: Array<{
    tenantId: string;
    businessName: string;
    role: UserRole;
    isAuthorized: boolean;
  }>;
}

/**
 * Cache de permisos en memoria para optimizar consultas
 * Estructura: { telegramId: { tenantId, role, permissions, lastUpdated } }
 */
const permissionsCache = new Map<string, CachedPermissions>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

/**
 * Middleware de autorización multiusuario
 * Reemplaza el middleware de auth.middleware.js actual
 */
const multiUserAuthMiddleware: BotMiddleware = async (
  ctx: BotContext,
  next: () => Promise<void>
) => {
  const telegramId = ctx.from?.id;

  if (!telegramId) {
    logger.warn('Request sin telegram ID');
    await ctx.reply('⛔ Error de autenticación');
    return;
  }

  try {
    // 1. Permitir comandos de inicio sin autenticación
    if (isPublicCommand(ctx)) {
      logger.debug({ telegramId }, 'Comando público, permitido');
      return next();
    }

    // 2. Verificar cache de permisos primero
    const cachedPermissions = getCachedPermissions(telegramId);
    if (cachedPermissions) {
      logger.debug({ telegramId }, 'Usando permisos desde cache');
      attachUserContext(ctx, cachedPermissions);
      return next();
    }

    // 3. Buscar usuario en BD con su tenant y rol
    // Obtener tenantId del contexto si está disponible (para usuarios existentes)
    const existingTenantId = ctx.getTenantId ? ctx.getTenantId() : null;
    let userAccess: UserAccess | MultipleAccess | null = await findUserAccess(
      telegramId,
      existingTenantId
    );

    if (!userAccess) {
      logger.warn({ telegramId }, 'Usuario no autorizado');
      await ctx.reply('⛔ No estás registrado en el sistema. Usa /registro para comenzar.');
      return;
    }

    // Manejar caso de múltiples empresas
    if ('multipleAccess' in userAccess && userAccess.multipleAccess) {
      logger.info({ telegramId }, 'Usuario con acceso a múltiples empresas');
      // Por ahora usar la primera empresa autorizada
      const authorizedAccess = userAccess.availableAccess.find((a) => a.isAuthorized);
      if (!authorizedAccess) {
        await ctx.reply('⏳ Tus accesos están pendientes de autorización en todas las empresas.');
        return;
      }
      // Recursivamente buscar con tenantId específico
      const specificAccess = await findUserAccess(telegramId, authorizedAccess.tenantId);
      if (specificAccess && !('multipleAccess' in specificAccess)) {
        userAccess = specificAccess;
      }
    }

    if (!userAccess || 'multipleAccess' in userAccess) {
      logger.warn({ telegramId }, 'No se pudo resolver acceso del usuario');
      await ctx.reply('❌ Error al procesar tu acceso. Contacta al administrador.');
      return;
    }

    // 4. Verificar que el usuario esté activo y autorizado
    if (!userAccess.isAuthorized || !userAccess.tenant.isActive) {
      logger.warn({ telegramId, tenantId: userAccess.tenantId }, 'Usuario o tenant inactivo');
      await ctx.reply('⛔ Tu cuenta está pendiente de autorización por el administrador.');
      return;
    }

    // 5. Cachear permisos y continuar
    const permissions = ROLE_PERMISSIONS[userAccess.role] || [];
    cachePermissions(telegramId, {
      tenantId: userAccess.tenantId,
      role: userAccess.role,
      permissions,
      isAuthorized: true,
    });

    attachUserContext(ctx, {
      tenantId: userAccess.tenantId,
      role: userAccess.role,
      permissions,
    });

    logger.info(
      {
        telegramId,
        tenantId: userAccess.tenantId,
        role: userAccess.role,
      },
      'Usuario autorizado'
    );

    return next();
  } catch (error) {
    logger.error(
      { telegramId, error: (error as Error).message },
      'Error en middleware de autorización'
    );
    await ctx.reply('❌ Error interno de autorización. Intenta de nuevo.');
    return;
  }
};

/**
 * Busca acceso del usuario en la BD
 * Compatible con schema actual Y futuro multiusuario
 */
async function findUserAccess(
  telegramId: number,
  tenantId: string | null = null
): Promise<UserAccess | MultipleAccess | null> {
  try {
    let user;

    if (tenantId) {
      // Si tenemos tenantId, usar constraint compuesto
      user = await prisma.tenantUser.findUnique({
        where: {
          tenantId_telegramId: {
            tenantId: tenantId,
            telegramId: BigInt(telegramId),
          },
        },
        include: {
          tenant: {
            select: {
              id: true,
              businessName: true,
              isActive: true,
            },
          },
        },
      });
    } else {
      // Sin tenantId, buscar todos los accesos de este usuario
      const users = await prisma.tenantUser.findMany({
        where: { telegramId: BigInt(telegramId) },
        include: {
          tenant: {
            select: {
              id: true,
              businessName: true,
              isActive: true,
            },
          },
        },
      });

      if (users.length === 0) return null;
      if (users.length === 1) {
        user = users[0];
      } else {
        // Múltiples empresas - devolver info especial
        return {
          multipleAccess: true,
          availableAccess: users.map((u) => ({
            tenantId: u.tenantId,
            businessName: u.tenant.businessName,
            role: u.role as UserRole,
            isAuthorized: u.isAuthorized,
          })),
        };
      }
    }

    if (!user) return null;

    return {
      tenantId: user.tenantId,
      role: user.role as UserRole,
      isAuthorized: user.isAuthorized,
      tenant: user.tenant,
    };
  } catch (error) {
    logger.error(
      { telegramId, error: (error as Error).message },
      'Error al buscar acceso de usuario'
    );
    return null;
  }
}

/**
 * Verifica si es un comando público que no requiere autenticación
 */
function isPublicCommand(ctx: BotContext): boolean {
  const allowedCommands = ['/start', '/help', '/registro', '/login'];
  const allowedActions = [
    'start_registration',
    'show_pricing',
    'back_to_start',
    'confirm_registration',
    'cancel_registration',
    'create_organization',
  ];

  // Verificar comandos de texto
  if (ctx.message && 'text' in ctx.message && ctx.message.text) {
    const messageText = ctx.message.text;
    return allowedCommands.some((cmd) => messageText.startsWith(cmd));
  }

  // Verificar acciones inline
  if (ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data) {
    return allowedActions.includes(ctx.callbackQuery.data);
  }

  // Permitir mensajes durante proceso de registro
  if (
    ctx.userState?.esperando?.startsWith('reg_') ||
    ctx.userState?.esperando?.startsWith('org_')
  ) {
    return true;
  }

  return false;
}

/**
 * Obtiene permisos desde cache si están vigentes
 */
function getCachedPermissions(telegramId: number): CachedPermissions | null {
  // Asegurar que siempre usamos string como clave para consistencia
  const key = telegramId.toString();
  const cached = permissionsCache.get(key);
  if (!cached) return null;

  const now = Date.now();
  if (now - cached.lastUpdated > CACHE_DURATION) {
    permissionsCache.delete(key);
    return null;
  }

  return cached;
}

/**
 * Cachea permisos de usuario
 */
function cachePermissions(telegramId: number, data: Omit<CachedPermissions, 'lastUpdated'>): void {
  // Asegurar que siempre usamos string como clave para consistencia
  const key = telegramId.toString();
  permissionsCache.set(key, {
    ...data,
    lastUpdated: Date.now(),
  });
}

/**
 * Adjunta contexto de usuario al objeto ctx
 */
function attachUserContext(
  ctx: BotContext,
  data: { tenantId: string; role: UserRole; permissions: string[] }
): void {
  // Mantener compatibilidad con código existente
  ctx.userState = ctx.userState || {};
  ctx.userState.tenantId = data.tenantId;
  ctx.userState.userRole = data.role;

  // Nuevos métodos para multiusuario
  ctx.getTenantId = () => data.tenantId;
  ctx.getUserRole = () => data.role;
  ctx.hasPermission = (permission: string) => data.permissions.includes(permission);
  ctx.isAdmin = () => data.role === USER_ROLES.ADMIN;
  ctx.isUserAuthorized = () => true; // Ya verificado antes
  ctx.hasTenant = () => !!data.tenantId;
}

/**
 * Middleware para verificar permisos específicos
 * Uso: checkPermission('invoice:create')
 */
export function checkPermission(requiredPermission: string): BotMiddleware {
  return async (ctx: BotContext, next: () => Promise<void>) => {
    if (!ctx.hasPermission || !ctx.hasPermission(requiredPermission)) {
      logger.warn(
        {
          telegramId: ctx.from?.id,
          requiredPermission,
          userRole: ctx.getUserRole?.(),
        },
        'Permiso denegado'
      );
      await ctx.reply(`⛔ No tienes permisos para esta acción: ${requiredPermission}`);
      return;
    }
    return next();
  };
}

/**
 * Invalida el caché de permisos para un usuario específico
 * @param telegramId - ID de Telegram del usuario
 */
export function invalidateUserCache(telegramId: string | number): boolean {
  const stringKey = telegramId.toString();
  const numberKey = Number(telegramId);

  // Intentar eliminar tanto la clave string como number para asegurar limpieza completa
  const hadStringCache = permissionsCache.has(stringKey);
  const hadNumberCache = permissionsCache.has(numberKey.toString());

  permissionsCache.delete(stringKey);
  permissionsCache.delete(numberKey.toString());

  // También limpiar cualquier clave que pueda coincidir
  for (const [key] of permissionsCache.entries()) {
    if (key == telegramId || key === stringKey || key === numberKey.toString()) {
      permissionsCache.delete(key);
    }
  }

  const hadCache = hadStringCache || hadNumberCache;

  logger.info(
    {
      telegramId,
      hadStringCache,
      hadNumberCache,
      hadCache,
      cacheSize: permissionsCache.size,
    },
    'Cache de permisos invalidado completamente'
  );

  return hadCache;
}

/**
 * Limpiar cache periódicamente
 */
setInterval(() => {
  const now = Date.now();
  for (const [telegramId, data] of permissionsCache.entries()) {
    if (now - data.lastUpdated > CACHE_DURATION) {
      permissionsCache.delete(telegramId);
    }
  }
}, CACHE_DURATION);

logger.info('Middleware de autorización multiusuario inicializado');

export default multiUserAuthMiddleware;
