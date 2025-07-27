// bot.js - ARREGLADO
import { initConfig, config } from './config/index.js';
import { connectDatabase } from './config/database.js';
import logger from './core/utils/logger.js';
import { createBot } from './bot/index.js';
import cron from 'node-cron';
import cleanupExpiredSessions from './scripts/database/cleanup-sessions.js';
import redisSessionService from './services/redis-session.service.js'; // Importar el servicio de Redis

// Logger específico para el bot
const botLogger = logger.child({ module: 'telegram-bot' });

// Función principal para iniciar el bot
async function startBot() {
  try {
    // Inicializar configuración
    await initConfig();
    botLogger.info('Configuración inicializada');

    // Conectar a la base de datos
    await connectDatabase();
    botLogger.info('Conexión a base de datos establecida');

    // Inicializar Redis
    await redisSessionService.initialize();
    botLogger.info('Servicio de Redis inicializado');

    // FASE 3: Inicializar sistema de colas Bull para jobs asíncronos
    try {
      const { cleanOldJobs } = await import('./services/queue.service.js');

      // Limpiar jobs antiguos al inicio
      await cleanOldJobs();

      botLogger.info('Sistema de colas Bull inicializado', {
        queues: ['excel-report', 'file-cleanup'],
      });
    } catch (error) {
      botLogger.warn('No se pudo inicializar sistema de colas Bull', { error: error.message });
    }

    // Crear e inicializar el bot usando el módulo modular
    const bot = createBot(botLogger);

    // 🧹 OPTIMIZACIÓN: Job automático de limpieza de sesiones cada hora
    cron.schedule('0 * * * *', async () => {
      botLogger.info('Ejecutando limpieza automática de sesiones...');
      await cleanupExpiredSessions();
    });

    // 🗑️ FASE 3: Job automático de limpieza de colas Bull cada hora
    cron.schedule('0 * * * *', async () => {
      try {
        botLogger.info('Ejecutando limpieza automática de jobs Bull...');
        const { cleanOldJobs } = await import('./services/queue.service.js');
        await cleanOldJobs();
        botLogger.info('Limpieza de jobs Bull completada');
      } catch (error) {
        botLogger.warn('Error en limpieza de jobs Bull', { error: error.message });
      }
    });

    // Iniciar el bot según el entorno
    if (config.env === 'production' && config.isRailway) {
      // En Railway, NO crear servidor - solo configurar webhook
      const webhookUrl = `${config.apiBaseUrl}/telegram-webhook`;
      botLogger.info(`Configurando webhook: ${webhookUrl}`);

      await bot.telegram.setWebhook(webhookUrl);
      botLogger.info('Webhook configurado. El servidor principal manejará las peticiones.');

      // NO crear servidor Express aquí - server.js lo maneja
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

    // Habilitar el cierre correcto
    process.once('SIGINT', () => {
      botLogger.info('Señal SIGINT recibida, deteniendo bot');
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      botLogger.info('Señal SIGTERM recibida, deteniendo bot');
      bot.stop('SIGTERM');
    });
  } catch (error) {
    botLogger.error({ error }, 'Error al iniciar el bot');
    process.exit(1);
  }
}

// Iniciar el bot
startBot();
