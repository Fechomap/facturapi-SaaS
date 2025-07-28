// bot/commands/menu.command.js
import { Markup } from 'telegraf';
import { mainMenu, reportsMenu } from '../views/menu.view.js';

// Importar utilidades de limpieza de estado
import { cleanupFlowChange } from '../../core/utils/state-cleanup.utils.js';
import { USER_ROLES } from '../middlewares/multi-auth.middleware.js';

/**
 * Registra el comando menu (/menu) y acciones relacionadas
 * @param {Object} bot - Instancia del bot
 */
export async function registerMenuCommand(bot) {
  // Comando para menú principal
  bot.command('menu', (ctx) => {
    ctx.resetState();

    if (ctx.hasTenant()) {
      ctx.reply('Seleccione una opción:', mainMenu());
    } else {
      ctx.reply(
        'Para utilizar el sistema, primero debes crear una organización y luego registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Crear organización', 'create_organization')],
        ])
      );
    }
  });

  // Acción para el menú principal
  bot.action('menu_principal', (ctx) => {
    console.log('Acción menu_principal activada. Estado actual:', ctx.userState);

    // 🚀 OPTIMIZACIÓN: Limpieza básica al ir al menú principal
    cleanupFlowChange(ctx, 'menu');

    ctx.answerCbQuery();

    if (ctx.hasTenant()) {
      ctx.reply('Seleccione una opción:', mainMenu());
    } else {
      ctx.reply(
        'Para utilizar el sistema, primero debes crear una organización y luego registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Crear organización', 'create_organization')],
        ])
      );
    }
  });

  // Agregar acciones de menú adicionales según sea necesario
  bot.action('volver_menu_principal', async (ctx) => {
    await ctx.answerCbQuery();

    console.log('Acción volver_menu_principal activada. Estado actual:', ctx.userState);

    // 🚀 OPTIMIZACIÓN: Limpieza completa incluyendo pdfAnalysis
    cleanupFlowChange(ctx, 'menu');

    // Guardar información importante del tenant antes de resetear
    const tenantId = ctx.userState?.tenantId;
    const tenantName = ctx.userState?.tenantName;
    const userStatus = ctx.userState?.userStatus;

    // Limpiar datos específicos manteniendo información de tenant
    ctx.userState = {
      tenantId,
      tenantName,
      userStatus,
      esperando: null,
      ...(ctx.userState?.continueCustomerSetup ? { continueCustomerSetup: true } : {}),
    };

    ctx.reply('Seleccione una opción:', mainMenu());
  });

  bot.action('menu_reportes', async (ctx) => {
    await ctx.answerCbQuery();

    if (!ctx.hasTenant()) {
      return ctx.reply(
        'Para ver reportes, primero debes registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrar empresa', 'start_registration')],
        ])
      );
    }

    await ctx.reply(
      '📊 *Reportes y Análisis*\n\n' + 'Selecciona el tipo de reporte que deseas consultar:',
      {
        parse_mode: 'Markdown',
        ...reportsMenu(),
      }
    );
  });

  // Acción para generar reporte de facturas - Ejecuta directamente
  bot.action('reporte_facturas_action', async (ctx) => {
    await ctx.answerCbQuery();
    
    if (!ctx.hasTenant()) {
      return ctx.reply(
        'Para generar un reporte, primero debes registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrar empresa', 'start_registration')],
        ])
      );
    }

    try {
      await ctx.reply('⏳ Generando reporte mensual de facturación, por favor espera...');

      const tenantId = ctx.getTenantId();
      const ReportsService = (await import('../../services/reports.service.js')).default;

      // Usar fecha actual para el reporte
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth(); // 0-11

      const reportResult = await ReportsService.generateMonthlyInvoiceReport(tenantId, {
        year,
        month,
        format: 'text',
      });

      await ctx.reply(reportResult.formatted, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '📅 Ver mes anterior',
              `reporte_mes_${year}_${month - 1 >= 0 ? month - 1 : 11}`
            ),
          ],
          [Markup.button.callback('🔙 Volver al menú', 'menu_principal')],
        ]),
      });
    } catch (error) {
      console.error('Error al generar reporte de facturas desde menú:', error);
      await ctx.reply(
        `❌ Error al generar el reporte: ${error.message}`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al menú', 'menu_principal')]])
      );
    }
  });

  // ELIMINADO: Acción para generar reporte de suscripción (duplicidad con "Mi Suscripción")
  // La funcionalidad está disponible en el menú principal como "💳 Mi Suscripción"

  // FASE 2: Importar y registrar handlers de Excel con filtros avanzados
  const { registerExcelReportHandlers } = await import('../handlers/excel-report.handler.js');
  registerExcelReportHandlers(bot);

  // Acción para gestión de usuarios
  bot.action('menu_usuarios', async (ctx) => {
    await ctx.answerCbQuery();

    if (!ctx.hasTenant()) {
      return ctx.reply(
        'Para gestionar usuarios, primero debes registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrar empresa', 'start_registration')],
        ])
      );
    }

    // Ejecutar la misma lógica que el comando /usuarios
    try {
      const tenantId = ctx.getTenantId();
      const MultiUserService = (await import('../../services/multi-user.service.js')).default;
      const users = await MultiUserService.getTenantUsers(tenantId);
      const stats = await MultiUserService.getTenantStats(tenantId);

      if (users.length === 0) {
        return ctx.reply('👥 No hay usuarios registrados en tu empresa.');
      }

      let message = `👥 *Usuarios de tu empresa* (${stats.total})\n\n`;
      message += `📊 *Estadísticas:*\n`;
      message += `• Autorizados: ${stats.authorized}\n`;
      message += `• Pendientes: ${stats.pending}\n`;
      message += `• Admins: ${stats.byRole.admin || 0}\n`;
      message += `• Operadores: ${stats.byRole.operator || 0}\n`;
      message += `• Viewers: ${stats.byRole.viewer || 0}\n\n`;

      message += `👤 *Lista de usuarios:*\n`;
      users.forEach((user, index) => {
        const status = user.isAuthorized ? '✅' : '⏳';
        const roleEmoji = getRoleEmoji(user.role);
        message += `${index + 1}. ${status} ${roleEmoji} ${user.displayName}\n`;
        message += `   ID: ${user.telegramId} | Rol: ${user.role}\n`;
      });

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Invitar Usuario', 'invite_user')],
        [Markup.button.callback('⚙️ Gestionar', 'manage_users')],
        [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
      ]);

      ctx.reply(message, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      console.error('Error al mostrar usuarios desde menú:', error);
      ctx.reply('❌ Error al obtener la lista de usuarios.');
    }
  });
}

/**
 * Obtiene emoji para el rol
 */
function getRoleEmoji(role) {
  const emojis = {
    [USER_ROLES.ADMIN]: '👑',
    [USER_ROLES.OPERATOR]: '👤',
    [USER_ROLES.VIEWER]: '👁️',
  };
  return emojis[role] || '❓';
}
