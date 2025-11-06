// bot/views/report-menu.view.ts
// Vistas para menús de reportes con filtros avanzados

import { Markup } from 'telegraf';

interface Client {
  id: number | string;
  legalName: string;
  _count?: {
    invoices?: number;
  };
}

interface DateRange {
  display: string;
  start?: Date;
  end?: Date;
}

interface Filters {
  dateRange?: DateRange;
  selectedClientIds?: string[];
  estimatedInvoices?: number;
  estimatedTimeSeconds?: number;
  estimatedGenerationTime?: number;
}

interface GenerationProgress {
  stage?: string;
  percentage?: number;
}

interface GenerationSummary {
  invoiceCount: number;
  filters?: Filters;
}

interface GenerationResult {
  success: boolean;
  errors?: Array<{ message: string }>;
}

interface TenantStats {
  currentMonth?: number;
  previousMonth?: number;
  last30Days?: number;
}

interface QuickAction {
  text: string;
  callback: string;
}

interface MenuPath {
  name: string;
  level: number;
}

/**
 * Menú principal de opciones de reporte Excel - MEJORADO UX
 */
export function excelReportOptionsMenu(): ReturnType<typeof Markup.inlineKeyboard> {
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
export function dateFilterMenu(): ReturnType<typeof Markup.inlineKeyboard> {
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
 * @param clients - Lista de clientes con información
 * @param selectedIds - IDs de clientes ya seleccionados
 */
export function clientSelectionMenu(
  clients: Client[],
  selectedIds: string[] = []
): ReturnType<typeof Markup.inlineKeyboard> {
  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

  // Función para simplificar nombres de clientes - MAPEO COMPLETO
  const simplifyClientName = (fullName: string): string => {
    const nameMap: Record<string, string> = {
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
 * @param startDate - Fecha de inicio
 * @param endDate - Fecha de fin
 */
export function customDateConfirmMenu(
  startDate: string,
  endDate: string
): ReturnType<typeof Markup.inlineKeyboard> {
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
 * @param progress - Información de progreso
 */
export function generationProgressMenu(
  progress: GenerationProgress = {}
): ReturnType<typeof Markup.inlineKeyboard> {
  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

  // Solo mostrar botón de cancelar si está en progreso
  if (progress.stage && progress.stage !== 'completed') {
    buttons.push([Markup.button.callback('❌ Cancelar generación', 'excel_cancel_generation')]);
  }

  return Markup.inlineKeyboard(buttons);
}

/**
 * Menú de resumen pre-generación
 * @param summary - Resumen de lo que se va a generar
 */
export function preGenerationSummaryMenu(
  summary: GenerationSummary
): ReturnType<typeof Markup.inlineKeyboard> {
  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [
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
 * @param result - Resultado de la generación
 */
export function postGenerationMenu(
  result: GenerationResult
): ReturnType<typeof Markup.inlineKeyboard> {
  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [
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
 * @param filters - Filtros actuales aplicados
 */
export function combinedFiltersMenu(
  filters: Filters = {}
): ReturnType<typeof Markup.inlineKeyboard> {
  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

  // Estado visual de filtros activos
  const hasDateFilter = !!filters.dateRange;
  const hasClientFilter = filters.selectedClientIds && filters.selectedClientIds.length > 0;

  // Botones para modificar filtros con indicadores visuales
  const dateButton = hasDateFilter
    ? Markup.button.callback(`✅ ${filters.dateRange!.display}`, 'excel_filter_date')
    : Markup.button.callback('📅 Filtrar por fecha', 'excel_filter_date');

  const clientButton = hasClientFilter
    ? Markup.button.callback(
        `✅ ${filters.selectedClientIds!.length} cliente${filters.selectedClientIds!.length > 1 ? 's' : ''}`,
        'excel_filter_clients'
      )
    : Markup.button.callback('👥 Filtrar clientes', 'excel_filter_clients');

  buttons.push([dateButton, clientButton]);

  // Botón principal de generación
  if (filters.estimatedInvoices && filters.estimatedInvoices > 0) {
    const timeEmoji =
      filters.estimatedTimeSeconds && filters.estimatedTimeSeconds < 10
        ? '⚡'
        : filters.estimatedTimeSeconds && filters.estimatedTimeSeconds < 30
          ? '⏱️'
          : '🕐';
    buttons.push([
      Markup.button.callback(
        `${timeEmoji} Generar ${filters.estimatedInvoices} facturas`,
        'excel_confirm_generation'
      ),
    ]);
  } else {
    buttons.push([Markup.button.callback('📊 Generar reporte', 'excel_confirm_generation')]);
  }

  // Botones de control - Limpiar más visible cuando hay filtros
  const hasAnyFilters = hasDateFilter || hasClientFilter;
  const clearButton = hasAnyFilters
    ? Markup.button.callback('🗑️ LIMPIAR FILTROS', 'excel_clear_all_filters')
    : Markup.button.callback('🔄 Limpiar todo', 'excel_clear_all_filters');

  buttons.push([clearButton, Markup.button.callback('🔙 Volver', 'menu_reportes')]);

  return Markup.inlineKeyboard(buttons);
}

/**
 * Menú de estadísticas rápidas
 * @param stats - Estadísticas del tenant
 */
export function quickStatsMenu(stats: TenantStats): ReturnType<typeof Markup.inlineKeyboard> {
  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [
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

interface LoadingMenu {
  text: string;
  markup: ReturnType<typeof Markup.inlineKeyboard>;
}

/**
 * Menús de estado de carga para transiciones suaves
 */
export function loadingMenus() {
  // Constantes de estados de carga
  const LoadingStates = {
    GENERIC: '🔄 *Cargando...*',
    FILTERS: '⚙️ *Aplicando filtros...*',
    CLIENTS: '👥 *Cargando clientes...*',
    DATES: '📅 *Procesando fechas...*',
    GENERATING: '📊 *Generando reporte...*',
  };

  return {
    generic: (): LoadingMenu => ({
      text: LoadingStates.GENERIC,
      markup: Markup.inlineKeyboard([]),
    }),

    filters: (): LoadingMenu => ({
      text: LoadingStates.FILTERS,
      markup: Markup.inlineKeyboard([]),
    }),

    clients: (): LoadingMenu => ({
      text: LoadingStates.CLIENTS,
      markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancelar', 'excel_report_options')],
      ]),
    }),

    dates: (): LoadingMenu => ({
      text: LoadingStates.DATES,
      markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancelar', 'excel_report_options')],
      ]),
    }),

    generating: (progress = 0): LoadingMenu => ({
      text: `${LoadingStates.GENERATING}\n\n${'█'.repeat(Math.floor(progress / 5))}${'░'.repeat(20 - Math.floor(progress / 5))} ${progress}%`,
      markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancelar generación', 'excel_cancel_generation')],
      ]),
    }),
  };
}

interface MenuWithBreadcrumbResult {
  text: string;
  markup: ReturnType<typeof Markup.inlineKeyboard> | LoadingMenu;
}

/**
 * Menú con breadcrumb para mejor navegación
 * @param menuPath - Camino de menús actual
 * @param mainMenu - Menú principal a mostrar
 */
export function menuWithBreadcrumb(
  menuPath: MenuPath[],
  mainMenu:
    | LoadingMenu
    | ReturnType<typeof Markup.inlineKeyboard>
    | { text?: string; markup?: ReturnType<typeof Markup.inlineKeyboard> }
): MenuWithBreadcrumbResult {
  // Generar breadcrumb simple
  const breadcrumb = menuPath.map((item) => item.name).join(' → ');

  const menuText = typeof mainMenu === 'object' && 'text' in mainMenu ? mainMenu.text : '';
  const menuMarkup =
    typeof mainMenu === 'object' && 'markup' in mainMenu
      ? mainMenu.markup
      : (mainMenu as ReturnType<typeof Markup.inlineKeyboard>);

  return {
    text: `${breadcrumb}\n\n${menuText || ''}`,
    markup: menuMarkup || Markup.inlineKeyboard([]),
  };
}

/**
 * Menú de confirmación con historial
 * @param action - Acción a confirmar
 * @param confirmCallback - Callback para confirmar
 * @param cancelCallback - Callback para cancelar
 */
export function confirmationMenuWithHistory(
  action: string,
  confirmCallback: string,
  cancelCallback = 'excel_report_options'
): ReturnType<typeof Markup.inlineKeyboard> {
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
 * @param quickActions - Acciones rápidas disponibles
 * @param hasHistory - Si hay historial disponible
 */
export function enhancedNavigationMenu(
  quickActions: QuickAction[] = [],
  hasHistory = false
): ReturnType<typeof Markup.inlineKeyboard> {
  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = [];

  // Acciones rápidas en filas de 2
  for (let i = 0; i < quickActions.length; i += 2) {
    const row = quickActions.slice(i, i + 2);
    buttons.push(row.map((action) => Markup.button.callback(action.text, action.callback)));
  }

  // Fila de navegación
  const navRow: Array<ReturnType<typeof Markup.button.callback>> = [];
  if (hasHistory) {
    navRow.push(Markup.button.callback('⬅️ Atrás', 'menu_back'));
  }
  navRow.push(Markup.button.callback('🏠 Inicio', 'menu_principal'));
  navRow.push(Markup.button.callback('📊 Reportes', 'menu_reportes'));

  buttons.push(navRow);

  return Markup.inlineKeyboard(buttons);
}

/**
 * Generar texto de resumen de filtros - MEJORADO UX con mejor visibilidad
 * @param filters - Filtros aplicados
 */
export function generateFilterSummaryText(filters: Filters): string {
  const hasFilters =
    filters.dateRange || (filters.selectedClientIds && filters.selectedClientIds.length > 0);

  if (!hasFilters) {
    return '🔓 **Sin filtros activos** - Se mostrarán todas las facturas\n';
  }

  let summary = '🎯 **FILTROS ACTIVOS:**\n';

  if (filters.dateRange) {
    summary += `📅 **Fecha:** ${filters.dateRange.display}\n`;
  }

  if (filters.selectedClientIds && filters.selectedClientIds.length > 0) {
    const clientCount = filters.selectedClientIds.length;
    summary += `👥 **Clientes:** ${clientCount} seleccionado${clientCount > 1 ? 's' : ''}\n`;
  }

  if (filters.estimatedInvoices) {
    summary += `\n📊 **Facturas estimadas:** ${filters.estimatedInvoices}\n`;
  }

  if (filters.estimatedGenerationTime) {
    summary += `⏱️ **Tiempo estimado:** ${filters.estimatedGenerationTime} segundos\n`;
  }

  return summary;
}
