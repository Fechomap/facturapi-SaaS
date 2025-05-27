// bot/commands/menu.command.js
import { Markup } from 'telegraf';
import { mainMenu, reportsMenu } from '../views/menu.view.js';

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

  bot.action('menu_reportes', async (ctx) => {
    await ctx.answerCbQuery();
    
    if (!ctx.hasTenant()) {
      return ctx.reply(
        'Para ver reportes, primero debes registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrar empresa', 'start_registration')]
        ])
      );
    }
    
    await ctx.reply(
      '📊 *Reportes y Análisis*\n\n' +
      'Selecciona el tipo de reporte que deseas consultar:',
      {
        parse_mode: 'Markdown',
        ...reportsMenu()
      }
    );
  });
  
  // Acción para generar reporte de facturas
  bot.action('reporte_facturas_action', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.telegram.sendMessage(ctx.chat.id, '/reporte_facturas');
  });
  
  // Acción para generar reporte de suscripción
  bot.action('reporte_suscripcion_action', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.telegram.sendMessage(ctx.chat.id, '/reporte_suscripcion');
  });
  
  // Acción para subir PDF de pedido
  bot.action('menu_subir_pdf', async (ctx) => {
    await ctx.answerCbQuery();
    
    if (!ctx.hasTenant()) {
      return ctx.reply(
        'Para subir un PDF de pedido, primero debes registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrar empresa', 'start_registration')]
        ])
      );
    }
    
    await ctx.reply(
      '📂 *Subir PDF de Pedido*\n\n' +
      'Envíame el PDF del pedido de compra para analizarlo automáticamente y generar la factura.\n\n' +
      '✅ Funcionará con pedidos de *ARSA*, *INFOASIST* y *SOS*.\n' +
      '📌 La clave SAT (`78101803`) se asignará automáticamente.\n\n' +
      'Por favor, adjunta ahora el archivo PDF:',
      { parse_mode: 'Markdown' }
    );
  });
}