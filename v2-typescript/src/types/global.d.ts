/**
 * Global type definitions for FacturAPI SaaS v2
 */

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // Environment
      NODE_ENV: 'development' | 'test' | 'production';

      // Database
      DATABASE_URL: string;

      // Redis
      REDIS_URL: string;

      // API
      API_BASE_URL: string;
      API_PORT?: string;

      // FacturAPI
      FACTURAPI_USER_KEY: string;

      // Telegram
      TELEGRAM_BOT_TOKEN: string;
      ADMIN_CHAT_IDS: string;

      // Security
      JWT_SECRET: string;
      SESSION_SECRET: string;

      // Rate Limiting
      RATE_LIMIT_WINDOW_MS?: string;
      RATE_LIMIT_MAX_REQUESTS?: string;

      // Logs
      LOG_LEVEL?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

      // Bull Queue
      BULL_BOARD_PORT?: string;
    }
  }
}

export {};
