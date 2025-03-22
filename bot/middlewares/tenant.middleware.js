// bot/middlewares/tenant.middleware.js
import TenantService from '../../services/tenant.service.js';

/**
 * Middleware para agregar contexto del tenant al objeto ctx
 */
async function tenantContextMiddleware(ctx, next) {
  // Asegurar que el ID del usuario esté disponible
  const telegramId = ctx.from?.id;
  if (!telegramId) return next();

  try {
    // Inicializar userState si no existe
    ctx.userState = ctx.userState || {};
    
    console.log('Estado actual antes de verificar tenant:', ctx.userState);

    // Solo verificar el tenant si no hay uno establecido o si userStatus es 'no_tenant'
    if (!ctx.userState.tenantId || ctx.userState.userStatus === 'no_tenant') {
      // Buscar el usuario y su tenant asociado
      const user = await TenantService.findUserByTelegramId(telegramId);
      console.log('Información de usuario encontrada:', user);
      
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
        
        console.log('Estado actualizado con información de tenant:', ctx.userState);
      } else {
        // El usuario no está asociado a ningún tenant
        ctx.userState.userStatus = 'no_tenant';
        console.log('Usuario sin tenant asociado');
      }
    }

    // Añadir métodos de utilidad para trabajar con el tenant
    ctx.getTenantId = () => ctx.userState?.tenantId;
    ctx.isUserAuthorized = () => ctx.userState?.userStatus === 'authorized';
    ctx.hasTenant = () => !!ctx.userState?.tenantId;
    
    return next();
  } catch (error) {
    console.error('Error en tenant middleware:', error);
    return next();
  }
}

export default tenantContextMiddleware;