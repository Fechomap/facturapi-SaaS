/**
 * External Services Configuration
 * Configuración de servicios externos (FacturAPI, Stripe, etc.)
 */

import { createModuleLogger } from '@core/utils/logger.js';

const servicesLogger = createModuleLogger('external-services');

// Configuración de FacturAPI con timeouts adaptativos
export interface FacturapiConfig {
  // Clave de usuario para operaciones administrativas
  userKey: string;

  apiVersion: string;

  // URL base
  baseUrl: string;

  // Timeouts adaptativos según el tipo de operación
  timeouts: {
    // Operaciones rápidas (obtener cliente, catálogos)
    quick: number;

    // Operaciones normales (crear factura)
    normal: number;

    // Operaciones lentas (upload certificados, downloads)
    slow: number;

    // Operaciones críticas (renovar API keys)
    critical: number;
  };

  // Timeout por defecto (para compatibilidad)
  timeout: number;

  // Número de reintentos para solicitudes fallidas
  retries: number;

  // Factor de backoff para reintentos
  retryBackoff: number;
}

export const facturapiConfig: FacturapiConfig = {
  // Clave de usuario para operaciones administrativas
  userKey: process.env.FACTURAPI_USER_KEY || '',

  apiVersion: 'v2',

  // URL base
  baseUrl: 'https://www.facturapi.io',

  // Timeouts adaptativos según el tipo de operación
  timeouts: {
    // Operaciones rápidas (obtener cliente, catálogos)
    quick: 5000, // 5 segundos

    // Operaciones normales (crear factura)
    normal: 10000, // 10 segundos

    // Operaciones lentas (upload certificados, downloads)
    slow: 30000, // 30 segundos

    // Operaciones críticas (renovar API keys)
    critical: 45000, // 45 segundos
  },

  // Timeout por defecto (para compatibilidad)
  timeout: 10000, // Reducido de 30s a 10s

  // Número de reintentos para solicitudes fallidas
  retries: 3,

  // Factor de backoff para reintentos
  retryBackoff: 1.5,
};

// Configuración de Stripe
export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;

  // API version
  apiVersion: string;

  // Configuración de productos/precios
  products: Record<string, any>;

  // Timeouts
  timeout: number;
}

export const stripeConfig: StripeConfig = {
  secretKey: process.env.STRIPE_SECRET_KEY || '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',

  // API version
  apiVersion: '2023-10-16',

  // Configuración de productos/precios
  products: {
    // Aquí podríamos mapear nuestros planes a IDs de productos en Stripe
  },

  // Timeouts
  timeout: 30000, // 30 segundos
};

// Configuración de Redis
export interface RedisConfig {
  url: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;

  // Timeouts
  connectTimeout: number;
  commandTimeout: number;

  // Reintentos
  retryStrategy: (times: number) => number | null;

  // Opciones de conexión
  maxRetriesPerRequest: number;
  enableReadyCheck: boolean;
  lazyConnect: boolean;
}

export const redisConfig: RedisConfig = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : undefined,
  password: process.env.REDIS_PASSWORD,
  db: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB, 10) : 0,

  // Timeouts
  connectTimeout: 10000, // 10 segundos
  commandTimeout: 5000, // 5 segundos

  // Estrategia de reintentos
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    if (times > 10) {
      servicesLogger.error('Redis: Max retry attempts reached');
      return null;
    }
    return delay;
  },

  // Opciones de conexión
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
};

/**
 * Comprobar la configuración crítica e imprimir advertencias
 */
export function validateServicesConfig(): string[] {
  const warnings: string[] = [];

  // Validar FacturAPI
  if (!facturapiConfig.userKey) {
    warnings.push(
      'FACTURAPI_USER_KEY no está configurada. Algunas operaciones administrativas con FacturAPI no funcionarán.'
    );
    servicesLogger.warn('FACTURAPI_USER_KEY no configurada');
  } else {
    servicesLogger.info('FacturAPI configurado correctamente');
  }

  // Validar Stripe (opcional)
  if (!stripeConfig.secretKey) {
    warnings.push(
      'STRIPE_SECRET_KEY no está configurada. La integración con Stripe no funcionará.'
    );
    servicesLogger.warn('Stripe no configurado (opcional)');
  }

  if (!stripeConfig.webhookSecret && stripeConfig.secretKey) {
    warnings.push(
      'STRIPE_WEBHOOK_SECRET no está configurada. Los webhooks de Stripe no funcionarán correctamente.'
    );
  }

  // Validar Redis
  if (!redisConfig.url && !redisConfig.host) {
    warnings.push(
      'REDIS_URL o REDIS_HOST no están configurados. Las funcionalidades de cache y locks no funcionarán.'
    );
    servicesLogger.warn('Redis no configurado');
  } else {
    servicesLogger.info('Redis configurado correctamente');
  }

  // Mostrar advertencias
  if (warnings.length > 0) {
    warnings.forEach((warning) => servicesLogger.warn(warning));
  } else {
    servicesLogger.info('Configuración de servicios externos validada correctamente');
  }

  return warnings;
}

// Validar al cargar
const warnings = validateServicesConfig();

export default {
  facturapi: facturapiConfig,
  stripe: stripeConfig,
  redis: redisConfig,
  validate: validateServicesConfig,
};
