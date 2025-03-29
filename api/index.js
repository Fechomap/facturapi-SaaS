// api/index.js
import express from 'express';
import routes from './routes/index.js';
import errorMiddleware from './middlewares/error.middleware.js';
import tenantMiddleware from './middlewares/tenant.middleware.js';

/**
 * Configura la aplicación Express con todas las rutas y middlewares
 * @param {Object} app - Instancia de Express
 * @param {Object} options - Opciones de configuración
 */
function setupAPI(app, options = {}) {
  // Configuración especial para webhooks que necesitan el cuerpo raw
  app.use(['/api/webhooks/stripe', '/api/webhooks/facturapi'], express.raw({ type: 'application/json' }));
  
  // Registrar middleware de parsing de JSON para las demás rutas
  app.use(express.json());
  
  // Middleware para extraer información de tenant
  app.use('/api', tenantMiddleware);
  
  // Registrar todas las rutas bajo el prefijo /api
  app.use('/api', routes);
  
  // Middleware de manejo de errores (debe ser el último)
  app.use(errorMiddleware);
  
  return app;
}

export default setupAPI;