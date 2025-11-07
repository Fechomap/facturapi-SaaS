/**
 * Server - Main entry point for FacturAPI SaaS API
 * TypeScript Edition - Complete migration from server.js
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { config } from '@config/index.js';
import { connectDatabase } from '@config/database.js';
import { createModuleLogger } from '@core/utils/logger.js';
import routes from '@api/routes/index.js';
import { tenantMiddleware } from '@api/middlewares/tenant.middleware.js';
import errorMiddleware from '@api/middlewares/error.middleware.js';
import {
  generalRateLimit,
  invoiceRateLimit,
  queryRateLimit,
  authRateLimit,
} from '@api/middlewares/rate-limit.middleware.js';
import { sessionMiddleware } from '@api/middlewares/session.middleware.js';
import redisSessionService from '@services/redis-session.service.js';
import SafeOperationsService from '@services/safe-operations.service.js';
import { startJobs } from '@jobs/index.js';
import NotificationService from '@services/notification.service.js';
import { createBot } from '@bot/index.js';
import type { Bot } from '@/types/bot.types.js';

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server-specific logger
const serverLogger = createModuleLogger('Server');

// Variable for Telegram bot
let telegramBot: Bot | null = null;

/**
 * Initialize Telegram bot
 */
async function initializeTelegramBot(): Promise<Bot | null> {
  try {
    if (!config.telegram.token) {
      serverLogger.warn('Telegram token not configured');
      return null;
    }

    const botLogger = createModuleLogger('TelegramBot');
    telegramBot = await createBot(botLogger);

    if (config.env === 'production' && config.isRailway) {
      // In production use webhook
      const webhookUrl = `${config.api.baseUrl}/telegram-webhook`;
      await telegramBot.telegram.setWebhook(webhookUrl);
      serverLogger.info(`Telegram webhook configured: ${webhookUrl}`);
    } else {
      // In development or environments without webhook, use polling
      await telegramBot.launch();
      serverLogger.info('Telegram bot started in polling mode');
    }

    return telegramBot;
  } catch (error) {
    serverLogger.error({ error }, 'Error initializing Telegram bot');
    return null;
  }
}

/**
 * Initialize Express application
 */
async function initializeApp(): Promise<Application> {
  // Initialize Express application
  const app = express();

  // Configure CORS to allow requests from frontend
  app.use(
    cors({
      origin: ['http://localhost:3000', 'http://localhost:3001'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
    })
  );

  // Special configuration for webhooks
  app.use('/telegram-webhook', express.json());

  // === TELEGRAM WEBHOOK ===
  app.post('/telegram-webhook', async (req: Request, res: Response) => {
    try {
      if (telegramBot && telegramBot.handleUpdate) {
        await telegramBot.handleUpdate(req.body);
      }
      res.status(200).json({ ok: true });
    } catch (error) {
      serverLogger.error({ error }, 'Error in Telegram webhook');
      res.status(200).json({ ok: true });
    }
  });

  app.get('/telegram-webhook', (req: Request, res: Response) => {
    res.json({
      status: 'Telegram webhook active',
      bot_initialized: Boolean(telegramBot),
    });
  });

  // Middleware for JSON parsing for the rest of routes
  app.use(express.json());

  // === INITIALIZE REDIS FOR CLUSTERING ===
  await redisSessionService.initialize();
  serverLogger.info('Session service initialized for clustering');

  // === INITIALIZE REDIS LOCKS FOR MULTI-USER ===
  await SafeOperationsService.initialize();
  serverLogger.info('Safe operations service initialized for multi-user');

  // === SHARED SESSIONS FOR CLUSTERING ===
  app.use(
    sessionMiddleware({
      sessionName: 'facturapi_session',
      maxAge: 3600, // 1 hour
      secure: config.env === 'production',
    })
  );

  // === RATE LIMITING FOR SCALABILITY ===
  // General rate limiting for entire API
  app.use('/api', generalRateLimit);

  // Specific rate limiting for critical endpoints
  app.use('/api/invoices', invoiceRateLimit);
  app.use('/api/auth', authRateLimit);
  app.use('/api/customers', queryRateLimit);
  app.use('/api/subscriptions', queryRateLimit);

  // Middleware to extract tenant information
  app.use('/api', tenantMiddleware);

  // Register all routes under /api prefix
  app.use('/api', routes);

  // Configuration to serve static files from frontend
  const frontendPath = path.join(__dirname, 'frontend/build');
  app.use(express.static(frontendPath));

  // API route for basic information
  app.get('/api/info', (req: Request, res: Response) => {
    res.json({
      status: 'FacturAPI SaaS API active',
      environment: config.env,
      version: '1.0.0',
      telegram_bot: Boolean(telegramBot),
    });
  });

  // Any other route that is not API serves the frontend
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
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

  // Middleware for error handling
  app.use(errorMiddleware);

  return app;
}

/**
 * Main function to start the server
 */
async function startServer(): Promise<void> {
  try {
    // Connect to database
    await connectDatabase();
    serverLogger.info('Database connection established');

    // Initialize application
    const app = await initializeApp();

    // Initialize Telegram bot
    telegramBot = await initializeTelegramBot();

    // Application port from centralized configuration
    const PORT = process.env.PORT || config.api.port || 3000;

    // Start server with error handling for port in use
    const server = app
      .listen(PORT, () => {
        serverLogger.info(`Server running on http://localhost:${PORT}`);
        serverLogger.info(`Environment: ${config.env}`);
        serverLogger.info(`FacturAPI SaaS API ready and running`);
        serverLogger.info(`API routes available at http://localhost:${PORT}/api`);
        serverLogger.info(`Frontend available at http://localhost:${PORT}`);
        serverLogger.info(`Telegram bot: ${telegramBot ? 'Active' : 'Inactive'}`);

        // Initialize notification service
        const notificationInitialized = NotificationService.initialize();
        if (notificationInitialized) {
          serverLogger.info('Notification service initialized successfully');
        } else {
          serverLogger.warn('Notification service could not be initialized');
        }

        // Start scheduled jobs system
        startJobs();
        serverLogger.info('Scheduled jobs system started');
      })
      .on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // If port is in use, try with another port
          const newPort = Number(PORT) + 1;
          serverLogger.warn(`Port ${PORT} in use, trying port ${newPort}`);
          server.close();
          app.listen(newPort, () => {
            serverLogger.info(`Server running on http://localhost:${newPort}`);
            serverLogger.info(`Environment: ${config.env}`);
            serverLogger.info(`FacturAPI SaaS API ready and running`);
            serverLogger.info(`API routes available at http://localhost:${newPort}/api`);
            serverLogger.info(`Frontend available at http://localhost:${newPort}`);

            // Initialize notification service
            const notificationInitialized = NotificationService.initialize();
            if (notificationInitialized) {
              serverLogger.info('Notification service initialized successfully');
            } else {
              serverLogger.warn('Notification service could not be initialized');
            }

            // Start scheduled jobs system
            startJobs();
            serverLogger.info('Scheduled jobs system started');
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
            'Detailed error starting server'
          );
          process.exit(1);
        }
      });

    // Enable graceful shutdown
    process.once('SIGINT', () => {
      serverLogger.info('SIGINT signal received, closing server and bot');
      if (telegramBot && 'running' in telegramBot && telegramBot.running) {
        serverLogger.info('Stopping Telegram bot...');
        telegramBot.stop('SIGINT');
      } else if (telegramBot) {
        serverLogger.warn('Telegram bot is not running, skipping stop()');
      }
      server.close(() => {
        process.exit(0);
      });
    });

    process.once('SIGTERM', () => {
      serverLogger.info('SIGTERM signal received, closing server and bot');
      if (telegramBot && 'running' in telegramBot && telegramBot.running) {
        serverLogger.info('Stopping Telegram bot...');
        telegramBot.stop('SIGTERM');
      } else if (telegramBot) {
        serverLogger.warn('Telegram bot is not running, skipping stop()');
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
        message: (error as Error).message,
        stack: (error as Error).stack,
        code: (error as NodeJS.ErrnoException).code,
        errno: (error as NodeJS.ErrnoException).errno,
        syscall: (error as NodeJS.ErrnoException).syscall,
      },
      'Detailed error during server initialization'
    );
    process.exit(1);
  }
}

// Start the server
startServer();
