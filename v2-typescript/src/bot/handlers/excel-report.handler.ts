// bot/handlers/excel-report.handler.ts
// Handler conversacional para reportes Excel con filtros avanzados

import { Markup } from 'telegraf';
import type { BotContext } from '../../types/bot.types.js';
import type { Bot } from '../../types/bot.types.js';
import { createModuleLogger } from '../../core/utils/logger.js';
import ExcelReportService from '../../services/excel-report.service.js';
import DateFilterUtils, { type DateRange } from '../utils/date-filter.utils.js';
import {
  excelReportOptionsMenu,
  dateFilterMenu,
  clientSelectionMenu,
  combinedFiltersMenu,
  generateFilterSummaryText,
  loadingMenus,
} from '../views/report-menu.view.js';
import {
  MenuStateManager,
  MenuTransitionUtils,
  LoadingStates,
  ActionFeedback,
} from '../utils/menu-transition.utils.js';

const logger = createModuleLogger('excel-report-handler');

/**
 * Interfaz para filtros de Excel
 */
interface ExcelFilters {
  dateRange?: DateRange;
  selectedClientIds?: string[];
}

/**
 * Registrar todos los handlers para reportes Excel con filtros
 */
export function registerExcelReportHandlers(bot: Bot): void {
  // ============================================
  // MENÚ PRINCIPAL DE OPCIONES
  // ============================================

  bot.action('reporte_excel_action', async (ctx) => {
    await ctx.answerCbQuery();

    if (!ctx.hasTenant()) {
      await ctx.reply(
        'Para generar reportes Excel, primero debes registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrar empresa', 'start_registration')],
        ])
      );
      return;
    }

    // Inicializar gestor de estado de menús
    const menuManager = new MenuStateManager(ctx);
    menuManager.pushMenu('excel_options', {});

    // Limpiar estado de filtros previos
    if (!ctx.userState) {
      ctx.userState = {};
    }
    if (!ctx.userState.excelFilters) {
      ctx.userState.excelFilters = {};
    }

    // Transición suave al menú principal
    await MenuTransitionUtils.smoothTransition(
      ctx,
      LoadingStates.FILTERS,
      '📊 **Generador de Reportes Excel**\n\n' +
        'Ya puedes generar tu reporte aplicando filtros por días o por clientes.',
      excelReportOptionsMenu(),
      300
    );
  });

  // Volver al menú de opciones
  bot.action('excel_report_options', async (ctx) => {
    await ctx.answerCbQuery(ActionFeedback.UPDATED);

    const filters = (ctx.userState?.excelFilters || {}) as ExcelFilters;

    if (Object.keys(filters).length > 0) {
      // Transición suave al menú con filtros
      let message = '📊 **Generador de Reportes Excel**\n\n';
      message += generateFilterSummaryText(filters);
      message += '\n¿Qué quieres hacer?';

      await MenuTransitionUtils.smoothTransition(
        ctx,
        LoadingStates.UPDATING,
        message,
        combinedFiltersMenu(filters),
        200
      );
    } else {
      // Transición suave al menú básico
      await MenuTransitionUtils.smoothTransition(
        ctx,
        LoadingStates.FILTERS,
        '📊 **Generador de Reportes Excel**\n\n' +
          'Ya puedes generar tu reporte aplicando filtros por días o por clientes.',
        excelReportOptionsMenu(),
        200
      );
    }
  });

  // ============================================
  // FILTROS DE FECHA
  // ============================================

  bot.action('excel_filter_date', async (ctx) => {
    await ctx.answerCbQuery(ActionFeedback.SELECTED);

    const menuManager = new MenuStateManager(ctx);
    menuManager.pushMenu('excel_dates', {});

    // Transición suave al menú de fechas
    await MenuTransitionUtils.smoothTransition(
      ctx,
      LoadingStates.DATES,
      '📅 **Filtrar por Fecha**\n\n' + 'Selecciona el período que quieres incluir en tu reporte:',
      dateFilterMenu(),
      300
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

    if (!ctx.userState) {
      ctx.userState = {};
    }
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
    await ctx.answerCbQuery(ActionFeedback.SELECTED);

    const menuManager = new MenuStateManager(ctx);
    menuManager.pushMenu('excel_clients', {});

    try {
      // Mostrar estado de carga mientras se obtienen los clientes
      const loadingMenu = loadingMenus().clients();
      await ctx.editMessageText(loadingMenu.text, {
        parse_mode: 'Markdown',
        ...loadingMenu.markup,
      });

      const tenantId = ctx.getTenantId();
      const customers = await ExcelReportService.getTenantCustomers(tenantId);

      if (customers.length === 0) {
        await MenuTransitionUtils.smoothTransition(
          ctx,
          LoadingStates.CLIENTS,
          '👥 **Sin Clientes**\n\n' +
            'No tienes clientes registrados para filtrar.\n' +
            'Primero debes configurar clientes en tu sistema.',
          Markup.inlineKeyboard([
            [Markup.button.callback('⚙️ Configurar Clientes', 'configure_clients')],
            [Markup.button.callback('🔙 Volver', 'excel_report_options')],
          ]),
          200
        );
        return;
      }

      const filters = (ctx.userState?.excelFilters || {}) as ExcelFilters;
      const selectedIds = filters.selectedClientIds || [];

      // Transición suave al menú de clientes
      await MenuTransitionUtils.smoothTransition(
        ctx,
        loadingMenu.text,
        '👥 **Seleccionar Clientes**\n\n' +
          'Marca los clientes que quieres incluir en el reporte:\n' +
          '☑️ = Incluido | ☐ = No incluido',
        clientSelectionMenu(customers, selectedIds),
        300
      );
    } catch (error) {
      logger.error({ error }, 'Error cargando clientes');
      await MenuTransitionUtils.smoothTransition(
        ctx,
        LoadingStates.CLIENTS,
        '❌ **Error**\n\n' + 'No se pudieron cargar los clientes. Intenta nuevamente.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Reintentar', 'excel_filter_clients')],
          [Markup.button.callback('🔙 Volver', 'excel_report_options')],
        ]),
        200
      );
    }
  });

  // Toggle selección de cliente específico
  bot.action(/excel_toggle_client_(\d+)/, async (ctx) => {
    const clientId = ctx.match?.[1];
    if (!clientId) return;

    if (!ctx.userState) {
      ctx.userState = {};
    }
    const filters = (ctx.userState.excelFilters || {}) as ExcelFilters;
    const selectedIds = filters.selectedClientIds || [];

    const isRemoving = selectedIds.includes(clientId);
    const feedbackText = isRemoving ? ActionFeedback.DESELECTED : ActionFeedback.SELECTED;

    // Actualización optimista del estado
    if (isRemoving) {
      filters.selectedClientIds = selectedIds.filter((id) => id !== clientId);
    } else {
      filters.selectedClientIds = [...selectedIds, clientId];
    }

    ctx.userState.excelFilters = filters;

    // Usar actualización optimista con feedback inmediato
    await MenuTransitionUtils.optimisticUpdate(
      ctx,
      async () => {
        // Actualizar UI inmediatamente
        await ctx.answerCbQuery(feedbackText);

        const tenantId = ctx.getTenantId();
        const customers = await ExcelReportService.getTenantCustomers(tenantId);

        await ctx.editMessageReplyMarkup({
          inline_keyboard: clientSelectionMenu(customers, filters.selectedClientIds || [])
            .reply_markup.inline_keyboard as unknown as never,
        });
      },
      async () => {
        // Validación en background (opcional)
        logger.debug(`Cliente ${clientId} ${isRemoving ? 'removido' : 'agregado'} exitosamente`);
      }
    );
  });

  // Seleccionar todos los clientes
  bot.action('excel_select_all_clients', async (ctx) => {
    await MenuTransitionUtils.optimisticUpdate(
      ctx,
      async () => {
        await ctx.answerCbQuery(ActionFeedback.SELECTED);

        const tenantId = ctx.getTenantId();
        const customers = await ExcelReportService.getTenantCustomers(tenantId);

        if (!ctx.userState) {
          ctx.userState = {};
        }
        const filters = (ctx.userState.excelFilters || {}) as ExcelFilters;
        filters.selectedClientIds = customers.map((c) => c.id.toString());
        ctx.userState.excelFilters = filters;

        await MenuTransitionUtils.updateKeyboardWithFeedback(
          ctx,
          {
            inline_keyboard: clientSelectionMenu(customers, filters.selectedClientIds).reply_markup
              .inline_keyboard as ReturnType<typeof Markup.button.callback>[][],
          },
          `✅ ${customers.length} clientes seleccionados`
        );
      },
      async () => {
        logger.debug('Todos los clientes seleccionados exitosamente');
      }
    );
  });

  // Limpiar selección de clientes
  bot.action('excel_clear_selection', async (ctx) => {
    await MenuTransitionUtils.optimisticUpdate(
      ctx,
      async () => {
        await ctx.answerCbQuery(ActionFeedback.CLEARED);

        const tenantId = ctx.getTenantId();
        const customers = await ExcelReportService.getTenantCustomers(tenantId);

        if (!ctx.userState) {
          ctx.userState = {};
        }
        const filters = (ctx.userState.excelFilters || {}) as ExcelFilters;
        filters.selectedClientIds = [];
        ctx.userState.excelFilters = filters;

        await MenuTransitionUtils.updateKeyboardWithFeedback(
          ctx,
          {
            inline_keyboard: clientSelectionMenu(customers, []).reply_markup
              .inline_keyboard as ReturnType<typeof Markup.button.callback>[][],
          },
          '🗑️ Selección limpiada'
        );
      },
      async () => {
        logger.debug('Selección de clientes limpiada exitosamente');
      }
    );
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
    if (!ctx.userState) {
      ctx.userState = {};
    }
    ctx.userState.excelFilters = {};

    await generateFilteredReport(ctx);
  });

  // Limpiar todos los filtros
  bot.action('excel_clear_all_filters', async (ctx) => {
    await ctx.answerCbQuery(ActionFeedback.CLEARED);

    if (!ctx.userState) {
      ctx.userState = {};
    }
    ctx.userState.excelFilters = {};

    await MenuTransitionUtils.smoothTransition(
      ctx,
      LoadingStates.UPDATING,
      '🗑️ **Filtros Limpiados**\n\n' +
        'Se han eliminado todos los filtros.\n' +
        'Ya puedes generar tu reporte aplicando filtros por días o por clientes.',
      excelReportOptionsMenu(),
      250
    );
  });

  // ============================================
  // NAVEGACIÓN CON HISTORIAL
  // ============================================

  // Handler para volver al menú anterior
  bot.action('menu_back', async (ctx) => {
    await ctx.answerCbQuery('⬅️ Volviendo...');

    const menuManager = new MenuStateManager(ctx);
    const previousMenu = menuManager.popMenu();

    if (previousMenu) {
      // Volver al menú anterior según el ID
      let targetAction = 'excel_report_options'; // fallback

      switch (previousMenu.id) {
        case 'excel_options':
          targetAction = 'excel_report_options';
          break;
        case 'excel_dates':
          targetAction = 'excel_filter_date';
          break;
        case 'excel_clients':
          targetAction = 'excel_filter_clients';
          break;
        case 'main':
          targetAction = 'menu_principal';
          break;
        default:
          targetAction = 'excel_report_options';
      }

      // Ejecutar la acción correspondiente
      try {
        if (targetAction === 'excel_report_options') {
          // Simular callback query interno
          const handlers = bot.context as unknown as Record<string, unknown>;
          if (handlers) {
            await MenuTransitionUtils.smoothTransition(
              ctx,
              LoadingStates.UPDATING,
              '🔄 **Volviendo al menú anterior...**',
              excelReportOptionsMenu(),
              200
            );
          }
        } else {
          // Para otros casos, redirigir directamente
          await MenuTransitionUtils.smoothTransition(
            ctx,
            LoadingStates.UPDATING,
            '🔄 **Volviendo al menú anterior...**',
            excelReportOptionsMenu(),
            200
          );
        }
      } catch (error) {
        logger.error({ error }, 'Error volviendo al menú anterior');
        // Fallback al menú principal
        await MenuTransitionUtils.smoothTransition(
          ctx,
          LoadingStates.UPDATING,
          '📊 **Generador de Reportes Excel**\n\nYa puedes generar tu reporte aplicando filtros por días o por clientes.',
          excelReportOptionsMenu(),
          200
        );
      }
    } else {
      // No hay historial, ir al menú principal
      await MenuTransitionUtils.smoothTransition(
        ctx,
        LoadingStates.UPDATING,
        '📊 **Generador de Reportes Excel**\n\nYa puedes generar tu reporte aplicando filtros por días o por clientes.',
        excelReportOptionsMenu(),
        200
      );
    }
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

      const startDate = new Date(ctx.userState.customStartDate as Date);

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

        const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
        await ctx.reply(
          '❌ **Error**\n\n' + `No se pudo crear el rango personalizado: ${errorMessage}`,
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
async function applyDateFilter(ctx: BotContext, dateRange: DateRange): Promise<void> {
  try {
    // Guardar filtro en estado
    if (!ctx.userState) {
      ctx.userState = {};
    }
    if (!ctx.userState.excelFilters) {
      ctx.userState.excelFilters = {};
    }

    const filters = ctx.userState.excelFilters as ExcelFilters;
    filters.dateRange = dateRange;

    // Estimar facturas para este rango
    const tenantId = ctx.getTenantId();
    const estimation = await ExcelReportService.estimateReportGeneration(tenantId, {
      dateRange,
      limit: 5000,
    });

    let message = '📅 **Filtro de Fecha Aplicado**\n\n';
    message += `📊 **Período:** ${dateRange.display}\n`;
    message += `📈 **Facturas encontradas:** ${estimation.totalAvailable}\n`;

    if (estimation.hasMoreThanLimit) {
      message += `⚠️ Solo se incluirán las ${estimation.willGenerate} facturas más recientes\n`;
    }

    message += '\n¿Qué quieres hacer ahora?';

    const buttons = [
      [Markup.button.callback('📊 Generar reporte', 'excel_generate_filtered')],
      [Markup.button.callback('👥 Agregar filtro de clientes', 'excel_filter_clients')],
      [Markup.button.callback('📅 Cambiar fecha', 'excel_filter_date')],
      [Markup.button.callback('🔙 Volver', 'excel_report_options')],
    ];

    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (editError) {
      // Si no se puede editar el mensaje, enviar uno nuevo
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    }
  } catch (error) {
    logger.error({ error }, 'Error aplicando filtro de fecha');

    try {
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
    } catch (editError) {
      // Si no se puede editar, enviar mensaje nuevo
      await ctx.reply(
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
}

/**
 * Generar reporte con filtros aplicados - ARQUITECTURA POR LOTES INTELIGENTE
 */
async function generateFilteredReport(ctx: BotContext): Promise<void> {
  try {
    const filters = (ctx.userState?.excelFilters || {}) as ExcelFilters;

    // Primero estimar el tamaño del reporte
    const tenantId = ctx.getTenantId();
    const estimation = await ExcelReportService.estimateReportGeneration(tenantId, filters);

    // Decidir qué servicio usar basado en el tamaño
    if (estimation.willGenerate >= 100) {
      // REPORTES GRANDES: Usar procesamiento por lotes con progreso real
      logger.info(
        { willGenerate: estimation.willGenerate },
        'Reporte grande detectado - usando procesamiento por lotes'
      );
      const { generateExcelReportBatched } = await import('../../services/batch-excel.service.js');
      await generateExcelReportBatched(ctx, filters);
    } else {
      // REPORTES PEQUEÑOS: Usar servicio simple rápido
      logger.info(
        { willGenerate: estimation.willGenerate },
        'Reporte pequeño detectado - usando procesamiento simple'
      );
      const { generateExcelReportAsync } = await import('../../services/simple-excel.service.js');
      await generateExcelReportAsync(ctx, filters);
    }

    // Limpiar filtros para próximo reporte
    if (ctx.userState) {
      ctx.userState.excelFilters = {};
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    logger.error({ error }, 'Error generando reporte');
    await ctx.reply(
      '❌ **Error Inesperado**\n\n' + `Error: ${errorMessage}\n\n` + '🔄 Intenta nuevamente.',
      { parse_mode: 'Markdown' }
    );
  }
}

export default registerExcelReportHandlers;
