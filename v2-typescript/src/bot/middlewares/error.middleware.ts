/**
 * Middleware para manejo centralizado de errores en el bot
 */

import { Markup } from 'telegraf';
import type { Bot, BotContext } from '@/types/bot.types.js';
import { createModuleLogger } from '@core/utils/logger.js';

const logger = createModuleLogger('bot-error-middleware');

/**
 * Códigos de error reconocidos
 */
interface ErrorWithCode extends Error {
  code?: string;
}

/**
 * Middleware de manejo de errores para el bot
 */
function errorMiddleware(bot: Bot): void {
  bot.catch((err: unknown, ctx: BotContext) => {
    const error = err as ErrorWithCode;
    logger.error({ error: error.message, code: error.code }, 'Error en el bot');

    let errorMsg = '❌ Ocurrió un error en el sistema.';
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      errorMsg = '❌ Error de conexión. Por favor, verifique su conexión a internet.';
    } else if (error.code === 'EFATAL') {
      errorMsg = '❌ Error crítico en el sistema. Por favor, contacte al administrador.';
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Volver al Menú', 'menu_principal')],
    ]);

    ctx.reply(errorMsg, keyboard).catch((e) => {
      logger.error({ error: (e as Error).message }, 'Error al enviar mensaje de error');
    });
  });
}

export default errorMiddleware;
