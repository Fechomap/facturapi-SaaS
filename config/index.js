// config/index.js - Configuración corregida
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

import logger from '../core/utils/logger.js';
import { facturapiConfig, stripeConfig, validateServicesConfig } from './services.js';
import { authConfig, validateAuthConfig } from './auth.js';
import { prisma, connectDatabase } from './database.js';

// Logger específico para configuración
const configLogger = logger.child({ module: 'config' });

// Determinar el entorno actual
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_RAILWAY = process.env.IS_RAILWAY === 'true' || Boolean(process.env.RAILWAY_ENVIRONMENT);
const IS_HEROKU = process.env.IS_HEROKU === 'true' || Boolean(process.env.DYNO);

// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno
if (IS_RAILWAY) {
  configLogger.info('Detectado entorno Railway, usando variables de entorno configuradas');
  dotenv.config();
} else if (IS_HEROKU) {
  configLogger.info('Detectado entorno Heroku, usando variables de entorno configuradas');
  dotenv.config();
} else {
  configLogger.info('Cargando variables de entorno desde: .env');
  dotenv.config();
}

// Función para validar variables de entorno críticas
const validateEnv = () => {
  const requiredVars = [];
  
  // Si estamos ejecutando el bot, necesitamos el token de Telegram
  const executedFile = process.argv[1];
  if (executedFile && executedFile.includes('bot.js')) {
    requiredVars.push('TELEGRAM_BOT_TOKEN');
  }
  
  // Para cualquier entorno, necesitamos la URL de la base de datos
  requiredVars.push('DATABASE_URL');
  
  // NOTA: Variables CLIENTE_* removidas - ya no se requieren en sistema multitenant
  
  // Para operaciones administrativas de FacturAPI
  requiredVars.push('FACTURAPI_USER_KEY');
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    configLogger.error(`Variables de entorno requeridas no encontradas: ${missing.join(', ')}`);
    if (IS_RAILWAY) {
      configLogger.error(`Por favor, configura estas variables en el dashboard de Railway`);
    } else if (IS_HEROKU) {
      configLogger.error(`Por favor, configura estas variables en el dashboard de Heroku`);
    } else {
      configLogger.error(`Por favor, configura estas variables en tu archivo .env`);
    }
    process.exit(1);
  }
};

// Normalizar la URL base para evitar problemas de slash al final
function normalizeBaseUrl(url) {
  if (!url) return '';
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

// Determinar la URL base según el entorno
let apiBaseUrlConfig;

if (IS_RAILWAY) {
  const railwayUrl = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayUrl) {
    apiBaseUrlConfig = `https://${railwayUrl}`;
  } else if (process.env.API_BASE_URL) {
    apiBaseUrlConfig = process.env.API_BASE_URL;
  } else {
    configLogger.warn('No se encontró RAILWAY_PUBLIC_DOMAIN ni API_BASE_URL, usando valor genérico');
    apiBaseUrlConfig = 'https://app.railway.app';
  }
  configLogger.info(`Entorno Railway detectado, usando URL base: ${apiBaseUrlConfig}`);
} else if (IS_HEROKU) {
  const herokuAppName = process.env.HEROKU_APP_NAME;
  if (herokuAppName) {
    apiBaseUrlConfig = `https://${herokuAppName}.herokuapp.com`;
  } else if (process.env.API_BASE_URL) {
    apiBaseUrlConfig = process.env.API_BASE_URL;
  } else {
    configLogger.warn('No se encontró HEROKU_APP_NAME ni API_BASE_URL, usando valor genérico');
    apiBaseUrlConfig = 'https://app.herokuapp.com';
  }
  configLogger.info(`Entorno Heroku detectado, usando URL base: ${apiBaseUrlConfig}`);
} else if (process.env.API_BASE_URL) {
  apiBaseUrlConfig = process.env.API_BASE_URL;
  configLogger.info(`Usando API_BASE_URL desde variables de entorno: ${apiBaseUrlConfig}`);
} else {
  // Para desarrollo local, asegurarnos de usar el puerto correcto
  const localPort = process.env.PORT || 3000;
  apiBaseUrlConfig = `http://localhost:${localPort}`;
  configLogger.info(`API_BASE_URL no definida, usando URL local: ${apiBaseUrlConfig}`);
}

// Normalizar la URL base
apiBaseUrlConfig = normalizeBaseUrl(apiBaseUrlConfig);
configLogger.info(`URL base normalizada: ${apiBaseUrlConfig}`);

// Configuración unificada
const config = {
  // Entorno de la aplicación y plataforma
  env: NODE_ENV,
  isRailway: IS_RAILWAY,
  isHeroku: IS_HEROKU,
  
  // Puerto para el servidor
  port: process.env.PORT || 3000,
  
  // Configuración de FacturAPI
  facturapi: facturapiConfig,
  
  // Configuración del Bot de Telegram
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    authorizedUsers: authConfig.telegram.authorizedUsers,
    // FIX: Añadir adminChatIds que estaba faltando
    adminChatIds: process.env.ADMIN_CHAT_IDS 
      ? process.env.ADMIN_CHAT_IDS.split(',').map(id => id.trim())
      : []
  },
  
  // URL base para las solicitudes del bot a la API
  apiBaseUrl: apiBaseUrlConfig,
  
  // NOTA: IDs de clientes removidos - sistema multitenant
  
  // Base de datos
  database: {
    url: process.env.DATABASE_URL,
    prisma,
    connect: connectDatabase
  },
  
  // Configuración de Stripe
  stripe: stripeConfig,
  
  // Configuración de autenticación
  auth: authConfig,
  
  // Configuración de almacenamiento
  storage: {
    basePath: IS_RAILWAY || IS_HEROKU
      ? '/tmp/storage' // En Railway y Heroku usamos /tmp
      : path.resolve(__dirname, '../storage'),
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10)
  },
  
  // Helper para construir URLs de API
  buildApiUrl: function(path) {
    const pathWithLeadingSlash = path.startsWith('/') ? path : `/${path}`;
    return `${this.apiBaseUrl}${pathWithLeadingSlash}`;
  },
  
  // Función para obtener una representación segura de la configuración
  getSafeConfig: function() {
    return {
      env: this.env,
      isRailway: this.isRailway,
      isHeroku: this.isHeroku,
      port: this.port,
      apiBaseUrl: this.apiBaseUrl,
      facturapi: {
        apiVersion: this.facturapi.apiVersion,
        userKey: this.facturapi.userKey ? `${this.facturapi.userKey.substring(0, 4)}...` : 'no configurada'
      },
      telegram: {
        token: this.telegram.token ? `${this.telegram.token.substring(0, 8)}...` : 'no configurado',
        authorizedUsers: this.telegram.authorizedUsers.length 
          ? `${this.telegram.authorizedUsers.length} usuarios autorizados` 
          : 'Todos los usuarios',
        adminChatIds: this.telegram.adminChatIds.length 
          ? `${this.telegram.adminChatIds.length} admins configurados`
          : 'Sin admins configurados'
      },
      // NOTA: Configuración de clientes removida - sistema multitenant
      database: {
        url: this.database.url ? 'configurada' : 'no configurada'
      },
      storage: {
        basePath: this.storage.basePath,
        maxFileSizeMB: this.storage.maxFileSizeMB
      }
    };
  }
};

// Función para inicializar y validar toda la configuración
const initConfig = async () => {
  // Validar variables de entorno
  validateEnv();
  
  // Validar configuración de servicios
  validateServicesConfig();
  
  // Validar configuración de autenticación
  validateAuthConfig();
  
  // Mostrar configuración segura
  configLogger.info('Configuración cargada correctamente');
  configLogger.debug(config.getSafeConfig(), 'Configuración segura');
  
  return config;
};

// Exportar el módulo
export { config, validateEnv, initConfig };
export default config;