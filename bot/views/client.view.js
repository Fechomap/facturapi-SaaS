// bot/views/client.view.js
import { Markup } from 'telegraf';

/**
 * Vista de lista de clientes configurados
 * @param {Array} clients - Lista de objetos de cliente con status
 */
export function clientStatusView(customerStatus) {
  let statusMessage = '📋 *Estado actual de clientes*\n\n';
  
  customerStatus.clients.forEach(client => {
    const emoji = client.isConfigured ? '✅' : '⏳';
    statusMessage += `${emoji} ${client.legalName}\n`;
  });
  
  statusMessage += `\n*Total:* ${customerStatus.configuredCount} de ${customerStatus.totalCount} clientes configurados`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Configurar clientes pendientes', 'start_client_setup')],
    [Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')]
  ]);
  
  return { message: statusMessage, keyboard, parse_mode: 'Markdown' };
}

/**
 * Vista de resumen de configuración de clientes
 * @param {number} successCount - Cantidad de clientes configurados exitosamente
 * @param {number} newlyConfigured - Cantidad de clientes recién configurados
 */
export function clientSetupResultView(successCount, newlyConfigured) {
  let message;
  
  if (newlyConfigured > 0) {
    message = `✅ Configuración completada con éxito.\n\n` +
      `Se han configurado ${newlyConfigured} nuevos clientes.\n` +
      `Total de clientes disponibles: ${successCount}`;
  } else {
    message = `ℹ️ No se han configurado nuevos clientes.\n\n` +
      `Ya tienes ${successCount} clientes configurados.`;
  }
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')]
  ]);
  
  return { message, keyboard };
}