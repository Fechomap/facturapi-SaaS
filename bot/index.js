// bot/index.js
import { Telegraf } from 'telegraf';
import { config } from '../config/index.js';
import { sessionMiddleware } from '../core/auth/session.service.js';
import tenantContextMiddleware from '../core/tenant/tenant.middleware.js';
import { registerAllCommands } from './commands/index.js';
import authMiddleware from './middlewares/auth.middleware.js';

// Importación directa de handlers
import { registerClientHandler } from './handlers/client.handler.js';
import { registerInvoiceHandler } from './handlers/invoice.handler.js';
import { registerChubbHandler } from './handlers/chubb.handler.js';
import { registerOnboardingHandler } from './handlers/onboarding.handler.js';
import { registerProductionSetupHandler } from './handlers/production-setup.handler.js'; 
import { registerTestHandlers } from './handlers/test-handlers.js'; // Nueva importación

export function createBot(logger) {
  // Verificar que el token está configurado
  if (!config.telegram.token) {
    logger.error('Token de Telegram no configurado');
    throw new Error('Token de Telegram no configurado. Configura TELEGRAM_BOT_TOKEN en tu archivo .env');
  }
  
  // Inicializar bot con token de Telegram
  const bot = new Telegraf(config.telegram.token);
  
  // Middleware para gestionar la sesión de usuario
  bot.use(sessionMiddleware);
  
  // Middleware para añadir información del tenant al contexto
  bot.use(tenantContextMiddleware);
  
  // Middleware para autorización
  bot.use(authMiddleware);
  
  // Middleware para manejo global de errores
  bot.catch((err, ctx) => {
    logger.error(
      { 
        error: err, 
        userId: ctx.from?.id, 
        username: ctx.from?.username,
        command: ctx.message?.text 
      }, 
      'Error no controlado en el bot'
    );
    
    ctx.reply('❌ Ha ocurrido un error inesperado. Por favor, intenta de nuevo más tarde.');
  });
  
  // Registrar los handlers de prueba primero (para diagnóstico)
  registerTestHandlers(bot);
  
  // Registrar todos los comandos
  registerAllCommands(bot);

  // Registrar handlers en orden: primero los específicos, último el de producción
  registerClientHandler(bot);
  registerInvoiceHandler(bot);
  registerChubbHandler(bot);         // Ahora antes del Production
  registerOnboardingHandler(bot);
  registerProductionSetupHandler(bot); // Este debe ser el último
  
  logger.info('Bot configurado correctamente');
  return bot;
}