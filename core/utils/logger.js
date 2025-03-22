// core/utils/logger.js
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Obtiene el directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '../../logs');

// Asegura que el directorio de logs exista
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Configuración según el entorno
const isDevelopment = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';

// Define la configuración base del logger
const baseConfig = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    pid: process.pid,
    hostname: process.env.HOSTNAME || 'unknown',
    env: process.env.NODE_ENV || 'unknown',
  },
};

// Configura las opciones dependiendo del entorno
let transport;
if (isDevelopment || process.stdout.isTTY) {
  transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  };
} else if (!isTest) {
  // En producción, escribe a un archivo y rota por día
  const date = new Date().toISOString().split('T')[0];
  transport = {
    target: 'pino/file',
    options: { destination: path.join(logsDir, `${date}.log`) },
  };
}

// Crea la instancia del logger
const logger = pino(
  baseConfig,
  transport ? pino.transport(transport) : undefined
);

// Exporta el logger directamente
export default logger;

// Función para crear un logger específico para un módulo
export function createModuleLogger(moduleName) {
  return logger.child({ module: moduleName });
}