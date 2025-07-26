// feature-multiuser/middleware/multi-auth.middleware.js
// Middleware de autorización multiusuario para Telegram

import prisma from '../../lib/prisma.js';
import logger from '../../core/utils/logger.js';

// Logger específico para autorización multiusuario
const multiAuthLogger = logger.child({ module: 'multi-auth-middleware' });

/**
 * Roles de usuario disponibles
 */
export const USER_ROLES = {
  ADMIN: 'admin', // Puede todo + gestionar usuarios
  OPERATOR: 'operator', // Puede facturar y consultar
  VIEWER: 'viewer', // Solo consulta
};

/**
 * Permisos por rol
 */
export const ROLE_PERMISSIONS = {
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
 * Cache de permisos en memoria para optimizar consultas
 * Estructura: { telegramId: { tenantId, role, permissions, lastUpdated } }
 */
const permissionsCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

/**
 * Middleware de autorización multiusuario
 * Reemplaza el middleware de auth.middleware.js actual
 */
export default async function multiUserAuthMiddleware(ctx, next) {
  const telegramId = ctx.from?.id;

  if (!telegramId) {
    multiAuthLogger.warn('Request sin telegram ID');
    return ctx.reply('⛔ Error de autenticación');
  }

  try {
    // 1. Permitir comandos de inicio sin autenticación
    if (isPublicCommand(ctx)) {
      multiAuthLogger.debug({ telegramId }, 'Comando público, permitido');
      return next();
    }

    // 2. Verificar cache de permisos primero
    const cachedPermissions = getCachedPermissions(telegramId);
    if (cachedPermissions) {
      multiAuthLogger.debug({ telegramId }, 'Usando permisos desde cache');
      attachUserContext(ctx, cachedPermissions);
      return next();
    }

    // 3. Buscar usuario en BD con su tenant y rol
    // Obtener tenantId del contexto si está disponible (para usuarios existentes)
    const existingTenantId = ctx.getTenantId ? ctx.getTenantId() : null;
    let userAccess = await findUserAccess(telegramId, existingTenantId);

    if (!userAccess) {
      multiAuthLogger.warn({ telegramId }, 'Usuario no autorizado');
      return ctx.reply('⛔ No estás registrado en el sistema. Usa /registro para comenzar.');
    }

    // Manejar caso de múltiples empresas
    if (userAccess.multipleAccess) {
      multiAuthLogger.info({ telegramId }, 'Usuario con acceso a múltiples empresas');
      // Por ahora usar la primera empresa autorizada
      const authorizedAccess = userAccess.availableAccess.find((a) => a.isAuthorized);
      if (!authorizedAccess) {
        return ctx.reply('⏳ Tus accesos están pendientes de autorización en todas las empresas.');
      }
      // Recursivamente buscar con tenantId específico
      const specificAccess = await findUserAccess(telegramId, authorizedAccess.tenantId);
      if (specificAccess) {
        userAccess = specificAccess;
      }
    }

    if (!userAccess || userAccess.multipleAccess) {
      multiAuthLogger.warn({ telegramId }, 'No se pudo resolver acceso del usuario');
      return ctx.reply('❌ Error al procesar tu acceso. Contacta al administrador.');
    }

    // 4. Verificar que el usuario esté activo y autorizado
    if (!userAccess.isAuthorized || !userAccess.tenant.isActive) {
      multiAuthLogger.warn(
        { telegramId, tenantId: userAccess.tenantId },
        'Usuario o tenant inactivo'
      );
      return ctx.reply('⛔ Tu cuenta está pendiente de autorización por el administrador.');
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

    multiAuthLogger.info(
      {
        telegramId,
        tenantId: userAccess.tenantId,
        role: userAccess.role,
      },
      'Usuario autorizado'
    );

    return next();
  } catch (error) {
    multiAuthLogger.error(
      { telegramId, error: error.message },
      'Error en middleware de autorización'
    );
    return ctx.reply('❌ Error interno de autorización. Intenta de nuevo.');
  }
}

/**
 * Busca acceso del usuario en la BD
 * Compatible con schema actual Y futuro multiusuario
 */
async function findUserAccess(telegramId, tenantId = null) {
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
            role: u.role,
            isAuthorized: u.isAuthorized,
          })),
        };
      }
    }

    if (!user) return null;

    return {
      tenantId: user.tenantId,
      role: user.role,
      isAuthorized: user.isAuthorized,
      tenant: user.tenant,
    };
  } catch (error) {
    multiAuthLogger.error(
      { telegramId, error: error.message },
      'Error al buscar acceso de usuario'
    );
    return null;
  }
}

/**
 * Verifica si es un comando público que no requiere autenticación
 */
function isPublicCommand(ctx) {
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
  if (ctx.message?.text) {
    return allowedCommands.some((cmd) => ctx.message.text.startsWith(cmd));
  }

  // Verificar acciones inline
  if (ctx.callbackQuery?.data) {
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
function getCachedPermissions(telegramId) {
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
function cachePermissions(telegramId, data) {
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
function attachUserContext(ctx, data) {
  // Mantener compatibilidad con código existente
  ctx.userState = ctx.userState || {};
  ctx.userState.tenantId = data.tenantId;
  ctx.userState.userRole = data.role;

  // Nuevos métodos para multiusuario
  ctx.getTenantId = () => data.tenantId;
  ctx.getUserRole = () => data.role;
  ctx.hasPermission = (permission) => data.permissions.includes(permission);
  ctx.isAdmin = () => data.role === USER_ROLES.ADMIN;
  ctx.isUserAuthorized = () => true; // Ya verificado antes
  ctx.hasTenant = () => !!data.tenantId;
}

/**
 * Middleware para verificar permisos específicos
 * Uso: checkPermission('invoice:create')
 */
export function checkPermission(requiredPermission) {
  return (ctx, next) => {
    if (!ctx.hasPermission || !ctx.hasPermission(requiredPermission)) {
      multiAuthLogger.warn(
        {
          telegramId: ctx.from?.id,
          requiredPermission,
          userRole: ctx.getUserRole?.(),
        },
        'Permiso denegado'
      );
      return ctx.reply(`⛔ No tienes permisos para esta acción: ${requiredPermission}`);
    }
    return next();
  };
}

/**
 * Invalida el caché de permisos para un usuario específico
 * @param {string|number} telegramId - ID de Telegram del usuario
 */
export function invalidateUserCache(telegramId) {
  const stringKey = telegramId.toString();
  const numberKey = Number(telegramId);

  // Intentar eliminar tanto la clave string como number para asegurar limpieza completa
  const hadStringCache = permissionsCache.has(stringKey);
  const hadNumberCache = permissionsCache.has(numberKey);

  permissionsCache.delete(stringKey);
  permissionsCache.delete(numberKey);

  // También limpiar cualquier clave que pueda coincidir
  for (const [key, value] of permissionsCache.entries()) {
    if (key == telegramId || key === stringKey || key === numberKey) {
      permissionsCache.delete(key);
    }
  }

  const hadCache = hadStringCache || hadNumberCache;

  multiAuthLogger.info(
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

multiAuthLogger.info('Middleware de autorización multiusuario inicializado');
