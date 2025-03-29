// bot/commands/report.command.js
import { Markup } from 'telegraf';
import ReportsService from '../../services/reports.service.js';
import logger from '../../core/utils/logger.js';

// Logger específico para comandos de reportes
const reportsCommandLogger = logger.child({ module: 'report-commands' });

/**
 * Registra comandos relacionados con reportes
 * @param {Object} bot - Instancia del bot
 */
export function registerReportCommands(bot) {
  // Comando para generar reporte de facturación mensual
  bot.command('reporte_facturas', async (ctx) => {
    if (!ctx.hasTenant()) {
      return ctx.reply(
        'Para generar un reporte, primero debes registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrar empresa', 'start_registration')]
        ])
      );
    }
    
    try {
      await ctx.reply('⏳ Generando reporte mensual de facturación, por favor espera...');
      
      const tenantId = ctx.getTenantId();
      
      // Usar fecha actual para el reporte
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth(); // 0-11
      
      const reportResult = await ReportsService.generateMonthlyInvoiceReport(tenantId, {
        year,
        month,
        format: 'text'
      });
      
      await ctx.reply(
        reportResult.formatted,
        { 
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📅 Ver mes anterior', `reporte_mes_${year}_${month-1 >= 0 ? month-1 : 11}`)],
            [Markup.button.callback('🔙 Volver al menú', 'menu_principal')]
          ])
        }
      );
      
    } catch (error) {
      reportsCommandLogger.error({ error }, 'Error al generar reporte de facturas');
      await ctx.reply(
        `❌ Error al generar el reporte: ${error.message}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Volver al menú', 'menu_principal')]
        ])
      );
    }
  });
  
  // Acción para ver reporte de mes específico
  bot.action(/reporte_mes_(\d+)_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    
    if (!ctx.hasTenant()) {
      return ctx.reply('Para generar un reporte, primero debes registrar tu empresa.');
    }
    
    try {
      const year = parseInt(ctx.match[1]);
      const month = parseInt(ctx.match[2]);
      
      await ctx.reply(`⏳ Generando reporte para ${month+1}/${year}, por favor espera...`);
      
      const tenantId = ctx.getTenantId();
      const reportResult = await ReportsService.generateMonthlyInvoiceReport(tenantId, {
        year,
        month,
        format: 'text'
      });
      
      // Calcular mes anterior y mes siguiente
      const prevMonth = month-1 >= 0 ? month-1 : 11;
      const prevYear = month-1 >= 0 ? year : year-1;
      
      const nextMonth = month+1 <= 11 ? month+1 : 0;
      const nextYear = month+1 <= 11 ? year : year+1;
      
      // No mostrar meses futuros
      const now = new Date();
      const isFutureMonth = (year > now.getFullYear()) || 
                          (year === now.getFullYear() && month > now.getMonth());
      
      const buttons = [];
      buttons.push([Markup.button.callback('⬅️ Mes anterior', `reporte_mes_${prevYear}_${prevMonth}`)]);
      
      if (!isFutureMonth) {
        buttons.push([Markup.button.callback('➡️ Mes siguiente', `reporte_mes_${nextYear}_${nextMonth}`)]);
      }
      
      buttons.push([Markup.button.callback('🔙 Volver al menú', 'menu_principal')]);
      
      await ctx.reply(
        reportResult.formatted,
        { 
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons)
        }
      );
      
    } catch (error) {
      reportsCommandLogger.error({ error }, 'Error al generar reporte de mes específico');
      await ctx.reply(
        `❌ Error al generar el reporte: ${error.message}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Volver al menú', 'menu_principal')]
        ])
      );
    }
  });
  
  // Comando para ver reporte de suscripción
  bot.command('reporte_suscripcion', async (ctx) => {
    if (!ctx.hasTenant()) {
      return ctx.reply('Para generar un reporte, primero debes registrar tu empresa.');
    }
    
    try {
      await ctx.reply('⏳ Generando reporte de suscripción, por favor espera...');
      
      const tenantId = ctx.getTenantId();
      const reportResult = await ReportsService.generateSubscriptionReport(tenantId, {
        format: 'text'
      });
      
      await ctx.reply(
        reportResult.formatted,
        { 
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💳 Actualizar suscripción', 'menu_suscripcion')],
            [Markup.button.callback('🔙 Volver al menú', 'menu_principal')]
          ])
        }
      );
      
    } catch (error) {
      reportsCommandLogger.error({ error }, 'Error al generar reporte de suscripción');
      await ctx.reply(
        `❌ Error al generar el reporte: ${error.message}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Volver al menú', 'menu_principal')]
        ])
      );
    }
  });
  
  // Comando de administrador para enviar reportes a todos los tenants
  bot.command('admin_enviar_reportes', async (ctx) => {
    // Verificar si es administrador (usando los chat IDs de admin configurados)
    const ADMIN_CHAT_IDS = process.env.ADMIN_CHAT_IDS ? 
                          process.env.ADMIN_CHAT_IDS.split(',').map(id => BigInt(id.trim())) : 
                          [];
    
    if (!ADMIN_CHAT_IDS.includes(BigInt(ctx.from.id))) {
      return ctx.reply('⛔ Este comando es solo para administradores.');
    }
    
    try {
      await ctx.reply('⏳ Preparando envío de reportes mensuales a todos los tenants...');
      
      // Obtener todos los tenants activos
      const tenants = await prisma.tenant.findMany({
        where: { isActive: true }
      });
      
      await ctx.reply(`📊 Enviando reportes a ${tenants.length} tenants activos...`);
      
      // Variable para almacenar resultados
      const results = {
        total: tenants.length,
        success: 0,
        failed: 0,
        details: []
      };
      
      // Enviar reportes en paralelo con límite de concurrencia
      const BATCH_SIZE = 5;
      for (let i = 0; i < tenants.length; i += BATCH_SIZE) {
        const batch = tenants.slice(i, i + BATCH_SIZE);
        
        // Procesar batch en paralelo
        const batchResults = await Promise.allSettled(
          batch.map(async (tenant) => {
            try {
              return await ReportsService.sendReportByTelegram(
                tenant.id,
                'monthly_invoice',
                { 
                  // Usar mes anterior para el reporte mensual
                  year: new Date().getFullYear(),
                  month: new Date().getMonth() - 1 >= 0 ? new Date().getMonth() - 1 : 11
                }
              );
            } catch (error) {
              return { 
                success: false, 
                error: error.message,
                tenant: {
                  id: tenant.id,
                  name: tenant.businessName
                }
              };
            }
          })
        );
        
        // Procesar resultados del batch
        batchResults.forEach((result, index) => {
          const tenant = batch[index];
          if (result.status === 'fulfilled' && result.value.success) {
            results.success++;
            results.details.push({
              tenantId: tenant.id,
              businessName: tenant.businessName,
              success: true,
              recipients: result.value.successCount
            });
          } else {
            results.failed++;
            results.details.push({
              tenantId: tenant.id,
              businessName: tenant.businessName,
              success: false,
              error: result.reason?.message || 'Error desconocido'
            });
          }
        });
        
        // Informar progreso cada batch
        await ctx.reply(
          `✅ Progreso: ${i + batch.length}/${tenants.length} tenants procesados`
        );
      }
      
      // Informe final
      await ctx.reply(
        `📊 *Resumen de envío de reportes*\n\n` +
        `• Total tenants: ${results.total}\n` +
        `• Reportes enviados: ${results.success}\n` +
        `• Reportes fallidos: ${results.failed}\n\n` +
        
        `Detalles de los errores:\n` +
        results.details
          .filter(d => !d.success)
          .slice(0, 10) // Limitar a 10 errores para no saturar el mensaje
          .map(d => `• ${d.businessName}: ${d.error}`)
          .join('\n') +
        (results.failed > 10 ? `\n... y ${results.failed - 10} más.` : ''),
        { parse_mode: 'Markdown' }
      );
      
    } catch (error) {
      reportsCommandLogger.error({ error }, 'Error al enviar reportes masivos');
      await ctx.reply(
        `❌ Error al enviar reportes: ${error.message}`
      );
    }
  });
  
  console.log('✅ Comandos de reportes registrados correctamente');
}