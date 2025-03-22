// bot/handlers/client.handler.js
import { Markup } from 'telegraf';
import prisma from '../../lib/prisma.js';
import CustomerSetupService from '../../services/customer-setup.service.js';
import { clientStatusView, clientSetupResultView } from '../views/client.view.js';

/**
 * Registra los manejadores relacionados con clientes
 * @param {Object} bot - Instancia del bot
 */
export function registerClientHandler(bot) {
  // Manejador para selección de cliente
  bot.action(/cliente_(.+)/, async (ctx) => {
    // Extraer el ID del cliente de FacturAPI del callback
    const facturapiCustomerId = ctx.match[1];
    
    try {
      // Buscar el cliente en la base de datos
      const cliente = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId: ctx.getTenantId(),
          facturapiCustomerId: facturapiCustomerId
        }
      });
      
      if (!cliente) {
        return ctx.reply(
          `❌ Error: No se pudo encontrar la información del cliente seleccionado. Por favor intente nuevamente.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('Volver', 'menu_generar')]
          ])
        );
      }
      
      // Guardar datos del cliente en el estado
      ctx.userState.clienteNombre = cliente.legalName;
      ctx.userState.clienteId = cliente.facturapiCustomerId;
      
      await ctx.reply(`Cliente seleccionado: ${cliente.legalName}`);
      await ctx.reply('Por favor, ingrese el número de pedido / orden de compra:');
      ctx.userState.esperando = 'numeroPedido';
      
      return ctx.answerCbQuery();
    } catch (error) {
      console.error('Error al seleccionar cliente:', error);
      await ctx.reply(`❌ Error al procesar la selección: ${error.message}`);
      return ctx.answerCbQuery('Error al seleccionar cliente');
    }
  });

  // Configuración de clientes
  bot.action('configure_clients', async (ctx) => {
    await ctx.answerCbQuery();
    
    // Mostrar mensaje de espera
    await ctx.reply('⏳ Verificando el estado de tus clientes...');
    
    try {
      const tenantId = ctx.getTenantId();
      
      if (!tenantId) {
        return ctx.reply('❌ Error: No se ha encontrado información de tu empresa. Por favor, contacta a soporte.');
      }
      
      // Obtener el estado actual de los clientes
      const customerStatus = await CustomerSetupService.getCustomersStatus(tenantId);
      console.log(`Estado de clientes: ${customerStatus.configuredCount}/${customerStatus.totalCount} configurados`);
      
      // Mostrar estado usando la vista
      const { message, keyboard, parse_mode } = clientStatusView(customerStatus);
      await ctx.reply(message, { parse_mode, ...keyboard });
      
    } catch (error) {
      console.error('Error al verificar estado de clientes:', error);
      await ctx.reply(
        `❌ Ocurrió un error al verificar el estado de los clientes: ${error.message}\n\n` +
        `Por favor, intenta nuevamente más tarde.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')]
        ])
      );
    }
  });

  // Acción para iniciar la configuración de clientes
  bot.action('start_client_setup', async (ctx) => {
    await ctx.answerCbQuery();
    
    try {
      // Mostrar mensaje de espera
      await ctx.reply('⏳ Iniciando configuración de clientes pendientes, esto tomará unos momentos...');
      
      const tenantId = ctx.getTenantId();
      
      // Ejecutar la configuración de clientes
      const results = await CustomerSetupService.setupPredefinedCustomers(tenantId, true);
      
      // Verificar que los clientes se hayan creado correctamente
      const clientService = await import('../../services/client.service.js');
      const verification = await clientService.verifyClientSetup(tenantId);

      if (!verification.success) {
        await ctx.reply(
          `⚠️ Se detectó un problema durante la verificación: ${verification.error}`
        );
      }
      
      // Contar éxitos y fallos
      const successCount = results.filter(r => r.success).length;
      const newlyConfigured = results.filter(r => r.success && !r.message?.includes('ya existente')).length;
      
      // Mostrar resultado usando la vista
      const { message, keyboard } = clientSetupResultView(successCount, newlyConfigured);
      await ctx.reply(message, keyboard);
      
    } catch (error) {
      console.error('Error al configurar clientes:', error);
      await ctx.reply(
        `❌ Ocurrió un error durante la configuración: ${error.message}\n\n` +
        `Por favor, intenta nuevamente más tarde.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')]
        ])
      );
    }
  });
}