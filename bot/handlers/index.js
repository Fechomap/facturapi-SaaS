// bot/handlers/index.js
import { registerClientHandler } from './client.handler.js';
import { registerInvoiceHandler } from './invoice.handler.js';
import { registerChubbHandler } from './chubb.handler.js';
import { registerOnboardingHandler } from './onboarding.handler.js';

/**
 * Registra todos los handlers en el bot
 * @param {Object} bot - Instancia del bot
 */
export function registerAllHandlers(bot) {
  registerClientHandler(bot);
  registerInvoiceHandler(bot);
  registerChubbHandler(bot);
  registerOnboardingHandler(bot);
  
  console.log('✅ Handlers registrados correctamente');
}