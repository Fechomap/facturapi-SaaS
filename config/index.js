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

// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar el archivo .env correspondiente al entorno
const envFilePath = path.resolve(__dirname, `../.env.${NODE_ENV}`);

// Verificar si existe el archivo específico del entorno
if (fs.existsSync(envFilePath)) {
  configLogger.info(`Cargando variables de entorno desde: .env.${NODE_ENV}`);
  dotenv.config({ path: envFilePath });
} else {
  // Si no existe, cargar el .env normal
  configLogger.info('Archivo .env específico no encontrado, usando .env por defecto');
  dotenv.config();
}

// Función para validar variables de entorno críticas
const validateEnv = () => {
  const requiredVars = [];
  
  // Variables comunes requeridas
  if (NODE_ENV === 'production') {
    requiredVars.push('FACTURAPI_LIVE_KEY');
  } else {
    // En desarrollo al menos necesitamos la clave de prueba
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
    configLogger.error(`Por favor, configura estas variables en tu archivo .env.${NODE_ENV}`);
    process.exit(1); // Terminar la aplicación
  }
};

// Configuración unificada
const config = {
  // Entorno de la aplicación: determina qué variables usar
  env: NODE_ENV,
  
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
  apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  
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
    basePath: path.resolve(__dirname, '../storage'),
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10)
  },
  
  // Función para obtener una representación segura de la configuración (sin claves)
  getSafeConfig: function() {
    return {
      env: this.env,
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