// bot/handlers/index.js
import { registerClientHandler } from './client.handler.js';
import { registerInvoiceHandler } from './invoice.handler.js';
import { registerChubbHandler } from './chubb.handler.js';
import { registerAxaHandler } from './axa.handler.js';
import { registerClubAsistenciaHandler } from './club-asistencia.handler.js';
import { registerQualitasHandler } from './qualitas.handler.js';
import { registerOnboardingHandler } from './onboarding.handler.js';

/**
 * Registra todos los handlers en el bot
 * @param {Object} bot - Instancia del bot
 */
export function registerAllHandlers(bot) {
  console.log('🔄 Iniciando registro de handlers...');

  registerClientHandler(bot);
  console.log('✅ Client handler registrado');

  registerInvoiceHandler(bot);
  console.log('✅ Invoice handler registrado');

  registerChubbHandler(bot);
  console.log('✅ Chubb handler registrado');

  registerAxaHandler(bot);
  console.log('✅ AXA handler registrado');

  registerClubAsistenciaHandler(bot);
  console.log('✅ Club de Asistencia handler registrado');

  registerQualitasHandler(bot);
  console.log('✅ Qualitas handler registrado');

  registerOnboardingHandler(bot);
  console.log('✅ Onboarding handler registrado');

  console.log('✅ Handlers registrados correctamente');
}
