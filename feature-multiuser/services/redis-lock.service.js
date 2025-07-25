// feature-multiuser/services/redis-lock.service.js
// Servicio de locks distribuidos con Redis para control de concurrencia

import logger from '../../core/utils/logger.js';

const lockLogger = logger.child({ module: 'redis-lock-service' });

/**
 * Servicio de locks distribuidos usando Redis
 * Evita condiciones de carrera en operaciones críticas multiusuario
 */
class RedisLockService {
  constructor() {
    this.redis = null;
    this.isConnected = false;
    this.lockPrefix = 'multiuser_lock:';
    this.defaultTTL = 10000; // 10 segundos por defecto
  }

  /**
   * Inicializa conexión Redis (usa la misma instancia que el session service)
   */
  async initialize() {
    try {
      // Importar Redis
      const Redis = await import('redis');
      
      // Usar misma configuración que redis-session.service.js
      const redisUrl = process.env.REDIS_URL || process.env.REDISCLOUD_URL;
      
      if (!redisUrl) {
        lockLogger.warn('Redis no configurado, usando locks en memoria (NO para producción)');
        return this.initializeMemoryFallback();
      }

      this.redis = Redis.createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => Math.min(retries * 50, 2000),
          connectTimeout: 10000,
          commandTimeout: 5000,
        },
        database: 0,
        lazyConnect: true,
      });

      // Eventos
      this.redis.on('ready', () => {
        lockLogger.info('✅ Redis locks conectado');
        this.isConnected = true;
      });

      this.redis.on('error', (error) => {
        lockLogger.error('❌ Error en Redis locks:', error.message);
        this.isConnected = false;
      });

      await this.redis.connect();
      return { success: true, type: 'redis' };

    } catch (error) {
      lockLogger.error('Error inicializando Redis locks:', error);
      return this.initializeMemoryFallback();
    }
  }

  /**
   * Fallback a memoria (NO usar en producción con múltiples workers)
   */
  initializeMemoryFallback() {
    this.memoryLocks = new Map();
    this.isConnected = false;
    
    // Limpiar locks expirados cada 30 segundos
    setInterval(() => {
      this.cleanupMemoryLocks();
    }, 30000);

    lockLogger.warn('⚠️ Usando locks en memoria - NO es seguro para clustering');
    return { success: true, type: 'memory', warning: 'No seguro para producción' };
  }

  /**
   * Adquiere un lock distribuido
   * @param {string} key - Clave del lock
   * @param {number} ttlMs - TTL en milisegundos
   * @param {number} retryDelayMs - Delay entre reintentos
   * @returns {Promise<Object>} - { acquired: boolean, lockId?: string }
   */
  async acquireLock(key, ttlMs = this.defaultTTL, retryDelayMs = 100) {
    const lockKey = `${this.lockPrefix}${key}`;
    const lockId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      if (this.isConnected && this.redis) {
        // Usar Redis SET con NX (only if not exists) y PX (expire in milliseconds)
        const result = await this.redis.set(lockKey, lockId, {
          NX: true, // Solo si no existe
          PX: ttlMs // Expira en ttlMs milisegundos
        });

        if (result === 'OK') {
          lockLogger.debug({ key, lockId, ttlMs }, 'Lock adquirido (Redis)');
          return { 
            acquired: true, 
            lockId,
            release: () => this.releaseLock(key, lockId)
          };
        } else {
          lockLogger.debug({ key }, 'Lock no disponible (Redis)');
          return { acquired: false };
        }

      } else {
        // Fallback a memoria
        return this.acquireMemoryLock(key, lockId, ttlMs);
      }

    } catch (error) {
      lockLogger.error({ key, error: error.message }, 'Error adquiriendo lock');
      return { acquired: false, error: error.message };
    }
  }

  /**
   * Libera un lock específico
   * @param {string} key - Clave del lock
   * @param {string} lockId - ID del lock para verificar ownership
   * @returns {Promise<boolean>} - True si se liberó exitosamente
   */
  async releaseLock(key, lockId) {
    const lockKey = `${this.lockPrefix}${key}`;
    
    try {
      if (this.isConnected && this.redis) {
        // Script Lua para verificar ownership y liberar atómicamente
        const luaScript = `
          if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
          else
            return 0
          end
        `;
        
        const result = await this.redis.eval(luaScript, {
          keys: [lockKey],
          arguments: [lockId]
        });

        const released = result === 1;
        if (released) {
          lockLogger.debug({ key, lockId }, 'Lock liberado (Redis)');
        } else {
          lockLogger.warn({ key, lockId }, 'Lock no encontrado o no owned (Redis)');
        }
        
        return released;

      } else {
        // Fallback a memoria
        return this.releaseMemoryLock(key, lockId);
      }

    } catch (error) {
      lockLogger.error({ key, lockId, error: error.message }, 'Error liberando lock');
      return false;
    }
  }

  /**
   * Ejecuta una función con lock automático
   * @param {string} key - Clave del lock
   * @param {Function} callback - Función a ejecutar
   * @param {number} ttlMs - TTL del lock
   * @param {number} maxRetries - Número máximo de reintentos
   * @returns {Promise<any>} - Resultado del callback
   */
  async withLock(key, callback, ttlMs = this.defaultTTL, maxRetries = 5) {
    let attempt = 0;
    
    while (attempt < maxRetries) {
      const lock = await this.acquireLock(key, ttlMs);
      
      if (lock.acquired) {
        try {
          lockLogger.debug({ key, attempt }, 'Ejecutando callback con lock');
          const result = await callback();
          return result;
        } finally {
          await lock.release();
        }
      }

      // Esperar antes del siguiente intento
      attempt++;
      if (attempt < maxRetries) {
        const delay = Math.min(100 * Math.pow(2, attempt), 1000); // Exponential backoff
        lockLogger.debug({ key, attempt, delay }, 'Lock no disponible, esperando...');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(`No se pudo adquirir lock '${key}' después de ${maxRetries} intentos`);
  }

  /**
   * Locks en memoria como fallback
   */
  acquireMemoryLock(key, lockId, ttlMs) {
    const now = Date.now();
    const existing = this.memoryLocks.get(key);
    
    // Verificar si existe y no ha expirado
    if (existing && existing.expires > now) {
      return { acquired: false };
    }

    // Adquirir lock
    this.memoryLocks.set(key, {
      lockId,
      expires: now + ttlMs,
      acquired: now
    });

    lockLogger.debug({ key, lockId, ttlMs }, 'Lock adquirido (memoria)');
    return { 
      acquired: true, 
      lockId,
      release: () => this.releaseMemoryLock(key, lockId)
    };
  }

  releaseMemoryLock(key, lockId) {
    const existing = this.memoryLocks.get(key);
    if (existing && existing.lockId === lockId) {
      this.memoryLocks.delete(key);
      lockLogger.debug({ key, lockId }, 'Lock liberado (memoria)');
      return true;
    }
    return false;
  }

  cleanupMemoryLocks() {
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

  /**
   * Obtiene estadísticas de locks activos
   */
  async getStats() {
    if (this.isConnected && this.redis) {
      try {
        const keys = await this.redis.keys(`${this.lockPrefix}*`);
        return {
          type: 'redis',
          activeLocks: keys.length,
          keys: keys.map(k => k.replace(this.lockPrefix, ''))
        };
      } catch (error) {
        return { type: 'redis', error: error.message };
      }
    } else {
      return {
        type: 'memory',
        activeLocks: this.memoryLocks.size,
        keys: Array.from(this.memoryLocks.keys())
      };
    }
  }
}

// Singleton instance
const redisLockService = new RedisLockService();

/**
 * Decorador para funciones que requieren lock
 * @param {string} keyTemplate - Template para la clave (ej: 'folio:{tenantId}')
 * @param {number} ttlMs - TTL del lock
 */
export function withLock(keyTemplate, ttlMs = 10000) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args) {
      // Reemplazar placeholders en keyTemplate
      let key = keyTemplate;
      if (args[0] && typeof args[0] === 'object') {
        Object.keys(args[0]).forEach(prop => {
          key = key.replace(`{${prop}}`, args[0][prop]);
        });
      }
      
      return await redisLockService.withLock(key, () => originalMethod.apply(this, args), ttlMs);
    };
    
    return descriptor;
  };
}

export default redisLockService;