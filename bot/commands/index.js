// bot/commands/index.js
import { registerStartCommand } from './start.command.js';
import { registerHelpCommand } from './help.command.js';
import { registerMenuCommand } from './menu.command.js';
import { registerSubscriptionCommand } from './subscription.command.js';

/**
 * Registra todos los comandos en el bot
 * @param {Object} bot - Instancia del bot de Telegram
 */
export function registerAllCommands(bot) {
  registerStartCommand(bot);
  registerHelpCommand(bot);
  registerMenuCommand(bot);
  registerSubscriptionCommand(bot);
  
  console.log('✅ Comandos registrados correctamente');
}