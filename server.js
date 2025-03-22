// server.js - Punto de entrada para la API
import express from 'express';
import { config, initConfig } from './config/index.js';
import { connectDatabase } from './config/database.js';
import logger from './core/utils/logger.js';

// Logger específico para el servidor
const serverLogger = logger.child({ module: 'server' });

// Función para inicializar la aplicación Express
async function initializeApp() {
  // Inicializar configuración
  await initConfig();
  
  // Inicializar la aplicación Express
  const app = express();
  
  // Middleware para parsing JSON
  app.use(express.json());
  
  // Ruta principal para probar que el servidor está funcionando
  app.get('/', (req, res) => {
    res.json({
      status: 'API de Facturación activa - FacturAPI SaaS',
      environment: config.env,
      version: '1.0.0'
    });
  });
  
  // Middleware para manejo de errores
  app.use((err, req, res, next) => {
    serverLogger.error({ err, path: req.path }, 'Error en la API');
    
    // Si ya se ha enviado una respuesta, pasar al siguiente middleware
    if (res.headersSent) {
      return next(err);
    }
    
    // Errores específicos de FacturAPI
    if (err.response && err.response.data) {
      return res.status(err.response.status || 400).json({
        error: err.message,
        details: err.response.data
      });
    }
    
    // Error genérico
    res.status(500).json({
      error: 'Error interno del servidor',
      message: err.message
    });
  });
  
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
    const PORT = config.port;
    
    // Iniciar el servidor
    app.listen(PORT, () => {
      serverLogger.info(`Servidor corriendo en http://localhost:${PORT}`);
      serverLogger.info(`Entorno: ${config.env}`);
      serverLogger.info(`API de Facturación SaaS lista y funcionando`);
    });
  } catch (error) {
    serverLogger.error({ error }, 'Error al iniciar el servidor');
    process.exit(1);
  }
}

// Iniciar el servidor
startServer();