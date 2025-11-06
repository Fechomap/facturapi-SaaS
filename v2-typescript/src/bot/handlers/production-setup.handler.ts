// bot/handlers/production-setup.handler.ts
// Handler para configuración de facturación real
import { Telegraf } from 'telegraf';

/**
 * Registra los manejadores para el proceso de configuración productiva
 * NOTA: Este es un stub temporal para permitir la compilación
 * TODO: Migrar la implementación completa desde production-setup.handler.js
 */
export function registerProductionSetupHandler(bot: Telegraf): void {
  // Stub temporal - implementación pendiente
  bot.action('setup_production', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Esta funcionalidad está en proceso de migración a TypeScript.');
  });

  bot.command('registro_factura_real_completo', async (ctx) => {
    await ctx.reply('Esta funcionalidad está en proceso de migración a TypeScript.');
  });
}

export default registerProductionSetupHandler;
