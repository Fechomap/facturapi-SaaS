// services/redis-session.service.js - Gestión de sesiones Redis para clustering
import logger from '../core/utils/logger.js';

const redisLogger = logger.child({ module: 'redis-session' });

/**
 * Servicio de sesiones Redis para soporte de clustering
 * En clustering necesitamos sesiones compartidas entre workers
 */
class RedisSessionService {
  constructor() {
    this.redis = null;
    this.isConnected = false;
    this.fallbackToMemory = true; // Fallback a memoria si Redis no está disponible
    this.memoryStore = new Map(); // Store en memoria como fallback
  }

  /**
   * Inicializar conexión Redis
   */
  async initialize() {
    try {
      // Verificar si tenemos URL de Redis configurada
      const redisUrl = process.env.REDIS_URL || process.env.REDISCLOUD_URL;

      if (!redisUrl) {
        redisLogger.warn(
          'Redis no configurado, usando almacenamiento en memoria (NO recomendado para clustering)'
        );
        return this.initializeMemoryFallback();
      }

      // Importar redis
      const Redis = await import('redis');
      redisLogger.info('✅ Módulo Redis importado correctamente');

      // Crear cliente Redis con configuración completa
      this.redis = Redis.createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            const delay = Math.min(retries * 50, 2000);
            redisLogger.warn(
              `🔄 Reintentando conexión Redis en ${delay}ms (intento ${retries + 1})`
            );
            return delay;
          },
          connectTimeout: 10000,
          commandTimeout: 5000,
        },
        // Configuración para Railway/producción
        database: 0,
        lazyConnect: true,
      });

      // Eventos de conexión
      this.redis.on('connect', () => {
        redisLogger.info('🔗 Conectando a Redis...');
      });

      this.redis.on('ready', () => {
        redisLogger.info('✅ Redis conectado y listo');
        this.isConnected = true;
        this.fallbackToMemory = false;
      });

      this.redis.on('error', (error) => {
        redisLogger.error('❌ Error en Redis:', error.message);
        this.isConnected = false;
        this.fallbackToMemory = true;
      });

      this.redis.on('end', () => {
        redisLogger.warn('📴 Conexión Redis cerrada');
        this.isConnected = false;
        this.fallbackToMemory = true;
      });

      // Conectar
      await this.redis.connect();

      return {
        success: true,
        message: 'Redis inicializado correctamente',
        type: 'redis',
      };
    } catch (error) {
      redisLogger.error('Error al inicializar Redis:', error);
      return this.initializeMemoryFallback();
    }
  }

  /**
   * Inicializar almacenamiento en memoria como fallback
   */
  initializeMemoryFallback() {
    redisLogger.warn('⚠️ Usando almacenamiento en memoria - NO es ideal para clustering');
    this.fallbackToMemory = true;
    this.isConnected = false;

    // Limpiar memoria cada 30 minutos
    setInterval(
      () => {
        this.cleanupMemoryStore();
      },
      30 * 60 * 1000
    );

    return {
      success: true,
      message: 'Almacenamiento en memoria inicializado',
      type: 'memory',
      warning: 'No es ideal para clustering - considera configurar Redis',
    };
  }

  /**
   * Guardar sesión
   */
  async setSession(sessionId, sessionData, ttlSeconds = 3600) {
    try {
      const data = {
        ...sessionData,
        timestamp: Date.now(),
        ttl: ttlSeconds,
      };

      if (this.isConnected && this.redis) {
        // Usar Redis
        await this.redis.setEx(`session:${sessionId}`, ttlSeconds, JSON.stringify(data));
        redisLogger.debug(`Sesión guardada en Redis: ${sessionId}`);
      } else {
        // Usar memoria como fallback
        this.memoryStore.set(sessionId, {
          data,
          expires: Date.now() + ttlSeconds * 1000,
        });
        redisLogger.debug(`Sesión guardada en memoria: ${sessionId}`);
      }

      return { success: true };
    } catch (error) {
      redisLogger.error(`Error al guardar sesión ${sessionId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Obtener sesión
   */
  async getSession(sessionId) {
    try {
      if (this.isConnected && this.redis) {
        // Obtener de Redis
        const sessionData = await this.redis.get(`session:${sessionId}`);
        if (sessionData) {
          const parsed = JSON.parse(sessionData);
          redisLogger.debug(`Sesión obtenida de Redis: ${sessionId}`);
          return { success: true, data: parsed };
        }
      } else {
        // Obtener de memoria
        const sessionEntry = this.memoryStore.get(sessionId);
        if (sessionEntry) {
          // Verificar si no ha expirado
          if (sessionEntry.expires > Date.now()) {
            redisLogger.debug(`Sesión obtenida de memoria: ${sessionId}`);
            return { success: true, data: sessionEntry.data };
          } else {
            // Sesión expirada
            this.memoryStore.delete(sessionId);
          }
        }
      }

      return { success: false, error: 'Sesión no encontrada o expirada' };
    } catch (error) {
      redisLogger.error(`Error al obtener sesión ${sessionId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Eliminar sesión
   */
  async deleteSession(sessionId) {
    try {
      if (this.isConnected && this.redis) {
        await this.redis.del(`session:${sessionId}`);
        redisLogger.debug(`Sesión eliminada de Redis: ${sessionId}`);
      } else {
        this.memoryStore.delete(sessionId);
        redisLogger.debug(`Sesión eliminada de memoria: ${sessionId}`);
      }

      return { success: true };
    } catch (error) {
      redisLogger.error(`Error al eliminar sesión ${sessionId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Limpiar sesiones expiradas en memoria
   */
  cleanupMemoryStore() {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, sessionEntry] of this.memoryStore.entries()) {
      if (sessionEntry.expires <= now) {
        this.memoryStore.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      redisLogger.info(`🧹 Limpiadas ${cleaned} sesiones expiradas de memoria`);
    }
  }

  /**
   * Obtener estadísticas
   */
  async getStats() {
    try {
      const stats = {
        type: this.isConnected ? 'redis' : 'memory',
        connected: this.isConnected,
        fallbackMode: this.fallbackToMemory,
      };

      if (this.isConnected && this.redis) {
        // Estadísticas de Redis
        const info = await this.redis.info('memory');
        stats.redisMemory = info;

        // Contar sesiones activas usando SCAN (seguro para producción)
        const keys = [];
        let cursor = '0';
        do {
          const [newCursor, foundKeys] = await this.redis.scan(
            cursor,
            'MATCH',
            'session:*',
            'COUNT',
            100
          );
          cursor = newCursor;
          keys.push(...foundKeys);
        } while (cursor !== '0');

        stats.activeSessions = keys.length;
      } else {
        // Estadísticas de memoria
        stats.activeSessions = this.memoryStore.size;
        stats.memoryUsage = process.memoryUsage();
      }

      return stats;
    } catch (error) {
      redisLogger.error('Error al obtener estadísticas:', error);
      return { error: error.message };
    }
  }

  /**
   * Cerrar conexiones
   */
  async disconnect() {
    try {
      if (this.redis && this.isConnected) {
        await this.redis.quit();
        redisLogger.info('📴 Conexión Redis cerrada correctamente');
      }

      // Limpiar memoria
      this.memoryStore.clear();

      return { success: true };
    } catch (error) {
      redisLogger.error('Error al cerrar Redis:', error);
      return { success: false, error: error.message };
    }
  }
}

// Exportar instancia singleton
const redisSessionService = new RedisSessionService();
export default redisSessionService;
