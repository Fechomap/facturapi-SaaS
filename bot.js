// bot.js - Punto de entrada para el bot de Telegram
import { initConfig, config } from './config/index.js';
import { connectDatabase } from './config/database.js';
import logger from './core/utils/logger.js';
import { createBot } from './bot/index.js';

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
    
    // Iniciar el bot
    await bot.launch();
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