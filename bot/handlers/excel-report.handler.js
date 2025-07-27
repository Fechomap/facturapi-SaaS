// bot/handlers/excel-report.handler.js
// Handler conversacional para reportes Excel con filtros avanzados

import { Markup } from 'telegraf';
import ExcelReportService from '../../services/excel-report.service.js';
import DateFilterUtils from '../../utils/date-filter.utils.js';
import {
  excelReportOptionsMenu,
  dateFilterMenu,
  clientSelectionMenu,
  preGenerationSummaryMenu,
  postGenerationMenu,
  combinedFiltersMenu,
  generateFilterSummaryText,
} from '../views/report-menu.view.js';

/**
 * Registrar todos los handlers para reportes Excel con filtros
 */
export function registerExcelReportHandlers(bot) {
  // ============================================
  // MENÚ PRINCIPAL DE OPCIONES
  // ============================================

  bot.action('reporte_excel_action', async (ctx) => {
    await ctx.answerCbQuery();

    if (!ctx.hasTenant()) {
      return ctx.reply(
        'Para generar reportes Excel, primero debes registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrar empresa', 'start_registration')],
        ])
      );
    }

    // Limpiar estado de filtros previos
    if (!ctx.userState.excelFilters) {
      ctx.userState.excelFilters = {};
    }

    await ctx.reply(
      '📊 **Generador de Reportes Excel**\n\n' +
        '¿Cómo quieres generar tu reporte?\n\n' +
        '📅 **Filtrar por fecha** - Selecciona un período específico\n' +
        '👥 **Seleccionar clientes** - Incluye solo clientes específicos\n' +
        '📊 **Todas las facturas** - Reporte completo (hasta 500 facturas)',
      {
        parse_mode: 'Markdown',
        ...excelReportOptionsMenu(),
      }
    );
  });

  // Volver al menú de opciones
  bot.action('excel_report_options', async (ctx) => {
    await ctx.answerCbQuery();

    const filters = ctx.userState.excelFilters || {};

    if (Object.keys(filters).length > 0) {
      // Mostrar menú con filtros actuales
      let message = '📊 **Generador de Reportes Excel**\n\n';
      message += generateFilterSummaryText(filters);
      message += '\n¿Qué quieres hacer?';

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...combinedFiltersMenu(filters),
      });
    } else {
      // Menú básico sin filtros
      await ctx.editMessageText(
        '📊 **Generador de Reportes Excel**\n\n' +
          '¿Cómo quieres generar tu reporte?\n\n' +
          '📅 **Filtrar por fecha** - Selecciona un período específico\n' +
          '👥 **Seleccionar clientes** - Incluye solo clientes específicos\n' +
          '📊 **Todas las facturas** - Reporte completo (hasta 500 facturas)',
        {
          parse_mode: 'Markdown',
          ...excelReportOptionsMenu(),
        }
      );
    }
  });

  // ============================================
  // FILTROS DE FECHA
  // ============================================

  bot.action('excel_filter_date', async (ctx) => {
    await ctx.answerCbQuery();

    await ctx.editMessageText(
      '📅 **Filtrar por Fecha**\n\n' + 'Selecciona el período que quieres incluir en tu reporte:',
      {
        parse_mode: 'Markdown',
        ...dateFilterMenu(),
      }
    );
  });

  // Handlers para filtros de fecha específicos
  bot.action('excel_date_last7', async (ctx) => {
    await ctx.answerCbQuery();
    const dateRange = DateFilterUtils.getLastDaysRange(7);
    await applyDateFilter(ctx, dateRange);
  });

  bot.action('excel_date_last30', async (ctx) => {
    await ctx.answerCbQuery();
    const dateRange = DateFilterUtils.getLastDaysRange(30);
    await applyDateFilter(ctx, dateRange);
  });

  bot.action('excel_date_current_month', async (ctx) => {
    await ctx.answerCbQuery();
    const dateRange = DateFilterUtils.getCurrentMonthRange();
    await applyDateFilter(ctx, dateRange);
  });

  bot.action('excel_date_previous_month', async (ctx) => {
    await ctx.answerCbQuery();
    const dateRange = DateFilterUtils.getPreviousMonthRange();
    await applyDateFilter(ctx, dateRange);
  });

  bot.action('excel_date_current_year', async (ctx) => {
    await ctx.answerCbQuery();
    const dateRange = DateFilterUtils.getCurrentYearRange();
    await applyDateFilter(ctx, dateRange);
  });

  // Rango personalizado
  bot.action('excel_date_custom', async (ctx) => {
    await ctx.answerCbQuery();

    ctx.userState.esperando = 'excel_custom_start_date';

    await ctx.reply(
      '📅 **Rango Personalizado**\n\n' +
        'Envía la **fecha de inicio** en formato:\n' +
        '• DD/MM/YYYY (ejemplo: 15/01/2025)\n' +
        '• YYYY-MM-DD (ejemplo: 2025-01-15)\n\n' +
        '💡 La fecha debe ser válida y no muy antigua.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'excel_filter_date')]]),
      }
    );
  });

  // ============================================
  // FILTROS DE CLIENTES
  // ============================================

  bot.action('excel_filter_clients', async (ctx) => {
    await ctx.answerCbQuery();

    try {
      const tenantId = ctx.getTenantId();
      const customers = await ExcelReportService.getTenantCustomers(tenantId);

      if (customers.length === 0) {
        return ctx.editMessageText(
          '👥 **Sin Clientes**\n\n' +
            'No tienes clientes registrados para filtrar.\n' +
            'Primero debes configurar clientes en tu sistema.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('⚙️ Configurar Clientes', 'configure_clients')],
              [Markup.button.callback('🔙 Volver', 'excel_report_options')],
            ]),
          }
        );
      }

      const selectedIds = ctx.userState.excelFilters?.selectedClientIds || [];

      await ctx.editMessageText(
        '👥 **Seleccionar Clientes**\n\n' +
          'Marca los clientes que quieres incluir en el reporte:\n' +
          '☑️ = Incluido | ☐ = No incluido',
        {
          parse_mode: 'Markdown',
          ...clientSelectionMenu(customers, selectedIds),
        }
      );
    } catch (error) {
      console.error('Error cargando clientes:', error);
      await ctx.editMessageText(
        '❌ **Error**\n\n' + 'No se pudieron cargar los clientes. Intenta nuevamente.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Reintentar', 'excel_filter_clients')],
            [Markup.button.callback('🔙 Volver', 'excel_report_options')],
          ]),
        }
      );
    }
  });

  // Toggle selección de cliente específico
  bot.action(/excel_toggle_client_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();

    const clientId = ctx.match[1];
    const filters = ctx.userState.excelFilters || {};
    const selectedIds = filters.selectedClientIds || [];

    if (selectedIds.includes(clientId)) {
      // Remover cliente
      filters.selectedClientIds = selectedIds.filter((id) => id !== clientId);
    } else {
      // Agregar cliente
      filters.selectedClientIds = [...selectedIds, clientId];
    }

    ctx.userState.excelFilters = filters;

    // Recargar menú de clientes
    try {
      const tenantId = ctx.getTenantId();
      const customers = await ExcelReportService.getTenantCustomers(tenantId);

      await ctx.editMessageReplyMarkup({
        inline_keyboard: clientSelectionMenu(customers, filters.selectedClientIds).reply_markup
          .inline_keyboard,
      });
    } catch (error) {
      console.error('Error actualizando selección:', error);
    }
  });

  // Seleccionar todos los clientes
  bot.action('excel_select_all_clients', async (ctx) => {
    await ctx.answerCbQuery();

    try {
      const tenantId = ctx.getTenantId();
      const customers = await ExcelReportService.getTenantCustomers(tenantId);

      const filters = ctx.userState.excelFilters || {};
      filters.selectedClientIds = customers.map((c) => c.id.toString());
      ctx.userState.excelFilters = filters;

      await ctx.editMessageReplyMarkup({
        inline_keyboard: clientSelectionMenu(customers, filters.selectedClientIds).reply_markup
          .inline_keyboard,
      });
    } catch (error) {
      console.error('Error seleccionando todos:', error);
    }
  });

  // Limpiar selección de clientes
  bot.action('excel_clear_selection', async (ctx) => {
    await ctx.answerCbQuery();

    try {
      const tenantId = ctx.getTenantId();
      const customers = await ExcelReportService.getTenantCustomers(tenantId);

      const filters = ctx.userState.excelFilters || {};
      filters.selectedClientIds = [];
      ctx.userState.excelFilters = filters;

      await ctx.editMessageReplyMarkup({
        inline_keyboard: clientSelectionMenu(customers, []).reply_markup.inline_keyboard,
      });
    } catch (error) {
      console.error('Error limpiando selección:', error);
    }
  });

  // ============================================
  // GENERACIÓN DE REPORTES
  // ============================================

  // Generar reporte con filtros aplicados
  bot.action('excel_generate_filtered', async (ctx) => {
    await ctx.answerCbQuery();
    await generateFilteredReport(ctx);
  });

  // Generar reporte de todas las facturas
  bot.action('excel_generate_all', async (ctx) => {
    await ctx.answerCbQuery();

    // Limpiar filtros
    ctx.userState.excelFilters = {};

    await generateFilteredReport(ctx);
  });

  // Limpiar todos los filtros
  bot.action('excel_clear_all_filters', async (ctx) => {
    await ctx.answerCbQuery();

    ctx.userState.excelFilters = {};

    await ctx.editMessageText(
      '🗑️ **Filtros Limpiados**\n\n' +
        'Se han eliminado todos los filtros.\n' +
        '¿Cómo quieres generar tu reporte?',
      {
        parse_mode: 'Markdown',
        ...excelReportOptionsMenu(),
      }
    );
  });

  // ============================================
  // MANEJO DE TEXTO PARA FECHAS PERSONALIZADAS
  // ============================================

  bot.on('text', async (ctx, next) => {
    if (ctx.userState?.esperando === 'excel_custom_start_date') {
      const userInput = ctx.message.text.trim();
      const startDate = DateFilterUtils.parseUserDateInput(userInput);

      if (!startDate) {
        return ctx.reply(
          '❌ **Fecha Inválida**\n\n' +
            'La fecha no es válida. Intenta nuevamente con formato:\n' +
            '• DD/MM/YYYY (ejemplo: 15/01/2025)\n' +
            '• YYYY-MM-DD (ejemplo: 2025-01-15)',
          {
            parse_mode: 'Markdown',
          }
        );
      }

      ctx.userState.customStartDate = startDate;
      ctx.userState.esperando = 'excel_custom_end_date';

      await ctx.reply(
        '📅 **Fecha de Inicio Guardada**\n\n' +
          `✅ Inicio: ${DateFilterUtils.formatDateForDisplay(startDate)}\n\n` +
          'Ahora envía la **fecha de fin** en el mismo formato:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'excel_filter_date')]]),
        }
      );

      return;
    }

    if (ctx.userState?.esperando === 'excel_custom_end_date') {
      const userInput = ctx.message.text.trim();
      const endDate = DateFilterUtils.parseUserDateInput(userInput);

      if (!endDate) {
        return ctx.reply(
          '❌ **Fecha Inválida**\n\n' +
            'La fecha no es válida. Intenta nuevamente con formato:\n' +
            '• DD/MM/YYYY (ejemplo: 31/01/2025)\n' +
            '• YYYY-MM-DD (ejemplo: 2025-01-31)',
          {
            parse_mode: 'Markdown',
          }
        );
      }

      const startDate = ctx.userState.customStartDate;

      if (endDate < startDate) {
        return ctx.reply(
          '❌ **Error en Fechas**\n\n' +
            'La fecha de fin debe ser mayor o igual a la fecha de inicio.\n\n' +
            `Inicio: ${DateFilterUtils.formatDateForDisplay(startDate)}\n` +
            `Fin: ${DateFilterUtils.formatDateForDisplay(endDate)}`,
          {
            parse_mode: 'Markdown',
          }
        );
      }

      try {
        const customRange = DateFilterUtils.getCustomRange(
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0]
        );

        ctx.userState.esperando = null;
        delete ctx.userState.customStartDate;

        await applyDateFilter(ctx, customRange);
      } catch (error) {
        ctx.userState.esperando = null;
        delete ctx.userState.customStartDate;

        await ctx.reply(
          '❌ **Error**\n\n' + `No se pudo crear el rango personalizado: ${error.message}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Intentar nuevamente', 'excel_date_custom')],
              [Markup.button.callback('🔙 Volver', 'excel_filter_date')],
            ]),
          }
        );
      }

      return;
    }

    return next();
  });
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================

/**
 * Aplicar filtro de fecha y mostrar resumen
 */
async function applyDateFilter(ctx, dateRange) {
  try {
    // Guardar filtro en estado
    if (!ctx.userState.excelFilters) {
      ctx.userState.excelFilters = {};
    }

    ctx.userState.excelFilters.dateRange = dateRange;

    // Estimar facturas para este rango
    const tenantId = ctx.getTenantId();
    const estimation = await ExcelReportService.estimateReportGeneration(tenantId, {
      dateRange,
      limit: 500,
    });

    let message = '📅 **Filtro de Fecha Aplicado**\n\n';
    message += `📊 **Período:** ${dateRange.display}\n`;
    message += `📈 **Facturas encontradas:** ${estimation.totalAvailable}\n`;
    message += `📋 **Se incluirán:** ${estimation.willGenerate}\n`;

    if (estimation.hasMoreThanLimit) {
      message += `⚠️ Solo se incluirán las ${estimation.willGenerate} facturas más recientes\n`;
    }

    message += `⏱️ **Tiempo estimado:** ${estimation.estimatedTimeSeconds} segundos\n\n`;
    message += '¿Qué quieres hacer ahora?';

    const buttons = [
      [Markup.button.callback('📊 Generar reporte', 'excel_generate_filtered')],
      [Markup.button.callback('👥 Agregar filtro de clientes', 'excel_filter_clients')],
      [Markup.button.callback('📅 Cambiar fecha', 'excel_filter_date')],
      [Markup.button.callback('🔙 Volver', 'excel_report_options')],
    ];

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  } catch (error) {
    console.error('Error aplicando filtro de fecha:', error);

    await ctx.editMessageText(
      '❌ **Error**\n\n' + 'No se pudo aplicar el filtro de fecha. Intenta nuevamente.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Reintentar', 'excel_filter_date')],
          [Markup.button.callback('🔙 Volver', 'excel_report_options')],
        ]),
      }
    );
  }
}

/**
 * Generar reporte con filtros aplicados - FASE 3: Con soporte para jobs asíncronos
 */
async function generateFilteredReport(ctx) {
  try {
    const tenantId = ctx.getTenantId();
    const filters = ctx.userState.excelFilters || {};

    // Preparar configuración del reporte
    const reportConfig = {
      limit: 5000, // FASE 3: límite aumentado para jobs asíncronos
      includeDetails: true,
      format: 'xlsx',
      useCache: true,
      dateRange: filters.dateRange || null,
      clientIds: filters.selectedClientIds || null,
    };

    // Mensaje inicial de progreso
    const progressMsg = await ctx.reply(
      '📊 **Iniciando Reporte Excel**\n\n' +
        '🔄 Estimando tamaño del reporte...\n' +
        '⏱️ Un momento por favor...',
      { parse_mode: 'Markdown' }
    );

    // Estimar cantidad de facturas que coinciden con los filtros
    const estimation = await ExcelReportService.estimateInvoiceCount(tenantId, reportConfig);

    // DECISIÓN: ¿Reporte síncrono o asíncrono?
    if (estimation.count > 500) {
      // ============================================
      // REPORTE ASÍNCRONO (>500 facturas)
      // ============================================

      const { addExcelReportJob, estimateProcessingTime } = await import(
        '../../services/queue.service.js'
      );

      const estimatedTime = estimateProcessingTime(estimation.count);
      const requestId = `RPT-${Date.now()}-${tenantId.slice(-6)}`;

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        null,
        `📊 **Reporte Grande Detectado**\n\n` +
          `📈 **Facturas encontradas:** ${estimation.count.toLocaleString()}\n` +
          `⏱️ **Tiempo estimado:** ${estimatedTime}\n\n` +
          `🔄 **Procesamiento asíncrono iniciado**\n` +
          `Te notificaremos cuando esté listo.\n\n` +
          `📋 **ID de solicitud:** \`${requestId}\`\n\n` +
          `💡 *Puedes cerrar el chat, te avisaremos por aquí cuando termine.*`,
        { parse_mode: 'Markdown' }
      );

      // Crear job asíncrono
      const jobData = {
        tenantId,
        userId: ctx.from.id,
        chatId: ctx.chat.id,
        filters,
        estimatedInvoices: estimation.count,
        requestId,
        timestamp: Date.now(),
      };

      const job = await addExcelReportJob(jobData);

      // Mensaje de confirmación
      await ctx.reply(
        `✅ **Job Asíncrono Creado**\n\n` +
          `🆔 **Job ID:** \`${job.id}\`\n` +
          `📋 **Solicitud:** \`${requestId}\`\n` +
          `⏱️ **Estimado:** ${estimatedTime}\n\n` +
          `🔔 **Te notificaremos automáticamente cuando esté listo**\n\n` +
          `📊 Mientras tanto, puedes seguir usando el bot normalmente.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📊 Otro reporte', 'excel_report_options')],
            [Markup.button.callback('🔙 Menú principal', 'menu_principal')],
          ]),
        }
      );
    } else {
      // ============================================
      // REPORTE SÍNCRONO (≤500 facturas)
      // ============================================

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        null,
        '📊 **Generando Reporte Excel**\n\n' +
          `📈 Facturas encontradas: ${estimation.count}\n` +
          '🔄 Consultando datos con filtros aplicados...\n' +
          '📋 Obteniendo información de FacturAPI...',
        { parse_mode: 'Markdown' }
      );

      // Generar reporte síncrono (como antes)
      const result = await ExcelReportService.generateInvoiceReport(tenantId, reportConfig);

      if (result.success) {
        // Construir mensaje de éxito
        let successMessage = '✅ **Reporte Excel Generado**\n\n';
        successMessage += `📊 Facturas incluidas: ${result.stats.totalInvoices}\n`;
        successMessage += `⏱️ Tiempo de generación: ${Math.round(result.stats.duration / 1000)}s\n`;

        if (result.fromCache) {
          successMessage += `🚀 Obtenido desde cache (súper rápido)\n`;
        }

        successMessage += `📄 Tamaño: ${result.stats.fileSize}\n\n`;

        // Agregar información de filtros aplicados
        if (filters.dateRange) {
          successMessage += `📅 Período: ${filters.dateRange.display}\n`;
        }
        if (filters.selectedClientIds && filters.selectedClientIds.length > 0) {
          successMessage += `👥 Clientes: ${filters.selectedClientIds.length} seleccionados\n`;
        }

        successMessage += '\n📎 Enviando archivo...';

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMsg.message_id,
          null,
          successMessage,
          { parse_mode: 'Markdown' }
        );

        // Enviar archivo Excel
        const filename = generateExcelFileName(filters);
        await ctx.replyWithDocument({
          source: result.filePath,
          filename,
        });

        // Mensaje final con opciones
        await ctx.reply(
          '🎉 **¡Reporte Excel enviado!**\n\n' +
            '📋 El archivo incluye todos los campos fiscales:\n' +
            '• Folio y UUID/Folio Fiscal\n' +
            '• Datos completos del cliente\n' +
            '• Subtotal, IVA, retención y total\n' +
            '• Estado y URL de verificación SAT\n\n' +
            '💡 Compatible con Excel, Google Sheets y LibreOffice.',
          {
            parse_mode: 'Markdown',
            ...postGenerationMenu(result),
          }
        );

        // Limpiar archivo temporal (solo para reportes síncronos)
        setTimeout(
          async () => {
            try {
              const fs = await import('fs');
              fs.unlinkSync(result.filePath);
              console.log(`🗑️ Archivo temporal limpiado: ${result.filePath}`);
            } catch (error) {
              console.log(`ℹ️ No se pudo limpiar archivo temporal: ${error.message}`);
            }
          },
          5 * 60 * 1000
        );
      } else {
        // Error en la generación síncrona
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMsg.message_id,
          null,
          '❌ **Error Generando Reporte**\n\n' +
            `💬 ${result.error}\n\n` +
            '🔄 Puedes intentar nuevamente o cambiar los filtros.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Reintentar', 'excel_generate_filtered')],
              [Markup.button.callback('⚙️ Cambiar filtros', 'excel_report_options')],
              [Markup.button.callback('🔙 Volver a Reportes', 'menu_reportes')],
            ]),
          }
        );
      }
    }
  } catch (error) {
    console.error('❌ Error generando reporte filtrado:', error);

    await ctx.reply(
      '❌ **Error Inesperado**\n\n' +
        'Ocurrió un error al generar el reporte. ' +
        'Por favor, intenta nuevamente.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Reintentar', 'excel_report_options')],
          [Markup.button.callback('🔙 Volver a Reportes', 'menu_reportes')],
        ]),
      }
    );
  }
}

/**
 * Generar nombre de archivo Excel descriptivo
 */
function generateExcelFileName(filters) {
  let filename = 'reporte_facturas';

  if (filters.dateRange) {
    const key = filters.dateRange.key;
    filename += `_${key}`;
  }

  if (filters.selectedClientIds && filters.selectedClientIds.length > 0) {
    filename += `_${filters.selectedClientIds.length}clientes`;
  }

  filename += `_${new Date().toISOString().split('T')[0]}.xlsx`;

  return filename;
}

export default registerExcelReportHandlers;
