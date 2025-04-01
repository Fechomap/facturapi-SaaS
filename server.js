// server.js - Punto de entrada para la API
import express from 'express';
import { config, initConfig } from './config/index.js';
import { connectDatabase } from './config/database.js';
import logger from './core/utils/logger.js';
import routes from './api/routes/index.js';
import tenantMiddleware from './api/middlewares/tenant.middleware.js';
import errorMiddleware from './api/middlewares/error.middleware.js';
import { startJobs } from './jobs/index.js';
import NotificationService from './services/notification.service.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Definir __dirname para módulos ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logger específico para el servidor
const serverLogger = logger.child({ module: 'server' });

// Función para inicializar la aplicación Express
async function initializeApp() {
  // Inicializar configuración
  await initConfig();
  
  // Inicializar la aplicación Express
  const app = express();
  
  // Configuración especial para webhooks de Stripe (necesita el cuerpo raw)
  app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
  
  // Middleware para parsing JSON para el resto de rutas
  app.use(express.json());
  
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
      version: '1.0.0'
    });
  });
  
  // Cualquier otra ruta que no sea de API sirve el frontend
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
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
    
    // Puerto de la aplicación desde la configuración centralizada
    const PORT = process.env.PORT || config.port || 3000;
    
    // Iniciar el servidor
    app.listen(PORT, () => {
      serverLogger.info(`Servidor corriendo en http://localhost:${PORT}`);
      serverLogger.info(`Entorno: ${config.env}`);
      serverLogger.info(`API de Facturación SaaS lista y funcionando`);
      serverLogger.info(`Rutas API disponibles en http://localhost:${PORT}/api`);
      serverLogger.info(`Frontend disponible en http://localhost:${PORT}`);
      
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
  } catch (error) {
    serverLogger.error({ error }, 'Error al iniciar el servidor');
    process.exit(1);
  }
}

// Iniciar el servidor
startServer();
