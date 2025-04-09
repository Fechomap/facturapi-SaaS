// core/tenant/tenant.middleware.js
import TenantService from './tenant.service.js';
import logger from '../utils/logger.js';
import prisma from '../../lib/prisma.js';

// Logger específico para middleware de tenant
const middlewareLogger = logger.child({ module: 'tenant-middleware' });

/**
 * Middleware para añadir información del tenant al contexto de Telegraf
 * @param {Object} ctx - Contexto de Telegraf
 * @param {Function} next - Función next
 * @returns {Promise<void>}
 */
async function tenantContextMiddleware(ctx, next) {
  // Asegurar que el ID del usuario esté disponible
  const telegramId = ctx.from?.id;
  if (!telegramId) return next();

  try {
    // Inicializar userState si no existe
    ctx.userState = ctx.userState || {};
    
    middlewareLogger.debug({ telegramId: telegramId, userState: JSON.stringify(ctx.userState) }, 'Estado actual antes de verificar tenant');

    // Solo verificar el tenant si no hay uno establecido o si userStatus es 'no_tenant'
    if (!ctx.userState.tenantId || ctx.userState.userStatus === 'no_tenant') {
      // Buscar el usuario y su tenant asociado
      const user = await TenantService.findUserByTelegramId(telegramId);
      middlewareLogger.debug({ telegramId: telegramId, userFound: !!user }, 'Información de usuario consultada');
      
      if (user && user.tenant) {
        // Guardar el ID del tenant en el estado del usuario para futuras referencias
        ctx.userState.tenantId = user.tenant.id;
        ctx.userState.tenantName = user.tenant.businessName;
        
        // También verificar si el usuario está autorizado
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
            userStatus: ctx.userState.userStatus 
          }, 
          'Estado actualizado con información de tenant'
        );
      } else {
        // El usuario no está asociado a ningún tenant
        ctx.userState.userStatus = 'no_tenant';
        middlewareLogger.debug({ telegramId: telegramId }, 'Usuario sin tenant asociado');
      }
    }

    // Añadir métodos de utilidad para trabajar con el tenant
    ctx.getTenantId = () => ctx.userState?.tenantId;
    ctx.isUserAuthorized = () => ctx.userState?.userStatus === 'authorized';
    ctx.hasTenant = () => !!ctx.userState?.tenantId;
    
    return next();
  } catch (error) {
    middlewareLogger.error({ error, telegramId }, 'Error en tenant middleware');
    return next();
  }
}

/**
 * Middleware para validar que el usuario tenga un tenant asignado (API REST)
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @param {Function} next - Función next
 * @returns {Promise<void>}
 */
async function requireTenant(req, res, next) {
  try {
    // Obtener el tenant ID del header o del cuerpo de la solicitud o query parameter
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId || req.body?.tenantId;
    
    if (!tenantId) {
      middlewareLogger.warn({ path: req.path }, 'Solicitud sin tenant ID');
      return res.status(400).json({ 
        error: 'TenantRequired', 
        message: 'Debe proporcionar un tenant ID en el header X-Tenant-ID, query parameter o en el cuerpo de la solicitud'
      });
    }
    
    // Verificar que el tenant existe directamente en la base de datos
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true,
        email: true,
        isActive: true,
        facturapiApiKey: true
      }
    });
    
    if (!tenant) {
      middlewareLogger.warn({ tenantId, path: req.path }, 'Tenant no encontrado');
      return res.status(404).json({ 
        error: 'TenantNotFound', 
        message: 'El tenant especificado no existe'
      });
    }
    
    // Verificar que el tenant está activo
    if (!tenant.isActive) {
      middlewareLogger.warn({ tenantId, path: req.path }, 'Tenant inactivo');
      return res.status(403).json({ 
        error: 'TenantInactive', 
        message: 'El tenant especificado está desactivado'
      });
    }
    
    // Añadir el tenant a la solicitud
    req.tenant = tenant;
    
    // Añadir método para obtener la API key
    req.getApiKey = async () => {
      return await TenantService.getDecryptedApiKey(tenantId);
    };
    
    middlewareLogger.debug({ tenantId, path: req.path }, 'Tenant validado correctamente');
    next();
  } catch (error) {
    middlewareLogger.error({ error, path: req.path }, 'Error en middleware requireTenant');
    next(error);
  }
}

export { tenantContextMiddleware, requireTenant };
export default tenantContextMiddleware;
