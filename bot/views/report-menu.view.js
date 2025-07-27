// bot/views/report-menu.view.js
// Vistas para menús de reportes con filtros avanzados

import { Markup } from 'telegraf';

/**
 * Menú principal de opciones de reporte Excel - MEJORADO UX
 */
export function excelReportOptionsMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📅 Filtrar por Fecha', 'excel_filter_date'),
      Markup.button.callback('👥 Filtrar Clientes', 'excel_filter_clients'),
    ],
    [Markup.button.callback('📊 Todas las Facturas', 'excel_generate_all')],
    [Markup.button.callback('🔙 Volver a Reportes', 'menu_reportes')],
  ]);
}

/**
 * Menú de filtros de fecha - MEJORADO UX
 */
export function dateFilterMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Últimos 7 días', 'excel_date_last7'),
      Markup.button.callback('📊 Últimos 30 días', 'excel_date_last30'),
    ],
    [
      Markup.button.callback('📅 Mes actual', 'excel_date_current_month'),
      Markup.button.callback('📅 Mes anterior', 'excel_date_previous_month'),
    ],
    [
      Markup.button.callback('📊 Año actual', 'excel_date_current_year'),
      Markup.button.callback('⚙️ Rango personalizado', 'excel_date_custom'),
    ],
    [Markup.button.callback('🔙 Volver', 'excel_report_options')],
  ]);
}

/**
 * Menú de selección de clientes - MEJORADO UX
 * @param {Array} clients - Lista de clientes con información
 * @param {Array} selectedIds - IDs de clientes ya seleccionados
 */
export function clientSelectionMenu(clients, selectedIds = []) {
  const buttons = [];

  // Función para simplificar nombres de clientes - CORREGIDO
  const simplifyClientName = (fullName) => {
    const nameMap = {
      'INFOASIST INFORMACION Y ASISTENCIA': 'INFOASIST',
      'AXA ASSISTANCE MEXICO': 'AXA',
      'CHUBB DIGITAL SERVICES': 'CHUBB',
      'PROTECCION S.O.S. JURIDICO': 'SOS',
      'ARSA ASESORIA INTEGRAL': 'ARSA',
      'ASESORIA INTEGRAL Y PROFESIONAL': 'ARSA',
      'FACTURAPI SA DE CV': 'FACTURAPI',
    };

    // Si no está en el mapeo, usar las primeras letras significativas
    if (nameMap[fullName]) {
      return nameMap[fullName];
    }

    // Extraer las siglas o nombre corto
    const words = fullName.split(' ');
    if (words.length >= 2) {
      // Tomar las primeras letras de cada palabra significativa
      const siglas = words
        .filter((word) => word.length > 2 && !['DE', 'LA', 'EL', 'Y', 'SA', 'CV'].includes(word))
        .map((word) => word.substring(0, 1))
        .join('');
      return siglas || words[0];
    }

    return words[0] || fullName;
  };

  // Agregar botones de clientes con checkmarks alineados a la izquierda
  clients.forEach((client) => {
    const isSelected = selectedIds.includes(client.id.toString());
    const icon = isSelected ? '✅' : '⬜'; // Iconos más visuales
    const simplifiedName = simplifyClientName(client.legalName);
    const invoiceCount = client._count?.invoices || 0;

    buttons.push([
      Markup.button.callback(
        `${icon} ${simplifiedName} (${invoiceCount})`,
        `excel_toggle_client_${client.id}`
      ),
    ]);
  });

  // Botones de control con mejor diseño visual
  if (selectedIds.length > 0) {
    const totalSelected = selectedIds.length;
    buttons.push([
      Markup.button.callback(
        `📊 Generar reporte (${totalSelected} cliente${totalSelected > 1 ? 's' : ''})`,
        'excel_generate_filtered'
      ),
    ]);
  }

  buttons.push([
    Markup.button.callback('✅ Todos', 'excel_select_all_clients'),
    Markup.button.callback('❌ Ninguno', 'excel_clear_selection'),
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
 * Menú para filtros combinados - MEJORADO UX
 * @param {Object} filters - Filtros actuales aplicados
 */
export function combinedFiltersMenu(filters = {}) {
  const buttons = [];

  // Estado visual de filtros activos
  const hasDateFilter = filters.dateRange;
  const hasClientFilter = filters.selectedClientIds && filters.selectedClientIds.length > 0;

  // Botones para modificar filtros con indicadores visuales
  const dateButton = hasDateFilter
    ? Markup.button.callback(`✅ ${filters.dateRange.display}`, 'excel_filter_date')
    : Markup.button.callback('📅 Filtrar por fecha', 'excel_filter_date');

  const clientButton = hasClientFilter
    ? Markup.button.callback(
        `✅ ${filters.selectedClientIds.length} cliente${filters.selectedClientIds.length > 1 ? 's' : ''}`,
        'excel_filter_clients'
      )
    : Markup.button.callback('👥 Filtrar clientes', 'excel_filter_clients');

  buttons.push([dateButton, clientButton]);

  // Botón principal de generación
  if (filters.estimatedInvoices && filters.estimatedInvoices > 0) {
    const timeEmoji =
      filters.estimatedTimeSeconds < 10 ? '⚡' : filters.estimatedTimeSeconds < 30 ? '⏱️' : '🕐';
    buttons.push([
      Markup.button.callback(
        `${timeEmoji} Generar ${filters.estimatedInvoices} facturas`,
        'excel_confirm_generation'
      ),
    ]);
  } else {
    buttons.push([Markup.button.callback('📊 Generar reporte', 'excel_confirm_generation')]);
  }

  // Botones de control
  buttons.push([
    Markup.button.callback('🔄 Limpiar todo', 'excel_clear_all_filters'),
    Markup.button.callback('🔙 Volver', 'menu_reportes'),
  ]);

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
 * Generar texto de resumen de filtros - MEJORADO UX
 * @param {Object} filters - Filtros aplicados
 */
export function generateFilterSummaryText(filters) {
  let summary = '';

  if (filters.dateRange) {
    summary += `📅 **Fecha seleccionada:** ${filters.dateRange.display}\n`;
  }

  if (filters.selectedClientIds && filters.selectedClientIds.length > 0) {
    const clientCount = filters.selectedClientIds.length;
    summary += `👥 **Clientes:** ${clientCount} cliente${clientCount > 1 ? 's' : ''}\n`;
  }

  if (filters.estimatedInvoices) {
    summary += `\n📊 **Facturas estimadas:** ${filters.estimatedInvoices}\n`;
  }

  if (filters.estimatedGenerationTime) {
    summary += `⏱️ **Tiempo estimado:** ${filters.estimatedGenerationTime} segundos\n`;
  }

  return summary;
}