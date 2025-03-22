// bot/middlewares/error.middleware.js
import { Markup } from 'telegraf';

/**
 * Middleware para manejo centralizado de errores en el bot
 */
function errorMiddleware(bot) {
  bot.catch((err, ctx) => {
    console.error('Error en el bot:', err);

    let errorMsg = '❌ Ocurrió un error en el sistema.';
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      errorMsg = '❌ Error de conexión. Por favor, verifique su conexión a internet.';
    } else if (err.code === 'EFATAL') {
      errorMsg = '❌ Error crítico en el sistema. Por favor, contacte al administrador.';
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('Volver al Menú', 'menu_principal')]
    ]);

    ctx.reply(errorMsg, keyboard).catch(e => {
      console.error('Error al enviar mensaje de error:', e);
    });
  });
}

export default errorMiddleware;