import type { Bot } from '../../types/bot.types.js';
import { createModuleLogger } from '@core/utils/logger.js';
import { registerStartCommand } from './start.command.js';
import { registerHelpCommand } from './help.command.js';
import { registerMenuCommand } from './menu.command.js';
import { registerSubscriptionCommand } from './subscription.command.js';
import { registerAdminCommands } from './admin.command.js';
import { registerOnboardingCommands } from './onboarding.command.js';
import { registerReportCommands } from './report.command.js';

const logger = createModuleLogger('commands-index');

/**
 * Registra todos los comandos en el bot
 * @param bot - Instancia del bot de Telegram
 */
export async function registerAllCommands(bot: Bot): Promise<void> {
  registerStartCommand(bot);
  registerHelpCommand(bot);
  await registerMenuCommand(bot);
  registerSubscriptionCommand(bot);
  registerAdminCommands(bot);
  registerOnboardingCommands(bot);
  registerReportCommands(bot);

  logger.info('Comandos registrados correctamente');
}
