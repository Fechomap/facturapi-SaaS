// services/notification.service.js
import { Telegraf } from 'telegraf';
import logger from '../core/utils/logger.js';
import { config } from '../config/index.js';
import prisma from '../lib/prisma.js';

// Logger específico para notificaciones
const notificationLogger = logger.child({ module: 'notification-service' });

// Instancia del bot (singleton)
let botInstance = null;

/**
 * Servicio centralizado para gestión de notificaciones
 */
class NotificationService {
  /**
   * Inicializa el servicio y sus dependencias
   */
  static initialize() {
    try {
      if (!config.telegram.token) {
        notificationLogger.error('Token de Telegram no configurado para notificaciones');
        throw new Error('Token de Telegram no configurado');
      }

      // Crear instancia del bot si no existe
      if (!botInstance) {
        botInstance = new Telegraf(config.telegram.token);
        notificationLogger.info('Servicio de notificaciones inicializado correctamente');
      }

      return true;
    } catch (error) {
      notificationLogger.error({ error }, 'Error al inicializar servicio de notificaciones');
      return false;
    }
  }

  /**
   * Obtiene la instancia del bot, inicializándola si es necesario
   * @returns {Object} - Instancia del bot
   */
  static getBot() {
    if (!botInstance) {
      NotificationService.initialize();
    }
    return botInstance;
  }

  /**
   * Envía una notificación a través de Telegram
   * @param {BigInt|string|number} telegramId - ID de Telegram del destinatario
   * @param {string} message - Mensaje a enviar
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<Object>} - Resultado del envío
   */
  static async sendTelegramNotification(telegramId, message, options = {}) {
    const bot = NotificationService.getBot();

    if (!bot) {
      throw new Error('No se pudo obtener la instancia del bot para notificaciones');
    }

    try {
      const telegramIdStr = telegramId.toString();

      // Opciones por defecto
      const defaultOptions = { parse_mode: 'Markdown' };
      const sendOptions = { ...defaultOptions, ...options };

      // Enviar mensaje
      const result = await bot.telegram.sendMessage(telegramIdStr, message, sendOptions);

      // Registrar notificación en la base de datos
      try {
        await prisma.notification.create({
          data: {
            recipientId: telegramIdStr,
            channel: 'telegram',
            message,
            status: 'sent',
            metadata: {
              messageId: result.message_id,
              options: sendOptions,
            },
          },
        });
      } catch (dbError) {
        // Si hay error al guardar en BD, solo lo registramos pero continuamos
        notificationLogger.warn(
          { error: dbError, telegramId: telegramIdStr },
          'Error al registrar notificación en base de datos'
        );
      }

      notificationLogger.info(
        { telegramId: telegramIdStr, messageId: result.message_id },
        'Notificación enviada correctamente'
      );

      return { success: true, messageId: result.message_id };
    } catch (error) {
      notificationLogger.error(
        { error, telegramId: telegramId.toString() },
        'Error al enviar notificación por Telegram'
      );

      // Registrar el error en la base de datos
      try {
        await prisma.notification.create({
          data: {
            recipientId: telegramId.toString(),
            channel: 'telegram',
            message,
            status: 'failed',
            metadata: {
              error: error.message,
              options,
            },
          },
        });
      } catch (dbError) {
        notificationLogger.error(
          { error: dbError },
          'Error al registrar notificación fallida en base de datos'
        );
      }

      return { success: false, error: error.message };
    }
  }

  /**
   * Envía una notificación a todos los administradores de un tenant
   * @param {string} tenantId - ID del tenant
   * @param {string} message - Mensaje a enviar
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<Object>} - Resultado del envío
   */
  static async notifyTenantAdmins(tenantId, message, options = {}) {
    try {
      // Buscar administradores del tenant
      const admins = await prisma.tenantUser.findMany({
        where: {
          tenantId,
          role: 'admin',
        },
      });

      if (admins.length === 0) {
        notificationLogger.warn({ tenantId }, 'No se encontraron administradores para notificar');
        return { success: false, error: 'No hay administradores para este tenant' };
      }

      // Enviar notificación a cada administrador
      const results = [];
      for (const admin of admins) {
        const result = await NotificationService.sendTelegramNotification(
          admin.telegramId,
          message,
          options
        );
        results.push({
          telegramId: admin.telegramId.toString(),
          ...result,
        });
      }

      const successCount = results.filter((r) => r.success).length;

      notificationLogger.info(
        { tenantId, totalAdmins: admins.length, successCount },
        'Notificaciones a administradores completadas'
      );

      return {
        success: successCount > 0,
        totalAdmins: admins.length,
        successCount,
        results,
      };
    } catch (error) {
      notificationLogger.error(
        { error, tenantId },
        'Error al notificar a administradores del tenant'
      );
      return { success: false, error: error.message };
    }
  }

  /**
   * Envía una notificación de sistema a todos los administradores globales
   * @param {string} message - Mensaje a enviar
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<Object>} - Resultado del envío
   */
  static async notifySystemAdmins(message, options = {}) {
    try {
      const adminIds = config.telegram.adminChatIds || [];

      if (adminIds.length === 0) {
        notificationLogger.warn('No hay administradores de sistema configurados');
        return { success: false, error: 'No hay administradores configurados' };
      }

      // Enviar notificación a cada administrador del sistema
      const results = [];
      for (const adminId of adminIds) {
        const result = await NotificationService.sendTelegramNotification(
          adminId,
          message,
          options
        );
        results.push({
          telegramId: adminId.toString(),
          ...result,
        });
      }

      const successCount = results.filter((r) => r.success).length;

      notificationLogger.info(
        { totalAdmins: adminIds.length, successCount },
        'Notificaciones a administradores del sistema completadas'
      );

      return {
        success: successCount > 0,
        totalAdmins: adminIds.length,
        successCount,
        results,
      };
    } catch (error) {
      notificationLogger.error({ error }, 'Error al notificar a administradores del sistema');
      return { success: false, error: error.message };
    }
  }
}

/**
 * Notificar al usuario que su reporte Excel está listo
 */
export async function notifyUserReportReady({
  chatId,
  tenantId,
  userId,
  filePath,
  fileName,
  invoiceCount,
  fileSizeMB,
  requestId,
  jobId,
}) {
  try {
    const message =
      `✅ **¡Tu Reporte Excel está listo!**\n\n` +
      `📊 **Facturas incluidas:** ${invoiceCount.toLocaleString()}\n` +
      `📁 **Tamaño:** ${fileSizeMB} MB\n` +
      `⏱️ **Generado:** ${new Date().toLocaleString('es-MX')}\n\n` +
      `🔗 Descargando automáticamente...\n\n` +
      `📋 **ID:** \`${requestId}\`\n` +
      `🗑️ *El archivo se eliminará automáticamente en 24 horas*`;

    // Enviar mensaje de notificación
    await NotificationService.sendTelegramNotification(chatId, message);

    // Enviar el archivo Excel
    const bot = NotificationService.getBot();
    await bot.telegram.sendDocument(
      chatId,
      {
        source: filePath,
        filename: fileName,
      },
      {
        caption: `📊 **${fileName}**\n${invoiceCount} facturas | ${fileSizeMB} MB`,
        parse_mode: 'Markdown',
      }
    );

    notificationLogger.info('Report ready notification sent successfully', {
      chatId,
      tenantId,
      userId,
      fileName,
      invoiceCount,
      fileSizeMB,
      requestId,
      jobId,
    });

    return { success: true };
  } catch (error) {
    notificationLogger.error('Error sending report ready notification', {
      chatId,
      tenantId,
      userId,
      error: error.message,
      requestId,
      jobId,
    });
    throw error;
  }
}

export default NotificationService;
