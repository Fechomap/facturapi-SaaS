/**
 * Client handler for Telegram bot
 * Handles client selection and configuration
 */

import { Markup } from 'telegraf';
import type { BotContext } from '@/types/bot.types.js';
import { createModuleLogger } from '@core/utils/logger.js';
import { prisma } from '@/config/database.js';

// Service imports
import CustomerSetupService from '@services/customer-setup.service.js';

const logger = createModuleLogger('bot-client-handler');

/**
 * Registers client-related handlers
 */
export function registerClientHandler(bot: any): void {
  // Handler for client selection
  bot.action(/cliente_(.+)/, async (ctx: BotContext): Promise<void> => {
    const facturapiCustomerId = ctx.match?.[1];
    if (!facturapiCustomerId) {
      await ctx.answerCbQuery('Error: ID de cliente no encontrado');
      return;
    }

    try {
      // Search for the customer in the database
      const cliente = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId: ctx.getTenantId(),
          facturapiCustomerId: facturapiCustomerId,
        },
      });

      if (!cliente) {
        await ctx.reply(
          `❌ Error: No se pudo encontrar la información del cliente seleccionado. Por favor intente nuevamente.`,
          {
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('Volver', 'menu_generar')],
            ]).reply_markup,
          }
        );
        return;
      }

      // If it's CHUBB, redirect to Excel flow
      if (cliente.legalName.includes('CHUBB')) {
        await ctx.reply(
          'Para facturar a CHUBB, se debe utilizar el proceso especial con archivo Excel.'
        );
        await ctx.answerCbQuery('Redirigiendo al flujo especial de CHUBB...');
        return;
      }

      // Save client data in state
      ctx.userState.clienteNombre = cliente.legalName;
      ctx.userState.clienteId = cliente.facturapiCustomerId;

      await ctx.reply(`Cliente seleccionado: ${cliente.legalName}`);
      await ctx.reply('Por favor, ingrese el número de pedido / orden de compra:');
      ctx.userState.esperando = 'numeroPedido';

      await ctx.answerCbQuery();
    } catch (error) {
      logger.error('Error al seleccionar cliente:', error);
      await ctx.reply(`❌ Error al procesar la selección: ${(error as Error).message}`);
      await ctx.answerCbQuery('Error al seleccionar cliente');
    }
  });

  // Configure clients
  bot.action('configure_clients', async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery('✓ Seleccionado');

    try {
      // Show loading state with transition
      await ctx.editMessageText(
        '🏠 Menú Principal → ⚙️ **Configurar Clientes**\n\n⏳ Verificando el estado de tus clientes...',
        { parse_mode: 'Markdown' }
      );

      const tenantId = ctx.getTenantId();

      if (!tenantId) {
        await ctx.editMessageText(
          '🏠 Menú Principal → ⚙️ **Configurar Clientes**\n\n❌ Error: No se ha encontrado información de tu empresa. Por favor, contacta a soporte.',
          {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')],
            ]).reply_markup,
          }
        );
        return;
      }

      // Get current customer status
      const customerStatus = await CustomerSetupService.getCustomersStatus(tenantId);
      logger.info(
        `Estado de clientes: ${customerStatus.configuredCount}/${customerStatus.totalCount} configurados`
      );

      // Build status message
      let message = '📊 **Estado de Clientes**\n\n';
      message += `Total de clientes: ${customerStatus.totalCount}\n`;
      message += `Configurados: ${customerStatus.configuredCount}\n`;
      message += `Pendientes: ${customerStatus.totalCount - customerStatus.configuredCount}\n\n`;

      if (customerStatus.configuredCount === customerStatus.totalCount) {
        message += '✅ Todos los clientes están configurados correctamente.';
      } else {
        message += `⚠️ Hay ${customerStatus.totalCount - customerStatus.configuredCount} clientes pendientes de configuración.`;
      }

      const buttons = [];

      if (customerStatus.configuredCount < customerStatus.totalCount) {
        buttons.push([Markup.button.callback('🔧 Configurar Clientes', 'start_client_setup')]);
      }

      buttons.push([Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')]);

      const enhancedMessage = `🏠 Menú Principal → ⚙️ **Configurar Clientes**\n\n${message}`;

      await ctx.editMessageText(enhancedMessage, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });
    } catch (error) {
      logger.error('Error al verificar estado de clientes:', error);
      await ctx.editMessageText(
        `🏠 Menú Principal → ⚙️ **Configurar Clientes**\n\n❌ Ocurrió un error al verificar el estado de los clientes: ${(error as Error).message}\n\nPor favor, intenta nuevamente más tarde.`,
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Reintentar', 'configure_clients')],
            [Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')],
          ]).reply_markup,
        }
      );
    }
  });

  // Action to start client configuration
  bot.action('start_client_setup', async (ctx: BotContext) => {
    await ctx.answerCbQuery();

    try {
      // Show waiting message
      await ctx.reply(
        '⏳ Iniciando configuración de clientes pendientes, esto tomará unos momentos...'
      );

      const tenantId = ctx.getTenantId();

      // Execute client configuration (only missing ones, don't recreate)
      const results = await CustomerSetupService.setupPredefinedCustomers(tenantId, false);

      // Count successes and failures
      const successCount = results.filter((r) => r.success).length;
      const newlyConfigured = results.filter(
        (r) => r.success && !r.message?.includes('ya existente')
      ).length;

      // Show result
      let message = '✅ **Configuración Completada**\n\n';
      message += `Clientes procesados: ${results.length}\n`;
      message += `Nuevos configurados: ${newlyConfigured}\n`;
      message += `Ya existentes: ${successCount - newlyConfigured}\n`;

      if (successCount < results.length) {
        message += `\n⚠️ Algunos clientes no pudieron configurarse. Por favor, contacta a soporte.`;
      }

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')],
        ]).reply_markup,
      });
    } catch (error) {
      logger.error('Error al configurar clientes:', error);
      await ctx.reply(
        `❌ Ocurrió un error durante la configuración: ${(error as Error).message}\n\n` +
          `Por favor, intenta nuevamente más tarde.`,
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')],
          ]).reply_markup,
        }
      );
    }
  });
}
