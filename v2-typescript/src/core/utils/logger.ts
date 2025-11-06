/**
 * Logger utility using Pino
 * Provides structured logging with environment-specific configuration
 */

import pino, { Logger } from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get current directory (ES Modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '../../../logs');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Environment detection
const isDevelopment = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';
const logLevel = (process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info')) as pino.Level;

// Base logger configuration
const baseConfig: pino.LoggerOptions = {
  level: logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    pid: process.pid,
    hostname: process.env.HOSTNAME || 'unknown',
    env: process.env.NODE_ENV || 'unknown',
  },
};

// Configure transport based on environment
let transport: pino.TransportTargetOptions | undefined;

if (isDevelopment || process.stdout.isTTY) {
  // Development: Pretty print to console
  transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  };
} else if (!isTest) {
  // Production: Write to rotating log files
  const date = new Date().toISOString().split('T')[0];
  transport = {
    target: 'pino/file',
    options: { destination: path.join(logsDir, `${date}.log`) },
  };
}

// Create logger instance
const logger: Logger = pino(baseConfig, transport ? pino.transport(transport) : undefined);

/**
 * Creates a child logger for a specific module
 * @param moduleName - Name of the module (e.g., 'FacturapiService', 'TenantController')
 * @returns Child logger instance with module context
 */
export function createModuleLogger(moduleName: string): Logger {
  return logger.child({ module: moduleName });
}

/**
 * Default logger instance
 */
export default logger;
