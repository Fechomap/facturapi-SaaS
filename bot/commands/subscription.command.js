import { Markup } from 'telegraf';
import TenantService from '../../services/tenant.service.js';

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

      if (!tenantData || !tenantData.subscriptions || tenantData.subscriptions.length === 0) {
        return ctx.reply(
          `❌ No se encontró información de suscripción para tu empresa: ${tenantData?.businessName || 'Desconocida'}.\n\n` +
            `Contacta a soporte para solucionar este problema.`
        );
      }

      const subscription = tenantData.subscriptions[0];
      const plan = subscription.plan || {
        name: 'Desconocido',
        price: 0,
        currency: 'MXN',
        billingPeriod: 'monthly',
      };

      console.log('Datos de suscripción recuperados:', {
        tenantId: tenantData.id,
        subscriptionCount: tenantData.subscriptions?.length || 0,
        invoicesUsed: subscription.invoicesUsed || 0,
      });

      // Formatear fechas
      const today = new Date();
      const trialEndsDate = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null;
      const currentPeriodEndsDate = subscription.currentPeriodEndsAt
        ? new Date(subscription.currentPeriodEndsAt)
        : null;

      const daysLeft =
        trialEndsDate && trialEndsDate > today
          ? Math.ceil((trialEndsDate - today) / (1000 * 60 * 60 * 24))
          : currentPeriodEndsDate && currentPeriodEndsDate > today
            ? Math.ceil((currentPeriodEndsDate - today) / (1000 * 60 * 60 * 24))
            : 0;

      // Determinar estado de la suscripción
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

      // Construcción del mensaje con valores corregidos
      await ctx.reply(
        `📊 Información de Suscripción\n\n` +
          `Empresa: ${tenantData.businessName}\n` +
          `Plan: ${plan.name}\n` +
          `Estado: ${statusEmoji} ${statusMsg}\n` +
          `${periodMsg}\n\n` +
          `Facturas generadas: ${subscription.invoicesUsed || 0}\n` +
          `Precio del plan: $${plan.price} ${plan.currency} / ${plan.billingPeriod === 'monthly' ? 'mes' : 'año'}\n\n` +
          `Tenant ID: ${tenantData.id}\n` +
          `API Key configurada: ${tenantData.facturapiApiKey ? '✅ Sí' : '❌ No'}\n` +
          `Organización FacturAPI: ${tenantData.facturapiOrganizationId || 'No configurada'}`,
        Markup.inlineKeyboard([
          // Mostrar botón de pago solo si la suscripción está inactiva o pendiente de pago
          ...(subscription.status === 'payment_pending' ||
          subscription.status === 'suspended' ||
          subscription.status === 'cancelled'
            ? [[Markup.button.callback('💰 Realizar Pago', 'generate_payment_link')]]
            : []),
          [Markup.button.callback('💳 Actualizar Plan', 'update_subscription')],
          [Markup.button.callback('↩️ Volver al Menú', 'menu_principal')],
        ])
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

    // Ejecutar directamente la lógica de consulta de suscripción
    if (!ctx.hasTenant()) {
      return ctx.reply(
        'Para ver información de suscripción, primero debes registrar tu empresa.\n\nUsa /registro para comenzar.'
      );
    }

    try {
      // Obtener información del tenant y su suscripción
      const tenantData = await TenantService.findTenantWithSubscription(ctx.userState.tenantId);

      if (!tenantData || !tenantData.subscriptions || tenantData.subscriptions.length === 0) {
        return ctx.reply(
          `❌ No se encontró información de suscripción para tu empresa: ${tenantData?.businessName || 'Desconocida'}.\n\n` +
            `Contacta a soporte para solucionar este problema.`
        );
      }

      const subscription = tenantData.subscriptions[0];
      const plan = subscription.plan || {
        name: 'Desconocido',
        price: 0,
        currency: 'MXN',
        billingPeriod: 'monthly',
      };

      console.log('Datos de suscripción recuperados:', {
        tenantId: tenantData.id,
        subscriptionCount: tenantData.subscriptions?.length || 0,
        invoicesUsed: subscription.invoicesUsed || 0,
      });

      // Formatear fechas
      const today = new Date();
      const trialEndsDate = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null;
      const currentPeriodEndsDate = subscription.currentPeriodEndsAt
        ? new Date(subscription.currentPeriodEndsAt)
        : null;

      const daysLeft =
        trialEndsDate && trialEndsDate > today
          ? Math.ceil((trialEndsDate - today) / (1000 * 60 * 60 * 24))
          : currentPeriodEndsDate && currentPeriodEndsDate > today
            ? Math.ceil((currentPeriodEndsDate - today) / (1000 * 60 * 60 * 24))
            : 0;

      // Determinar estado de la suscripción
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

      // Construcción del mensaje con valores corregidos
      await ctx.reply(
        `📊 Información de Suscripción\n\n` +
          `Empresa: ${tenantData.businessName}\n` +
          `Plan: ${plan.name}\n` +
          `Estado: ${statusEmoji} ${statusMsg}\n` +
          `${periodMsg}\n\n` +
          `Facturas generadas: ${subscription.invoicesUsed || 0}\n` +
          `Precio del plan: $${plan.price} ${plan.currency} / ${plan.billingPeriod === 'monthly' ? 'mes' : 'año'}\n\n` +
          `Tenant ID: ${tenantData.id}\n` +
          `API Key configurada: ${tenantData.facturapiApiKey ? '✅ Sí' : '❌ No'}\n` +
          `Organización FacturAPI: ${tenantData.facturapiOrganizationId || 'No configurada'}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('💳 Actualizar Plan', 'update_subscription')],
          [Markup.button.callback('↩️ Volver al Menú', 'menu_principal')],
        ])
      );
    } catch (error) {
      console.error('Error al obtener información de suscripción:', error);

      ctx.reply(
        `❌ Ocurrió un error al obtener la información de tu suscripción: ${error.message}\n\n` +
          `Por favor, intenta nuevamente más tarde o contacta a soporte.`
      );
    }
  });

  // Acción para generar un enlace de pago
  bot.action('generate_payment_link', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('⏳ Generando enlace de pago, por favor espere...');

    try {
      // Obtener el tenant ID
      const tenantId = ctx.userState.tenantId;

      // Generar el enlace de pago
      const paymentLink = await TenantService.generatePaymentLink(tenantId);

      if (paymentLink && paymentLink.url) {
        await ctx.reply(
          `🔗 Enlace de pago generado correctamente\n\n` +
            `Para reactivar tu suscripción, realiza el pago a través del siguiente enlace:\n\n` +
            `${paymentLink.url}\n\n` +
            `Una vez completado el pago, tu suscripción se actualizará automáticamente.`,
          Markup.inlineKeyboard([
            [Markup.button.url('💳 Realizar Pago', paymentLink.url)],
            [Markup.button.callback('↩️ Volver', 'menu_suscripcion')],
          ])
        );
      } else {
        throw new Error('No se pudo generar el enlace de pago');
      }
    } catch (error) {
      console.error('Error al generar enlace de pago:', error);
      await ctx.reply(
        `❌ Error al generar el enlace de pago: ${error.message}\n\n` +
          `Por favor, intenta nuevamente más tarde o contacta a soporte.`,
        Markup.inlineKeyboard([[Markup.button.callback('↩️ Volver', 'menu_suscripcion')]])
      );
    }
  });

  // Acción para actualizar suscripción - Temporalmente deshabilitada
  bot.action('update_subscription', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '🚧 **Actualización de Suscripción**\n\n' +
      'Esta funcionalidad está en desarrollo como parte de las mejoras del sistema de pagos.\n\n' +
      '📅 Próximamente estará disponible con nuevas opciones de pago y gestión avanzada de planes.\n\n' +
      '💡 Mientras tanto, puedes contactar a soporte para cambios urgentes.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Volver', 'menu_suscripcion')],
          [Markup.button.callback('📞 Contactar Soporte', 'contact_support')],
        ])
      }
    );
  });
}
