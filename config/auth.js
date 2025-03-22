// config/auth.js
import logger from '../core/utils/logger.js';

// Logger específico para autenticación
const authLogger = logger.child({ module: 'auth' });

// Tiempo de expiración de sesión en milisegundos (24 horas por defecto)
const SESSION_EXPIRY = parseInt(process.env.SESSION_EXPIRY || '86400000', 10);

// Lista de usuarios autorizados de Telegram
const AUTHORIZED_TELEGRAM_USERS = process.env.TELEGRAM_AUTHORIZED_USERS
  ? process.env.TELEGRAM_AUTHORIZED_USERS.split(',').map(id => BigInt(id.trim()))
  : [];

// Configuración de autenticación
const authConfig = {
  // Configuración de sesión de Telegram
  telegram: {
    authorizedUsers: AUTHORIZED_TELEGRAM_USERS,
    sessionExpiry: SESSION_EXPIRY
  },
  
  // Roles disponibles en el sistema
  roles: {
    ADMIN: 'admin',
    USER: 'user',
    READONLY: 'readonly'
  },
  
  // Permisos por entidad y rol
  permissions: {
    'admin': ['*'], // Acceso total
    'user': [
      'invoice:create', 'invoice:read', 'invoice:cancel',
      'customer:create', 'customer:read', 'customer:update',
      'product:read'
    ],
    'readonly': ['invoice:read', 'customer:read', 'product:read']
  }
};

// Validar la configuración de autenticación
function validateAuthConfig() {
  const warnings = [];
  
  // Validar la configuración de Telegram
  if (authConfig.telegram.authorizedUsers.length === 0) {
    warnings.push('No hay usuarios de Telegram autorizados configurados. Cualquier usuario podrá utilizar el bot.');
    authLogger.warn('No hay usuarios autorizados de Telegram configurados');
  } else {
    authLogger.info(`${authConfig.telegram.authorizedUsers.length} usuarios de Telegram autorizados configurados`);
  }
  
  return warnings;
}

export {
  authConfig,
  validateAuthConfig
};