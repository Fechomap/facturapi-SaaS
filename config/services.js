// config/services.js
import logger from '../core/utils/logger.js';

// Logger específico para servicios externos
const servicesLogger = logger.child({ module: 'external-services' });

// Configuración de FacturAPI con timeouts adaptativos
const facturapiConfig = {
  // Clave de usuario para operaciones administrativas
  userKey: process.env.FACTURAPI_USER_KEY,
  
  apiVersion: 'v2',
  
  // URL base
  baseUrl: 'https://www.facturapi.io',
  
  // Timeouts adaptativos según el tipo de operación
  timeouts: {
    // Operaciones rápidas (obtener cliente, catálogos)
    quick: 5000,   // 5 segundos
    
    // Operaciones normales (crear factura)
    normal: 10000, // 10 segundos
    
    // Operaciones lentas (upload certificados, downloads)
    slow: 30000,   // 30 segundos
    
    // Operaciones críticas (renovar API keys)
    critical: 45000 // 45 segundos
  },
  
  // Timeout por defecto (para compatibilidad)
  timeout: 10000, // Reducido de 30s a 10s
  
  // Número de reintentos para solicitudes fallidas
  retries: 3,
  
  // Factor de backoff para reintentos
  retryBackoff: 1.5,
};

// Configuración de Stripe
const stripeConfig = {
  secretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  
  // API version
  apiVersion: '2023-10-16',
  
  // Configuración de productos/precios
  products: {
    // Aquí podríamos mapear nuestros planes a IDs de productos en Stripe
  },
};

// NOTA: IDs de clientes removidos - sistema multitenant usa búsqueda dinámica

// Comprobar la configuración crítica e imprimir advertencias
function validateServicesConfig() {
  const warnings = [];

  // Validar FacturAPI
  if (!facturapiConfig.userKey) {
    warnings.push(`FACTURAPI_USER_KEY no está configurada. Algunas operaciones administrativas con FacturAPI no funcionarán.`);
  }
  
  // Validar Stripe
  if (!stripeConfig.secretKey) {
    warnings.push('STRIPE_SECRET_KEY no está configurada. La integración con Stripe no funcionará.');
  }
  
  if (!stripeConfig.webhookSecret) {
    warnings.push('STRIPE_WEBHOOK_SECRET no está configurada. Los webhooks de Stripe no funcionarán correctamente.');
  }
  
  // NOTA: Validación de clientes removida - sistema multitenant
  
  // Mostrar advertencias
  if (warnings.length > 0) {
    warnings.forEach(warning => servicesLogger.warn(warning));
  } else {
    servicesLogger.info('Configuración de servicios externos validada correctamente');
  }

  return warnings;
}

export {
  facturapiConfig,
  stripeConfig,
  validateServicesConfig
};
