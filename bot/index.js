// bot/index.js
import { Telegraf } from 'telegraf';
import { config } from '../config/index.js';
import { sessionMiddleware } from '../core/auth/session.service.js';
import tenantContextMiddleware from '../core/tenant/tenant.middleware.js';
import { registerAllCommands } from './commands/index.js';
import multiUserAuthMiddleware from './middlewares/multi-auth.middleware.js';
import { registerUserManagementCommands } from './commands/user-management.commands.js';

// Importación directa de handlers
import { registerPDFInvoiceHandler } from './handlers/pdf-invoice.handler.js'; // Handler para PDFs
import { handleBatchGenerateInvoices } from './handlers/pdf-batch-simple.handler.js'; // Handler simplificado para batch
import { registerClientHandler } from './handlers/client.handler.js';
import { registerInvoiceHandler } from './handlers/invoice.handler.js';
import { registerChubbHandler } from './handlers/chubb.handler.js';
import { registerAxaHandler } from './handlers/axa.handler.js';
import { registerClubAsistenciaHandler } from './handlers/club-asistencia.handler.js';
import { registerOnboardingHandler } from './handlers/onboarding.handler.js';
import { registerProductionSetupHandler } from './handlers/production-setup.handler.js';
import { registerTestHandlers } from './handlers/test-handlers.js'; // Nueva importación

export async function createBot(logger) {
  // Verificar que el token está configurado
  if (!config.telegram.token) {
    logger.error('Token de Telegram no configurado');
    throw new Error(
      'Token de Telegram no configurado. Configura TELEGRAM_BOT_TOKEN en tu archivo .env'
    );
  }

  // Inicializar bot con token de Telegram
  const bot = new Telegraf(config.telegram.token);

  // Middleware para gestionar la sesión de usuario
  bot.use(sessionMiddleware);

  // Middleware para añadir información del tenant al contexto
  bot.use(tenantContextMiddleware);

  // Lista de IDs de admin (tomar de las variables de entorno)
  const ADMIN_IDS =
    config.telegram.adminChatIds ||
    process.env.ADMIN_CHAT_IDS?.split(',').map((id) => BigInt(id.trim())) ||
    [];

  // Middleware para comandos de administrador
  bot.use((ctx, next) => {
    // Si es un comando que empieza con /admin_
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/admin_')) {
      // Verificar si el usuario es administrador
      if (!ADMIN_IDS.includes(BigInt(ctx.from.id))) {
        return ctx.reply('⛔ Comando reservado para administradores.');
      }
    }
    return next();
  });

  // Middleware para autorización multiusuario (reemplaza authMiddleware)
  bot.use(multiUserAuthMiddleware);

  // Middleware para manejo global de errores
  bot.catch((err, ctx) => {
    logger.error(
      {
        error: err,
        userId: ctx.from?.id,
        username: ctx.from?.username,
        command: ctx.message?.text,
      },
      'Error no controlado en el bot'
    );

    ctx.reply('❌ Ha ocurrido un error inesperado. Por favor, intenta de nuevo más tarde.');
  });

  // Registrar los handlers de prueba primero (para diagnóstico)
  registerTestHandlers(bot);

  // Registrar todos los comandos (incluyendo los de admin a través de registerAllCommands)
  await registerAllCommands(bot);

  // Registrar comandos de gestión multiusuario
  registerUserManagementCommands(bot);

  // Registrar handlers en orden: IMPORTANTE - el handler de PDF debe ir PRIMERO
  registerPDFInvoiceHandler(bot); // 1. PDF (PRIMERO)
  handleBatchGenerateInvoices(bot); // 1.1. Handler simplificado para batch
  registerClientHandler(bot); // 2. Clientes
  registerInvoiceHandler(bot); // 3. Facturas
  registerChubbHandler(bot); // 4. Excel CHUBB
  registerAxaHandler(bot); // 5. Excel AXA
  registerClubAsistenciaHandler(bot); // 6. Excel CLUB DE ASISTENCIA
  registerOnboardingHandler(bot); // 7. Onboarding
  registerProductionSetupHandler(bot); // 8. Producción (ÚLTIMO)

  logger.info('Bot configurado correctamente');
  return bot;
}
