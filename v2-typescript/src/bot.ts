// bot.ts - Telegram Bot Entry Point
import { config } from './config/index.js';
import { connectDatabase } from './config/database.js';
import logger from './core/utils/logger.js';
import { createBot } from './bot/index.js';
import cron from 'node-cron';
import redisSessionService from './services/redis-session.service.js';

const botLogger = logger.child({ module: 'telegram-bot' });

/**
 * Función principal para iniciar el bot
 */
async function startBot() {
  try {
    botLogger.info('Inicializando bot de Telegram');

    // Conectar a la base de datos
    await connectDatabase();
    botLogger.info('Conexión a base de datos establecida');

    // Inicializar Redis
    await redisSessionService.initialize();
    botLogger.info('Servicio de Redis inicializado');

    // Inicializar sistema de colas Bull
    try {
      const queueService = await import('./services/queue.service');
      if (queueService.cleanOldJobs) {
        await queueService.cleanOldJobs();
        botLogger.info('Sistema de colas Bull inicializado', {
          queues: ['excel-report', 'file-cleanup'],
        });
      }
    } catch (error: any) {
      botLogger.warn('No se pudo inicializar sistema de colas Bull', {
        error: error.message,
      });
    }

    // Crear el bot
    const bot = await createBot(botLogger);

    // Job automático de limpieza de sesiones cada hora
    cron.schedule('0 * * * *', async () => {
      botLogger.info('Ejecutando limpieza automática de sesiones...');
      // TODO: Implementar script de limpieza de sesiones
    });

    // Job automático de limpieza de colas Bull cada hora
    cron.schedule('0 * * * *', async () => {
      try {
        botLogger.info('Ejecutando limpieza automática de jobs Bull...');
        const queueService = await import('./services/queue.service');
        if (queueService.cleanOldJobs) {
          await queueService.cleanOldJobs();
          botLogger.info('Limpieza de jobs Bull completada');
        }
      } catch (error: any) {
        botLogger.warn('Error en limpieza de jobs Bull', { error: error.message });
      }
    });

    // Iniciar el bot según el entorno
    if (config.env === 'production' && config.isRailway) {
      // En Railway, solo configurar webhook
      const webhookUrl = `${config.api.baseUrl}/telegram-webhook`;
      botLogger.info(`Configurando webhook: ${webhookUrl}`);

      await bot.telegram.setWebhook(webhookUrl);
      botLogger.info('Webhook configurado. El servidor principal manejará las peticiones.');
    } else {
      // En desarrollo, usar polling
      await bot.launch();
      botLogger.info('Bot iniciado en modo polling');
    }

    botLogger.info('Bot de Telegram iniciado correctamente');
    botLogger.info(`Entorno: ${config.env}`);

    try {
      const botInfo = await bot.telegram.getMe();
      botLogger.info(`Nombre del bot: @${botInfo.username}`);
    } catch (error) {
      botLogger.warn('No se pudo obtener información del bot');
    }

    // Cierre correcto
    process.once('SIGINT', () => {
      botLogger.info('Señal SIGINT recibida, deteniendo bot');
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      botLogger.info('Señal SIGTERM recibida, deteniendo bot');
      bot.stop('SIGTERM');
    });
  } catch (error: any) {
    botLogger.error({ error }, 'Error al iniciar el bot');
    process.exit(1);
  }
}

// Iniciar el bot
startBot();
