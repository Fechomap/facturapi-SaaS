import type { BotContext } from '../../types/bot.types.js';
import type { Bot } from '../../types/bot.types.js';
import { Markup } from 'telegraf';
import { createModuleLogger } from '@core/utils/logger.js';
import { mainMenu } from '../views/menu.view.js';

const logger = createModuleLogger('menu-command');

/**
 * Registra el comando menu (/menu) y acciones relacionadas
 * @param bot - Instancia del bot
 */
export async function registerMenuCommand(bot: Bot): Promise<void> {
  // Comando para menú principal
  bot.command('menu', async (ctx: BotContext) => {
    ctx.resetState();

    if (ctx.hasTenant()) {
      await ctx.reply('Selecciona una opción:', {
        parse_mode: 'Markdown',
        ...mainMenu(),
      });
    } else {
      await ctx.reply(
        'Para utilizar el sistema, primero debes crear una organización y luego registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Crear organización', 'create_organization')],
        ])
      );
    }
  });

  // Acción para el menú principal
  bot.action('menu_principal', async (ctx: BotContext) => {
    logger.debug({ userId: ctx.from?.id }, 'Acción menu_principal activada');

    await ctx.answerCbQuery('🔄 Actualizando...');

    // Guardar información importante del tenant antes de limpiar
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

    if (ctx.hasTenant()) {
      await ctx.editMessageText('Selecciona una opción:', {
        parse_mode: 'Markdown',
        ...mainMenu(),
      });
    } else {
      await ctx.editMessageText(
        'Para utilizar el sistema, primero debes crear una organización y luego registrar tu empresa.',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📝 Crear organización', 'create_organization')],
          ]),
        }
      );
    }
  });

  // Acción alternativa para volver al menú principal
  bot.action('volver_menu_principal', async (ctx: BotContext) => {
    await ctx.answerCbQuery();

    logger.debug({ userId: ctx.from?.id }, 'Acción volver_menu_principal activada');

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

    ctx.reply('Selecciona una opción:', mainMenu());
  });

  // Acción para menú de reportes
  bot.action('menu_reportes', async (ctx: BotContext) => {
    await ctx.answerCbQuery('📊 Cargando reportes...');

    if (!ctx.hasTenant()) {
      return ctx.editMessageText('Para ver reportes, primero debes registrar tu empresa.', {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrar empresa', 'start_registration')],
        ]),
      });
    }

    await ctx.editMessageText(
      '📊 *Reportes*\n\nSelecciona el tipo de reporte que deseas generar:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📅 Reporte de Facturas', 'reporte_facturas_action')],
          [Markup.button.callback('💾 Exportar a Excel', 'reporte_excel_action')],
          [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
        ]),
      }
    );
    return;
  });

  // Acción para generar reporte de facturas - Ejecuta directamente
  bot.action('reporte_facturas_action', async (ctx: BotContext) => {
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

      await ctx.reply(reportResult.formatted ?? 'No se pudo generar el reporte', {
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
      return;
    } catch (error) {
      logger.error({ error }, 'Error al generar reporte de facturas desde menú');
      await ctx.reply(
        `❌ Error al generar el reporte: ${error instanceof Error ? error.message : 'Error desconocido'}`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al menú', 'menu_principal')]])
      );
      return;
    }
  });

  // Acción para gestión de usuarios
  bot.action('menu_usuarios', async (ctx: BotContext) => {
    await ctx.answerCbQuery('👥 Cargando usuarios...');

    if (!ctx.hasTenant()) {
      return ctx.editMessageText('Para gestionar usuarios, primero debes registrar tu empresa.', {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrar empresa', 'start_registration')],
        ]),
      });
    }

    try {
      const tenantId = ctx.getTenantId();
      const MultiUserService = (await import('../../services/multi-user.service.js')).default;
      const users = await MultiUserService.getTenantUsers(tenantId);
      const stats = await MultiUserService.getTenantStats(tenantId);

      if (users.length === 0) {
        return ctx.editMessageText(
          '👥 *Usuarios*\n\n👥 No hay usuarios registrados en tu empresa.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('➕ Invitar Usuario', 'invite_user')],
              [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
            ]),
          }
        );
      }

      let message = `👥 *Usuarios de tu empresa* (${stats.total})\n\n`;
      message += `📊 *Estadísticas:*\n`;
      message += `• Autorizados: ${stats.authorized}\n`;
      message += `• Pendientes: ${stats.pending}\n`;
      message += `• Admins: ${stats.byRole?.admin || 0}\n`;
      message += `• Operadores: ${stats.byRole?.operator || 0}\n`;
      message += `• Viewers: ${stats.byRole?.viewer || 0}\n\n`;

      message += `👤 *Lista de usuarios:*\n`;
      users.forEach((user: any, index: number) => {
        const status = user.isAuthorized ? '✅' : '⏳';
        message += `${index + 1}. ${status} ${user.displayName}\n`;
        message += `   ID: ${user.telegramId} | Rol: ${user.role}\n`;
      });

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Invitar Usuario', 'invite_user')],
        [Markup.button.callback('⚙️ Gestionar', 'manage_users')],
        [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
      ]);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...keyboard,
      });
      return;
    } catch (error) {
      logger.error({ error }, 'Error al mostrar usuarios desde menú');
      await ctx.editMessageText('👥 *Usuarios*\n\n❌ Error al obtener la lista de usuarios.', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Reintentar', 'menu_usuarios')],
          [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
        ]),
      });
      return;
    }
  });

  // Importar y registrar handlers de Excel con filtros avanzados
  try {
    const { registerExcelReportHandlers } = await import('../handlers/excel-report.handler.js');
    registerExcelReportHandlers(bot);
    logger.info('Handlers de reportes Excel registrados');
  } catch (error) {
    logger.warn({ error }, 'No se pudieron registrar handlers de Excel (pueden no existir aún)');
  }

  logger.info('Comandos de menú registrados correctamente');
}
