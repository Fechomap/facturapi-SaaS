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
    let message =
      `📊 Información de Suscripción\n\n` +
      `Empresa: ${tenantData.businessName}\n` +
      `Plan: ${plan.name}\n` +
      `Estado: ${statusEmoji} ${statusMsg}\n` +
      `${periodMsg}\n\n` +
      `Facturas emitidas: ${realInvoicesUsed}\n` +
      `Precio del plan: $${plan.price} ${plan.currency} / ${plan.billingPeriod === 'monthly' ? 'mes' : 'año'}\n\n` +
      `Tenant ID: ${tenantData.id}\n` +
      `API Key configurada: ${tenantData.facturapiApiKey ? '✅ Sí' : '❌ No'}\n` +
      `Organización FacturAPI: ${tenantData.facturapiOrganizationId || 'No configurada'}`;

    // Agregar nota de soporte si la suscripción está suspendida o cancelada
    if (
      subscription.status === 'payment_pending' ||
      subscription.status === 'suspended' ||
      subscription.status === 'cancelled'
    ) {
      message += `\n\n💡 Para reactivar o renovar tu suscripción, contacta a soporte.`;
    }

    await ctx.reply(
      message,
      Markup.inlineKeyboard([
        // NOTA: Botones de pago deshabilitados - gestión manual de suscripciones
        // Para activar o renovar tu suscripción, contacta a soporte
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
      throw new Error(
        'Funcionalidad de pago en desarrollo. Contacta a soporte para reactivar tu suscripción.'
      );
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

  // ========== COMANDOS ADMINISTRATIVOS PARA GESTIÓN MANUAL ==========
  // Estos comandos están protegidos por el middleware multi-auth (solo admin)

  /**
   * /admin_activar_suscripcion <tenantId> <dias>
   * Activa o extiende la suscripción de un tenant por X días
   */
  bot.command('admin_activar_suscripcion', async (ctx: BotContext) => {
    // Verificar permisos de admin
    if (!ctx.userState?.role || ctx.userState.role !== 'admin') {
      await ctx.reply('❌ Este comando solo está disponible para administradores.');
      return;
    }

    const message = ctx.message && 'text' in ctx.message ? ctx.message : null;
    const args = message?.text?.split(' ').slice(1);
    if (!args || args.length < 2) {
      await ctx.reply(
        '📖 **Uso correcto:**\n' +
          '`/admin_activar_suscripcion <tenantId> <dias>`\n\n' +
          '**Ejemplo:**\n' +
          '`/admin_activar_suscripcion abc123 30`\n\n' +
          'Esto activará o extenderá la suscripción por 30 días.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const [tenantId, diasStr] = args;
    const dias = parseInt(diasStr, 10);

    if (isNaN(dias) || dias <= 0) {
      await ctx.reply('❌ El número de días debe ser un número positivo.');
      return;
    }

    try {
      const result = await TenantService.extendSubscription(tenantId, dias);

      if (result.success) {
        await ctx.reply(
          `✅ **Suscripción Activada**\n\n` +
            `Tenant: ${tenantId}\n` +
            `Días agregados: ${dias}\n` +
            `Nueva fecha de vencimiento: ${result.newEndDate ? new Date(result.newEndDate).toLocaleDateString() : 'N/A'}\n` +
            `Estado: ${result.newStatus || 'active'}`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.reply(`❌ Error: ${result.error || 'No se pudo activar la suscripción'}`);
      }
    } catch (error: unknown) {
      logger.error({ error, tenantId, dias }, 'Error en admin_activar_suscripcion');
      await ctx.reply(
        `❌ Error al activar suscripción: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  /**
   * /admin_suspender_suscripcion <tenantId>
   * Suspende la suscripción de un tenant
   */
  bot.command('admin_suspender_suscripcion', async (ctx: BotContext) => {
    // Verificar permisos de admin
    if (!ctx.userState?.role || ctx.userState.role !== 'admin') {
      await ctx.reply('❌ Este comando solo está disponible para administradores.');
      return;
    }

    const message = ctx.message && 'text' in ctx.message ? ctx.message : null;
    const args = message?.text?.split(' ').slice(1);
    if (!args || args.length < 1) {
      await ctx.reply(
        '📖 **Uso correcto:**\n' +
          '`/admin_suspender_suscripcion <tenantId>`\n\n' +
          '**Ejemplo:**\n' +
          '`/admin_suspender_suscripcion abc123`\n\n' +
          'Esto suspenderá la suscripción del tenant.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const tenantId = args[0];

    try {
      const result = await TenantService.suspendSubscription(tenantId);

      if (result.success) {
        await ctx.reply(
          `⚠️ **Suscripción Suspendida**\n\n` +
            `Tenant: ${tenantId}\n` +
            `Estado: suspended\n` +
            `Fecha: ${new Date().toLocaleDateString()}\n\n` +
            `El tenant tendrá acceso limitado hasta que se reactive la suscripción.`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.reply(`❌ Error: ${result.error || 'No se pudo suspender la suscripción'}`);
      }
    } catch (error: unknown) {
      logger.error({ error, tenantId }, 'Error en admin_suspender_suscripcion');
      await ctx.reply(
        `❌ Error al suspender suscripción: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  /**
   * /admin_cambiar_plan <tenantId> <planNombre>
   * Cambia el plan de suscripción de un tenant
   */
  bot.command('admin_cambiar_plan', async (ctx: BotContext) => {
    // Verificar permisos de admin
    if (!ctx.userState?.role || ctx.userState.role !== 'admin') {
      await ctx.reply('❌ Este comando solo está disponible para administradores.');
      return;
    }

    const message = ctx.message && 'text' in ctx.message ? ctx.message : null;
    const args = message?.text?.split(' ').slice(1);
    if (!args || args.length < 2) {
      await ctx.reply(
        '📖 **Uso correcto:**\n' +
          '`/admin_cambiar_plan <tenantId> <planNombre>`\n\n' +
          '**Planes disponibles:**\n' +
          '- `basico`\n' +
          '- `profesional`\n' +
          '- `empresarial`\n\n' +
          '**Ejemplo:**\n' +
          '`/admin_cambiar_plan abc123 profesional`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const [tenantId, planNombre] = args;
    const planesValidos = ['basico', 'profesional', 'empresarial'];

    if (!planesValidos.includes(planNombre.toLowerCase())) {
      await ctx.reply(
        `❌ Plan inválido: "${planNombre}"\n\n` + `Planes válidos: ${planesValidos.join(', ')}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    try {
      const result = await TenantService.changePlan(tenantId, planNombre.toLowerCase());

      if (result.success) {
        await ctx.reply(
          `✅ **Plan Cambiado**\n\n` +
            `Tenant: ${tenantId}\n` +
            `Nuevo plan: ${planNombre}\n` +
            `Fecha: ${new Date().toLocaleDateString()}\n\n` +
            `El cambio es efectivo inmediatamente.`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.reply(`❌ Error: ${result.error || 'No se pudo cambiar el plan'}`);
      }
    } catch (error: unknown) {
      logger.error({ error, tenantId, planNombre }, 'Error en admin_cambiar_plan');
      await ctx.reply(
        `❌ Error al cambiar plan: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  /**
   * /admin_ver_suscripcion <tenantId>
   * Ver detalles de la suscripción de un tenant
   */
  bot.command('admin_ver_suscripcion', async (ctx: BotContext) => {
    // Verificar permisos de admin
    if (!ctx.userState?.role || ctx.userState.role !== 'admin') {
      await ctx.reply('❌ Este comando solo está disponible para administradores.');
      return;
    }

    const message = ctx.message && 'text' in ctx.message ? ctx.message : null;
    const args = message?.text?.split(' ').slice(1);
    if (!args || args.length < 1) {
      await ctx.reply(
        '📖 **Uso correcto:**\n' +
          '`/admin_ver_suscripcion <tenantId>`\n\n' +
          '**Ejemplo:**\n' +
          '`/admin_ver_suscripcion abc123`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const tenantId = args[0];

    try {
      const tenantData = (await TenantService.findTenantWithSubscription(tenantId)) as any;

      if (!tenantData) {
        await ctx.reply(`❌ No se encontró el tenant: ${tenantId}`);
        return;
      }

      const subscription = tenantData.subscriptions?.[0];
      if (!subscription) {
        await ctx.reply(`❌ El tenant ${tenantId} no tiene suscripción activa.`);
        return;
      }

      const plan = subscription.plan || { name: 'Desconocido', price: 0 };

      await ctx.reply(
        `📊 **Información de Suscripción**\n\n` +
          `**Tenant:** ${tenantData.businessName} (${tenantId})\n` +
          `**Plan:** ${plan.name}\n` +
          `**Estado:** ${subscription.status}\n` +
          `**Precio:** $${plan.price} ${plan.currency || 'MXN'}\n` +
          `**Período:** ${plan.billingPeriod === 'monthly' ? 'Mensual' : 'Anual'}\n` +
          `**Finaliza:** ${subscription.currentPeriodEndsAt ? new Date(subscription.currentPeriodEndsAt).toLocaleDateString() : 'N/A'}\n` +
          `**API Key:** ${tenantData.facturapiApiKey ? '✅ Configurada' : '❌ No configurada'}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error: unknown) {
      logger.error({ error, tenantId }, 'Error en admin_ver_suscripcion');
      await ctx.reply(
        `❌ Error al obtener información: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}
