/**
 * Middleware para verificar autorización de usuarios
 */

import type { BotContext, BotMiddleware } from '@/types/bot.types.js';
import { config } from '@/config/index.js';
import { createModuleLogger } from '@core/utils/logger.js';

const logger = createModuleLogger('bot-auth-middleware');

/**
 * Middleware de autenticación para el bot de Telegram
 */
const authMiddleware: BotMiddleware = async (ctx: BotContext, next: () => Promise<void>) => {
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
    'text' in ctx.message &&
    ctx.message.text &&
    ctx.userState &&
    (ctx.userState.esperando === 'org_create' ||
      ctx.userState.esperando?.startsWith('reg_') ||
      ctx.userState.esperando?.startsWith('org_'))
  ) {
    logger.debug('Permitiendo mensaje durante el proceso de registro/organización');
    return next();
  }

  // Verificar si es un comando permitido
  if (ctx.message && 'text' in ctx.message && ctx.message.text) {
    const messageText = ctx.message.text;
    if (allowedCommands.some((cmd) => messageText.startsWith(cmd))) {
      return next();
    }
  }

  // Verificar si es una acción inline permitida
  if (
    ctx.callbackQuery &&
    'data' in ctx.callbackQuery &&
    allowedActions.includes(ctx.callbackQuery.data)
  ) {
    return next();
  }

  // Si hay lista de usuarios autorizados global, verificar primero eso
  if (config.telegram.authorizedUsers && config.telegram.authorizedUsers.length > 0) {
    if (ctx.from && config.telegram.authorizedUsers.includes(ctx.from.id)) {
      return next();
    }
    await ctx.reply('⛔ Lo siento, no estás autorizado para usar este bot.');
    return;
  }

  // Si el usuario debe estar asociado a un tenant, verificar
  if (!ctx.hasTenant()) {
    await ctx.reply('⛔ No estás registrado en el sistema. Usa /registro para comenzar.');
    return;
  }

  // Verificar si el usuario está autorizado en su tenant
  if (!ctx.isUserAuthorized || !ctx.isUserAuthorized()) {
    await ctx.reply('⛔ Tu cuenta está pendiente de autorización por el administrador.');
    return;
  }

  return next();
};

export default authMiddleware;
