// services/redis-lock.service.ts
import logger from '../core/utils/logger';
import type { RedisClientType } from 'redis';

const lockLogger = logger.child({ module: 'redis-lock-service' });

interface LockResult {
  acquired: boolean;
  lockId?: string;
  release?: () => Promise<boolean>;
  error?: string;
}

interface LockStats {
  type: 'redis' | 'memory';
  activeLocks?: number;
  keys?: string[];
  error?: string;
}

/**
 * Servicio de locks distribuidos usando Redis
 */
class RedisLockService {
  private redis: RedisClientType | null = null;
  private isConnected = false;
  private lockPrefix = 'multiuser_lock:';
  private defaultTTL = 10000;
  private memoryLocks = new Map<string, { lockId: string; expires: number; acquired: number }>();

  async initialize() {
    try {
      const Redis = await import('redis');
      const redisUrl = process.env.REDIS_URL || process.env.REDISCLOUD_URL;

      if (!redisUrl) {
        lockLogger.warn('Redis no configurado, usando locks en memoria (NO para producción)');
        return this.initializeMemoryFallback();
      }

      this.redis = Redis.createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries: number) => Math.min(retries * 50, 2000),
          connectTimeout: 10000,
        },
        database: 0,
      }) as RedisClientType;

      this.redis.on('ready', () => {
        lockLogger.info('✅ Redis locks conectado');
        this.isConnected = true;
      });

      this.redis.on('error', (error: Error) => {
        lockLogger.error('❌ Error en Redis locks:', error.message);
        this.isConnected = false;
      });

      await this.redis.connect();
      return { success: true, type: 'redis' };
    } catch (error: any) {
      lockLogger.error('Error inicializando Redis locks:', error);
      return this.initializeMemoryFallback();
    }
  }

  initializeMemoryFallback() {
    this.memoryLocks = new Map();
    this.isConnected = false;

    setInterval(() => {
      this.cleanupMemoryLocks();
    }, 30000);

    lockLogger.warn('⚠️ Usando locks en memoria - NO es seguro para clustering');
    return { success: true, type: 'memory', warning: 'No seguro para producción' };
  }

  async acquireLock(
    key: string,
    ttlMs: number = this.defaultTTL,
    _retryDelayMs: number = 100
  ): Promise<LockResult> {
    const lockKey = `${this.lockPrefix}${key}`;
    const lockId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      if (this.isConnected && this.redis) {
        const result = await this.redis.set(lockKey, lockId, {
          NX: true,
          PX: ttlMs,
        });

        if (result === 'OK') {
          lockLogger.debug({ key, lockId, ttlMs }, 'Lock adquirido (Redis)');
          return {
            acquired: true,
            lockId,
            release: () => this.releaseLock(key, lockId),
          };
        } else {
          lockLogger.debug({ key }, 'Lock no disponible (Redis)');
          return { acquired: false };
        }
      } else {
        return this.acquireMemoryLock(key, lockId, ttlMs);
      }
    } catch (error: any) {
      lockLogger.error({ key, error: error.message }, 'Error adquiriendo lock');
      return { acquired: false, error: error.message };
    }
  }

  async releaseLock(key: string, lockId: string): Promise<boolean> {
    const lockKey = `${this.lockPrefix}${key}`;

    try {
      if (this.isConnected && this.redis) {
        const luaScript = `
          if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
          else
            return 0
          end
        `;

        const result = (await this.redis.eval(luaScript, {
          keys: [lockKey],
          arguments: [lockId],
        })) as number;

        const released = result === 1;
        if (released) {
          lockLogger.debug({ key, lockId }, 'Lock liberado (Redis)');
        } else {
          lockLogger.warn({ key, lockId }, 'Lock no encontrado o no owned (Redis)');
        }

        return released;
      } else {
        return this.releaseMemoryLock(key, lockId);
      }
    } catch (error: any) {
      lockLogger.error({ key, lockId, error: error.message }, 'Error liberando lock');
      return false;
    }
  }

  async withLock<T>(
    key: string,
    callback: () => Promise<T>,
    ttlMs: number = this.defaultTTL,
    maxRetries: number = 5
  ): Promise<T> {
    let attempt = 0;

    while (attempt < maxRetries) {
      const lock = await this.acquireLock(key, ttlMs);

      if (lock.acquired) {
        try {
          lockLogger.debug({ key, attempt }, 'Ejecutando callback con lock');
          return await callback();
        } finally {
          if (lock.release) {
            await lock.release();
          }
        }
      }

      attempt++;
      if (attempt < maxRetries) {
        const delay = Math.min(100 * Math.pow(2, attempt), 1000);
        lockLogger.debug({ key, attempt, delay }, 'Lock no disponible, esperando...');
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error(`No se pudo adquirir lock '${key}' después de ${maxRetries} intentos`);
  }

  acquireMemoryLock(key: string, lockId: string, ttlMs: number): LockResult {
    const now = Date.now();
    const existing = this.memoryLocks.get(key);

    if (existing && existing.expires > now) {
      return { acquired: false };
    }

    this.memoryLocks.set(key, {
      lockId,
      expires: now + ttlMs,
      acquired: now,
    });

    lockLogger.debug({ key, lockId, ttlMs }, 'Lock adquirido (memoria)');
    return {
      acquired: true,
      lockId,
      release: () => Promise.resolve(this.releaseMemoryLock(key, lockId)),
    };
  }

  releaseMemoryLock(key: string, lockId: string): boolean {
    const existing = this.memoryLocks.get(key);
    if (existing && existing.lockId === lockId) {
      this.memoryLocks.delete(key);
      lockLogger.debug({ key, lockId }, 'Lock liberado (memoria)');
      return true;
    }
    return false;
  }

  cleanupMemoryLocks(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, lock] of this.memoryLocks.entries()) {
      if (lock.expires <= now) {
        this.memoryLocks.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      lockLogger.debug({ cleaned }, 'Locks expirados limpiados de memoria');
    }
  }

  async getStats(): Promise<LockStats> {
    if (this.isConnected && this.redis) {
      try {
        const keys = await this.redis.keys(`${this.lockPrefix}*`);
        return {
          type: 'redis',
          activeLocks: keys.length,
          keys: keys.map((k) => k.replace(this.lockPrefix, '')),
        };
      } catch (error: any) {
        return { type: 'redis', error: error.message };
      }
    } else {
      return {
        type: 'memory',
        activeLocks: this.memoryLocks.size,
        keys: Array.from(this.memoryLocks.keys()),
      };
    }
  }
}

const redisLockService = new RedisLockService();

export function withLock(keyTemplate: string, ttlMs: number = 10000) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      let key = keyTemplate;
      if (args[0] && typeof args[0] === 'object') {
        Object.keys(args[0]).forEach((prop) => {
          key = key.replace(`{${prop}}`, args[0][prop]);
        });
      }

      return await redisLockService.withLock(key, () => originalMethod.apply(this, args), ttlMs);
    };

    return descriptor;
  };
}

export default redisLockService;
