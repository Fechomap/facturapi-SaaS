// config/database.js
import logger from '../core/utils/logger.js';

// Logger específico para base de datos
const dbLogger = logger.child({ module: 'database-config' });

/**
 * Configuración optimizada de base de datos para escalabilidad
 */
export const getDatabaseConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // URL base de la base de datos
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    throw new Error('DATABASE_URL no está configurada');
  }
  
  // Configuración de connection pooling para escalabilidad
  const poolConfig = new URLSearchParams({
    // Conexiones concurrentes (adaptado según entorno)
    connection_limit: isProduction ? '20' : '10',
    
    // Timeout para obtener conexión del pool (20 segundos)
    pool_timeout: '20',
    
    // Timeout para queries individuales (30 segundos)
    socket_timeout: '30',
    
    // Conexiones idle antes de cerrar (2 minutos)
    idle_timeout: '120',
    
    // Vida máxima de conexión (10 minutos)
    max_lifetime: '600'
  });
  
  // Agregar parámetros de pooling si no están presentes
  const url = new URL(databaseUrl);
  
  // Solo agregar parámetros si no existen
  for (const [key, value] of poolConfig) {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  }
  
  const optimizedUrl = url.toString();
  
  dbLogger.info('Configuración de base de datos optimizada', {
    environment: process.env.NODE_ENV,
    connectionLimit: url.searchParams.get('connection_limit'),
    poolTimeout: url.searchParams.get('pool_timeout'),
    socketTimeout: url.searchParams.get('socket_timeout')
  });
  
  return {
    url: optimizedUrl,
    config: {
      connection_limit: parseInt(url.searchParams.get('connection_limit') || '10'),
      pool_timeout: parseInt(url.searchParams.get('pool_timeout') || '20'),
      socket_timeout: parseInt(url.searchParams.get('socket_timeout') || '30')
    }
  };
};

/**
 * Validar que la configuración de BD sea adecuada para escalabilidad
 */
export const validateDatabaseConfig = () => {
  const warnings = [];
  const config = getDatabaseConfig();
  
  // Validaciones para escalabilidad
  if (config.config.connection_limit < 10) {
    warnings.push('Connection limit muy bajo para escalabilidad (recomendado: 10+)');
  }
  
  if (config.config.pool_timeout < 10) {
    warnings.push('Pool timeout muy bajo (recomendado: 10+ segundos)');
  }
  
  if (config.config.socket_timeout < 20) {
    warnings.push('Socket timeout muy bajo para operaciones complejas (recomendado: 20+ segundos)');
  }
  
  // Mostrar advertencias
  if (warnings.length > 0) {
    warnings.forEach(warning => dbLogger.warn(warning));
  } else {
    dbLogger.info('Configuración de base de datos validada para escalabilidad');
  }
  
  return {
    isValid: warnings.length === 0,
    warnings,
    config: config.config
  };
};

// Importar y reexportar prisma
import prismaInstance from '../lib/prisma.js';
export const prisma = prismaInstance;

/**
 * Función para conectar a la base de datos (dummy para compatibilidad)
 * En Prisma la conexión es automática
 */
export const connectDatabase = async () => {
  const dbConfig = getDatabaseConfig();
  const validation = validateDatabaseConfig();
  
  if (!validation.isValid) {
    throw new Error(`Configuración de BD inválida: ${validation.warnings.join(', ')}`);
  }
  
  return {
    success: true,
    message: 'Configuración de base de datos validada',
    config: validation.config
  };
};

/**
 * Función para desconectar de la base de datos
 */
export const disconnectDatabase = async () => {
  // En Prisma la desconexión se maneja automáticamente
  return { success: true, message: 'Base de datos desconectada' };
};

export default {
  getDatabaseConfig,
  validateDatabaseConfig,
  connectDatabase,
  disconnectDatabase
};