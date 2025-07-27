// server.js - Punto de entrada para la API
import express from 'express';
import cors from 'cors';
import { config, initConfig } from './config/index.js';
import { connectDatabase } from './config/database.js';
import logger from './core/utils/logger.js';
import routes from './api/routes/index.js';
import { tenantMiddleware } from './api/middlewares/tenant.middleware.js';
import errorMiddleware from './api/middlewares/error.middleware.js';
import {
  generalRateLimit,
  invoiceRateLimit,
  queryRateLimit,
  authRateLimit,
} from './api/middlewares/rate-limit.middleware.js';
import { sessionMiddleware } from './api/middlewares/session.middleware.js';
import redisSessionService from './services/redis-session.service.js';
import SafeOperationsService from './services/safe-operations.service.js';
import { startJobs } from './jobs/index.js';
import NotificationService from './services/notification.service.js';
import { createBot } from './bot/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Definir __dirname para módulos ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logger específico para el servidor
const serverLogger = logger.child({ module: 'server' });

// Variable para el bot de Telegram
let telegramBot = null;

// Función para inicializar el bot de Telegram
async function initializeTelegramBot() {
  try {
    if (!config.telegram.token) {
      serverLogger.warn('Token de Telegram no configurado');
      return null;
    }

    const botLogger = logger.child({ module: 'telegram-bot' });
    telegramBot = await createBot(botLogger);

    if (config.env === 'production' && config.isRailway) {
      // En producción usar webhook
      const webhookUrl = `${config.apiBaseUrl}/telegram-webhook`;
      await telegramBot.telegram.setWebhook(webhookUrl);
      serverLogger.info(`Webhook de Telegram configurado: ${webhookUrl}`);
    } else {
      // En desarrollo o entornos sin webhook, usar polling
      await telegramBot.launch();
      serverLogger.info('Bot de Telegram iniciado en modo polling');
    }

    return telegramBot;
  } catch (error) {
    serverLogger.error('Error al inicializar bot de Telegram:', error);
    return null;
  }
}

// Función para inicializar la aplicación Express
async function initializeApp() {
  // Inicializar configuración
  await initConfig();

  // Inicializar la aplicación Express
  const app = express();

  // Configurar CORS para permitir peticiones desde el frontend
  app.use(
    cors({
      origin: ['http://localhost:3000', 'http://localhost:3001'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
    })
  );

  // Configuración especial para webhooks
  app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
  app.use('/telegram-webhook', express.json());

  // === WEBHOOK DE TELEGRAM ===
  app.post('/telegram-webhook', async (req, res) => {
    try {
      if (telegramBot) {
        await telegramBot.handleUpdate(req.body);
      }
      res.status(200).json({ ok: true });
    } catch (error) {
      serverLogger.error('Error en webhook de Telegram:', error);
      res.status(200).json({ ok: true });
    }
  });

  app.get('/telegram-webhook', (req, res) => {
    res.json({
      status: 'Webhook de Telegram activo',
      bot_initialized: Boolean(telegramBot),
    });
  });

  // Middleware para parsing JSON para el resto de rutas
  app.use(express.json());

  // === INICIALIZAR REDIS PARA CLUSTERING ===
  await redisSessionService.initialize();
  serverLogger.info('📦 Servicio de sesiones inicializado para clustering');

  // === INICIALIZAR REDIS LOCKS PARA MULTIUSUARIO ===
  await SafeOperationsService.initialize();
  serverLogger.info('🔒 Servicio de operaciones seguras inicializado para multiusuario');

  // === SESIONES COMPARTIDAS PARA CLUSTERING ===
  app.use(
    sessionMiddleware({
      sessionName: 'facturapi_session',
      maxAge: 3600, // 1 hora
      secure: config.env === 'production',
    })
  );

  // === RATE LIMITING PARA ESCALABILIDAD ===
  // Rate limiting general para toda la API
  app.use('/api', generalRateLimit);

  // Rate limiting específico para endpoints críticos
  app.use('/api/invoices', invoiceRateLimit);
  app.use('/api/auth', authRateLimit);
  app.use('/api/customers', queryRateLimit);
  app.use('/api/subscriptions', queryRateLimit);

  // Middleware para extraer información de tenant
  app.use('/api', tenantMiddleware);

  // Registrar todas las rutas bajo el prefijo /api
  app.use('/api', routes);

  // Configuración para servir archivos estáticos del frontend
  const frontendPath = path.join(__dirname, 'frontend/build');
  app.use(express.static(frontendPath));

  // Ruta API para información básica
  app.get('/api/info', (req, res) => {
    res.json({
      status: 'API de Facturación activa - FacturAPI SaaS',
      environment: config.env,
      version: '1.0.0',
      telegram_bot: Boolean(telegramBot),
    });
  });

  // Cualquier otra ruta que no sea de API sirve el frontend
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/telegram-webhook')) {
      return next();
    }
    // Ensure the file exists before sending
    const indexPath = path.join(frontendPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      // Handle case where index.html doesn't exist (e.g., frontend not built)
      res.status(404).send('Frontend not built. Run `cd frontend && npm run build`.');
    }
  });

  // Middleware para manejo de errores
  app.use(errorMiddleware);

  return app;
}

// Función principal para iniciar el servidor
async function startServer() {
  try {
    // Conectar a la base de datos
    await connectDatabase();
    serverLogger.info('Conexión a base de datos establecida');

    // Inicializar la aplicación
    const app = await initializeApp();

    // Inicializar el bot de Telegram
    telegramBot = await initializeTelegramBot();

    // Puerto de la aplicación desde la configuración centralizada
    const PORT = process.env.PORT || config.port || 3000;

    // Iniciar el servidor con manejo de errores para puerto en uso
    const server = app
      .listen(PORT, () => {
        serverLogger.info(`Servidor corriendo en http://localhost:${PORT}`);
        serverLogger.info(`Entorno: ${config.env}`);
        serverLogger.info(`API de Facturación SaaS lista y funcionando`);
        serverLogger.info(`Rutas API disponibles en http://localhost:${PORT}/api`);
        serverLogger.info(`Frontend disponible en http://localhost:${PORT}`);
        serverLogger.info(`Bot de Telegram: ${telegramBot ? '✅ Activo' : '❌ Inactivo'}`);

        // Inicializar servicio de notificaciones
        const notificationInitialized = NotificationService.initialize();
        if (notificationInitialized) {
          serverLogger.info('Servicio de notificaciones inicializado correctamente');
        } else {
          serverLogger.warn('El servicio de notificaciones no pudo ser inicializado');
        }

        // Iniciar sistema de jobs programados
        startJobs();
        serverLogger.info('Sistema de jobs programados iniciado');
      })
      .on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          // Si el puerto está en uso, intentar con otro puerto
          const newPort = PORT + 1;
          serverLogger.warn(`Puerto ${PORT} en uso, intentando con puerto ${newPort}`);
          server.close();
          app.listen(newPort, () => {
            serverLogger.info(`Servidor corriendo en http://localhost:${newPort}`);
            serverLogger.info(`Entorno: ${config.env}`);
            serverLogger.info(`API de Facturación SaaS lista y funcionando`);
            serverLogger.info(`Rutas API disponibles en http://localhost:${newPort}/api`);
            serverLogger.info(`Frontend disponible en http://localhost:${newPort}`);

            // Inicializar servicio de notificaciones
            const notificationInitialized = NotificationService.initialize();
            if (notificationInitialized) {
              serverLogger.info('Servicio de notificaciones inicializado correctamente');
            } else {
              serverLogger.warn('El servicio de notificaciones no pudo ser inicializado');
            }

            // Iniciar sistema de jobs programados
            startJobs();
            serverLogger.info('Sistema de jobs programados iniciado');
          });
        } else {
          // Log more details about the error
          console.error('Raw Server Startup Error:', err);
          serverLogger.error(
            {
              message: err.message,
              stack: err.stack,
              code: err.code,
              errno: err.errno,
              syscall: err.syscall,
            },
            'Error detallado al iniciar el servidor'
          );
          process.exit(1);
        }
      });

    // Habilitar el cierre correcto
    process.once('SIGINT', () => {
      serverLogger.info('Señal SIGINT recibida, cerrando servidor y bot');
      if (telegramBot && telegramBot.running) {
        serverLogger.info('Deteniendo bot de Telegram...');
        telegramBot.stop('SIGINT');
      } else if (telegramBot) {
        serverLogger.warn('Bot de Telegram no está corriendo, omitiendo stop()');
      }
      server.close(() => {
        process.exit(0);
      });
    });

    process.once('SIGTERM', () => {
      serverLogger.info('Señal SIGTERM recibida, cerrando servidor y bot');
      if (telegramBot && telegramBot.running) {
        serverLogger.info('Deteniendo bot de Telegram...');
        telegramBot.stop('SIGTERM');
      } else if (telegramBot) {
        serverLogger.warn('Bot de Telegram no está corriendo, omitiendo stop()');
      }
      server.close(() => {
        process.exit(0);
      });
    });
  } catch (error) {
    // Log errors during the initial setup phase (before app.listen)
    console.error('Raw Server Initialization Error:', error);
    serverLogger.error(
      {
        message: error.message,
        stack: error.stack,
        code: error.code,
        errno: error.errno,
        syscall: error.syscale,
      },
      'Error detallado durante la inicialización del servidor'
    );
    process.exit(1);
  }
}

// Iniciar el servidor
startServer();
