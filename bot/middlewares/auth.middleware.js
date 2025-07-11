// bot/middlewares/auth.middleware.js
import { config } from '../../config/index.js';

/**
 * Middleware para verificar autorización de usuarios
 */
function authMiddleware(ctx, next) {
  // Permitir siempre comandos de inicio y registro
  const allowedCommands = ['/start', '/help', '/registro', '/login'];

  // También permitir ciertas acciones inline
  const allowedActions = [
    'start_registration',
    'show_pricing',
    'back_to_start',
    'confirm_registration',
    'cancel_registration',
    'create_organization',
  ];

  // IMPORTANTE: Permitir mensajes durante el proceso de registro
  if (
    ctx.message &&
    ctx.message.text &&
    ctx.userState &&
    (ctx.userState.esperando === 'org_create' ||
      ctx.userState.esperando?.startsWith('reg_') ||
      ctx.userState.esperando?.startsWith('org_'))
  ) {
    console.log('Permitiendo mensaje durante el proceso de registro/organización.');
    return next();
  }

  // Verificar si es un comando permitido
  if (
    ctx.message &&
    ctx.message.text &&
    allowedCommands.some((cmd) => ctx.message.text.startsWith(cmd))
  ) {
    return next();
  }

  // Verificar si es una acción inline permitida
  if (ctx.callbackQuery && allowedActions.includes(ctx.callbackQuery.data)) {
    return next();
  }

  // Si hay lista de usuarios autorizados global, verificar primero eso
  if (config.telegram.authorizedUsers.length > 0) {
    if (config.telegram.authorizedUsers.includes(ctx.from.id)) {
      return next();
    }
    return ctx.reply('⛔ Lo siento, no estás autorizado para usar este bot.');
  }

  // Si el usuario debe estar asociado a un tenant, verificar
  if (!ctx.hasTenant()) {
    return ctx.reply('⛔ No estás registrado en el sistema. Usa /registro para comenzar.');
  }

  // Verificar si el usuario está autorizado en su tenant
  if (!ctx.isUserAuthorized()) {
    return ctx.reply('⛔ Tu cuenta está pendiente de autorización por el administrador.');
  }

  return next();
}

export default authMiddleware;
