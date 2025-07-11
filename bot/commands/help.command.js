// bot/commands/help.command.js

/**
 * Registra el comando help (/help)
 * @param {Object} bot - Instancia del bot
 */
export function registerHelpCommand(bot) {
  bot.help((ctx) => {
    // Determinar si mostrar ayuda básica o para usuarios registrados
    if (ctx.hasTenant()) {
      ctx.reply(
        '🤖 *Bot de Facturación - Ayuda*\n\n' +
          'Este bot te permite generar facturas de forma automatizada utilizando FacturAPI.\n\n' +
          '*Comandos disponibles:*\n' +
          '• /start - Iniciar el bot\n' +
          '• /help - Mostrar este mensaje de ayuda\n' +
          '• /suscripcion - Ver detalles de tu suscripción\n\n' +
          '*Cómo generar una factura:*\n' +
          '1. Pulse el botón "Generar Factura"\n' +
          '2. Seleccione el cliente o la opción CHUBB\n' +
          '3. Si selecciona un cliente:\n' +
          '   a. Ingrese el número de pedido\n' +
          '   b. Ingrese la clave del producto\n' +
          '   c. Ingrese el monto a facturar\n' +
          '   d. Confirme los datos\n' +
          '4. Si selecciona CHUBB:\n' +
          '   a. Suba el archivo Excel con los datos\n' +
          '   b. Confirme la generación de facturas\n' +
          '5. Descargue el PDF o XML de su factura',
        { parse_mode: 'Markdown' }
      );
    } else {
      ctx.reply(
        '🤖 *Bot de Facturación - Ayuda*\n\n' +
          'Este bot te permite generar facturas electrónicas para tu empresa de forma sencilla.\n\n' +
          '*Comandos disponibles:*\n' +
          '• /start - Iniciar el bot\n' +
          '• /help - Mostrar este mensaje de ayuda\n\n' +
          '*Para comenzar:*\n' +
          '1. Crear una organización en FacturAPI\n' +
          '2. Registrar tu empresa con los datos fiscales\n' +
          '3. Comenzar a generar facturas',
        { parse_mode: 'Markdown' }
      );
    }
  });
}
