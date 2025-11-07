// services/simple-excel.service.ts
// Generación de reportes Excel SIMPLE y ASÍNCRONA
import logger from '../core/utils/logger';

const simpleLogger = logger.child({ module: 'simple-excel' });

/**
 * Generar reporte Excel asíncrono SIMPLE
 */
export async function generateExcelReportAsync(ctx: any, filters: any = {}) {
  const tenantId = ctx.getTenantId();
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  simpleLogger.info('🚀 Iniciando reporte Excel simple asíncrono', {
    tenantId,
    userId,
    filters: Object.keys(filters),
  });

  try {
    const progressMsg = await ctx.reply(
      '📊 **Generando Reporte Excel**\n\n' +
        '🔄 Procesando facturas...\n' +
        '📱 Te mantendré informado del progreso',
      { parse_mode: 'Markdown' }
    );

    processInBackground(ctx, tenantId, userId, chatId, filters, progressMsg.message_id);

    return { success: true };
  } catch (error: any) {
    simpleLogger.error('❌ Error iniciando reporte asíncrono', {
      tenantId,
      userId,
      error: error.message,
    });

    await ctx.reply('❌ **Error**\n\nNo se pudo iniciar el reporte.', { parse_mode: 'Markdown' });
    return { success: false, error: error.message };
  }
}

async function processInBackground(
  ctx: any,
  tenantId: string,
  userId: number,
  chatId: number,
  filters: any,
  messageId: number
) {
  try {
    simpleLogger.info('📊 Procesando Excel en background', { tenantId, userId });

    await updateProgress(ctx, chatId, messageId, 10, 'Consultando facturas en base de datos...');

    // TODO: Implementar cuando se migre ExcelReportService completo
    await updateProgress(ctx, chatId, messageId, 100, 'Completado (funcionalidad en desarrollo)');

    await ctx.telegram.sendMessage(
      chatId,
      '⚠️ **Servicio en Desarrollo**\n\nLa generación de reportes Excel está siendo migrada a TypeScript.',
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    simpleLogger.error('❌ Error procesando en background', { error: error.message });
    await ctx.telegram.sendMessage(chatId, '❌ Error generando reporte.');
  }
}

async function updateProgress(
  ctx: any,
  chatId: number,
  messageId: number,
  progress: number,
  status: string
) {
  try {
    const progressBar =
      '█'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));

    await ctx.telegram.editMessageText(
      chatId,
      messageId,
      undefined,
      `📊 **Generando Reporte Excel**\n\n` + `${progressBar} ${progress}%\n\n` + `📝 ${status}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    // Ignorar errores de edición (mensaje idéntico, etc)
  }
}

export default {
  generateExcelReportAsync,
};
