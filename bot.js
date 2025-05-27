// bot.js - Punto de entrada para el bot de Telegram
import { initConfig, config } from './config/index.js';
import { connectDatabase } from './config/database.js';
import logger from './core/utils/logger.js';
import { createBot } from './bot/index.js';
import express from 'express';

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
    
    // Crear e inicializar el bot usando el módulo modular
    const bot = createBot(botLogger);
    
    // Iniciar el bot según el entorno
    if (config.env === 'production' && config.isRailway) {
      // En Railway, usar webhook
      const webhookDomain = config.apiBaseUrl.replace(/^https?:\/\//i, '');
      botLogger.info(`Configurando webhook en dominio: ${webhookDomain}`);
      
      // Configurar webhook - Railway requiere HTTPS
      await bot.telegram.setWebhook(`https://${webhookDomain}/telegram-webhook`);
      
      // Iniciar servidor web para el webhook
      const app = express();
      app.use(express.json());
      
      // Ruta del webhook
      app.use('/telegram-webhook', (req, res) => {
        bot.handleUpdate(req.body, res);
      });
      
      // Puerto para el webhook (usar el puerto asignado por Railway)
      const PORT = process.env.PORT || 3000;
      app.listen(PORT, () => {
        botLogger.info(`Servidor webhook escuchando en puerto ${PORT}`);
      });
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