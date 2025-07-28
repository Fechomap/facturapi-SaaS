// bot/commands/menu.command.js
import { Markup } from 'telegraf';
import { 
  mainMenu, 
  reportsMenu, 
  loadingMainMenus, 
  enhancedMainMenu, 
  enhancedReportsMenu 
} from '../views/menu.view.js';
import {
  MenuStateManager,
  MenuTransitionUtils,
  LoadingStates,
  ActionFeedback,
} from '../utils/menu-transition.utils.js';

// Importar utilidades de limpieza de estado
import { cleanupFlowChange } from '../../core/utils/state-cleanup.utils.js';
import { USER_ROLES } from '../middlewares/multi-auth.middleware.js';

/**
 * Registra el comando menu (/menu) y acciones relacionadas
 * @param {Object} bot - Instancia del bot
 */
export async function registerMenuCommand(bot) {
  // Comando para menú principal
  bot.command('menu', async (ctx) => {
    ctx.resetState();

    // Inicializar gestor de menús
    const menuManager = new MenuStateManager(ctx);
    menuManager.pushMenu('main', {});

    if (ctx.hasTenant()) {
      // Mostrar con transición suave
      const mainMenuView = enhancedMainMenu();
      await ctx.reply(mainMenuView.text, {
        parse_mode: 'Markdown',
        ...mainMenuView.markup
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
  bot.action('menu_principal', async (ctx) => {
    console.log('Acción menu_principal activada. Estado actual:', ctx.userState);

    await ctx.answerCbQuery(ActionFeedback.UPDATED);

    // 🚀 OPTIMIZACIÓN: Limpieza básica al ir al menú principal
    cleanupFlowChange(ctx, 'menu');

    // Inicializar gestor de menús
    const menuManager = new MenuStateManager(ctx);
    menuManager.pushMenu('main', {});

    if (ctx.hasTenant()) {
      // Transición suave al menú principal
      const mainMenuView = enhancedMainMenu();
      
      await MenuTransitionUtils.smoothTransition(
        ctx,
        loadingMainMenus().main().text,
        mainMenuView.text,
        mainMenuView.markup,
        300
      );
    } else {
      await MenuTransitionUtils.smoothTransition(
        ctx,
        LoadingStates.UPDATING,
        'Para utilizar el sistema, primero debes crear una organización y luego registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Crear organización', 'create_organization')],
        ]),
        200
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
    await ctx.answerCbQuery(ActionFeedback.SELECTED);

    if (!ctx.hasTenant()) {
      return MenuTransitionUtils.smoothTransition(
        ctx,
        LoadingStates.UPDATING,
        'Para ver reportes, primero debes registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrar empresa', 'start_registration')],
        ]),
        200
      );
    }

    // Inicializar gestor de menús
    const menuManager = new MenuStateManager(ctx);
    menuManager.pushMenu('reports', {});

    // Transición suave al menú de reportes con breadcrumb
    const reportsMenuView = enhancedReportsMenu();
    
    await MenuTransitionUtils.smoothTransition(
      ctx,
      loadingMainMenus().reports().text,
      reportsMenuView.text,
      reportsMenuView.markup,
      400
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

  // ============================================
  // OTROS MENÚS PRINCIPALES CON TRANSICIONES
  // ============================================

  // NOTA: Los handlers originales menu_generar, menu_consultar, menu_suscripcion y configure_clients
  // están definidos en sus respectivos archivos de handlers (invoice.handler.js, client.handler.js, etc.)
  // NO los redefinimos aquí para evitar conflictos

  // ============================================
  // NAVEGACIÓN CON HISTORIAL GLOBAL
  // ============================================

  // Handler universal para volver atrás
  bot.action('menu_back', async (ctx) => {
    await ctx.answerCbQuery('⬅️ Volviendo...');

    const menuManager = new MenuStateManager(ctx);
    const previousMenu = menuManager.popMenu();

    if (previousMenu) {
      // Mapear IDs de menú a acciones
      const menuActions = {
        'main': 'menu_principal',
        'reports': 'menu_reportes', 
        'users': 'menu_usuarios',
        'invoices': 'menu_generar',
        'query': 'menu_consultar',
        'subscription': 'menu_suscripcion',
        'clients': 'configure_clients',
        'excel_options': 'reporte_excel_action',
        'excel_dates': 'excel_filter_date',
        'excel_clients': 'excel_filter_clients'
      };

      const targetAction = menuActions[previousMenu.id] || 'menu_principal';
      
      // Ejecutar la acción correspondiente directamente
      try {
        if (targetAction === 'menu_principal') {
          return bot.action('menu_principal')(ctx);
        } else if (targetAction === 'menu_reportes') {
          return bot.action('menu_reportes')(ctx);
        } else {
          // Para otros casos, ir al menú principal como fallback
          return bot.action('menu_principal')(ctx);
        }
      } catch (error) {
        console.error('Error en navegación hacia atrás:', error);
        return bot.action('menu_principal')(ctx);
      }
    } else {
      // Sin historial, ir al menú principal
      return bot.action('menu_principal')(ctx);
    }
  });

  // NOTA: El botón "🔙 Volver al Menú" de la selección de clientes 
  // usa la acción 'menu_principal' que ya tiene transiciones implementadas arriba

  // FASE 2: Importar y registrar handlers de Excel con filtros avanzados
  const { registerExcelReportHandlers } = await import('../handlers/excel-report.handler.js');
  registerExcelReportHandlers(bot);

  // Acción para gestión de usuarios
  bot.action('menu_usuarios', async (ctx) => {
    await ctx.answerCbQuery(ActionFeedback.SELECTED);

    if (!ctx.hasTenant()) {
      return MenuTransitionUtils.smoothTransition(
        ctx,
        LoadingStates.UPDATING,
        'Para gestionar usuarios, primero debes registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrar empresa', 'start_registration')],
        ]),
        200
      );
    }

    // Inicializar gestor de menús
    const menuManager = new MenuStateManager(ctx);
    menuManager.pushMenu('users', {});

    try {
      // Mostrar estado de carga
      const loadingMenu = loadingMainMenus().users();
      await ctx.editMessageText(loadingMenu.text, {
        parse_mode: 'Markdown',
        ...loadingMenu.markup
      });

      // Ejecutar la misma lógica que el comando /usuarios
      const tenantId = ctx.getTenantId();
      const MultiUserService = (await import('../../services/multi-user.service.js')).default;
      const users = await MultiUserService.getTenantUsers(tenantId);
      const stats = await MultiUserService.getTenantStats(tenantId);

      if (users.length === 0) {
        return MenuTransitionUtils.smoothTransition(
          ctx,
          loadingMenu.text,
          '🏠 Menú Principal → 👥 **Usuarios**\n\n👥 No hay usuarios registrados en tu empresa.',
          Markup.inlineKeyboard([
            [Markup.button.callback('➕ Invitar Usuario', 'invite_user')],
            [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
          ]),
          300
        );
      }

      let message = `🏠 Menú Principal → 👥 **Usuarios de tu empresa** (${stats.total})\n\n`;
      message += `📊 **Estadísticas:**\n`;
      message += `• Autorizados: ${stats.authorized}\n`;
      message += `• Pendientes: ${stats.pending}\n`;
      message += `• Admins: ${stats.byRole.admin || 0}\n`;
      message += `• Operadores: ${stats.byRole.operator || 0}\n`;
      message += `• Viewers: ${stats.byRole.viewer || 0}\n\n`;

      message += `👤 **Lista de usuarios:**\n`;
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

      await MenuTransitionUtils.smoothTransition(
        ctx,
        loadingMenu.text,
        message,
        keyboard,
        400
      );
    } catch (error) {
      console.error('Error al mostrar usuarios desde menú:', error);
      await MenuTransitionUtils.smoothTransition(
        ctx,
        loadingMainMenus().users().text,
        '🏠 Menú Principal → 👥 **Usuarios**\n\n❌ Error al obtener la lista de usuarios.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Reintentar', 'menu_usuarios')],
          [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
        ]),
        200
      );
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
