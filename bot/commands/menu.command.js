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
export function registerMenuCommand(bot) {
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

  // Acción para generar reporte de facturas
  bot.action('reporte_facturas_action', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.telegram.sendMessage(ctx.chat.id, '/reporte_facturas');
  });

  // Acción para generar reporte de suscripción
  bot.action('reporte_suscripcion_action', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.telegram.sendMessage(ctx.chat.id, '/reporte_suscripcion');
  });

  // Acción para generar reporte Excel de facturas
  bot.action('reporte_excel_action', async (ctx) => {
    await ctx.answerCbQuery();

    if (!ctx.hasTenant()) {
      return ctx.reply(
        'Para generar un reporte Excel de facturas, primero debes registrar tu empresa.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrar empresa', 'start_registration')],
        ])
      );
    }

    try {
      const tenantId = ctx.getTenantId();
      
      // Mensaje inicial
      const progressMsg = await ctx.reply(
        '📊 *Generando Reporte Excel de Facturas*\n\n' +
        '🔄 Obteniendo facturas de la base de datos...\n' +
        '⏱️ Esto puede tomar unos momentos...',
        { parse_mode: 'Markdown' }
      );

      // Importar servicio dinámicamente
      const ExcelReportService = (await import('../../services/excel-report.service.js')).default;
      
      // Configuración del reporte MVP
      const reportConfig = {
        limit: 100, // MVP: límite de 100 facturas
        includeDetails: true,
        format: 'xlsx'
      };

      // Actualizar progreso
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        null,
        '📊 *Generando Reporte Excel de Facturas*\n\n' +
        '🔄 Consultando datos de FacturAPI...\n' +
        '📋 Esto incluirá UUID, IVA, retención y todos los campos fiscales...',
        { parse_mode: 'Markdown' }
      );

      // Generar reporte
      const result = await ExcelReportService.generateInvoiceReport(tenantId, reportConfig);

      if (result.success) {
        // Actualizar con éxito
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMsg.message_id,
          null,
          '✅ *Reporte Excel Generado Exitosamente*\n\n' +
          `📊 Facturas incluidas: ${result.stats.totalInvoices}\n` +
          `⏱️ Tiempo de generación: ${Math.round(result.stats.duration / 1000)}s\n` +
          `📄 Tamaño del archivo: ${result.stats.fileSize}\n\n` +
          '📎 Enviando archivo...',
          { parse_mode: 'Markdown' }
        );

        // Enviar archivo Excel
        await ctx.replyWithDocument({
          source: result.filePath,
          filename: `reporte_facturas_${new Date().toISOString().split('T')[0]}.xlsx`
        });

        // Mensaje final
        await ctx.reply(
          '🎉 *¡Reporte Excel enviado exitosamente!*\n\n' +
          '📋 *El archivo incluye:*\n' +
          '• Folio completo de cada factura\n' +
          '• UUID/Folio Fiscal del SAT\n' +
          '• Datos completos del cliente (nombre y RFC)\n' +
          '• Fechas de facturación\n' +
          '• Subtotal, IVA y retenciones\n' +
          '• Total y estado de cada factura\n' +
          '• URL de verificación del SAT\n\n' +
          '💡 *Tip:* Puedes abrir el archivo en Excel, Google Sheets o LibreOffice.',
          { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Volver a Reportes', 'menu_reportes')]
            ])
          }
        );

        // Limpiar archivo temporal después de 5 minutos
        setTimeout(async () => {
          try {
            const fs = await import('fs');
            fs.unlinkSync(result.filePath);
            console.log(`🗑️ Archivo temporal limpiado: ${result.filePath}`);
          } catch (error) {
            console.log(`ℹ️ No se pudo limpiar archivo temporal: ${error.message}`);
          }
        }, 5 * 60 * 1000);

      } else {
        // Error en la generación
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMsg.message_id,
          null,
          '❌ *Error Generando Reporte*\n\n' +
          `💬 ${result.error}\n\n` +
          '🔄 Por favor, intenta nuevamente en unos momentos.',
          { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Reintentar', 'reporte_excel_action')],
              [Markup.button.callback('🔙 Volver a Reportes', 'menu_reportes')]
            ])
          }
        );
      }

    } catch (error) {
      console.error('❌ Error en acción reporte_excel_action:', error);
      
      await ctx.reply(
        '❌ *Error Inesperado*\n\n' +
        'Ocurrió un error al generar el reporte Excel. ' +
        'Por favor, contacta al soporte técnico si el problema persiste.',
        { 
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Volver a Reportes', 'menu_reportes')]
          ])
        }
      );
    }
  });

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
