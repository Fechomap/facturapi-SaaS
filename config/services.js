// config/services.js
import logger from '../core/utils/logger.js';

// Logger específico para servicios externos
const servicesLogger = logger.child({ module: 'external-services' });

// Configuración de FacturAPI
const facturapiConfig = {
  // Clave de usuario para operaciones administrativas
  userKey: process.env.FACTURAPI_USER_KEY,
  
  apiVersion: 'v2',
  
  // URL base
  baseUrl: 'https://www.facturapi.io',
  
  // Timeout para solicitudes en milisegundos
  timeout: 30000,
  
  // Número de reintentos para solicitudes fallidas
  retries: 3,
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
