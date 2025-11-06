// bot/views/client.view.ts
import { Markup } from 'telegraf';

interface Client {
  legalName: string;
  isConfigured: boolean;
}

interface CustomerStatus {
  clients: Client[];
  configuredCount: number;
  totalCount: number;
}

interface ViewResponse {
  message: string;
  keyboard: ReturnType<typeof Markup.inlineKeyboard>;
  parse_mode?: 'Markdown';
}

/**
 * Vista de lista de clientes configurados
 * @param customerStatus - Estado de clientes con información de configuración
 */
export function clientStatusView(customerStatus: CustomerStatus): ViewResponse {
  let statusMessage = '📋 *Estado actual de clientes*\n\n';

  customerStatus.clients.forEach((client) => {
    const emoji = client.isConfigured ? '✅' : '⏳';
    statusMessage += `${emoji} ${client.legalName}\n`;
  });

  statusMessage += `\n*Total:* ${customerStatus.configuredCount} de ${customerStatus.totalCount} clientes configurados`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Configurar clientes pendientes', 'start_client_setup')],
    [Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')],
  ]);

  return { message: statusMessage, keyboard, parse_mode: 'Markdown' };
}

/**
 * Vista de resumen de configuración de clientes
 * @param successCount - Cantidad de clientes configurados exitosamente
 * @param newlyConfigured - Cantidad de clientes recién configurados
 */
export function clientSetupResultView(successCount: number, newlyConfigured: number): ViewResponse {
  let message: string;

  if (newlyConfigured > 0) {
    message =
      `✅ Configuración completada con éxito.\n\n` +
      `Se han configurado ${newlyConfigured} nuevos clientes.\n` +
      `Total de clientes disponibles: ${successCount}`;
  } else {
    message =
      `ℹ️ No se han configurado nuevos clientes.\n\n` +
      `Ya tienes ${successCount} clientes configurados.`;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')],
  ]);

  return { message, keyboard };
}
