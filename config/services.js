// config/services.js
import logger from '../core/utils/logger.js';

// Logger específico para servicios externos
const servicesLogger = logger.child({ module: 'external-services' });

// Configuración de FacturAPI
const facturapiConfig = {
  // Determina si usamos el entorno de producción o pruebas
  // Esto SOLO depende de la variable FACTURAPI_ENV, no de NODE_ENV
  isProduction: process.env.FACTURAPI_ENV === 'production',
  
  // Clave API (dependiendo del entorno FacturAPI)
  apiKey: process.env.FACTURAPI_ENV === 'production'
    ? process.env.FACTURAPI_LIVE_KEY
    : process.env.FACTURAPI_TEST_KEY,
  
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

// IDs de clientes predefinidos
const clientesIds = {
  INFOASIST: process.env.CLIENTE_INFOASIST,
  SOS: process.env.CLIENTE_SOS,
  ARSA: process.env.CLIENTE_ARSA,
  CHUBB: process.env.CLIENTE_CHUBB
};

// Comprobar la configuración crítica e imprimir advertencias
function validateServicesConfig() {
  const warnings = [];

  // Validar FacturAPI
  if (!facturapiConfig.apiKey) {
    const envVar = facturapiConfig.isProduction ? 'FACTURAPI_LIVE_KEY' : 'FACTURAPI_TEST_KEY';
    warnings.push(`${envVar} no está configurada. La integración con FacturAPI no funcionará.`);
  }
  
  // Validar Stripe
  if (!stripeConfig.secretKey) {
    warnings.push('STRIPE_SECRET_KEY no está configurada. La integración con Stripe no funcionará.');
  }
  
  if (!stripeConfig.webhookSecret) {
    warnings.push('STRIPE_WEBHOOK_SECRET no está configurada. Los webhooks de Stripe no funcionarán correctamente.');
  }
  
  // Validar clientes predefinidos
  Object.entries(clientesIds).forEach(([nombre, id]) => {
    if (!id) {
      warnings.push(`CLIENTE_${nombre} no está configurado. Las funcionalidades relacionadas podrían fallar.`);
    }
  });
  
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
  clientesIds,
  validateServicesConfig
};