// bot/views/report-menu.view.js
// Vistas para menús de reportes con filtros avanzados

import { Markup } from 'telegraf';

/**
 * Menú principal de opciones de reporte Excel
 */
export function excelReportOptionsMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📅 Filtrar por fecha', 'excel_filter_date')],
    [Markup.button.callback('👥 Seleccionar clientes', 'excel_filter_clients')],
    [Markup.button.callback('📊 Todas las facturas', 'excel_generate_all')],
    [Markup.button.callback('🔙 Volver a Reportes', 'menu_reportes')],
  ]);
}

/**
 * Menú de filtros de fecha
 */
export function dateFilterMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📅 Últimos 7 días', 'excel_date_last7')],
    [Markup.button.callback('📅 Últimos 30 días', 'excel_date_last30')],
    [Markup.button.callback('📅 Mes actual', 'excel_date_current_month')],
    [Markup.button.callback('📅 Mes anterior', 'excel_date_previous_month')],
    [Markup.button.callback('📅 Año actual', 'excel_date_current_year')],
    [Markup.button.callback('📅 Rango personalizado', 'excel_date_custom')],
    [Markup.button.callback('🔙 Volver', 'excel_report_options')],
  ]);
}

/**
 * Menú de selección de clientes
 * @param {Array} clients - Lista de clientes con información
 * @param {Array} selectedIds - IDs de clientes ya seleccionados
 */
export function clientSelectionMenu(clients, selectedIds = []) {
  const buttons = [];

  // Agregar botones de clientes
  clients.forEach((client) => {
    const isSelected = selectedIds.includes(client.id.toString());
    const icon = isSelected ? '☑️' : '☐';
    const invoiceCount = client._count?.invoices || 0;

    buttons.push([
      Markup.button.callback(
        `${icon} ${client.legalName} (${invoiceCount} facturas)`,
        `excel_toggle_client_${client.id}`
      ),
    ]);
  });

  // Botones de control
  if (selectedIds.length > 0) {
    const totalSelected = selectedIds.length;
    buttons.push([
      Markup.button.callback(
        `✅ Generar reporte (${totalSelected} clientes)`,
        'excel_generate_filtered'
      ),
    ]);
  }

  buttons.push([
    Markup.button.callback('🔄 Seleccionar todos', 'excel_select_all_clients'),
    Markup.button.callback('❌ Limpiar selección', 'excel_clear_selection'),
  ]);

  buttons.push([Markup.button.callback('🔙 Volver', 'excel_report_options')]);

  return Markup.inlineKeyboard(buttons);
}

/**
 * Menú de confirmación para rango personalizado
 * @param {string} startDate - Fecha de inicio
 * @param {string} endDate - Fecha de fin
 */
export function customDateConfirmMenu(startDate, endDate) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        `✅ Confirmar: ${startDate} a ${endDate}`,
        'excel_confirm_custom_date'
      ),
    ],
    [Markup.button.callback('📝 Cambiar fechas', 'excel_date_custom')],
    [Markup.button.callback('🔙 Volver', 'excel_filter_date')],
  ]);
}

/**
 * Menú de progreso durante generación
 * @param {Object} progress - Información de progreso
 */
export function generationProgressMenu(progress = {}) {
  const buttons = [];

  // Solo mostrar botón de cancelar si está en progreso
  if (progress.stage && progress.stage !== 'completed') {
    buttons.push([Markup.button.callback('❌ Cancelar generación', 'excel_cancel_generation')]);
  }

  return Markup.inlineKeyboard(buttons);
}

/**
 * Menú de resumen pre-generación
 * @param {Object} summary - Resumen de lo que se va a generar
 */
export function preGenerationSummaryMenu(summary) {
  const buttons = [
    [
      Markup.button.callback(
        `📊 Generar Excel (${summary.invoiceCount} facturas)`,
        'excel_confirm_generation'
      ),
    ],
    [Markup.button.callback('⚙️ Cambiar filtros', 'excel_report_options')],
    [Markup.button.callback('❌ Cancelar', 'menu_reportes')],
  ];

  return Markup.inlineKeyboard(buttons);
}

/**
 * Menú de opciones adicionales post-generación
 * @param {Object} result - Resultado de la generación
 */
export function postGenerationMenu(result) {
  const buttons = [
    [Markup.button.callback('📊 Generar otro reporte', 'excel_report_options')],
    [Markup.button.callback('🔙 Volver a Reportes', 'menu_reportes')],
  ];

  // Si hay errores, agregar opción para ver detalles
  if (result.errors && result.errors.length > 0) {
    buttons.unshift([Markup.button.callback('⚠️ Ver errores', 'excel_view_errors')]);
  }

  return Markup.inlineKeyboard(buttons);
}

/**
 * Menú para filtros combinados (fecha + clientes)
 * @param {Object} filters - Filtros actuales aplicados
 */
export function combinedFiltersMenu(filters = {}) {
  const buttons = [];

  // Mostrar filtros activos
  if (filters.dateRange) {
    buttons.push([
      Markup.button.callback(`📅 Período: ${filters.dateRange.display} ✏️`, 'excel_filter_date'),
    ]);
  }

  if (filters.selectedClients && filters.selectedClients.length > 0) {
    buttons.push([
      Markup.button.callback(
        `👥 Clientes: ${filters.selectedClients.length} seleccionados ✏️`,
        'excel_filter_clients'
      ),
    ]);
  }

  // Botones de acción
  if (filters.dateRange || (filters.selectedClients && filters.selectedClients.length > 0)) {
    buttons.push([Markup.button.callback('📊 Generar con filtros', 'excel_generate_filtered')]);
    buttons.push([Markup.button.callback('🗑️ Limpiar filtros', 'excel_clear_all_filters')]);
  }

  buttons.push([Markup.button.callback('📅 Filtrar por fecha', 'excel_filter_date')]);

  buttons.push([Markup.button.callback('👥 Seleccionar clientes', 'excel_filter_clients')]);

  buttons.push([Markup.button.callback('🔙 Volver a Reportes', 'menu_reportes')]);

  return Markup.inlineKeyboard(buttons);
}

/**
 * Menú de estadísticas rápidas
 * @param {Object} stats - Estadísticas del tenant
 */
export function quickStatsMenu(stats) {
  const buttons = [
    [
      Markup.button.callback(
        `📊 Este mes: ${stats.currentMonth || 0} facturas`,
        'excel_date_current_month'
      ),
    ],
    [
      Markup.button.callback(
        `📊 Mes anterior: ${stats.previousMonth || 0} facturas`,
        'excel_date_previous_month'
      ),
    ],
    [
      Markup.button.callback(
        `📊 Últimos 30 días: ${stats.last30Days || 0} facturas`,
        'excel_date_last30'
      ),
    ],
    [Markup.button.callback('⚙️ Más opciones', 'excel_report_options')],
    [Markup.button.callback('🔙 Volver', 'menu_reportes')],
  ];

  return Markup.inlineKeyboard(buttons);
}

/**
 * Generar texto de resumen de filtros
 * @param {Object} filters - Filtros aplicados
 */
export function generateFilterSummaryText(filters) {
  let summary = '🔍 **Filtros aplicados:**\n\n';

  if (filters.dateRange) {
    summary += `📅 **Período:** ${filters.dateRange.display}\n`;
    if (filters.dateRange.start && filters.dateRange.end) {
      summary += `   Del ${filters.dateRange.start} al ${filters.dateRange.end}\n`;
    }
  }

  if (filters.selectedClients && filters.selectedClients.length > 0) {
    summary += `👥 **Clientes:** ${filters.selectedClients.length} seleccionados\n`;
    if (filters.selectedClients.length <= 3) {
      // Mostrar nombres si son pocos
      filters.selectedClients.forEach((client) => {
        summary += `   • ${client.name}\n`;
      });
    }
  }

  if (filters.estimatedInvoices) {
    summary += `\n📊 **Facturas estimadas:** ${filters.estimatedInvoices}\n`;
  }

  if (filters.estimatedGenerationTime) {
    summary += `⏱️ **Tiempo estimado:** ${filters.estimatedGenerationTime} segundos\n`;
  }

  return summary;
}
