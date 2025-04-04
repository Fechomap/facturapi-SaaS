// bot/commands/admin.command.js
import prisma from '../../lib/prisma.js';
import { Markup } from 'telegraf';

/**
 * Registra comandos administrativos para recuperación y mantenimiento
 * @param {Object} bot - Instancia del bot
 */
export function registerAdminCommands(bot) {
  // Comando para mostrar información de un tenant
  bot.command('admin_tenant', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('⚠️ Uso: /admin_tenant [ID del tenant]');
    }
    
    const tenantId = args[1];
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          subscriptions: {
            include: { plan: true },
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          customers: {
            select: { id: true, legalName: true, facturapiCustomerId: true }
          }
        }
      });
      
      if (!tenant) {
        return ctx.reply(`❌ No se encontró tenant con ID: ${tenantId}`);
      }
      
      // Formatear y mostrar la información
      const info = `📋 *Información del Tenant*\n\n` +
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
          [Markup.button.callback('✅ Completar Setup', `admin_complete_setup_${tenantId}`)]
        ])
      });
    } catch (error) {
      console.error('Error al obtener información del tenant:', error);
      return ctx.reply(`❌ Error: ${error.message}`);
    }
  });
  
  // Acción para reconfigurar clientes
  bot.action(/admin_reset_customers_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const tenantId = ctx.match[1];
    
    try {
      await ctx.reply(`⏳ Reconfigurando clientes para tenant ${tenantId}...`);
      
      // Eliminar clientes existentes
      const deleteResult = await prisma.tenantCustomer.deleteMany({
        where: { tenantId }
      });
      
      await ctx.reply(`🗑️ Eliminados ${deleteResult.count} clientes antiguos.`);
      
      // Reconfigurar clientes
      const CustomerSetupService = await import('../../services/customer-setup.service.js');
      const setupResults = await CustomerSetupService.default.setupPredefinedCustomers(tenantId, true);
      
      const successCount = setupResults.filter(r => r.success).length;
      
      await ctx.reply(
        `✅ Proceso completado. Se configuraron ${successCount} nuevos clientes.\n\n` +
        `Resultados:\n` +
        setupResults.map(r => `• ${r.legalName}: ${r.success ? '✅' : '❌'} ${r.message || ''}`).join('\n')
      );
    } catch (error) {
      console.error('Error al reconfigurar clientes:', error);
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  });
  
  // Comando directo para reconfigurar clientes
  bot.command('admin_reset_customers', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('⚠️ Uso: /admin_reset_customers [ID del tenant]');
    }
    
    const tenantId = args[1];
    try {
      // Mismo código que el action handler
      await ctx.reply(`⏳ Reconfigurando clientes para tenant ${tenantId}...`);
      
      // Eliminar clientes existentes
      const deleteResult = await prisma.tenantCustomer.deleteMany({
        where: { tenantId }
      });
      
      await ctx.reply(`🗑️ Eliminados ${deleteResult.count} clientes antiguos.`);
      
      // Reconfigurar clientes
      const CustomerSetupService = await import('../../services/customer-setup.service.js');
      const setupResults = await CustomerSetupService.default.setupPredefinedCustomers(tenantId, true);
      
      const successCount = setupResults.filter(r => r.success).length;
      
      await ctx.reply(
        `✅ Proceso completado. Se configuraron ${successCount} nuevos clientes.\n\n` +
        `Resultados:\n` +
        setupResults.map(r => `• ${r.legalName}: ${r.success ? '✅' : '❌'} ${r.message || ''}`).join('\n')
      );
    } catch (error) {
      console.error('Error al reconfigurar clientes:', error);
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  });
  
  // Comando para completar setup de producción
  bot.command('admin_complete_setup', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('⚠️ Uso: /admin_complete_setup [ID del tenant]');
    }
    
    const tenantId = args[1];
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId }
      });
      
      if (!tenant) {
        return ctx.reply(`❌ No se encontró tenant con ID: ${tenantId}`);
      }
      
      // Verificar si ya está en modo producción basado en el formato de la API key
      const isLiveKey = tenant.facturapiApiKey && tenant.facturapiApiKey.startsWith('sk_live_');
      if (isLiveKey) {
        return ctx.reply(`⚠️ El tenant ya está en modo producción. ¿Deseas reconfigurar los clientes?`, 
          Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Reconfigurar Clientes', `admin_reset_customers_${tenantId}`)]
          ])
        );
      }
      
      // Verificar que tenga API key y organización
      if (!tenant.facturapiOrganizationId) {
        return ctx.reply(`❌ El tenant no tiene una organización configurada en FacturAPI.`);
      }
      
      await ctx.reply(`⏳ Completando setup de producción para tenant ${tenantId}...`);
      
      // Importamos la función para renovar la API key
      const { renewFacturapiLiveKey } = await import('../../bot/handlers/production-setup.handler.js');
      
      // Renovar API Key Live
      const apiKeyLive = await renewFacturapiLiveKey(tenant.facturapiOrganizationId);
      
      if (!apiKeyLive) {
        return ctx.reply(`❌ No se pudo obtener la API Key de producción.`);
      }
      
      // Actualizar tenant en BD
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          facturapiApiKey: apiKeyLive
        }
      });
      
      await ctx.reply(`✅ Tenant actualizado a modo producción. Reconfigurando clientes...`);
      
      // Reconfigurar clientes
      // Eliminar clientes existentes
      const deleteResult = await prisma.tenantCustomer.deleteMany({
        where: { tenantId }
      });
      
      // Reconfigurar clientes
      const CustomerSetupService = await import('../../services/customer-setup.service.js');
      const setupResults = await CustomerSetupService.default.setupPredefinedCustomers(tenantId, true);
      
      const successCount = setupResults.filter(r => r.success).length;
      
      await ctx.reply(
        `✅ Proceso completado exitosamente.\n\n` +
        `• Tenant configurado en modo producción\n` +
        `• API Key Live renovada y configurada\n` +
        `• ${successCount} clientes configurados con la nueva API key`
      );
    } catch (error) {
      console.error('Error al completar setup de producción:', error);
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  });
  
  // Comando para reparar estado de sesión
  bot.command('admin_fix_session', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('⚠️ Uso: /admin_fix_session [Telegram ID]');
    }
    
    const telegramId = args[1];
    try {
      // Obtener la sesión actual
      const session = await prisma.userSession.findUnique({
        where: { telegramId: BigInt(telegramId) }
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
            [Markup.button.callback('🔙 Volver', 'admin_help')]
          ])
        }
      );
    } catch (error) {
      console.error('Error al reparar sesión:', error);
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  });
  
  // Acción para reiniciar sesión
  bot.action(/admin_reset_session_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.match[1];
    
    try {
      // Obtener información necesaria para preservar
      const currentSession = await prisma.userSession.findUnique({
        where: { telegramId: BigInt(telegramId) }
      });
      
      if (!currentSession) {
        return ctx.reply(`❌ No se encontró sesión para el usuario con Telegram ID: ${telegramId}`);
      }
      
      // Extraer información crítica a preservar
      const { tenantId, tenantName, userStatus } = currentSession.sessionData;
      
      // Crear una sesión limpia preservando información crítica
      const newSessionData = {
        tenantId,
        tenantName,
        userStatus,
        esperando: null
      };
      
      // Actualizar la sesión
      await prisma.userSession.update({
        where: { telegramId: BigInt(telegramId) },
        data: {
          sessionData: newSessionData,
          updatedAt: new Date()
        }
      });
      
      await ctx.reply(
        `✅ Sesión reiniciada exitosamente.\n\n` +
        `El usuario puede continuar normalmente sus actividades.`
      );
    } catch (error) {
        console.error('Error al reiniciar sesión:', error);
        await ctx.reply(`❌ Error: ${error.message}`);
      }
    });
    
    // Comando para mostrar estado del servidor
    bot.command('admin_status', async (ctx) => {
      try {
        const stats = {
          tenants: await prisma.tenant.count(),
          users: await prisma.tenantUser.count(),
          activeSessions: await prisma.userSession.count(),
          customers: await prisma.tenantCustomer.count(),
          invoices: await prisma.tenantInvoice.count(),
          memory: process.memoryUsage(),
          uptime: process.uptime()
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
        console.error('Error al obtener estado:', error);
        await ctx.reply(`❌ Error: ${error.message}`);
      }
    });
   }
