import type { BotContext } from '../../types/bot.types.js';
import type { Bot } from '../../types/bot.types.js';
import { Markup } from 'telegraf';
import { createModuleLogger } from '@core/utils/logger.js';
import MultiUserService from '../../services/multi-user.service.js';
import {
  USER_ROLES,
  checkPermission,
  invalidateUserCache,
} from '../middlewares/multi-auth.middleware.js';

const logger = createModuleLogger('user-management-commands');

interface TenantUser {
  telegramId: string;
  displayName: string;
  role: string;
  isAuthorized: boolean;
  createdAt: Date;
}

interface TenantStats {
  total: number;
  authorized: number;
  pending: number;
  byRole: {
    admin?: number;
    operator?: number;
    viewer?: number;
  };
}

/**
 * Obtiene emoji para el rol
 */
function getRoleEmoji(role: string): string {
  const emojis: Record<string, string> = {
    [USER_ROLES.ADMIN]: '👑',
    [USER_ROLES.OPERATOR]: '👤',
    [USER_ROLES.VIEWER]: '👁️',
  };
  return emojis[role] || '❓';
}

/**
 * Registra los comandos de gestión de usuarios
 * @param bot - Instancia del bot de Telegram
 */
export function registerUserManagementCommands(bot: Bot): void {
  // Comando: /usuarios - Listar usuarios del tenant
  bot.command('usuarios', checkPermission('user:manage'), async (ctx: BotContext) => {
    try {
      const tenantId = ctx.getTenantId();
      const users = (await MultiUserService.getTenantUsers(tenantId)) as TenantUser[];
      const stats = (await MultiUserService.getTenantStats(tenantId)) as TenantStats;

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
      logger.error(
        {
          tenantId: ctx.getTenantId(),
          error,
        },
        'Error al listar usuarios'
      );
      ctx.reply('❌ Error al obtener la lista de usuarios.');
    }
  });

  // Acción: Invitar usuario
  bot.action('invite_user', checkPermission('user:manage'), async (ctx: BotContext) => {
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
  bot.action('manage_users', checkPermission('user:manage'), async (ctx: BotContext) => {
    await ctx.answerCbQuery();

    try {
      const tenantId = ctx.getTenantId();
      const users = (await MultiUserService.getTenantUsers(tenantId)) as TenantUser[];

      if (users.length <= 1) {
        return ctx.reply('👥 Solo hay un usuario. Invita más usuarios para gestionar.');
      }

      const keyboard = users
        .filter((u) => u.telegramId !== ctx.from?.id.toString()) // Excluir al usuario actual
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
      logger.error(
        {
          tenantId: ctx.getTenantId(),
          error,
        },
        'Error al mostrar usuarios para gestionar'
      );
      ctx.reply('❌ Error al cargar usuarios.');
    }
  });

  // Manejar entrada de Telegram ID para invitación
  bot.on('text', async (ctx: BotContext, next) => {
    if (ctx.userState?.esperando === 'invite_telegram_id') {
      if (!ctx.message || !('text' in ctx.message)) {
        await ctx.reply('❌ Por favor, envía un mensaje de texto.');
        return;
      }

      const telegramId = ctx.message.text.trim();

      if (!telegramId) {
        await ctx.reply('❌ Por favor, envía un ID válido.');
        return;
      }

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
          ctx.from?.id || 0
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
        logger.error(
          {
            tenantId: ctx.getTenantId(),
            telegramId,
            error,
          },
          'Error al invitar usuario'
        );

        ctx.reply(
          `❌ Error al invitar usuario: ${error instanceof Error ? error.message : 'Error desconocido'}`,
          Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver', 'menu_principal')]])
        );
      }

      return; // No continuar con next()
    }

    return next();
  });

  // Gestión individual de usuario
  bot.action(/manage_user_(\d+)/, checkPermission('user:manage'), async (ctx: BotContext) => {
    await ctx.answerCbQuery();

    const targetTelegramId = (ctx.match as RegExpExecArray)[1];

    try {
      const user = (await MultiUserService.findUser(
        ctx.getTenantId(),
        targetTelegramId
      )) as TenantUser | null;
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
      logger.error(
        {
          tenantId: ctx.getTenantId(),
          targetTelegramId,
          error,
        },
        'Error al cargar usuario para gestionar'
      );
      ctx.reply('❌ Error al cargar usuario.');
    }
  });

  // Autorizar usuario
  bot.action(/authorize_(\d+)/, checkPermission('user:manage'), async (ctx: BotContext) => {
    await ctx.answerCbQuery();
    const targetTelegramId = (ctx.match as RegExpExecArray)[1];

    try {
      await MultiUserService.authorizeUser(
        ctx.getTenantId(),
        targetTelegramId,
        true,
        ctx.from?.id || 0
      );

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
      ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
  });

  // Remover usuario
  bot.action(/remove_user_(\d+)/, checkPermission('user:manage'), async (ctx: BotContext) => {
    await ctx.answerCbQuery();
    const targetTelegramId = (ctx.match as RegExpExecArray)[1];

    try {
      const user = (await MultiUserService.findUser(
        ctx.getTenantId(),
        targetTelegramId
      )) as TenantUser | null;
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
      logger.error(
        {
          tenantId: ctx.getTenantId(),
          targetTelegramId,
          error,
        },
        'Error al mostrar confirmación de eliminación'
      );
      ctx.reply('❌ Error al cargar usuario para eliminar.');
    }
  });

  // Confirmar eliminación de usuario
  bot.action(/confirm_remove_(\d+)/, checkPermission('user:manage'), async (ctx: BotContext) => {
    await ctx.answerCbQuery();
    const targetTelegramId = (ctx.match as RegExpExecArray)[1];

    try {
      const user = (await MultiUserService.findUser(
        ctx.getTenantId(),
        targetTelegramId
      )) as TenantUser | null;
      if (!user) {
        return ctx.reply('❌ Usuario no encontrado.');
      }

      // Eliminar usuario
      await MultiUserService.removeUser(ctx.getTenantId(), targetTelegramId, ctx.from?.id || 0);

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

      logger.info(
        {
          tenantId: ctx.getTenantId(),
          removedUserId: targetTelegramId,
          removedBy: ctx.from?.id,
        },
        'Usuario removido exitosamente'
      );
    } catch (error) {
      logger.error(
        {
          tenantId: ctx.getTenantId(),
          targetTelegramId,
          error,
        },
        'Error al remover usuario'
      );
      ctx.reply(
        `❌ Error al remover usuario: ${error instanceof Error ? error.message : 'Error desconocido'}`
      );
    }
  });

  // Cancelar invitación
  bot.action('cancel_invite', async (ctx: BotContext) => {
    await ctx.answerCbQuery();
    ctx.userState.esperando = null;
    ctx.reply('❌ Invitación cancelada.');
  });

  logger.info('Comandos de gestión de usuarios registrados');
}

export default registerUserManagementCommands;
