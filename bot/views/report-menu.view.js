// bot/views/report-menu.view.js
// Vistas para menús de reportes con filtros avanzados

import { Markup } from 'telegraf';
import { generateBreadcrumb, LoadingStates } from '../utils/menu-transition.utils.js';

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

  // Función para simplificar nombres de clientes - MAPEO COMPLETO
  const simplifyClientName = (fullName) => {
    const nameMap = {
      'INFOASIST INFORMACION Y ASISTENCIA': 'INFOASIST',
      'AXA ASSISTANCE MEXICO': 'AXA',
      'CHUBB DIGITAL SERVICES': 'CHUBB',
      'PROTECCION S.O.S. JURIDICO AUTOMOVILISTICO LAS VEINTICUATRO HORAS DEL DIA': 'SOS',
      'ARSA ASESORIA INTEGRAL PROFESIONAL': 'ARSA',
      'FACTURAPI SA DE CV': 'FACTURAPI',
    };

    // Verificar mapeo directo primero
    if (nameMap[fullName]) {
      return nameMap[fullName];
    }

    // Verificar coincidencias parciales para casos donde el nombre puede variar ligeramente
    for (const [key, value] of Object.entries(nameMap)) {
      if (fullName.includes(key.split(' ')[0]) || key.includes(fullName.split(' ')[0])) {
        return value;
      }
    }

    // Como último recurso, extraer las primeras letras significativas
    const words = fullName.split(' ');
    if (words.length >= 2) {
      // Tomar las primeras letras de cada palabra significativa
      const siglas = words
        .filter(
          (word) =>
            word.length > 2 &&
            !['DE', 'LA', 'EL', 'Y', 'SA', 'CV', 'LAS', 'DEL', 'DIA'].includes(word)
        )
        .slice(0, 3) // Máximo 3 palabras para evitar siglas muy largas
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
 * Menús de estado de carga para transiciones suaves
 */
export function loadingMenus() {
  return {
    generic: () => ({
      text: LoadingStates.GENERIC,
      markup: Markup.inlineKeyboard([]),
    }),

    filters: () => ({
      text: LoadingStates.FILTERS,
      markup: Markup.inlineKeyboard([]),
    }),

    clients: () => ({
      text: LoadingStates.CLIENTS,
      markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancelar', 'excel_report_options')],
      ]),
    }),

    dates: () => ({
      text: LoadingStates.DATES,
      markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancelar', 'excel_report_options')],
      ]),
    }),

    generating: (progress = 0) => ({
      text: `${LoadingStates.GENERATING}\n\n${'█'.repeat(Math.floor(progress / 5))}${'░'.repeat(20 - Math.floor(progress / 5))} ${progress}%`,
      markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancelar generación', 'excel_cancel_generation')],
      ]),
    }),
  };
}

/**
 * Menú con breadcrumb para mejor navegación
 * @param {Array} menuPath - Camino de menús actual
 * @param {Object} mainMenu - Menú principal a mostrar
 */
export function menuWithBreadcrumb(menuPath, mainMenu) {
  const breadcrumb = generateBreadcrumb(menuPath);

  return {
    text: `${breadcrumb}\n\n${mainMenu.text || ''}`,
    markup: mainMenu.markup || mainMenu,
  };
}

/**
 * Menú de confirmación con historial
 * @param {string} action - Acción a confirmar
 * @param {string} confirmCallback - Callback para confirmar
 * @param {string} cancelCallback - Callback para cancelar
 */
export function confirmationMenuWithHistory(
  action,
  confirmCallback,
  cancelCallback = 'excel_report_options'
) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`✅ Confirmar ${action}`, confirmCallback),
      Markup.button.callback('❌ Cancelar', cancelCallback),
    ],
    [Markup.button.callback('🔙 Volver al menú anterior', 'menu_back')],
  ]);
}

/**
 * Menú de navegación mejorado con historial
 * @param {Array} quickActions - Acciones rápidas disponibles
 * @param {boolean} hasHistory - Si hay historial disponible
 */
export function enhancedNavigationMenu(quickActions = [], hasHistory = false) {
  const buttons = [];

  // Acciones rápidas en filas de 2
  for (let i = 0; i < quickActions.length; i += 2) {
    const row = quickActions.slice(i, i + 2);
    buttons.push(row.map((action) => Markup.button.callback(action.text, action.callback)));
  }

  // Fila de navegación
  const navRow = [];
  if (hasHistory) {
    navRow.push(Markup.button.callback('⬅️ Atrás', 'menu_back'));
  }
  navRow.push(Markup.button.callback('🏠 Inicio', 'menu_principal'));
  navRow.push(Markup.button.callback('📊 Reportes', 'menu_reportes'));

  buttons.push(navRow);

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
