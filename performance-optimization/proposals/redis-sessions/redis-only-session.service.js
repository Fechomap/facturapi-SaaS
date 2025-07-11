// core/auth/redis-only-session.service.js
import logger from '../utils/logger.js';
import redisSessionService from '../../services/redis-session.service.js';
import { prisma } from '../../config/database.js';

const sessionLogger = logger.child({ module: 'redis-session' });

/**
 * Servicio de sesiones usando SOLO Redis para máximo rendimiento
 * Con sincronización periódica a BD para respaldo
 */
class RedisOnlySessionService {
  // Cola de sesiones para sincronizar con BD
  static syncQueue = new Map();
  static syncInterval = null;

  /**
   * Inicia la sincronización periódica con BD
   */
  static startPeriodicSync(intervalMs = 60000) { // 1 minuto por defecto
    if (this.syncInterval) return;
    
    this.syncInterval = setInterval(() => {
      this.syncToDB().catch(error => {
        sessionLogger.error({ error }, 'Error en sincronización periódica');
      });
    }, intervalMs);
  }

  /**
   * Detiene la sincronización periódica
   */
  static stopPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Obtiene información de tenant (desde BD - no cambia frecuentemente)
   */
  static async getTenantOnly(telegramId) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
    const cacheKey = `tenant:${telegramIdBigInt.toString()}`;
    
    // Intentar obtener de Redis primero
    const cached = await redisSessionService.get(cacheKey);
    if (cached.success && cached.data) {
      return cached.data;
    }
    
    // Si no está en cache, obtener de BD
    try {
      const tenantUser = await prisma.tenantUser.findUnique({
        where: { telegramId: telegramIdBigInt },
        select: {
          tenant: {
            select: {
              id: true,
              businessName: true,
            },
          },
        },
      });

      if (!tenantUser || !tenantUser.tenant) {
        return { hasTenant: false };
      }

      const result = {
        hasTenant: true,
        tenantId: tenantUser.tenant.id,
        tenantName: tenantUser.tenant.businessName,
      };

      // Cachear en Redis por 1 hora (tenant info no cambia frecuentemente)
      await redisSessionService.set(cacheKey, result, 3600);
      
      return result;
    } catch (error) {
      sessionLogger.error({ error, telegramId }, 'Error obteniendo tenant');
      return { hasTenant: false };
    }
  }

  /**
   * Obtiene el estado de sesión (SOLO de Redis)
   */
  static async getUserState(telegramId) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
    const cacheKey = `session:${telegramIdBigInt.toString()}`;
    
    // Solo Redis - ultra rápido
    const redisResult = await redisSessionService.getSession(cacheKey);
    if (redisResult.success) {
      return redisResult.data;
    }
    
    // Si no está en Redis, devolver estado vacío
    // (la BD se sincronizará periódicamente)
    return { esperando: null };
  }

  /**
   * Guarda el estado de sesión (SOLO en Redis)
   */
  static async saveUserState(telegramId, state) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
    const cacheKey = `session:${telegramIdBigInt.toString()}`;
    
    // Guardar SOLO en Redis - instantáneo
    await redisSessionService.setSession(cacheKey, state);
    
    // Marcar para sincronización posterior
    this.syncQueue.set(telegramIdBigInt.toString(), {
      telegramIdBigInt,
      state,
      timestamp: Date.now()
    });
    
    return { sessionData: state };
  }

  /**
   * Sincroniza las sesiones pendientes con la BD
   */
  static async syncToDB() {
    if (this.syncQueue.size === 0) return;
    
    const toSync = Array.from(this.syncQueue.entries());
    this.syncQueue.clear();
    
    sessionLogger.info(`Sincronizando ${toSync.length} sesiones con BD`);
    const startTime = Date.now();
    
    // Sincronizar en batches
    const batchSize = 10;
    let synced = 0;
    
    for (let i = 0; i < toSync.length; i += batchSize) {
      const batch = toSync.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async ([_, { telegramIdBigInt, state }]) => {
          try {
            await prisma.userSession.upsert({
              where: { telegramId: telegramIdBigInt },
              update: {
                sessionData: state,
                updatedAt: new Date(),
              },
              create: {
                telegramId: telegramIdBigInt,
                sessionData: state,
              },
            });
            synced++;
          } catch (error) {
            sessionLogger.error(
              { error, telegramId: telegramIdBigInt.toString() },
              'Error sincronizando sesión'
            );
          }
        })
      );
    }
    
    const duration = Date.now() - startTime;
    sessionLogger.info(
      `Sincronización completada: ${synced}/${toSync.length} en ${duration}ms`
    );
  }

  /**
   * Fuerza sincronización inmediata (para casos críticos)
   */
  static async forceSyncNow(telegramId) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
    const cacheKey = `session:${telegramIdBigInt.toString()}`;
    
    const redisResult = await redisSessionService.getSession(cacheKey);
    if (!redisResult.success) return;
    
    try {
      await prisma.userSession.upsert({
        where: { telegramId: telegramIdBigInt },
        update: {
          sessionData: redisResult.data,
          updatedAt: new Date(),
        },
        create: {
          telegramId: telegramIdBigInt,
          sessionData: redisResult.data,
        },
      });
    } catch (error) {
      sessionLogger.error({ error, telegramId }, 'Error en sincronización forzada');
    }
  }

  /**
   * Limpia sesiones expiradas de Redis
   */
  static async cleanupExpiredSessions() {
    // Redis TTL maneja esto automáticamente
    sessionLogger.debug('Limpieza de sesiones delegada a Redis TTL');
  }
}

export default RedisOnlySessionService;