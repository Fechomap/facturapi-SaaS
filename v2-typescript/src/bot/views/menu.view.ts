// bot/views/menu.view.ts
import { Markup } from 'telegraf';

interface Client {
  id: string | number;
  name: string;
}

interface MenuResponse {
  text: string;
  markup: ReturnType<typeof Markup.inlineKeyboard>;
}

/**
 * Genera el teclado persistente con botón MENU
 */
export function persistentKeyboard(): ReturnType<typeof Markup.keyboard> {
  return Markup.keyboard([['📱 MENU']])
    .resize()
    .persistent();
}

/**
 * Genera el menú principal para usuarios con tenant
 */
export function mainMenu(): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 Generar Factura', 'menu_generar')],
    [Markup.button.callback('💰 Complemento de Pago', 'menu_complemento_pago')],
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
export function reportsMenu(): ReturnType<typeof Markup.inlineKeyboard> {
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
export function startMenu(): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 Crear organización', 'create_organization')],
    [Markup.button.callback('ℹ️ Más información', 'show_pricing')],
  ]);
}

/**
 * Genera el menú para selección de cliente
 * @param clients - Lista de clientes disponibles
 * @param includeChubb - Si se debe incluir la opción CHUBB
 * @param includeBackButton - Si se debe incluir el botón de volver
 */
export function clientSelectionMenu(
  clients: Client[],
  includeChubb = true,
  includeBackButton = true
): ReturnType<typeof Markup.inlineKeyboard> {
  const buttons: Array<Array<ReturnType<typeof Markup.button.callback>>> = clients.map((client) => [
    Markup.button.callback(client.name, `cliente_${client.id}`),
  ]);

  if (includeChubb) {
    buttons.push([Markup.button.callback('CHUBB (Archivo Excel)', 'menu_chubb')]);
    buttons.push([Markup.button.callback('AXA (Archivo Excel)', 'menu_axa')]);
    buttons.push([
      Markup.button.callback('CLUB DE ASISTENCIA (Archivo Excel)', 'menu_club_asistencia'),
    ]);
    buttons.push([Markup.button.callback('QUALITAS (Archivo Excel)', 'menu_qualitas')]);
  }

  // Agregar botón de volver al final
  if (includeBackButton) {
    buttons.push([Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]);
  }

  return Markup.inlineKeyboard(buttons);
}

// Más funciones de menú según necesidad...
export function confirmationMenu(transactionId: string): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirmar', `confirmar_${transactionId}`)],
    [Markup.button.callback('❌ Cancelar', `cancelar_${transactionId}`)],
  ]);
}

export function backToMainMenu(): ReturnType<typeof Markup.inlineKeyboard> {
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
 * @param context - Contexto adicional opcional
 */
export function enhancedMainMenu(context = ''): MenuResponse {
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
export function enhancedReportsMenu(): MenuResponse {
  return {
    text: '🏠 Menú Principal → 📊 **Reportes y Análisis**\n\nSelecciona el tipo de reporte que deseas consultar:',
    markup: reportsMenu(),
  };
}
