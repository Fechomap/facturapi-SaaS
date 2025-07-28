// bot/views/menu.view.js
import { Markup } from 'telegraf';
import { LoadingStates } from '../utils/menu-transition.utils.js';

/**
 * Genera el teclado persistente con botón MENU
 */
export function persistentKeyboard() {
  return Markup.keyboard([['📱 MENU']])
    .resize()
    .persistent();
}

/**
 * Genera el menú principal para usuarios con tenant
 */
export function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 Generar Factura', 'menu_generar')],
    [Markup.button.callback('👥 Usuarios', 'menu_usuarios')],
    [Markup.button.callback('🔍 Consultar Factura', 'menu_consultar')],
    [Markup.button.callback('📊 Reportes', 'menu_reportes')],
    [Markup.button.callback('💳 Mi Suscripción', 'menu_suscripcion')],
    [Markup.button.callback('⚙️ Configurar Clientes', 'configure_clients')],
  ]);
}

/**
 * Genera el menú de reportes
 */
export function reportsMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📈 Reporte de Facturación', 'reporte_facturas_action')],
    [Markup.button.callback('📊 Reporte Excel', 'reporte_excel_action')],
    [Markup.button.callback('🔄 Estado de Progreso', 'view_onboarding_progress')],
    [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
  ]);
}

/**
 * Genera el menú de inicio para usuarios sin tenant
 */
export function startMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 Crear organización', 'create_organization')],
    [Markup.button.callback('ℹ️ Más información', 'show_pricing')],
  ]);
}

/**
 * Genera el menú para selección de cliente
 * @param {Array} clients - Lista de clientes disponibles
 * @param {boolean} includeChubb - Si se debe incluir la opción CHUBB
 * @param {boolean} includeBackButton - Si se debe incluir el botón de volver
 */
export function clientSelectionMenu(clients, includeChubb = true, includeBackButton = true) {
  const buttons = clients.map((client) => [
    Markup.button.callback(client.name, `cliente_${client.id}`),
  ]);

  if (includeChubb) {
    buttons.push([Markup.button.callback('CHUBB (Archivo Excel)', 'menu_chubb')]);
    buttons.push([Markup.button.callback('AXA (Archivo Excel)', 'menu_axa')]);
  }

  // Agregar botón de volver al final
  if (includeBackButton) {
    buttons.push([Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]);
  }

  return Markup.inlineKeyboard(buttons);
}

// Más funciones de menú según necesidad...
export function confirmationMenu(transactionId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirmar', `confirmar_${transactionId}`)],
    [Markup.button.callback('❌ Cancelar', `cancelar_${transactionId}`)],
  ]);
}

export function backToMainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')],
  ]);
}

/**
 * Menús de carga para transiciones principales
 */
export function loadingMainMenus() {
  return {
    main: () => ({
      text: '🔄 *Cargando menú principal...*',
      markup: Markup.inlineKeyboard([]),
    }),

    reports: () => ({
      text: '📊 *Cargando reportes...*',
      markup: Markup.inlineKeyboard([]),
    }),

    users: () => ({
      text: '👥 *Cargando usuarios...*',
      markup: Markup.inlineKeyboard([]),
    }),

    invoices: () => ({
      text: '📝 *Cargando facturas...*',
      markup: Markup.inlineKeyboard([]),
    }),

    subscription: () => ({
      text: '💳 *Cargando suscripción...*',
      markup: Markup.inlineKeyboard([]),
    }),

    clients: () => ({
      text: '⚙️ *Cargando clientes...*',
      markup: Markup.inlineKeyboard([]),
    }),
  };
}

/**
 * Menú principal mejorado con breadcrumb
 * @param {string} context - Contexto adicional opcional
 */
export function enhancedMainMenu(context = '') {
  const menuText = context
    ? `🏠 **Menú Principal** ${context}\n\nSelecciona una opción:`
    : '🏠 **Menú Principal**\n\nSelecciona una opción:';

  return {
    text: menuText,
    markup: mainMenu(),
  };
}

/**
 * Menú de reportes mejorado con breadcrumb
 */
export function enhancedReportsMenu() {
  return {
    text: '🏠 Menú Principal → 📊 **Reportes y Análisis**\n\nSelecciona el tipo de reporte que deseas consultar:',
    markup: reportsMenu(),
  };
}
