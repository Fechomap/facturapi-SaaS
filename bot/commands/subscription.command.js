// bot/commands/subscription.command.js
import { Markup } from 'telegraf';
import TenantService from '../../services/tenant.service.js';
import prisma from '../../lib/prisma.js';

/**
 * Registra el comando suscripcion (/suscripcion) y acciones relacionadas
 * @param {Object} bot - Instancia del bot
 */
export function registerSubscriptionCommand(bot) {
  // Comando para ver información de suscripción
  bot.command('suscripcion', async (ctx) => {
    if (!ctx.hasTenant()) {
      return ctx.reply(
        'Para ver información de suscripción, primero debes registrar tu empresa.\n\nUsa /registro para comenzar.'
      );
    }
    
    try {
      // Obtener información del tenant y su suscripción
      const tenantData = await TenantService.findTenantWithSubscription(ctx.userState.tenantId);
      
      if (!tenantData) {
        return ctx.reply(
          `❌ No se encontró información para tu empresa con ID: ${ctx.userState.tenantId}.\n\n` +
          `Contacta a soporte para solucionar este problema.`
        );
      }
      
      if (!tenantData.subscriptions || tenantData.subscriptions.length === 0) {
        return ctx.reply(
          `❌ No se encontró información de suscripción para tu empresa: ${tenantData.businessName}.\n\n` +
          `Contacta a soporte para solucionar este problema.`
        );
      }
      
      const subscription = tenantData.subscriptions[0];
      
      // Verificar que el plan existe
      if (!subscription.plan) {
        return ctx.reply(
          `❌ No se encontró información del plan para tu suscripción.\n\n` +
          `Contacta a soporte para solucionar este problema.`
        );
      }
      
      const plan = subscription.plan;
      
      // Formatear fechas
      const today = new Date();
      const trialEndsDate = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null;
      const currentPeriodEndsDate = subscription.currentPeriodEndsAt 
        ? new Date(subscription.currentPeriodEndsAt) 
        : null;
      
      // Calcular días restantes
      const daysLeft = trialEndsDate && trialEndsDate > today
        ? Math.ceil((trialEndsDate - today) / (1000 * 60 * 60 * 24))
        : (currentPeriodEndsDate && currentPeriodEndsDate > today
            ? Math.ceil((currentPeriodEndsDate - today) / (1000 * 60 * 60 * 24))
            : 0);
      
      // Determinar estado y mensaje
      let statusEmoji = '✅';
      let statusMsg = 'Activa';
      let periodMsg = '';
      
      switch (subscription.status) {
        case 'trial':
          statusEmoji = '🔍';
          statusMsg = 'Período de Prueba';
          periodMsg = `Finaliza en ${daysLeft} días`;
          break;
        case 'active':
          statusEmoji = '✅';
          statusMsg = 'Activa';
          periodMsg = `Renovación en ${daysLeft} días`;
          break;
        case 'payment_pending':
          statusEmoji = '⚠️';
          statusMsg = 'Pago Pendiente';
          periodMsg = 'Se requiere actualizar método de pago';
          break;
        case 'suspended':
          statusEmoji = '❌';
          statusMsg = 'Suspendida';
          periodMsg = 'Servicio limitado por falta de pago';
          break;
        case 'cancelled':
          statusEmoji = '🚫';
          statusMsg = 'Cancelada';
          periodMsg = 'La suscripción ha sido cancelada';
          break;
        default:
          statusMsg = subscription.status || 'Desconocido';
          periodMsg = 'Estado de suscripción no reconocido';
      }
      
      // Crear mensaje de suscripción
      await ctx.reply(
        `📊 *Información de Suscripción*\n\n` +
        `*Empresa:* ${tenantData.businessName}\n` +
        `*Plan:* ${plan.name}\n` +
        `*Estado:* ${statusEmoji} ${statusMsg}\n` +
        `*${periodMsg}*\n\n` +
        `*Facturas generadas:* ${subscription.invoicesUsed} / ${plan.invoiceLimit}\n` +
        `*Porcentaje usado:* ${Math.round((subscription.invoicesUsed / plan.invoiceLimit) * 100)}%\n\n` +
        `*Precio del plan:* $${plan.price} ${plan.currency} / ${plan.billingPeriod === 'monthly' ? 'mes' : 'año'}\n\n` +
        `*Tenant ID:* ${tenantData.id}\n` +
        `*API Key configurada:* ${tenantData.facturapiApiKey ? '✅ Sí' : '❌ No'}\n` +
        `*Organización FacturAPI:* ${tenantData.facturapiOrganizationId || 'No configurada'}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💳 Actualizar Plan', 'update_subscription')],
            [Markup.button.callback('↩️ Volver al Menú', 'menu_principal')]
          ])
        }
      );
    } catch (error) {
      console.error('Error al obtener información de suscripción:', error);
      
      ctx.reply(
        `❌ Ocurrió un error al obtener la información de tu suscripción: ${error.message}\n\n` +
        `Por favor, intenta nuevamente más tarde o contacta a soporte.`
      );
    }
  });
  
  // Acción para el menú de suscripción
  bot.action('menu_suscripcion', async (ctx) => {
    await ctx.answerCbQuery();
    
    // Simplemente ejecutar el comando /suscripcion
    ctx.telegram.sendMessage(ctx.chat.id, '/suscripcion');
  });
  
  // Implementar acción para actualizar suscripción
  bot.action('update_subscription', async (ctx) => {
    // ... (código original para actualizar suscripción) ...
  });
}