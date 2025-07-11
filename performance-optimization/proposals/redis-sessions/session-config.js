// config/session-config.js

/**
 * Configuración para migración gradual a Redis-only sessions
 */
export const sessionConfig = {
  // Activar modo Redis-only gradualmente
  useRedisOnly: process.env.USE_REDIS_ONLY_SESSIONS === 'true',
  
  // Intervalo de sincronización con BD (ms)
  syncInterval: parseInt(process.env.SESSION_SYNC_INTERVAL || '60000'), // 1 minuto
  
  // TTL de sesiones en Redis (segundos)
  sessionTTL: parseInt(process.env.SESSION_TTL || '3600'), // 1 hora
  
  // TTL de cache de tenant info (segundos)
  tenantCacheTTL: parseInt(process.env.TENANT_CACHE_TTL || '3600'), // 1 hora
  
  // Tipos de estado que requieren sync inmediato
  criticalStates: [
    'facturaGenerada',
    'userStatus',
    'tenantId'
  ],
  
  // Métricas
  enableMetrics: process.env.SESSION_METRICS_ENABLED === 'true'
};

/**
 * Helper para decidir qué servicio usar
 */
export function getSessionService() {
  if (sessionConfig.useRedisOnly) {
    return import('../core/auth/redis-only-session.service.js')
      .then(module => module.default);
  }
  return import('../core/auth/session.service.js')
    .then(module => module.default);
}