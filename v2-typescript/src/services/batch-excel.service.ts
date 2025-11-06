// services/batch-excel.service.ts
import logger from '../core/utils/logger';

const batchLogger = logger.child({ module: 'batch-excel' });

/**
 * Generación de reportes Excel por lotes con progreso real
 * TODO: Migrar implementación completa desde batch-excel.service.js
 */
export async function generateExcelReportBatched(ctx: any, filters: any = {}) {
  const tenantId = ctx.getTenantId();

  batchLogger.info('🚀 Iniciando reporte Excel por lotes', { tenantId, filters });

  try {
    await ctx.reply(
      '📊 **Reporte Excel en Desarrollo**\n\n' +
        'La funcionalidad de reportes por lotes está siendo migrada a TypeScript.\n\n' +
        'Por favor, usa reportes pequeños por ahora.',
      { parse_mode: 'Markdown' }
    );

    return { success: false, message: 'En desarrollo' };
  } catch (error: any) {
    batchLogger.error('Error en reporte por lotes', { error: error.message });
    return { success: false, error: error.message };
  }
}

export default {
  generateExcelReportBatched,
};
