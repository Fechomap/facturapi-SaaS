/**
 * Simple Excel Service
 * Generación de reportes Excel SIMPLE y ASÍNCRONA - Sin jobs, sin colas, solo async/await
 */

import ExcelReportService from './excel-report.service.js';
import { createModuleLogger } from '@core/utils/logger.js';
import redisBatchStateService from './redis-batch-state.service.js';
import { Markup } from 'telegraf';
import type { BotContext } from '../types/bot.types.js';

const logger = createModuleLogger('simple-excel');

interface DateRange {
  start: Date;
  end: Date;
  display?: string;
}

interface Filters {
  dateRange?: DateRange | null;
  selectedClientIds?: string[] | null;
}

/**
 * Generar reporte Excel asíncrono SIMPLE
 * 1. Mensaje inmediato al usuario
 * 2. Procesar en background
 * 3. Actualizar progreso visualmente
 * 4. Enviar archivo cuando esté listo
 */
export async function generateExcelReportAsync(
  ctx: BotContext,
  filters: Filters = {}
): Promise<{ success: boolean; error?: string }> {
  const tenantId = ctx.getTenantId();
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!tenantId || !userId || !chatId) {
    return { success: false, error: 'Información de contexto incompleta' };
  }

  logger.info('Iniciando reporte Excel simple asíncrono', {
    tenantId,
    userId,
    filters: Object.keys(filters),
  });

  try {
    // PASO 1: ESTIMAR el trabajo ANTES de empezar
    logger.info('Estimando tamaño del reporte antes de procesar', { tenantId, userId, filters });
    const estimation = await ExcelReportService.estimateReportGeneration(tenantId, filters);

    // PASO 2: Decidir el flujo basado en la estimación
    const INVOICE_THRESHOLD = 500; // Umbral configurable

    if (estimation.willGenerate > INVOICE_THRESHOLD) {
      // REPORTE GRANDE: Guardar filtros en Redis y pedir confirmación
      logger.info('Reporte grande detectado, solicitando confirmación', {
        tenantId,
        userId,
        willGenerate: estimation.willGenerate,
      });

      // 1. Generar un ID único para esta solicitud de reporte
      const reportId = redisBatchStateService.generateBatchId();

      // 2. Guardar los filtros en Redis (TTL de 15 minutos por defecto)
      await redisBatchStateService.saveBatchData(userId, reportId, {
        batchId: reportId,
        userId,
        timestamp: Date.now(),
        filters,
      });

      // 3. Mostrar advertencia y botón de confirmación con el reportId
      await ctx.reply(
        `⚠️ **Reporte Grande Detectado**\n\n` +
          `El reporte que solicitaste contiene **${estimation.willGenerate} facturas** y podría tardar un poco en generarse.\n\n` +
          `⏱️ **Tiempo estimado:** ~${estimation.estimatedTimeSeconds} segundos\n\n` +
          `¿Deseas continuar?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            // El botón ahora solo lleva el ID, es seguro y corto
            [
              Markup.button.callback(
                '✅ Sí, generar reporte',
                `confirm_generate_report:${reportId}`
              ),
            ],
            [Markup.button.callback('❌ No, cancelar', 'cancel_report')],
          ]),
        }
      );

      return { success: true };
    } else {
      // REPORTE PEQUEÑO: Proceder directamente como antes
      if (estimation.willGenerate === 0) {
        await ctx.reply('✅ No se encontraron facturas con los filtros seleccionados.');
        return { success: true };
      }

      logger.info('Reporte pequeño, procesando directamente', {
        tenantId,
        userId,
        willGenerate: estimation.willGenerate,
      });

      // PASO 1: Mensaje inmediato (nunca bloquea)
      const progressMsg = await ctx.reply(
        `📊 **Generando Reporte Excel para ${estimation.willGenerate} facturas**\n\n` +
          '🔄 Procesando facturas...\n' +
          '📱 Te mantendré informado del progreso',
        { parse_mode: 'Markdown' }
      );

      // PASO 2: Procesar en background SIN BLOQUEAR
      processInBackground(ctx, tenantId, userId, chatId, filters, progressMsg.message_id);

      return { success: true };
    }
  } catch (error: unknown) {
    logger.error('Error iniciando reporte asíncrono', {
      tenantId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    await ctx.reply('❌ **Error**\n\nNo se pudo iniciar el reporte.', { parse_mode: 'Markdown' });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Procesar Excel en background con BARRA DE PROGRESO VISUAL
 * EXPORTADA para ser usada por reports.handler.ts
 */
export async function processInBackground(
  ctx: BotContext,
  tenantId: string,
  userId: number,
  chatId: number,
  filters: Filters,
  messageId: number
): Promise<void> {
  try {
    logger.info('Procesando Excel en background', { tenantId, userId });

    // PASO 1: Actualizar progreso - Consultando
    await updateProgress(ctx, chatId, messageId, 10, 'Consultando facturas en base de datos...');

    const reportConfig = {
      limit: 5000,
      includeDetails: true,
      format: 'xlsx',
      dateRange: filters.dateRange || null,
      clientIds: filters.selectedClientIds || null,
    };

    // PASO 2: Actualizar progreso - Obteniendo datos
    await updateProgress(ctx, chatId, messageId, 30, 'Obteniendo datos de FacturAPI...');

    // PASO 3: Generar reporte (la parte pesada)
    const reportData = await ExcelReportService.generateInvoiceReport(tenantId, reportConfig);

    if (!reportData.success) {
      throw new Error(reportData.error || 'Error generando reporte');
    }

    // PASO 4: Actualizar progreso - Finalizando
    await updateProgress(ctx, chatId, messageId, 90, 'Preparando archivo para descarga...');

    // PASO 5: Obtener tamaño del buffer de Excel
    const bufferAsNodeBuffer = reportData.buffer as unknown as Buffer;
    const fileSizeMB = reportData.buffer
      ? (bufferAsNodeBuffer.length / (1024 * 1024)).toFixed(2)
      : '0';

    // PASO 6: Mensaje de completado
    await ctx.telegram.editMessageText(
      chatId,
      messageId,
      undefined,
      '✅ **¡Reporte Excel Completado!**\n\n' +
        `📊 **Facturas:** ${reportData.stats?.totalInvoices || 0}\n` +
        `📁 **Tamaño:** ${fileSizeMB} MB\n` +
        `⏱️ **Generado:** ${new Date().toLocaleString('es-MX')}\n\n` +
        '📎 **Enviando archivo...**',
      { parse_mode: 'Markdown' }
    );

    // PASO 7: Enviar archivo Excel directamente desde memoria
    const fileName = `reporte_facturas_${new Date().toISOString().split('T')[0]}.xlsx`;

    if (reportData.buffer) {
      await ctx.telegram.sendDocument(
        chatId,
        {
          source: reportData.buffer as unknown as Buffer,
          filename: fileName,
        },
        {
          caption: `🎉 **¡Reporte enviado exitosamente!**`,
          parse_mode: 'Markdown',
        }
      );
    }

    logger.info('Reporte Excel enviado exitosamente', {
      tenantId,
      userId,
      invoiceCount: reportData.stats?.totalInvoices || 0,
      fileSizeMB,
    });
  } catch (error: unknown) {
    logger.error('Error procesando Excel en background', {
      tenantId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Notificar error al usuario
    try {
      await ctx.telegram.editMessageText(
        chatId,
        messageId,
        undefined,
        '❌ **Error generando reporte**\n\n' +
          `💬 ${error instanceof Error ? error.message : 'Error desconocido'}\n\n` +
          '🔄 Puedes intentar nuevamente.',
        { parse_mode: 'Markdown' }
      );
    } catch (notifyError) {
      // Si no puede editar, enviar mensaje nuevo
      await ctx.telegram.sendMessage(
        chatId,
        '❌ **Error generando reporte**\n\n' +
          `💬 ${error instanceof Error ? error.message : 'Error desconocido'}\n\n` +
          '🔄 Puedes intentar nuevamente.',
        { parse_mode: 'Markdown' }
      );
    }
  }
}

/**
 * Actualizar progreso visual del usuario
 */
async function updateProgress(
  ctx: BotContext,
  chatId: number,
  messageId: number,
  percentage: number,
  message: string
): Promise<void> {
  try {
    const progressBar = generateProgressBar(percentage);

    await ctx.telegram.editMessageText(
      chatId,
      messageId,
      undefined,
      `📊 **Generando Reporte Excel**\n\n` + `${progressBar} ${percentage}%\n\n` + `🔄 ${message}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error: unknown) {
    logger.warn('Error actualizando progreso', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Generar barra de progreso visual
 */
function generateProgressBar(percentage: number): string {
  const totalBars = 10;
  const filledBars = Math.floor((percentage / 100) * totalBars);
  const emptyBars = totalBars - filledBars;

  return '▓'.repeat(filledBars) + '░'.repeat(emptyBars);
}

export default {
  generateExcelReportAsync,
};
