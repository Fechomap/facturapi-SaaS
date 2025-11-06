/**
 * Configuration Index
 * Central configuration module
 */

import dotenv from 'dotenv';
import { createModuleLogger } from '@core/utils/logger.js';

const logger = createModuleLogger('Config');

// Load environment variables
dotenv.config();

// Environment detection
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_RAILWAY = process.env.IS_RAILWAY === 'true' || Boolean(process.env.RAILWAY_ENVIRONMENT);

interface TelegramConfig {
  token: string;
  adminChatIds: number[];
  authorizedUsers?: number[];
}

interface ApiConfig {
  baseUrl: string;
  port: number;
}

interface FacturapiConfig {
  userKey: string;
}

interface AuthConfig {
  jwtSecret: string;
  sessionSecret: string;
}

interface Config {
  env: string;
  isRailway: boolean;
  telegram: TelegramConfig;
  api: ApiConfig;
  facturapi: FacturapiConfig;
  auth: AuthConfig;
}

/**
 * Normalize base URL
 */
function normalizeBaseUrl(url: string | undefined): string {
  if (!url) return '';
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Parse admin chat IDs from environment
 */
function parseAdminChatIds(adminChatIdsStr: string | undefined): number[] {
  if (!adminChatIdsStr) return [];
  return adminChatIdsStr
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));
}

// Determine API base URL
let apiBaseUrlConfig: string;

if (IS_RAILWAY) {
  const railwayUrl = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayUrl) {
    apiBaseUrlConfig = `https://${railwayUrl}`;
  } else if (process.env.API_BASE_URL) {
    apiBaseUrlConfig = normalizeBaseUrl(process.env.API_BASE_URL);
  } else {
    apiBaseUrlConfig = 'http://localhost:3001';
  }
} else {
  apiBaseUrlConfig = normalizeBaseUrl(process.env.API_BASE_URL) || 'http://localhost:3001';
}

// Configuration object
export const config: Config = {
  env: NODE_ENV,
  isRailway: IS_RAILWAY,

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    adminChatIds: parseAdminChatIds(process.env.ADMIN_CHAT_IDS),
  },

  api: {
    baseUrl: apiBaseUrlConfig,
    port: parseInt(process.env.API_PORT || '3001', 10),
  },

  facturapi: {
    userKey: process.env.FACTURAPI_USER_KEY || '',
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || '',
    sessionSecret: process.env.SESSION_SECRET || '',
  },
};

/**
 * Validate environment variables
 */
export function validateEnv(): void {
  const requiredVars: string[] = [];

  // If running bot, need Telegram token
  const executedFile = process.argv[1];
  if (executedFile && executedFile.includes('bot')) {
    requiredVars.push('TELEGRAM_BOT_TOKEN');
  }

  // Always need database URL
  requiredVars.push('DATABASE_URL');

  // For FacturAPI admin operations
  requiredVars.push('FACTURAPI_USER_KEY');

  const missing = requiredVars.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    logger.error({ missing }, 'Required environment variables not found');
    if (IS_RAILWAY) {
      logger.error('Please configure these variables in Railway dashboard');
    } else {
      logger.error('Please configure these variables in your .env file');
    }
    process.exit(1);
  }
}

// Validate on load
validateEnv();

logger.info({ env: NODE_ENV, isRailway: IS_RAILWAY }, 'Configuration loaded');

export default config;
