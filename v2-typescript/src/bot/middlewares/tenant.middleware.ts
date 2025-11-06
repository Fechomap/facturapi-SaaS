/**
 * Middleware para agregar contexto del tenant al objeto ctx
 */

import type { BotContext, BotMiddleware } from '@/types/bot.types.js';
import TenantService from '@services/tenant.service.js';
import { createModuleLogger } from '@core/utils/logger.js';

const logger = createModuleLogger('bot-tenant-middleware');

/**
 * Middleware de contexto de tenant
 */
const tenantContextMiddleware: BotMiddleware = async (
  ctx: BotContext,
  next: () => Promise<void>
) => {
  // Asegurar que el ID del usuario esté disponible
  const telegramId = ctx.from?.id;
  if (!telegramId) return next();

  try {
    // Inicializar userState si no existe
    ctx.userState = ctx.userState || {};

    logger.debug({ userState: ctx.userState }, 'Estado actual antes de verificar tenant');

    // Solo verificar el tenant si no hay uno establecido o si userStatus es 'no_tenant'
    if (!ctx.userState.tenantId || ctx.userState.userStatus === 'no_tenant') {
      // Buscar el usuario y su tenant asociado
      const user = await TenantService.findUserByTelegramId(BigInt(telegramId));
      logger.debug({ user }, 'Información de usuario encontrada');

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

        logger.debug({ userState: ctx.userState }, 'Estado actualizado con información de tenant');
      } else {
        // El usuario no está asociado a ningún tenant
        ctx.userState.userStatus = 'no_tenant';
        logger.debug('Usuario sin tenant asociado');
      }
    }

    // Añadir métodos de utilidad para trabajar con el tenant
    ctx.getTenantId = () => ctx.userState?.tenantId;
    ctx.isUserAuthorized = () => ctx.userState?.userStatus === 'authorized';
    ctx.hasTenant = () => !!ctx.userState?.tenantId;

    return next();
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Error en tenant middleware');
    return next();
  }
};

export default tenantContextMiddleware;
