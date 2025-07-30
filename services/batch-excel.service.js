// services/batch-excel.service.js
// Generación de reportes Excel con procesamiento por LOTES y progreso visual real

import ExcelReportService from './excel-report.service.js';
import logger from '../core/utils/logger.js';

const batchLogger = logger.child({ module: 'batch-excel' });

/**
 * Configuración de lotes para procesamiento eficiente
 */
const BATCH_CONFIG = {
  BATCH_SIZE: 50, // 50 facturas por lote (óptimo API + UX)
  MIN_FOR_BATCHING: 100, // Usar lotes solo si > 100 facturas
  PROGRESS_STEPS: {
    FETCHING_DB: { start: 5, end: 15 }, // 5-15%: Consulta BD
    PROCESSING: { start: 15, end: 85 }, // 15-85%: Procesamiento por lotes
    GENERATING_EXCEL: { start: 85, end: 95 }, // 85-95%: Generación Excel
    FINALIZING: { start: 95, end: 100 }, // 95-100%: Finalización
  },
};

/**
 * Generar reporte Excel con procesamiento por lotes y progreso real
 */
export async function generateExcelReportBatched(ctx, filters = {}) {
  const tenantId = ctx.getTenantId();
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  batchLogger.info('🚀 Iniciando reporte Excel con procesamiento por lotes', {
    tenantId,
    userId,
    filters: Object.keys(filters),
  });

  try {
    // PASO 1: Mensaje inicial
    const progressMsg = await ctx.reply(
      '📊 **Generando Reporte Excel**\n\n' +
        '🔄 Iniciando procesamiento inteligente...\n' +
        '📱 Te mantendré informado del progreso real',
      { parse_mode: 'Markdown' }
    );

    // PASO 2: Procesar en background con lotes
    processBatchedInBackground(ctx, tenantId, userId, chatId, filters, progressMsg.message_id);

    return { success: true };
  } catch (error) {
    batchLogger.error('❌ Error iniciando reporte por lotes', {
      tenantId,
      userId,
      error: error.message,
    });

    await ctx.reply('❌ **Error**\n\nNo se pudo iniciar el reporte.', { parse_mode: 'Markdown' });
    return { success: false, error: error.message };
  }
}

/**
 * Procesamiento en background con lotes y progreso real
 */
async function processBatchedInBackground(ctx, tenantId, userId, chatId, filters, messageId) {
  try {
    const startTime = Date.now();

    // PASO 1: Obtener facturas de BD (5-15%)
    await updateBatchProgress(
      ctx,
      chatId,
      messageId,
      5,
      'Consultando facturas en base de datos...'
    );

    const reportConfig = {
      limit: 5000,
      dateRange: filters.dateRange || null,
      clientIds: filters.selectedClientIds || null,
    };

    const invoicesFromDB = await ExcelReportService.getInvoicesFromDatabase(tenantId, reportConfig);

    if (invoicesFromDB.length === 0) {
      throw new Error('No se encontraron facturas para generar el reporte');
    }

    await updateBatchProgress(
      ctx,
      chatId,
      messageId,
      15,
      `Encontradas ${invoicesFromDB.length} facturas. Iniciando procesamiento...`
    );

    // PASO 2: Decidir si usar lotes o procesamiento simple
    let enrichedInvoices;

    if (invoicesFromDB.length >= BATCH_CONFIG.MIN_FOR_BATCHING) {
      // PROCESAMIENTO POR LOTES (reportes grandes)
      batchLogger.info(`📦 Usando procesamiento por lotes: ${invoicesFromDB.length} facturas`);
      enrichedInvoices = await processInvoicesBatched(
        ctx,
        chatId,
        messageId,
        tenantId,
        invoicesFromDB
      );
    } else {
      // PROCESAMIENTO SIMPLE (reportes pequeños)
      batchLogger.info(`🚀 Usando procesamiento simple: ${invoicesFromDB.length} facturas`);
      await updateBatchProgress(ctx, chatId, messageId, 50, 'Obteniendo datos de FacturAPI...');
      enrichedInvoices = await ExcelReportService.enrichWithFacturapiData(
        tenantId,
        invoicesFromDB,
        reportConfig
      );
    }

    // PASO 3: Generar Excel (85-95%)
    await updateBatchProgress(ctx, chatId, messageId, 85, 'Generando archivo Excel...');

    const buffer = await ExcelReportService.generateExcelBuffer(
      tenantId,
      enrichedInvoices,
      reportConfig
    );

    // PASO 4: Finalización (95-100%)
    await updateBatchProgress(ctx, chatId, messageId, 95, 'Preparando descarga...');

    const fileSizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
    const duration = Date.now() - startTime;

    // PASO 5: Mensaje final y envío
    await ctx.telegram.editMessageText(
      chatId,
      messageId,
      null,
      '✅ **¡Reporte Excel Completado!**\n\n' +
        `📊 **Facturas:** ${enrichedInvoices.length}\n` +
        `📁 **Tamaño:** ${fileSizeMB} MB\n` +
        `⏱️ **Tiempo:** ${(duration / 1000).toFixed(1)}s\n` +
        `🔄 **Lotes procesados:** ${Math.ceil(enrichedInvoices.length / BATCH_CONFIG.BATCH_SIZE)}\n\n` +
        '📎 **Enviando archivo...**',
      { parse_mode: 'Markdown' }
    );

    // PASO 6: Enviar archivo
    const fileName = `reporte_facturas_${new Date().toISOString().split('T')[0]}.xlsx`;

    await ctx.telegram.sendDocument(
      chatId,
      {
        source: buffer,
        filename: fileName,
      },
      {
        caption: `🎉 **¡Reporte enviado exitosamente!**\n📈 Procesamiento optimizado por lotes`,
        parse_mode: 'Markdown',
      }
    );

    batchLogger.info('✅ Reporte Excel por lotes completado', {
      tenantId,
      userId,
      invoiceCount: enrichedInvoices.length,
      fileSizeMB,
      duration,
      batchesProcessed: Math.ceil(enrichedInvoices.length / BATCH_CONFIG.BATCH_SIZE),
    });
  } catch (error) {
    batchLogger.error('❌ Error en procesamiento por lotes', {
      tenantId,
      userId,
      error: error.message,
    });

    // Notificar error
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
 * Procesar facturas en lotes con progreso visual real
 */
async function processInvoicesBatched(ctx, chatId, messageId, tenantId, invoices) {
  const totalInvoices = invoices.length;
  const totalBatches = Math.ceil(totalInvoices / BATCH_CONFIG.BATCH_SIZE);
  const enrichedInvoices = [];

  batchLogger.info(
    `📦 Iniciando procesamiento: ${totalBatches} lotes de ${BATCH_CONFIG.BATCH_SIZE} facturas`
  );

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIndex = batchIndex * BATCH_CONFIG.BATCH_SIZE;
    const endIndex = Math.min(startIndex + BATCH_CONFIG.BATCH_SIZE, totalInvoices);
    const currentBatch = invoices.slice(startIndex, endIndex);

    // Calcular progreso real basado en lotes completados
    const progressPercent =
      BATCH_CONFIG.PROGRESS_STEPS.PROCESSING.start +
      (batchIndex / totalBatches) *
        (BATCH_CONFIG.PROGRESS_STEPS.PROCESSING.end - BATCH_CONFIG.PROGRESS_STEPS.PROCESSING.start);

    const roundedProgress = Math.round(progressPercent);

    await updateBatchProgress(
      ctx,
      chatId,
      messageId,
      roundedProgress,
      `Procesando lote ${batchIndex + 1}/${totalBatches} (${currentBatch.length} facturas)...`
    );

    try {
      // Procesar lote actual
      const batchEnriched = await ExcelReportService.enrichWithFacturapiData(
        tenantId,
        currentBatch,
        { includeDetails: true }
      );

      // Acumular resultados
      enrichedInvoices.push(...batchEnriched);

      batchLogger.info(
        `✅ Lote ${batchIndex + 1}/${totalBatches} completado: ${batchEnriched.length} facturas`
      );

      // Pequeña pausa para permitir otras operaciones
      if (batchIndex < totalBatches - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (batchError) {
      batchLogger.error(`❌ Error en lote ${batchIndex + 1}:`, batchError.message);

      // Continuar con el siguiente lote, pero registrar facturas fallidas
      const failedInvoices = currentBatch.map((invoice) => ({
        ...invoice,
        error: `Error en lote ${batchIndex + 1}: ${batchError.message}`,
        folio: `${invoice.series}${invoice.folioNumber}`,
        uuid: 'Error al obtener',
        subtotal: 0,
        ivaAmount: 0,
        retencionAmount: 0,
        verificationUrl: '',
      }));

      enrichedInvoices.push(...failedInvoices);
    }
  }

  batchLogger.info(
    `✅ Procesamiento por lotes completado: ${enrichedInvoices.length}/${totalInvoices} facturas`
  );
  return enrichedInvoices;
}

/**
 * Actualizar barra de progreso con información de lotes
 */
async function updateBatchProgress(ctx, chatId, messageId, percentage, message) {
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
    batchLogger.warn('⚠️ Error actualizando progreso por lotes', { error: error.message });
  }
}

/**
 * Generar barra de progreso visual mejorada
 */
function generateProgressBar(percentage) {
  const totalBars = 20; // Barra más larga para mejor precisión visual
  const filledBars = Math.floor((percentage / 100) * totalBars);
  const emptyBars = totalBars - filledBars;

  return '▓'.repeat(filledBars) + '░'.repeat(emptyBars);
}

export default {
  generateExcelReportBatched,
  BATCH_CONFIG,
};
