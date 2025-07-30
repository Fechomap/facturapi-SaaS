// services/simple-excel.service.js
// Generación de reportes Excel SIMPLE y ASÍNCRONA - Sin jobs, sin colas, solo async/await

import ExcelReportService from './excel-report.service.js';
import logger from '../core/utils/logger.js';
import fs from 'fs/promises';

const simpleLogger = logger.child({ module: 'simple-excel' });

/**
 * Generar reporte Excel asíncrono SIMPLE
 * 1. Mensaje inmediato al usuario
 * 2. Procesar en background
 * 3. Actualizar progreso visualmente
 * 4. Enviar archivo cuando esté listo
 */
export async function generateExcelReportAsync(ctx, filters = {}) {
  const tenantId = ctx.getTenantId();
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  simpleLogger.info('🚀 Iniciando reporte Excel simple asíncrono', {
    tenantId,
    userId,
    filters: Object.keys(filters),
  });

  try {
    // PASO 1: Mensaje inmediato (nunca bloquea)
    const progressMsg = await ctx.reply(
      '📊 **Generando Reporte Excel**\n\n' +
        '🔄 Procesando facturas...\n' +
        '📱 Te mantendré informado del progreso',
      { parse_mode: 'Markdown' }
    );

    // PASO 2: Procesar en background SIN BLOQUEAR
    processInBackground(ctx, tenantId, userId, chatId, filters, progressMsg.message_id);

    return { success: true };
  } catch (error) {
    simpleLogger.error('❌ Error iniciando reporte asíncrono', {
      tenantId,
      userId,
      error: error.message,
    });

    await ctx.reply('❌ **Error**\n\nNo se pudo iniciar el reporte.', { parse_mode: 'Markdown' });
    return { success: false, error: error.message };
  }
}

/**
 * Procesar Excel en background con BARRA DE PROGRESO VISUAL
 */
async function processInBackground(ctx, tenantId, userId, chatId, filters, messageId) {
  try {
    simpleLogger.info('📊 Procesando Excel en background', { tenantId, userId });

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
    const fileSizeMB = (reportData.buffer.length / (1024 * 1024)).toFixed(2);

    // PASO 6: Mensaje de completado
    await ctx.telegram.editMessageText(
      chatId,
      messageId,
      null,
      '✅ **¡Reporte Excel Completado!**\n\n' +
        `📊 **Facturas:** ${reportData.stats.totalInvoices}\n` +
        `📁 **Tamaño:** ${fileSizeMB} MB\n` +
        `⏱️ **Generado:** ${new Date().toLocaleString('es-MX')}\n\n` +
        '📎 **Enviando archivo...**',
      { parse_mode: 'Markdown' }
    );

    // PASO 7: Enviar archivo Excel directamente desde memoria
    const fileName = `reporte_facturas_${new Date().toISOString().split('T')[0]}.xlsx`;

    await ctx.telegram.sendDocument(
      chatId,
      {
        source: reportData.buffer,
        filename: fileName,
      },
      {
        caption: `🎉 **¡Reporte enviado exitosamente!**`,
        parse_mode: 'Markdown',
      }
    );

    // Ya no necesitamos limpiar archivos porque todo está en memoria 🎉

    simpleLogger.info('✅ Reporte Excel enviado exitosamente', {
      tenantId,
      userId,
      filePath: reportData.filePath,
      invoiceCount: reportData.stats.totalInvoices,
      fileSizeMB,
    });
  } catch (error) {
    simpleLogger.error('❌ Error procesando Excel en background', {
      tenantId,
      userId,
      error: error.message,
    });

    // Notificar error al usuario
    try {
      await ctx.telegram.editMessageText(
        chatId,
        messageId,
        null,
        '❌ **Error generando reporte**\n\n' +
          `💬 ${error.message}\n\n` +
          '🔄 Puedes intentar nuevamente.',
        { parse_mode: 'Markdown' }
      );
    } catch (notifyError) {
      // Si no puede editar, enviar mensaje nuevo
      await ctx.telegram.sendMessage(
        chatId,
        '❌ **Error generando reporte**\n\n' +
          `💬 ${error.message}\n\n` +
          '🔄 Puedes intentar nuevamente.',
        { parse_mode: 'Markdown' }
      );
    }
  }
}

/**
 * Actualizar progreso visual del usuario
 */
async function updateProgress(ctx, chatId, messageId, percentage, message) {
  try {
    const progressBar = generateProgressBar(percentage);

    await ctx.telegram.editMessageText(
      chatId,
      messageId,
      null,
      `📊 **Generando Reporte Excel**\n\n` + `${progressBar} ${percentage}%\n\n` + `🔄 ${message}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    simpleLogger.warn('⚠️ Error actualizando progreso', { error: error.message });
  }
}

/**
 * Generar barra de progreso visual
 */
function generateProgressBar(percentage) {
  const totalBars = 10;
  const filledBars = Math.floor((percentage / 100) * totalBars);
  const emptyBars = totalBars - filledBars;

  return '▓'.repeat(filledBars) + '░'.repeat(emptyBars);
}

export default {
  generateExcelReportAsync,
};
