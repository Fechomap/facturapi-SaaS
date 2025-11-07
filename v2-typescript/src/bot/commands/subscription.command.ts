import type { BotContext } from '../../types/bot.types.js';
import type { Bot } from '../../types/bot.types.js';
import { Markup } from 'telegraf';
import { createModuleLogger } from '@core/utils/logger.js';
import TenantService from '../../services/tenant.service.js';

const logger = createModuleLogger('subscription-command');

interface SubscriptionData {
  id: string;
  businessName: string;
  rfc: string;
  facturapiApiKey: string | null;
  facturapiOrganizationId: string | null;
  subscriptions: Array<{
    status: string;
    trialEndsAt: Date | null;
    currentPeriodEndsAt: Date | null;
    plan: {
      name: string;
      price: any; // Prisma Decimal
      currency: string;
      billingPeriod: string;
    } | null;
  }>;
}

/**
 * Formatea y muestra la información de suscripción
 */
async function showSubscriptionInfo(ctx: BotContext): Promise<void> {
  if (!ctx.hasTenant()) {
    await ctx.reply(
      'Para ver información de suscripción, primero debes registrar tu empresa.\n\nUsa /registro para comenzar.'
    );
    return;
  }

  try {
    // Obtener información del tenant y su suscripción
    const tenantData = (await TenantService.findTenantWithSubscription(
      ctx.userState.tenantId
    )) as unknown as SubscriptionData | null;

    if (!tenantData || !tenantData.subscriptions || tenantData.subscriptions.length === 0) {
      await ctx.reply(
        `❌ No se encontró información de suscripción para tu empresa: ${tenantData?.businessName || 'Desconocida'}.\n\n` +
          `Contacta a soporte para solucionar este problema.`
      );
      return;
    }

    const subscription = tenantData.subscriptions[0];
    const plan = subscription.plan || {
      name: 'Desconocido',
      price: 0,
      currency: 'MXN',
      billingPeriod: 'monthly',
    };

    // Calcular facturas emitidas reales (no el contador interno)
    const realInvoicesUsed = await TenantService.getTenantInvoiceCount(tenantData.id);

    logger.debug(
      {
        tenantId: tenantData.id,
        subscriptionCount: tenantData.subscriptions?.length || 0,
        invoicesUsed: realInvoicesUsed,
      },
      'Datos de suscripción recuperados'
    );

    // Formatear fechas
    const today = new Date();
    const trialEndsDate = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null;
    const currentPeriodEndsDate = subscription.currentPeriodEndsAt
      ? new Date(subscription.currentPeriodEndsAt)
      : null;

    const daysLeft =
      trialEndsDate && trialEndsDate > today
        ? Math.ceil((trialEndsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        : currentPeriodEndsDate && currentPeriodEndsDate > today
          ? Math.ceil((currentPeriodEndsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
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
        `Facturas emitidas: ${realInvoicesUsed}\n` +
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
    logger.error({ error }, 'Error al obtener información de suscripción');

    ctx.reply(
      `❌ Ocurrió un error al obtener la información de tu suscripción: ${error instanceof Error ? error.message : 'Error desconocido'}\n\n` +
        `Por favor, intenta nuevamente más tarde o contacta a soporte.`
    );
  }
}

/**
 * Registra el comando suscripcion (/suscripcion) y acciones relacionadas
 * @param bot - Instancia del bot
 */
export function registerSubscriptionCommand(bot: Bot): void {
  // Comando para ver información de suscripción
  bot.command('suscripcion', async (ctx: BotContext) => {
    await showSubscriptionInfo(ctx);
  });

  // Acción para el menú de suscripción
  bot.action('menu_suscripcion', async (ctx: BotContext) => {
    await ctx.answerCbQuery();
    await showSubscriptionInfo(ctx);
  });

  // Acción para generar un enlace de pago
  bot.action('generate_payment_link', async (ctx: BotContext) => {
    await ctx.answerCbQuery();
    await ctx.reply('⏳ Generando enlace de pago, por favor espere...');

    try {
      // Obtener el tenant ID
      const tenantId = ctx.userState.tenantId;

      // TODO: Implementar generatePaymentLink en TenantService
      // const paymentLink = await TenantService.generatePaymentLink(tenantId);

      // Temporalmente lanzar error hasta que se implemente la funcionalidad
      throw new Error('Funcionalidad de pago en desarrollo. Contacta a soporte para reactivar tu suscripción.');
    } catch (error) {
      logger.error({ error }, 'Error al generar enlace de pago');
      await ctx.reply(
        `❌ Error al generar el enlace de pago: ${error instanceof Error ? error.message : 'Error desconocido'}\n\n` +
          `Por favor, intenta nuevamente más tarde o contacta a soporte.`,
        Markup.inlineKeyboard([[Markup.button.callback('↩️ Volver', 'menu_suscripcion')]])
      );
    }
  });

  // Acción para actualizar suscripción - Temporalmente deshabilitada
  bot.action('update_subscription', async (ctx: BotContext) => {
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
        ]),
      }
    );
  });
}
