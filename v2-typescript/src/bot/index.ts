/**
 * Telegram Bot Index
 * Main bot initialization and setup
 */

import { Telegraf } from 'telegraf';
import type { Logger } from 'pino';
import type { Bot, BotContext } from '@/types/bot.types.js';
import { sessionMiddleware } from '../core/auth/session.service.js';
import errorHandler from './middlewares/error.middleware.js';
import tenantMiddlewareBot from './middlewares/tenant.middleware.js';
import multiUserAuthMiddleware from './middlewares/multi-auth.middleware.js';

// Importar comandos
import { registerStartCommand } from './commands/start.command.js';
import { registerMenuCommand } from './commands/menu.command.js';
import { registerHelpCommand } from './commands/help.command.js';
import { registerAdminCommands } from './commands/admin.command.js';
import { registerOnboardingCommands } from './commands/onboarding.command.js';
import { registerReportCommands } from './commands/report.command.js';
import { registerSubscriptionCommand } from './commands/subscription.command.js';
import { registerUserManagementCommands } from './commands/user-management.commands.js';

// Importar handlers
import { registerClientHandler } from './handlers/client.handler.js';
import { registerInvoiceHandler } from './handlers/invoice.handler.js';
import { registerPDFInvoiceHandler } from './handlers/pdf-invoice.handler.js';
import { registerClubAsistenciaHandler } from './handlers/club-asistencia.handler.js';
import { registerQualitasHandler } from './handlers/qualitas.handler.js';
import { registerEscotelHandler } from './handlers/escotel.handler.js';
import { registerAxaHandler } from './handlers/axa.handler.js';
import { registerChubbHandler } from './handlers/chubb.handler.js';
import { registerTestHandlers } from './handlers/test.handler.js';
import { registerExcelReportHandlers } from './handlers/excel-report.handler.js';
import { registerReportHandlers } from './handlers/reports.handler.js';
import { registerProductionSetupHandler } from './handlers/production-setup.handler.js';
import { registerPaymentComplementHandler } from './handlers/payment-complement.handler.js';
import { registerBatchActionHandlers } from './handlers/pdf-batch.handler.js';

export async function createBot(botLogger: Logger): Promise<Bot> {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    botLogger.fatal('TELEGRAM_BOT_TOKEN is required');
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  const bot = new Telegraf<BotContext>(token);

  botLogger.info('Registrando middlewares y comandos del bot...');

  // 1. Middleware de Errores (el más externo - catch all)
  errorHandler(bot);

  // 2. Middleware de Sesión (maneja el estado del usuario)
  bot.use(sessionMiddleware);

  // 3. Middleware de Tenant específico del bot (validaciones adicionales)
  bot.use(tenantMiddlewareBot);

  // 4. Middleware de Autenticación Multi-Usuario (maneja tenant + roles + permisos)
  // NOTA: Este middleware reemplaza tenantContextMiddleware (redundante y conflictivo)
  bot.use(multiUserAuthMiddleware);

  // 6. Registro de Comandos (en orden de prioridad)
  botLogger.info('Registrando comandos básicos...');
  registerStartCommand(bot);
  registerHelpCommand(bot);
  registerMenuCommand(bot);

  botLogger.info('Registrando comandos de negocio...');
  registerOnboardingCommands(bot);
  registerReportCommands(bot);
  registerSubscriptionCommand(bot);

  botLogger.info('Registrando comandos de administración...');
  registerAdminCommands(bot);
  registerUserManagementCommands(bot);

  // 7. Registro de Handlers (procesamiento de documentos y eventos)
  botLogger.info('Registrando handlers...');
  registerClientHandler(bot);
  registerInvoiceHandler(bot);
  registerPDFInvoiceHandler(bot); // Handler para PDFs (individual y lotes)
  registerBatchActionHandlers(bot); // Acciones de botones de lotes
  registerPaymentComplementHandler(bot);
  registerClubAsistenciaHandler(bot);
  registerQualitasHandler(bot);
  registerEscotelHandler(bot);
  registerAxaHandler(bot);
  registerChubbHandler(bot);
  registerTestHandlers(bot);
  registerExcelReportHandlers(bot);
  registerReportHandlers(bot); // Handler para confirmación/cancelación de reportes
  registerProductionSetupHandler(bot);

  // 8. Manejador para texto no reconocido (debe ir al final)
  bot.on('text', async (ctx, next) => {
    // Solo responder si no fue manejado por ningún comando anterior
    if (!ctx.updateType) {
      botLogger.warn(
        { userId: ctx.from?.id, text: (ctx.message as any).text },
        'Comando no reconocido'
      );
      await ctx.reply('No reconozco ese comando. Usa /start para ver las opciones disponibles.');
      return;
    }
    return next();
  });

  botLogger.info('✅ Middlewares y comandos registrados. Bot configurado correctamente.');
  botLogger.info('Telegram bot created successfully');

  return bot;
}

export default {
  createBot,
};
