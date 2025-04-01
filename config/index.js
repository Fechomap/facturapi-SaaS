// config/index.js - Configuración centralizada para API y Bot
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

import logger from '../core/utils/logger.js';
import { facturapiConfig, stripeConfig, clientesIds, validateServicesConfig } from './services.js';
import { authConfig, validateAuthConfig } from './auth.js';
import { prisma, connectDatabase } from './database.js';

// Logger específico para configuración
const configLogger = logger.child({ module: 'config' });

// Determinar el entorno actual
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_HEROKU = process.env.IS_HEROKU === 'true' || Boolean(process.env.DYNO);

// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno
if (IS_HEROKU) {
  // En Heroku, las variables se configuran en el dashboard
  configLogger.info('Detectado entorno Heroku, usando variables de entorno configuradas');
  // dotenv.config() no es necesario en Heroku, pero lo hacemos por si hay un .env local
  dotenv.config();
} else {
  // En entorno local, intentar cargar desde archivos .env específicos
  const envFilePath = path.resolve(__dirname, `../.env.${NODE_ENV}`);
  
  if (fs.existsSync(envFilePath)) {
    configLogger.info(`Cargando variables de entorno desde: .env.${NODE_ENV}`);
    dotenv.config({ path: envFilePath });
  } else {
    // Si no existe, cargar el .env normal
    configLogger.info('Archivo .env específico no encontrado, usando .env por defecto');
    dotenv.config();
  }
}

// Función para validar variables de entorno críticas
const validateEnv = () => {
  const requiredVars = [];
  
  // Variables comunes requeridas - solo verificamos la API key apropiada
  // según el FACTURAPI_ENV, no según NODE_ENV
  if (process.env.FACTURAPI_ENV === 'production') {
    requiredVars.push('FACTURAPI_LIVE_KEY');
  } else {
    // En modo test de Facturapi necesitamos la clave de prueba
    requiredVars.push('FACTURAPI_TEST_KEY');
  }
  
  // Si estamos ejecutando el bot, necesitamos el token de Telegram
  const executedFile = process.argv[1];
  if (executedFile && executedFile.includes('bot.js')) {
    requiredVars.push('TELEGRAM_BOT_TOKEN');
  }
  
  // Para cualquier entorno, necesitamos la URL de la base de datos
  requiredVars.push('DATABASE_URL');
  
  // Para cualquier entorno, necesitamos los IDs de clientes
  requiredVars.push('CLIENTE_INFOASIST', 'CLIENTE_SOS', 'CLIENTE_ARSA', 'CLIENTE_CHUBB');
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    configLogger.error(`Variables de entorno requeridas no encontradas: ${missing.join(', ')}`);
    if (IS_HEROKU) {
      configLogger.error(`Por favor, configura estas variables en el dashboard de Heroku`);
    } else {
      configLogger.error(`Por favor, configura estas variables en tu archivo .env.${NODE_ENV}`);
    }
    process.exit(1); // Terminar la aplicación
  }
};

// Normalizar la URL base para evitar problemas de slash al final
function normalizeBaseUrl(url) {
  if (!url) return '';
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

// Determinar la URL base según el entorno
let apiBaseUrlConfig;

if (IS_HEROKU) {
  // En Heroku usamos la URL de la aplicación
  const herokuAppName = process.env.HEROKU_APP_NAME;
  if (herokuAppName) {
    apiBaseUrlConfig = `https://${herokuAppName}.herokuapp.com`;
  } else if (process.env.API_BASE_URL) {
    // Si no se definió el nombre de la app pero sí la URL base
    apiBaseUrlConfig = process.env.API_BASE_URL;
  } else {
    // Fallback para Heroku si no tenemos ninguno de los anteriores
    configLogger.warn('No se encontró HEROKU_APP_NAME ni API_BASE_URL, usando valor genérico');
    apiBaseUrlConfig = 'https://app.herokuapp.com'; // El usuario debería configurar esto
  }
  configLogger.info(`Entorno Heroku detectado, usando URL base: ${apiBaseUrlConfig}`);
} else if (process.env.API_BASE_URL) {
  // Si existe la variable de entorno en desarrollo, usarla (para casos especiales)
  apiBaseUrlConfig = process.env.API_BASE_URL;
  configLogger.info(`Usando API_BASE_URL desde variables de entorno: ${apiBaseUrlConfig}`);
} else {
  // URL local basada en el puerto para desarrollo
  apiBaseUrlConfig = `http://localhost:${process.env.PORT || 3000}`;
  configLogger.info(`API_BASE_URL no definida, usando URL local: ${apiBaseUrlConfig}`);
}

// Normalizar la URL base (quitar slash final si existe)
apiBaseUrlConfig = normalizeBaseUrl(apiBaseUrlConfig);
configLogger.info(`URL base normalizada: ${apiBaseUrlConfig}`);

// Configuración unificada
const config = {
  // Entorno de la aplicación y plataforma
  env: NODE_ENV,
  isHeroku: IS_HEROKU,
  
  // Puerto para el servidor
  port: process.env.PORT || 3000,
  
  // Configuración de FacturAPI
  facturapi: facturapiConfig,
  
  // Configuración del Bot de Telegram
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    authorizedUsers: authConfig.telegram.authorizedUsers
  },
  
  // URL base para las solicitudes del bot a la API
  apiBaseUrl: apiBaseUrlConfig,
  
  // IDs de clientes
  clientes: clientesIds,
  
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
    basePath: IS_HEROKU 
      ? '/tmp/storage' // En Heroku usamos /tmp porque el filesystem normal es efímero
      : path.resolve(__dirname, '../storage'),
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10)
  },
  
  // Helper para construir URLs de API
  buildApiUrl: function(path) {
    const pathWithLeadingSlash = path.startsWith('/') ? path : `/${path}`;
    return `${this.apiBaseUrl}${pathWithLeadingSlash}`;
  },
  
  // Función para obtener una representación segura de la configuración (sin claves)
  getSafeConfig: function() {
    return {
      env: this.env,
      isHeroku: this.isHeroku,
      port: this.port,
      apiBaseUrl: this.apiBaseUrl,
      facturapi: {
        isProduction: this.facturapi.isProduction,
        apiVersion: this.facturapi.apiVersion,
        // Mostramos solo los primeros 4 caracteres de la clave
        apiKey: this.facturapi.apiKey ? `${this.facturapi.apiKey.substring(0, 4)}...` : 'no configurada'
      },
      telegram: {
        // No mostrar el token completo
        token: this.telegram.token ? `${this.telegram.token.substring(0, 8)}...` : 'no configurado',
        authorizedUsers: this.telegram.authorizedUsers.length 
          ? `${this.telegram.authorizedUsers.length} usuarios autorizados` 
          : 'Todos los usuarios'
      },
      clientes: {
        INFOASIST: this.clientes.INFOASIST ? 'configurado' : 'no configurado',
        SOS: this.clientes.SOS ? 'configurado' : 'no configurado',
        ARSA: this.clientes.ARSA ? 'configurado' : 'no configurado',
        CHUBB: this.clientes.CHUBB ? 'configurado' : 'no configurado'
      },
      database: {
        // No mostrar la URL completa de la base de datos
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