/**
 * Authentication Configuration
 * Configuración de autenticación y autorización del sistema
 */

import { createModuleLogger } from '@core/utils/logger.js';

const authLogger = createModuleLogger('auth-config');

// Tiempo de expiración de sesión en milisegundos (24 horas por defecto)
const SESSION_EXPIRY = parseInt(process.env.SESSION_EXPIRY || '86400000', 10);

// Lista de usuarios autorizados de Telegram
const AUTHORIZED_TELEGRAM_USERS = process.env.TELEGRAM_AUTHORIZED_USERS
  ? process.env.TELEGRAM_AUTHORIZED_USERS.split(',').map((id) => BigInt(id.trim()))
  : [];

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d'; // 7 días por defecto

export interface AuthConfig {
  // Configuración de sesión de Telegram
  telegram: {
    authorizedUsers: bigint[];
    sessionExpiry: number;
  };

  // Configuración de JWT
  jwt: {
    secret: string;
    expiry: string;
    algorithm: string;
  };

  // Roles disponibles en el sistema
  roles: {
    ADMIN: string;
    OPERATOR: string;
    VIEWER: string;
    USER: string;
    READONLY: string;
  };

  // Permisos por entidad y rol
  permissions: {
    admin: string[];
    operator: string[];
    viewer: string[];
    user: string[];
    readonly: string[];
  };
}

// Configuración de autenticación
export const authConfig: AuthConfig = {
  // Configuración de sesión de Telegram
  telegram: {
    authorizedUsers: AUTHORIZED_TELEGRAM_USERS,
    sessionExpiry: SESSION_EXPIRY,
  },

  // Configuración de JWT
  jwt: {
    secret: JWT_SECRET,
    expiry: JWT_EXPIRY,
    algorithm: 'HS256',
  },

  // Roles disponibles en el sistema
  roles: {
    ADMIN: 'admin',
    OPERATOR: 'operator',
    VIEWER: 'viewer',
    USER: 'user',
    READONLY: 'readonly',
  },

  // Permisos por entidad y rol
  permissions: {
    admin: ['*'], // Acceso total
    operator: [
      'invoice:create',
      'invoice:read',
      'invoice:cancel',
      'invoice:download',
      'customer:create',
      'customer:read',
      'customer:update',
      'product:create',
      'product:read',
      'product:update',
      'report:create',
      'report:read',
    ],
    viewer: ['invoice:read', 'invoice:download', 'customer:read', 'product:read', 'report:read'],
    user: [
      'invoice:create',
      'invoice:read',
      'invoice:cancel',
      'customer:create',
      'customer:read',
      'customer:update',
      'product:read',
    ],
    readonly: ['invoice:read', 'customer:read', 'product:read'],
  },
};

/**
 * Validar la configuración de autenticación
 */
export function validateAuthConfig(): string[] {
  const warnings: string[] = [];

  // Validar JWT Secret
  if (!authConfig.jwt.secret) {
    warnings.push('JWT_SECRET no está configurado. La autenticación de API no funcionará.');
    authLogger.warn('JWT_SECRET no está configurado');
  } else if (authConfig.jwt.secret.length < 32) {
    warnings.push('JWT_SECRET es demasiado corto. Se recomienda al menos 32 caracteres.');
    authLogger.warn('JWT_SECRET es demasiado corto');
  }

  // Validar la configuración de Telegram
  if (authConfig.telegram.authorizedUsers.length === 0) {
    warnings.push(
      'No hay usuarios de Telegram autorizados configurados. Cualquier usuario podrá utilizar el bot.'
    );
    authLogger.warn('No hay usuarios autorizados de Telegram configurados');
  } else {
    authLogger.info(
      `${authConfig.telegram.authorizedUsers.length} usuarios de Telegram autorizados configurados`
    );
  }

  // Validar expiración de sesión
  if (authConfig.telegram.sessionExpiry < 60000) {
    warnings.push('SESSION_EXPIRY es menor a 1 minuto. Esto puede causar problemas de usabilidad.');
    authLogger.warn('SESSION_EXPIRY configurado muy bajo');
  }

  return warnings;
}

// Validar al cargar
const warnings = validateAuthConfig();
if (warnings.length > 0) {
  warnings.forEach((warning) => authLogger.warn(warning));
}

export default authConfig;
