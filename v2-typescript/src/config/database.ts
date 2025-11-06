/**
 * Database Configuration
 * Optimized configuration for scalability with connection pooling
 */

import { createModuleLogger } from '@core/utils/logger.js';
import prismaInstance from '../lib/prisma.js';

const dbLogger = createModuleLogger('DatabaseConfig');

interface DatabaseConfig {
  connection_limit: number;
  pool_timeout: number;
  socket_timeout: number;
}

interface DatabaseConfigResult {
  url: string;
  config: DatabaseConfig;
}

interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  config: DatabaseConfig;
}

/**
 * Get optimized database configuration
 */
export const getDatabaseConfig = (): DatabaseConfigResult => {
  const isProduction = process.env.NODE_ENV === 'production';

  // Base database URL
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }

  // Connection pooling configuration for scalability
  const poolConfig = new URLSearchParams({
    // Concurrent connections (adapted by environment)
    connection_limit: isProduction ? '20' : '10',

    // Timeout to get connection from pool (20 seconds)
    pool_timeout: '20',

    // Timeout for individual queries (30 seconds)
    socket_timeout: '30',

    // Idle connections before closing (2 minutes)
    idle_timeout: '120',

    // Max connection lifetime (10 minutes)
    max_lifetime: '600',
  });

  // Add pooling parameters if not present
  const url = new URL(databaseUrl);

  // Only add parameters if they don't exist
  for (const [key, value] of poolConfig) {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  }

  const optimizedUrl = url.toString();

  dbLogger.info(
    {
      environment: process.env.NODE_ENV,
      connectionLimit: url.searchParams.get('connection_limit'),
      poolTimeout: url.searchParams.get('pool_timeout'),
      socketTimeout: url.searchParams.get('socket_timeout'),
    },
    'Database configuration optimized'
  );

  return {
    url: optimizedUrl,
    config: {
      connection_limit: parseInt(url.searchParams.get('connection_limit') || '10'),
      pool_timeout: parseInt(url.searchParams.get('pool_timeout') || '20'),
      socket_timeout: parseInt(url.searchParams.get('socket_timeout') || '30'),
    },
  };
};

/**
 * Validate database configuration for scalability
 */
export const validateDatabaseConfig = (): ValidationResult => {
  const warnings: string[] = [];
  const config = getDatabaseConfig();

  // Scalability validations
  if (config.config.connection_limit < 10) {
    warnings.push('Connection limit too low for scalability (recommended: 10+)');
  }

  if (config.config.pool_timeout < 10) {
    warnings.push('Pool timeout too low (recommended: 10+ seconds)');
  }

  if (config.config.socket_timeout < 20) {
    warnings.push('Socket timeout too low for complex operations (recommended: 20+ seconds)');
  }

  // Show warnings
  if (warnings.length > 0) {
    warnings.forEach((warning) => dbLogger.warn(warning));
  } else {
    dbLogger.info('Database configuration validated for scalability');
  }

  return {
    isValid: warnings.length === 0,
    warnings,
    config: config.config,
  };
};

// Export Prisma instance
export const prisma = prismaInstance;

/**
 * Connect to database (validates configuration)
 * In Prisma, connection is automatic
 */
export const connectDatabase = async () => {
  const validation = validateDatabaseConfig();

  if (!validation.isValid) {
    throw new Error(`Invalid database configuration: ${validation.warnings.join(', ')}`);
  }

  return {
    success: true,
    message: 'Database configuration validated',
    config: validation.config,
  };
};

/**
 * Disconnect from database
 */
export const disconnectDatabase = async () => {
  await prisma.$disconnect();
  return { success: true, message: 'Database disconnected' };
};

export default {
  getDatabaseConfig,
  validateDatabaseConfig,
  connectDatabase,
  disconnectDatabase,
  prisma,
};
