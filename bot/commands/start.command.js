// bot/commands/start.command.js
import { mainMenu, startMenu } from '../views/menu.view.js';

/**
 * Registra el comando start (/start)
 * @param {Object} bot - Instancia del bot
 */
export function registerStartCommand(bot) {
  bot.start((ctx) => {
    ctx.resetState();
    
    // Comprobar si el usuario ya está asociado a un tenant
    if (ctx.hasTenant()) {
      ctx.reply(
        `¡Bienvenido de nuevo, ${ctx.from.first_name}!\nEstás conectado como usuario de ${ctx.userState.tenantName}.\nSelecciona una opción:`,
        mainMenu()
      );
    } else {
      ctx.reply(
        `¡Bienvenido al Sistema de Facturación, ${ctx.from.first_name}!\n\n` +
        `Para comenzar a utilizar el sistema, necesitas crear una organización en FacturAPI y luego registrar tu empresa.\n\n` +
        `Usa el botón "Crear organización" para comenzar o "Más información" para conocer los planes disponibles.`,
        startMenu()
      );
    }
  });
}