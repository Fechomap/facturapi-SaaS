// feature-multiuser/middleware/user-management.commands.js
// Comandos de Telegram para gestión de usuarios multiusuario

import { Markup } from 'telegraf';
import MultiUserService from '../../services/multi-user.service.js';
import {
  USER_ROLES,
  checkPermission,
  invalidateUserCache,
} from '../middlewares/multi-auth.middleware.js';
import logger from '../../core/utils/logger.js';

const userMgmtLogger = logger.child({ module: 'user-management-commands' });

/**
 * Registra los comandos de gestión de usuarios
 * @param {Object} bot - Instancia del bot de Telegram
 */
export function registerUserManagementCommands(bot) {
  // Comando: /usuarios - Listar usuarios del tenant
  bot.command('usuarios', checkPermission('user:manage'), async (ctx) => {
    try {
      const tenantId = ctx.getTenantId();
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
        [Markup.button.callback('🔙 Volver', 'menu_principal')],
      ]);

      ctx.reply(message, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      userMgmtLogger.error(
        {
          tenantId: ctx.getTenantId(),
          error: error.message,
        },
        'Error al listar usuarios'
      );
      ctx.reply('❌ Error al obtener la lista de usuarios.');
    }
  });

  // Acción: Invitar usuario
  bot.action('invite_user', checkPermission('user:manage'), async (ctx) => {
    await ctx.answerCbQuery();

    ctx.userState.esperando = 'invite_telegram_id';
    ctx.reply(
      '👤 *Invitar nuevo usuario*\n\n' +
        'Envía el ID de Telegram del usuario que quieres invitar.\n\n' +
        '💡 *¿Cómo obtener el ID?*\n' +
        '• Pide al usuario que le escriba a @userinfobot\n' +
        '• O usa @username\\_to\\_id\\_bot\n\n' +
        'Ejemplo: 123456789',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'cancel_invite')]]),
      }
    );
  });

  // Acción: Gestionar usuarios
  bot.action('manage_users', checkPermission('user:manage'), async (ctx) => {
    await ctx.answerCbQuery();

    try {
      const tenantId = ctx.getTenantId();
      const users = await MultiUserService.getTenantUsers(tenantId);

      if (users.length <= 1) {
        return ctx.reply('👥 Solo hay un usuario. Invita más usuarios para gestionar.');
      }

      const keyboard = users
        .filter((u) => u.telegramId !== ctx.from.id.toString()) // Excluir al usuario actual
        .map((user) => [
          Markup.button.callback(
            `${user.isAuthorized ? '✅' : '⏳'} ${user.displayName}`,
            `manage_user_${user.telegramId}`
          ),
        ]);

      keyboard.push([Markup.button.callback('🔙 Volver', 'menu_principal')]);

      ctx.reply('👥 *Selecciona usuario para gestionar:*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(keyboard),
      });
    } catch (error) {
      userMgmtLogger.error(
        {
          tenantId: ctx.getTenantId(),
          error: error.message,
        },
        'Error al mostrar usuarios para gestionar'
      );
      ctx.reply('❌ Error al cargar usuarios.');
    }
  });

  // Manejar entrada de Telegram ID para invitación
  bot.on('text', async (ctx, next) => {
    if (ctx.userState?.esperando === 'invite_telegram_id') {
      const telegramId = ctx.message.text.trim();

      // Validar que sea un número
      if (!/^\d+$/.test(telegramId)) {
        return ctx.reply('❌ ID inválido. Debe ser solo números.\n\n' + 'Ejemplo: 123456789', {
          parse_mode: 'Markdown',
        });
      }

      try {
        // Invitar usuario como OPERATOR por defecto
        await MultiUserService.inviteUser(
          ctx.getTenantId(),
          telegramId,
          USER_ROLES.OPERATOR,
          ctx.from.id
        );

        ctx.userState.esperando = null;

        ctx.reply(
          `✅ *Usuario invitado exitosamente*\n\n` +
            `ID: ${telegramId}\n` +
            `Rol: Operador\n` +
            `Estado: Pendiente de autorización\n\n` +
            `🔔 El usuario podrá usar el bot después de que lo autorices.`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('⚙️ Gestionar usuarios', 'manage_users')],
              [Markup.button.callback('🔙 Menú principal', 'menu_principal')],
            ]),
          }
        );
      } catch (error) {
        userMgmtLogger.error(
          {
            tenantId: ctx.getTenantId(),
            telegramId,
            error: error.message,
          },
          'Error al invitar usuario'
        );

        ctx.reply(
          `❌ Error al invitar usuario: ${error.message}`,
          Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver', 'menu_principal')]])
        );
      }

      return; // No continuar con next()
    }

    return next();
  });

  // Gestión individual de usuario
  bot.action(/manage_user_(\d+)/, checkPermission('user:manage'), async (ctx) => {
    await ctx.answerCbQuery();

    const targetTelegramId = ctx.match[1];

    try {
      const user = await MultiUserService.findUser(ctx.getTenantId(), targetTelegramId);
      if (!user) {
        return ctx.reply('❌ Usuario no encontrado.');
      }

      const keyboard = [];

      // Autorizar (solo si el usuario no está autorizado)
      if (!user.isAuthorized) {
        keyboard.push([Markup.button.callback('✅ Autorizar', `authorize_${targetTelegramId}`)]);
      }

      // Remover usuario
      keyboard.push([
        Markup.button.callback('🗑️ Remover usuario', `remove_user_${targetTelegramId}`),
      ]);

      keyboard.push([Markup.button.callback('🔙 Volver', 'manage_users')]);

      const status = user.isAuthorized ? '✅ Autorizado' : '⏳ Pendiente';
      const roleEmoji = getRoleEmoji(user.role);

      ctx.reply(
        `👤 *Gestionar usuario*\n\n` +
          `Nombre: ${user.displayName}\n` +
          `ID: ${user.telegramId}\n` +
          `Rol: ${roleEmoji} ${user.role}\n` +
          `Estado: ${status}\n` +
          `Registro: ${user.createdAt.toLocaleDateString('es-MX')}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(keyboard),
        }
      );
    } catch (error) {
      userMgmtLogger.error(
        {
          tenantId: ctx.getTenantId(),
          targetTelegramId,
          error: error.message,
        },
        'Error al cargar usuario para gestionar'
      );
      ctx.reply('❌ Error al cargar usuario.');
    }
  });

  // Autorizar usuario
  bot.action(/authorize_(\d+)/, checkPermission('user:manage'), async (ctx) => {
    await ctx.answerCbQuery();
    const targetTelegramId = ctx.match[1];

    try {
      await MultiUserService.authorizeUser(ctx.getTenantId(), targetTelegramId, true, ctx.from.id);

      // CRÍTICO: Invalidar caché inmediatamente después de autorizar
      invalidateUserCache(targetTelegramId);

      ctx.reply('✅ Usuario autorizado exitosamente.');

      // Simular click para volver a mostrar el usuario
      setTimeout(() => {
        ctx.editMessageReplyMarkup({
          inline_keyboard: [
            [Markup.button.callback('🔄 Actualizar', `manage_user_${targetTelegramId}`)],
          ],
        });
      }, 1000);
    } catch (error) {
      ctx.reply(`❌ Error: ${error.message}`);
    }
  });

  // Remover usuario
  bot.action(/remove_user_(\d+)/, checkPermission('user:manage'), async (ctx) => {
    await ctx.answerCbQuery();
    const targetTelegramId = ctx.match[1];

    try {
      const user = await MultiUserService.findUser(ctx.getTenantId(), targetTelegramId);
      if (!user) {
        return ctx.reply('❌ Usuario no encontrado.');
      }

      // Mostrar confirmación
      ctx.reply(
        `⚠️ *Confirmar eliminación*\n\n` +
          `¿Estás seguro de que quieres remover a este usuario?\n\n` +
          `👤 Usuario: ${user.displayName}\n` +
          `🆔 ID: ${user.telegramId}\n` +
          `👑 Rol: ${getRoleEmoji(user.role)} ${user.role}\n\n` +
          `⚠️ *Esta acción no se puede deshacer*`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Sí, remover', `confirm_remove_${targetTelegramId}`),
              Markup.button.callback('❌ Cancelar', `manage_user_${targetTelegramId}`),
            ],
          ]),
        }
      );
    } catch (error) {
      userMgmtLogger.error(
        {
          tenantId: ctx.getTenantId(),
          targetTelegramId,
          error: error.message,
        },
        'Error al mostrar confirmación de eliminación'
      );
      ctx.reply('❌ Error al cargar usuario para eliminar.');
    }
  });

  // Confirmar eliminación de usuario
  bot.action(/confirm_remove_(\d+)/, checkPermission('user:manage'), async (ctx) => {
    await ctx.answerCbQuery();
    const targetTelegramId = ctx.match[1];

    try {
      const user = await MultiUserService.findUser(ctx.getTenantId(), targetTelegramId);
      if (!user) {
        return ctx.reply('❌ Usuario no encontrado.');
      }

      // Eliminar usuario
      await MultiUserService.removeUser(ctx.getTenantId(), targetTelegramId, ctx.from.id);

      // CRÍTICO: Invalidar caché inmediatamente después de remover
      invalidateUserCache(targetTelegramId);

      ctx.reply(
        `✅ *Usuario removido exitosamente*\n\n` +
          `👤 ${user.displayName} ha sido eliminado del sistema.\n\n` +
          `🔔 Este usuario ya no podrá acceder al bot.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Menú principal', 'menu_principal')],
          ]),
        }
      );

      userMgmtLogger.info(
        {
          tenantId: ctx.getTenantId(),
          removedUserId: targetTelegramId,
          removedBy: ctx.from.id,
        },
        'Usuario removido exitosamente'
      );
    } catch (error) {
      userMgmtLogger.error(
        {
          tenantId: ctx.getTenantId(),
          targetTelegramId,
          error: error.message,
        },
        'Error al remover usuario'
      );
      ctx.reply(`❌ Error al remover usuario: ${error.message}`);
    }
  });

  // Cancelar invitación
  bot.action('cancel_invite', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.userState.esperando = null;
    ctx.reply('❌ Invitación cancelada.');
  });

  userMgmtLogger.info('Comandos de gestión de usuarios registrados');
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

export default registerUserManagementCommands;
