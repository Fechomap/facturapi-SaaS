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
  ADMIN: 'admin',        // Puede todo + gestionar usuarios
  OPERATOR: 'operator',  // Puede facturar y consultar
  VIEWER: 'viewer'       // Solo consulta
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
    'user:manage',      // Solo admin puede gestionar usuarios
    'batch:process'
  ],
  [USER_ROLES.OPERATOR]: [
    'invoice:create',
    'invoice:view',
    'invoice:cancel', 
    'client:manage',
    'report:view',
    'batch:process'
  ],
  [USER_ROLES.VIEWER]: [
    'invoice:view',
    'report:view'
  ]
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
    const userAccess = await findUserAccess(telegramId);
    if (!userAccess) {
      multiAuthLogger.warn({ telegramId }, 'Usuario no autorizado');
      return ctx.reply(
        '⛔ No estás registrado en el sistema. Usa /registro para comenzar.'
      );
    }

    // 4. Verificar que el usuario esté activo y autorizado
    if (!userAccess.isAuthorized || !userAccess.tenant.isActive) {
      multiAuthLogger.warn({ telegramId, tenantId: userAccess.tenantId }, 'Usuario o tenant inactivo');
      return ctx.reply(
        '⛔ Tu cuenta está pendiente de autorización por el administrador.'
      );
    }

    // 5. Cachear permisos y continuar
    const permissions = ROLE_PERMISSIONS[userAccess.role] || [];
    cachePermissions(telegramId, {
      tenantId: userAccess.tenantId,
      role: userAccess.role,
      permissions,
      isAuthorized: true
    });

    attachUserContext(ctx, {
      tenantId: userAccess.tenantId,
      role: userAccess.role,
      permissions
    });

    multiAuthLogger.info(
      { 
        telegramId, 
        tenantId: userAccess.tenantId, 
        role: userAccess.role 
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
async function findUserAccess(telegramId) {
  try {
    // NOTA: Por ahora usa el schema actual (telegramId único)
    // Después de la migración, esto cambiará para soportar múltiples usuarios por tenant
    const user = await prisma.tenantUser.findUnique({
      where: { telegramId: BigInt(telegramId) },
      include: {
        tenant: {
          select: {
            id: true,
            businessName: true,
            isActive: true
          }
        }
      }
    });

    if (!user) return null;

    return {
      tenantId: user.tenantId,
      role: user.role,
      isAuthorized: user.isAuthorized,
      tenant: user.tenant
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
    'create_organization'
  ];

  // Verificar comandos de texto
  if (ctx.message?.text) {
    return allowedCommands.some(cmd => ctx.message.text.startsWith(cmd));
  }

  // Verificar acciones inline
  if (ctx.callbackQuery?.data) {
    return allowedActions.includes(ctx.callbackQuery.data);
  }

  // Permitir mensajes durante proceso de registro
  if (ctx.userState?.esperando?.startsWith('reg_') || 
      ctx.userState?.esperando?.startsWith('org_')) {
    return true;
  }

  return false;
}

/**
 * Obtiene permisos desde cache si están vigentes
 */
function getCachedPermissions(telegramId) {
  const cached = permissionsCache.get(telegramId);
  if (!cached) return null;

  const now = Date.now();
  if (now - cached.lastUpdated > CACHE_DURATION) {
    permissionsCache.delete(telegramId);
    return null;
  }

  return cached;
}

/**
 * Cachea permisos de usuario
 */
function cachePermissions(telegramId, data) {
  permissionsCache.set(telegramId, {
    ...data,
    lastUpdated: Date.now()
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
          userRole: ctx.getUserRole?.() 
        },
        'Permiso denegado'
      );
      return ctx.reply(`⛔ No tienes permisos para esta acción: ${requiredPermission}`);
    }
    return next();
  };
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