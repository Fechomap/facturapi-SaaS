/**
 * Reports Handler
 * Maneja acciones relacionadas con reportes (confirmación, cancelación)
 * Complementa el excel-report.handler.ts
 */

import redisBatchStateService from '@services/redis-batch-state.service.js';
import { processInBackground } from '@services/simple-excel.service.js';
import type { BotContext } from '@/types/bot.types.js';
import type { Bot } from '@/types/bot.types.js';
import { createModuleLogger } from '@core/utils/logger.js';

const logger = createModuleLogger('reports-handler');

interface ReportBatchData {
  batchId: string;
  userId: number;
  timestamp: number;
  filters: {
    dateRange?: {
      start: Date;
      end: Date;
      display?: string;
    };
    selectedClientIds?: string[];
  };
  [key: string]: unknown; // Cumplir con BatchDataBase
}

/**
 * Registrar todos los handlers relacionados con reportes
 */
export function registerReportHandlers(bot: Bot): void {
  // ============================================
  // CONFIRMACIÓN DE REPORTE GRANDE
  // ============================================

  /**
   * Handler para el botón de confirmación de reportes grandes
   * Patrón: confirm_generate_report:UUID
   */
  bot.action(/^confirm_generate_report:(.+)$/, async (ctx: BotContext) => {
    try {
      await ctx.answerCbQuery('Iniciando generación...');

      // Limpiar botones inmediatamente para feedback visual
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

      // Extraer el reportId del callback_data
      const reportId = (ctx as any).match[1];
      const userId = ctx.from?.id;
      const tenantId = ctx.getTenantId();
      const chatId = ctx.chat?.id;

      if (!reportId || !userId || !tenantId || !chatId) {
        logger.error('Información incompleta en confirmación de reporte', {
          reportId,
          userId,
          tenantId,
          chatId,
        });
        await ctx.reply('❌ Error: La solicitud ha expirado o es inválida.');
        return;
      }

      logger.info('Confirmación de reporte grande recibida', { reportId, userId, tenantId });

      // 1. Recuperar los filtros desde Redis
      const batchResult = await redisBatchStateService.getBatchData<ReportBatchData>(
        userId,
        reportId
      );

      if (!batchResult.success || !batchResult.data) {
        logger.warn('Datos de reporte no encontrados en Redis', { reportId, userId });
        await ctx.reply(
          '❌ Error: La solicitud del reporte ha expirado. Por favor, inténtalo de nuevo.'
        );
        return;
      }

      const filters = batchResult.data.filters;

      logger.info('Filtros recuperados de Redis exitosamente', {
        reportId,
        userId,
        filters: Object.keys(filters),
      });

      // 2. Iniciar el proceso en segundo plano con los filtros recuperados
      const progressMsg = await ctx.reply(
        '✅ Confirmado. Iniciando generación del reporte grande...'
      );

      processInBackground(ctx, tenantId, userId, chatId, filters, progressMsg.message_id);

      // 3. Limpiar el estado de Redis (ya no se necesita)
      await redisBatchStateService.deleteBatchData(userId, reportId);

      logger.info('Reporte grande iniciado exitosamente', { reportId, userId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      logger.error({ error }, 'Error procesando confirmación de reporte');
      await ctx.reply(
        '❌ **Error Inesperado**\n\n' +
          `No se pudo procesar tu solicitud: ${errorMessage}\n\n` +
          '🔄 Intenta generar el reporte nuevamente.',
        { parse_mode: 'Markdown' }
      );
    }
  });

  // ============================================
  // CANCELACIÓN DE REPORTE
  // ============================================

  /**
   * Handler para el botón de cancelar reporte
   */
  bot.action('cancel_report', async (ctx: BotContext) => {
    try {
      await ctx.answerCbQuery('Operación cancelada.');

      // Editar el mensaje para mostrar que fue cancelado
      await ctx.editMessageText('❌ Operación cancelada por el usuario.', {
        parse_mode: 'Markdown',
      });

      logger.info('Reporte cancelado por el usuario', { userId: ctx.from?.id });
    } catch (error) {
      logger.error({ error }, 'Error procesando cancelación de reporte');

      // Fallback: enviar mensaje nuevo si no se puede editar
      try {
        await ctx.reply('❌ Operación cancelada por el usuario.', {
          parse_mode: 'Markdown',
        });
      } catch (fallbackError) {
        logger.error({ error: fallbackError }, 'Error en fallback de cancelación');
      }
    }
  });
}

export default registerReportHandlers;
