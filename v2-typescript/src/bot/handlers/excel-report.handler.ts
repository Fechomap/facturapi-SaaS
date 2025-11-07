// bot/handlers/excel-report.handler.ts
// Handler conversacional para reportes Excel con filtros avanzados
import type { Bot } from '@/types/bot.types.js';

/**
 * Registrar todos los handlers para reportes Excel con filtros
 * NOTA: Este es un stub temporal para permitir la compilación
 * TODO: Migrar la implementación completa desde excel-report.handler.js
 */
export function registerExcelReportHandlers(bot: Bot): void {
  // Stub temporal - implementación pendiente
  bot.action('reporte_excel_action', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Esta funcionalidad está en proceso de migración a TypeScript.');
  });
}

export default registerExcelReportHandlers;
