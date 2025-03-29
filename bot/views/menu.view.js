// bot/views/menu.view.js
import { Markup } from 'telegraf';

/**
 * Genera el menú principal para usuarios con tenant
 */
export function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 Generar Factura', 'menu_generar')],
    [Markup.button.callback('🔍 Consultar Factura', 'menu_consultar')],
    [Markup.button.callback('📊 Reportes', 'menu_reportes')], // Nueva opción
    [Markup.button.callback('💳 Mi Suscripción', 'menu_suscripcion')],
    [Markup.button.callback('⚙️ Configurar Clientes', 'configure_clients')]
  ]);
}

/**
 * Genera el menú de reportes
 */
export function reportsMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📈 Reporte de Facturación', 'reporte_facturas_action')],
    [Markup.button.callback('💰 Reporte de Suscripción', 'reporte_suscripcion_action')],
    [Markup.button.callback('🔄 Estado de Progreso', 'view_onboarding_progress')],
    [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]
  ]);
}

/**
 * Genera el menú de inicio para usuarios sin tenant
 */
export function startMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 Crear organización', 'create_organization')],
    [Markup.button.callback('ℹ️ Más información', 'show_pricing')]
  ]);
}

/**
 * Genera el menú para selección de cliente
 * @param {Array} clients - Lista de clientes disponibles
 * @param {boolean} includeChubb - Si se debe incluir la opción CHUBB
 */
export function clientSelectionMenu(clients, includeChubb = true) {
  const buttons = clients.map(client => 
    [Markup.button.callback(client.name, `cliente_${client.id}`)]
  );
  
  if (includeChubb) {
    buttons.push([Markup.button.callback('CHUBB (Archivo Excel)', 'menu_chubb')]);
  }
  
  return Markup.inlineKeyboard(buttons);
}

// Más funciones de menú según necesidad...
export function confirmationMenu(transactionId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirmar', `confirmar_${transactionId}`)],
    [Markup.button.callback('❌ Cancelar', `cancelar_${transactionId}`)]
  ]);
}

export function backToMainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')]
  ]);
}