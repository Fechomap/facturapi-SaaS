/**
 * Redis Session Service
 * Session management with Redis for clustering support
 */

import { createModuleLogger } from '@core/utils/logger.js';
import type { RedisClientType } from 'redis';

const logger = createModuleLogger('RedisSession');

interface SessionData {
  timestamp: number;
  ttl: number;
  [key: string]: unknown;
}

interface MemoryStoreEntry {
  data: SessionData;
  expires: number;
}

interface ServiceResult {
  success: boolean;
  message?: string;
  type?: string;
  warning?: string;
  error?: string;
  data?: unknown;
}

interface SessionStats {
  type: 'redis' | 'memory';
  connected: boolean;
  fallbackMode: boolean;
  activeSessions?: number;
  redisMemory?: string;
  memoryUsage?: NodeJS.MemoryUsage;
  error?: string;
}

/**
 * Redis Session Service Class
 */
class RedisSessionService {
  private redis: RedisClientType | null = null;
  private isConnected = false;
  private fallbackToMemory = true;
  private memoryStore: Map<string, MemoryStoreEntry> = new Map();

  /**
   * Initialize Redis connection
   */
  async initialize(): Promise<ServiceResult> {
    try {
      const redisUrl = process.env.REDIS_URL || process.env.REDISCLOUD_URL;

      if (!redisUrl) {
        logger.warn('Redis not configured, using memory storage (NOT recommended for clustering)');
        return this.initializeMemoryFallback();
      }

      const Redis = await import('redis');
      logger.info('Redis module imported successfully');

      this.redis = Redis.createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries: number) => {
            const delay = Math.min(retries * 50, 2000);
            logger.warn({ retries: retries + 1, delay }, 'Retrying Redis connection');
            return delay;
          },
          connectTimeout: 10000,
        },
        database: 0,
      }) as RedisClientType;

      // Connection events
      this.redis.on('connect', () => {
        logger.info('Connecting to Redis...');
      });

      this.redis.on('ready', () => {
        logger.info('Redis connected and ready');
        this.isConnected = true;
        this.fallbackToMemory = false;
      });

      this.redis.on('error', (error: Error) => {
        logger.error({ error }, 'Redis error');
        this.isConnected = false;
        this.fallbackToMemory = true;
      });

      this.redis.on('end', () => {
        logger.warn('Redis connection closed');
        this.isConnected = false;
        this.fallbackToMemory = true;
      });

      // Connect
      await this.redis.connect();

      return {
        success: true,
        message: 'Redis initialized successfully',
        type: 'redis',
      };
    } catch (error) {
      logger.error({ error }, 'Error initializing Redis');
      return this.initializeMemoryFallback();
    }
  }

  /**
   * Initialize memory storage as fallback
   */
  initializeMemoryFallback(): ServiceResult {
    logger.warn('Using memory storage - NOT ideal for clustering');
    this.fallbackToMemory = true;
    this.isConnected = false;

    // Clean memory every 30 minutes
    setInterval(
      () => {
        this.cleanupMemoryStore();
      },
      30 * 60 * 1000
    );

    return {
      success: true,
      message: 'Memory storage initialized',
      type: 'memory',
      warning: 'Not ideal for clustering - consider configuring Redis',
    };
  }

  /**
   * Save session
   */
  async setSession(
    sessionId: string,
    sessionData: Record<string, unknown>,
    ttlSeconds = 3600
  ): Promise<ServiceResult> {
    try {
      const data: SessionData = {
        ...sessionData,
        timestamp: Date.now(),
        ttl: ttlSeconds,
      };

      if (this.isConnected && this.redis) {
        await this.redis.setEx(`session:${sessionId}`, ttlSeconds, JSON.stringify(data));
        logger.debug({ sessionId }, 'Session saved in Redis');
      } else {
        this.memoryStore.set(sessionId, {
          data,
          expires: Date.now() + ttlSeconds * 1000,
        });
        logger.debug({ sessionId }, 'Session saved in memory');
      }

      return { success: true };
    } catch (error) {
      logger.error({ sessionId, error }, 'Error saving session');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get session
   */
  async getSession(sessionId: string): Promise<ServiceResult> {
    try {
      if (this.isConnected && this.redis) {
        const sessionData = await this.redis.get(`session:${sessionId}`);
        if (sessionData) {
          const parsed = JSON.parse(sessionData);
          logger.debug({ sessionId }, 'Session obtained from Redis');
          return { success: true, data: parsed };
        }
      } else {
        const sessionEntry = this.memoryStore.get(sessionId);
        if (sessionEntry) {
          if (sessionEntry.expires > Date.now()) {
            logger.debug({ sessionId }, 'Session obtained from memory');
            return { success: true, data: sessionEntry.data };
          } else {
            this.memoryStore.delete(sessionId);
          }
        }
      }

      return { success: false, error: 'Session not found or expired' };
    } catch (error) {
      logger.error({ sessionId, error }, 'Error getting session');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string): Promise<ServiceResult> {
    try {
      if (this.isConnected && this.redis) {
        await this.redis.del(`session:${sessionId}`);
        logger.debug({ sessionId }, 'Session deleted from Redis');
      } else {
        this.memoryStore.delete(sessionId);
        logger.debug({ sessionId }, 'Session deleted from memory');
      }

      return { success: true };
    } catch (error) {
      logger.error({ sessionId, error }, 'Error deleting session');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Clean expired sessions from memory
   */
  cleanupMemoryStore(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, sessionEntry] of this.memoryStore.entries()) {
      if (sessionEntry.expires <= now) {
        this.memoryStore.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Expired sessions cleaned from memory');
    }
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<SessionStats> {
    try {
      const stats: SessionStats = {
        type: this.isConnected ? 'redis' : 'memory',
        connected: this.isConnected,
        fallbackMode: this.fallbackToMemory,
      };

      if (this.isConnected && this.redis) {
        const info = await this.redis.info('memory');
        stats.redisMemory = info;

        // Count active sessions using SCAN (safe for production)
        const keys: string[] = [];
        let cursor = 0;
        do {
          const result = await this.redis.scan(cursor, {
            MATCH: 'session:*',
            COUNT: 100,
          });
          cursor = result.cursor;
          keys.push(...result.keys);
        } while (cursor !== 0);

        stats.activeSessions = keys.length;
      } else {
        stats.activeSessions = this.memoryStore.size;
        stats.memoryUsage = process.memoryUsage();
      }

      return stats;
    } catch (error) {
      logger.error({ error }, 'Error getting statistics');
      return {
        type: 'memory',
        connected: false,
        fallbackMode: true,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<ServiceResult> {
    try {
      if (this.redis && this.isConnected) {
        await this.redis.quit();
        logger.info('Redis connection closed successfully');
      }

      this.memoryStore.clear();

      return { success: true };
    } catch (error) {
      logger.error({ error }, 'Error closing Redis');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

// Export singleton instance
const redisSessionService = new RedisSessionService();
export default redisSessionService;
