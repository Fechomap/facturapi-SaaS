/**
 * Notification Service
 * Centralized service for notification management via Telegram
 */

import { Telegraf } from 'telegraf';
import { createModuleLogger } from '@core/utils/logger.js';
import { config } from '@config/index.js';
import { prisma } from '@config/database.js';

const logger = createModuleLogger('NotificationService');

// Bot instance (singleton)
let botInstance: Telegraf | null = null;

interface SendOptions {
  parse_mode?: 'Markdown' | 'HTML';
  disable_notification?: boolean;
  [key: string]: unknown;
}

interface NotificationResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

interface AdminNotificationResult {
  success: boolean;
  totalAdmins?: number;
  successCount?: number;
  results?: Array<{ telegramId: string } & NotificationResult>;
  error?: string;
}

interface ReportNotificationParams {
  chatId: number;
  tenantId: string;
  userId: number;
  filePath: string;
  fileName: string;
  invoiceCount: number;
  fileSizeMB: string;
  requestId: string;
  jobId: string;
}

/**
 * Notification Service Class
 */
class NotificationService {
  /**
   * Initialize service and dependencies
   */
  static initialize(): boolean {
    try {
      if (!config.telegram.token) {
        logger.error('Telegram token not configured for notifications');
        throw new Error('Telegram token not configured');
      }

      if (!botInstance) {
        botInstance = new Telegraf(config.telegram.token);
        logger.info('Notification service initialized successfully');
      }

      return true;
    } catch (error) {
      logger.error({ error }, 'Error initializing notification service');
      return false;
    }
  }

  /**
   * Get bot instance, initializing if necessary
   */
  static getBot(): Telegraf {
    if (!botInstance) {
      NotificationService.initialize();
    }
    if (!botInstance) {
      throw new Error('Could not get bot instance for notifications');
    }
    return botInstance;
  }

  /**
   * Send notification via Telegram
   */
  static async sendTelegramNotification(
    telegramId: bigint | string | number,
    message: string,
    options: SendOptions = {}
  ): Promise<NotificationResult> {
    const bot = NotificationService.getBot();

    try {
      const telegramIdStr = telegramId.toString();

      // Default options
      const defaultOptions: SendOptions = { parse_mode: 'Markdown' };
      const sendOptions = { ...defaultOptions, ...options };

      // Send message
      const result = await bot.telegram.sendMessage(telegramIdStr, message, sendOptions);

      // Register notification in database
      try {
        await prisma.notification.create({
          data: {
            recipientId: telegramIdStr,
            channel: 'telegram',
            message,
            status: 'sent',
            metadata: {
              messageId: result.message_id,
            },
          },
        });
      } catch (dbError) {
        logger.warn(
          { error: dbError, telegramId: telegramIdStr },
          'Error registering notification in database'
        );
      }

      logger.info(
        { telegramId: telegramIdStr, messageId: result.message_id },
        'Notification sent successfully'
      );

      return { success: true, messageId: result.message_id };
    } catch (error) {
      logger.error(
        { error, telegramId: telegramId.toString() },
        'Error sending Telegram notification'
      );

      // Register error in database
      try {
        await prisma.notification.create({
          data: {
            recipientId: telegramId.toString(),
            channel: 'telegram',
            message,
            status: 'failed',
            metadata: {
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          },
        });
      } catch (dbError) {
        logger.error({ error: dbError }, 'Error registering failed notification in database');
      }

      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Notify all admins of a tenant
   */
  static async notifyTenantAdmins(
    tenantId: string,
    message: string,
    options: SendOptions = {}
  ): Promise<AdminNotificationResult> {
    try {
      const admins = await prisma.tenantUser.findMany({
        where: {
          tenantId,
          role: 'admin',
        },
      });

      if (admins.length === 0) {
        logger.warn({ tenantId }, 'No admins found to notify');
        return { success: false, error: 'No admins for this tenant' };
      }

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

      logger.info(
        { tenantId, totalAdmins: admins.length, successCount },
        'Admin notifications completed'
      );

      return {
        success: successCount > 0,
        totalAdmins: admins.length,
        successCount,
        results,
      };
    } catch (error) {
      logger.error({ error, tenantId }, 'Error notifying tenant admins');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Notify all system admins
   */
  static async notifySystemAdmins(
    message: string,
    options: SendOptions = {}
  ): Promise<AdminNotificationResult> {
    try {
      const adminIds = config.telegram.adminChatIds || [];

      if (adminIds.length === 0) {
        logger.warn('No system admins configured');
        return { success: false, error: 'No admins configured' };
      }

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

      logger.info(
        { totalAdmins: adminIds.length, successCount },
        'System admin notifications completed'
      );

      return {
        success: successCount > 0,
        totalAdmins: adminIds.length,
        successCount,
        results,
      };
    } catch (error) {
      logger.error({ error }, 'Error notifying system admins');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

/**
 * Notify user that Excel report is ready
 */
export async function notifyUserReportReady(
  params: ReportNotificationParams
): Promise<{ success: boolean }> {
  try {
    const {
      chatId,
      tenantId,
      userId,
      filePath,
      fileName,
      invoiceCount,
      fileSizeMB,
      requestId,
      jobId,
    } = params;

    const message =
      `✅ **¡Tu Reporte Excel está listo!**\n\n` +
      `📊 **Facturas incluidas:** ${invoiceCount.toLocaleString()}\n` +
      `📁 **Tamaño:** ${fileSizeMB} MB\n` +
      `⏱️ **Generado:** ${new Date().toLocaleString('es-MX')}\n\n` +
      `🔗 Descargando automáticamente...\n\n` +
      `📋 **ID:** \`${requestId}\`\n` +
      `🗑️ *El archivo se eliminará automáticamente en 24 horas*`;

    // Send notification message
    await NotificationService.sendTelegramNotification(chatId, message);

    // Send Excel file
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

    logger.info(
      { chatId, tenantId, userId, fileName, invoiceCount, fileSizeMB, requestId, jobId },
      'Report ready notification sent successfully'
    );

    return { success: true };
  } catch (error) {
    logger.error({ ...params, error }, 'Error sending report ready notification');
    throw error;
  }
}

export default NotificationService;
