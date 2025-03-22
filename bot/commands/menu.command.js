// bot/commands/menu.command.js
import { mainMenu } from '../views/menu.view.js';

/**
 * Registra el comando menu (/menu) y acciones relacionadas
 * @param {Object} bot - Instancia del bot
 */
export function registerMenuCommand(bot) {
  // Comando para menú principal
  bot.command('menu', (ctx) => {
    ctx.resetState();
    
    if (ctx.hasTenant()) {
      ctx.reply(
        'Seleccione una opción:',
        mainMenu()
      );
    } else {
      ctx.reply(
        'Para utilizar el sistema, primero debes crear una organización y luego registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Crear organización', 'create_organization')]
        ])
      );
    }
  });
  
  // Acción para el menú principal
  bot.action('menu_principal', (ctx) => {
    console.log('Acción menu_principal activada. Estado actual:', ctx.userState);
    
    ctx.answerCbQuery();
    
    if (ctx.hasTenant()) {
      ctx.reply(
        'Seleccione una opción:',
        mainMenu()
      );
    } else {
      ctx.reply(
        'Para utilizar el sistema, primero debes crear una organización y luego registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Crear organización', 'create_organization')]
        ])
      );
    }
  });
  
  // Agregar acciones de menú adicionales según sea necesario
  bot.action('volver_menu_principal', async (ctx) => {
    await ctx.answerCbQuery();
    
    console.log('Acción volver_menu_principal activada. Estado actual:', ctx.userState);
    
    // Guardar información importante del tenant antes de resetear
    const tenantId = ctx.userState?.tenantId;
    const tenantName = ctx.userState?.tenantName;
    const userStatus = ctx.userState?.userStatus;
    
    // Limpiar datos específicos manteniendo información de tenant
    ctx.userState = {
      tenantId,
      tenantName,
      userStatus,
      esperando: null,
      ...(ctx.userState?.continueCustomerSetup ? { continueCustomerSetup: true } : {})
    };
    
    ctx.reply('Seleccione una opción:', mainMenu());
  });
}