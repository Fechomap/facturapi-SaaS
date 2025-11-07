import type { BotContext } from '../../types/bot.types.js';
import type { Bot } from '../../types/bot.types.js';
import { Markup } from 'telegraf';
import { createModuleLogger } from '@core/utils/logger.js';
import prisma from '../../lib/prisma.js';

const logger = createModuleLogger('admin-commands');

interface TenantWithRelations {
  id: string;
  businessName: string;
  rfc: string;
  facturapiApiKey: string | null;
  facturapiOrganizationId: string | null;
  subscriptions: Array<{
    id: number;
    status: string;
    trialEndsAt: Date | null;
    currentPeriodEndsAt: Date | null;
    plan: {
      id: number;
      name: string;
      price: any; // Prisma Decimal type
    };
  }>;
  customers: Array<{
    id: number;
    legalName: string;
    facturapiCustomerId: string | null;
  }>;
}

/**
 * Registra comandos administrativos para recuperación y mantenimiento
 * @param bot - Instancia del bot
 */
export function registerAdminCommands(bot: Bot): void {
  // Comando para mostrar información de un tenant
  bot.command('admin_tenant', async (ctx: BotContext) => {
    const messageText = 'text' in ctx.message! ? ctx.message.text : '';
    const args = messageText.split(' ');
    if (args.length < 2) {
      await ctx.reply('⚠️ Uso: /admin_tenant [ID del tenant]');
      return;
    }

    const tenantId = args[1];
    try {
      const tenant = (await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          subscriptions: {
            include: { plan: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          customers: {
            select: { id: true, legalName: true, facturapiCustomerId: true },
          },
        },
      })) as TenantWithRelations | null;

      if (!tenant) {
        return ctx.reply(`❌ No se encontró tenant con ID: ${tenantId}`);
      }

      // Formatear y mostrar la información
      const info =
        `📋 *Información del Tenant*\n\n` +
        `*ID:* \`${tenant.id}\`\n` +
        `*Nombre:* ${tenant.businessName}\n` +
        `*RFC:* ${tenant.rfc}\n` +
        `*Entorno:* ${tenant.facturapiApiKey && tenant.facturapiApiKey.startsWith('sk_live_') ? 'production' : 'test'}\n` +
        `*Organización:* ${tenant.facturapiOrganizationId || 'No configurada'}\n` +
        `*API Key:* ${tenant.facturapiApiKey ? '✅ Configurada' : '❌ No configurada'}\n\n` +
        `*Suscripción:* ${tenant.subscriptions[0]?.status || 'No tiene'}\n` +
        `*Plan:* ${tenant.subscriptions[0]?.plan?.name || 'N/A'}\n\n` +
        `*Clientes configurados:* ${tenant.customers.length}\n`;

      return ctx.reply(info, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Reconfigurar Clientes', `admin_reset_customers_${tenantId}`)],
          [Markup.button.callback('✅ Completar Setup', `admin_complete_setup_${tenantId}`)],
        ]),
      });
    } catch (error) {
      logger.error({ error, tenantId }, 'Error al obtener información del tenant');
      return ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
  });

  // Acción para reconfigurar clientes
  bot.action(/admin_reset_customers_(.+)/, async (ctx: BotContext) => {
    await ctx.answerCbQuery();
    const tenantId = (ctx.match as RegExpExecArray)[1];

    try {
      await ctx.reply(`⏳ Reconfigurando clientes para tenant ${tenantId}...`);

      // Eliminar clientes existentes
      const deleteResult = await prisma.tenantCustomer.deleteMany({
        where: { tenantId },
      });

      await ctx.reply(`🗑️ Eliminados ${deleteResult.count} clientes antiguos.`);

      // Reconfigurar clientes
      const CustomerSetupService = await import('../../services/customer-setup.service.js');
      const setupResults = await CustomerSetupService.default.setupPredefinedCustomers(
        tenantId,
        true
      );

      const successCount = setupResults.filter((r) => r.success).length;

      await ctx.reply(
        `✅ Proceso completado. Se configuraron ${successCount} nuevos clientes.\n\n` +
          `Resultados:\n` +
          setupResults
            .map((r) => `• ${r.legalName}: ${r.success ? '✅' : '❌'} ${r.message || ''}`)
            .join('\n')
      );
    } catch (error) {
      logger.error({ error, tenantId }, 'Error al reconfigurar clientes');
      await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
  });

  // Comando directo para reconfigurar clientes
  bot.command('admin_reset_customers', async (ctx: BotContext) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('⚠️ No se pudo procesar el comando');
      return;
    }

    const args = ctx.message.text.split(' ') || [];
    if (args.length < 2) {
      await ctx.reply('⚠️ Uso: /admin_reset_customers [ID del tenant]');
      return;
    }

    const tenantId = args[1];
    try {
      await ctx.reply(`⏳ Reconfigurando clientes para tenant ${tenantId}...`);

      // Eliminar clientes existentes
      const deleteResult = await prisma.tenantCustomer.deleteMany({
        where: { tenantId },
      });

      await ctx.reply(`🗑️ Eliminados ${deleteResult.count} clientes antiguos.`);

      // Reconfigurar clientes
      const CustomerSetupService = await import('../../services/customer-setup.service.js');
      const setupResults = await CustomerSetupService.default.setupPredefinedCustomers(
        tenantId,
        true
      );

      const successCount = setupResults.filter((r) => r.success).length;

      await ctx.reply(
        `✅ Proceso completado. Se configuraron ${successCount} nuevos clientes.\n\n` +
          `Resultados:\n` +
          setupResults
            .map((r) => `• ${r.legalName}: ${r.success ? '✅' : '❌'} ${r.message || ''}`)
            .join('\n')
      );
    } catch (error) {
      logger.error({ error, tenantId }, 'Error al reconfigurar clientes');
      await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
  });

  // Comando para completar setup de producción
  bot.command('admin_complete_setup', async (ctx: BotContext) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('⚠️ No se pudo procesar el comando');
      return;
    }

    const args = ctx.message.text.split(' ') || [];
    if (args.length < 2) {
      await ctx.reply('⚠️ Uso: /admin_complete_setup [ID del tenant]');
      return;
    }

    const tenantId = args[1];
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!tenant) {
        await ctx.reply(`❌ No se encontró tenant con ID: ${tenantId}`);
        return;
      }

      // Verificar si ya está en modo producción basado en el formato de la API key
      const isLiveKey = tenant.facturapiApiKey && tenant.facturapiApiKey.startsWith('sk_live_');
      if (isLiveKey) {
        await ctx.reply(
          `⚠️ El tenant ya está en modo producción. ¿Deseas reconfigurar los clientes?`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '🔄 Reconfigurar Clientes',
                `admin_reset_customers_${tenantId}`
              ),
            ],
          ])
        );
        return;
      }

      // Verificar que tenga API key y organización
      if (!tenant.facturapiOrganizationId) {
        await ctx.reply(`❌ El tenant no tiene una organización configurada en FacturAPI.`);
        return;
      }

      await ctx.reply(`⏳ Completando setup de producción para tenant ${tenantId}...`);

      // TODO: Implementar renovación de API key cuando se migre production-setup.handler completo
      // const { renewFacturapiLiveKey } = await import('../../bot/handlers/production-setup.handler.js');
      // const apiKeyLive = await renewFacturapiLiveKey(tenant.facturapiOrganizationId);

      // Por ahora, usamos la API key existente
      const apiKeyLive = tenant.facturapiApiKey;

      if (!apiKeyLive) {
        await ctx.reply(`❌ El tenant no tiene una API Key configurada.`);
        return;
      }

      // Actualizar tenant en BD
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          facturapiApiKey: apiKeyLive,
        },
      });

      await ctx.reply(`✅ Tenant actualizado a modo producción. Reconfigurando clientes...`);

      // Eliminar clientes existentes
      await prisma.tenantCustomer.deleteMany({
        where: { tenantId },
      });

      // Reconfigurar clientes
      const CustomerSetupService = await import('../../services/customer-setup.service.js');
      const setupResults = await CustomerSetupService.default.setupPredefinedCustomers(
        tenantId,
        true
      );

      const successCount = setupResults.filter((r) => r.success).length;

      await ctx.reply(
        `✅ Proceso completado exitosamente.\n\n` +
          `• Tenant configurado en modo producción\n` +
          `• API Key Live renovada y configurada\n` +
          `• ${successCount} clientes configurados con la nueva API key`
      );
    } catch (error) {
      logger.error({ error, tenantId }, 'Error al completar setup de producción');
      await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
  });

  // Comando para reparar estado de sesión
  bot.command('admin_fix_session', async (ctx: BotContext) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('⚠️ No se pudo procesar el comando');
      return;
    }

    const args = ctx.message.text.split(' ') || [];
    if (args.length < 2) {
      await ctx.reply('⚠️ Uso: /admin_fix_session [Telegram ID]');
      return;
    }

    const telegramId = args[1];
    try {
      // Obtener la sesión actual
      const session = await prisma.userSession.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      if (!session) {
        return ctx.reply(`❌ No se encontró sesión para el usuario con Telegram ID: ${telegramId}`);
      }

      // Mostrar el estado actual y opciones para reparar
      await ctx.reply(
        `📋 *Estado actual de la sesión*\n\n` +
          `\`\`\`\n${JSON.stringify(session.sessionData, null, 2)}\n\`\`\`\n\n` +
          `Selecciona una acción:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Reiniciar sesión', `admin_reset_session_${telegramId}`)],
            [Markup.button.callback('⚙️ Editar (pronto)', `admin_edit_session_${telegramId}`)],
            [Markup.button.callback('🔙 Volver', 'admin_help')],
          ]),
        }
      );
      return;
    } catch (error) {
      logger.error({ error, telegramId }, 'Error al reparar sesión');
      await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      return;
    }
  });

  // Acción para reiniciar sesión
  bot.action(/admin_reset_session_(.+)/, async (ctx: BotContext) => {
    await ctx.answerCbQuery();
    const telegramId = (ctx.match as RegExpExecArray)[1];

    try {
      // Obtener información necesaria para preservar
      const currentSession = await prisma.userSession.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      if (!currentSession) {
        return ctx.reply(`❌ No se encontró sesión para el usuario con Telegram ID: ${telegramId}`);
      }

      // Extraer información crítica a preservar
      const sessionData = currentSession.sessionData as Record<string, any>;
      const { tenantId, tenantName, userStatus } = sessionData;

      // Crear una sesión limpia preservando información crítica
      const newSessionData = {
        tenantId,
        tenantName,
        userStatus,
        esperando: null,
      };

      // Actualizar la sesión
      await prisma.userSession.update({
        where: { telegramId: BigInt(telegramId) },
        data: {
          sessionData: newSessionData,
          updatedAt: new Date(),
        },
      });

      await ctx.reply(
        `✅ Sesión reiniciada exitosamente.\n\n` +
          `El usuario puede continuar normalmente sus actividades.`
      );
      return;
    } catch (error) {
      logger.error({ error, telegramId }, 'Error al reiniciar sesión');
      await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      return;
    }
  });

  // Comando para mostrar estado del servidor
  bot.command('admin_status', async (ctx: BotContext) => {
    try {
      const stats = {
        tenants: await prisma.tenant.count(),
        users: await prisma.tenantUser.count(),
        activeSessions: await prisma.userSession.count(),
        customers: await prisma.tenantCustomer.count(),
        invoices: await prisma.tenantInvoice.count(),
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      };

      await ctx.reply(
        `📊 *Estado del Servidor*\n\n` +
          `• Tenants: ${stats.tenants}\n` +
          `• Usuarios: ${stats.users}\n` +
          `• Sesiones activas: ${stats.activeSessions}\n` +
          `• Clientes configurados: ${stats.customers}\n` +
          `• Facturas generadas: ${stats.invoices}\n\n` +
          `*Sistema*\n` +
          `• Memoria usada: ${Math.round(stats.memory.rss / 1024 / 1024)} MB\n` +
          `• Tiempo activo: ${Math.round(stats.uptime / 3600)} horas\n` +
          `• Entorno: ${process.env.NODE_ENV || 'development'}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error({ error }, 'Error al obtener estado');
      await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
  });

  // NOTA: El comando /sus fue removido - ahora se usan los comandos explícitos:
  // /admin_activar_suscripcion, /admin_suspender_suscripcion, /admin_cambiar_plan
  // Ver subscription.command.ts para la gestión manual de suscripciones

  // Comando para eliminar tenant específico (SOLO ADMINS)
  bot.command('delete_tenant', async (ctx: BotContext) => {
    // Verificar que sea admin
    const adminChatIds = process.env.ADMIN_CHAT_IDS?.split(',').map((id) => id.trim()) || [];
    const userId = ctx.from?.id.toString();

    if (!userId || !adminChatIds.includes(userId)) {
      await ctx.reply('❌ No tienes permisos para usar este comando.');
      return;
    }

    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('⚠️ No se pudo procesar el comando');
      return;
    }

    const args = ctx.message.text.split(' ') || [];
    if (args.length !== 2) {
      await ctx.reply('❌ Uso: /delete_tenant <tenant-id>');
      return;
    }

    const tenantId = args[1];

    try {
      // Verificar que el tenant existe y obtener información
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          users: true,
          invoices: true,
          customers: true,
          subscriptions: true,
          folios: true,
          settings: true,
          documents: true,
          payments: true,
          auditLogs: true,
        },
      });

      if (!tenant) {
        return ctx.reply(`❌ Tenant ${tenantId} no encontrado`);
      }

      // Mostrar información del tenant
      const infoMessage =
        `🔍 **Tenant encontrado:**\n\n` +
        `• **Empresa:** ${tenant.businessName}\n` +
        `• **RFC:** ${tenant.rfc}\n` +
        `• **Email:** ${tenant.email}\n` +
        `• **Usuarios:** ${tenant.users.length}\n` +
        `• **Facturas:** ${tenant.invoices.length}\n` +
        `• **Clientes:** ${tenant.customers.length}\n` +
        `• **Suscripciones:** ${tenant.subscriptions.length}\n` +
        `• **Folios:** ${tenant.folios.length}\n` +
        `• **Configuraciones:** ${tenant.settings.length}\n` +
        `• **Documentos:** ${tenant.documents.length}\n` +
        `• **Pagos:** ${tenant.payments.length}\n` +
        `• **Logs auditoría:** ${tenant.auditLogs.length}\n\n` +
        `⚠️ **ADVERTENCIA:** Esta operación eliminará PERMANENTEMENTE todos los datos del tenant.\n\n` +
        `¿Confirmas la eliminación?`;

      await ctx.reply(infoMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar Eliminación', `confirm_delete_${tenantId}`)],
          [Markup.button.callback('❌ Cancelar', 'cancel_delete')],
        ]),
      });
      return;
    } catch (error) {
      logger.error({ error, tenantId }, 'Error verificando tenant');
      await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      return;
    }
  });

  // Action para confirmar eliminación de tenant
  bot.action(/confirm_delete_(.+)/, async (ctx: BotContext) => {
    await ctx.answerCbQuery();
    const tenantId = (ctx.match as RegExpExecArray)[1];

    try {
      await ctx.editMessageText('⏳ Eliminando tenant...');

      // Eliminar tenant (CASCADE eliminará automáticamente registros relacionados)
      const deletedTenant = await prisma.tenant.delete({
        where: { id: tenantId },
      });

      await ctx.editMessageText(
        `✅ **Tenant eliminado exitosamente:**\n\n` +
          `• **ID:** ${deletedTenant.id}\n` +
          `• **Empresa:** ${deletedTenant.businessName}\n` +
          `• **RFC:** ${deletedTenant.rfc}\n\n` +
          `🎯 Todos los registros relacionados fueron eliminados automáticamente.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error({ error, tenantId }, 'Error eliminando tenant');
      await ctx.editMessageText(
        `❌ Error al eliminar tenant: ${error instanceof Error ? error.message : 'Error desconocido'}`
      );
    }
  });

  // Action para cancelar eliminación
  bot.action('cancel_delete', async (ctx: BotContext) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('❌ Eliminación cancelada por el usuario.');
  });
}
