-- Optimización de índices para user_sessions

-- 1. Índice compuesto para UPSERT más eficiente
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_telegram_updated 
ON user_sessions(telegram_id, updated_at DESC);

-- 2. Índice parcial para sesiones activas
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_active 
ON user_sessions(telegram_id) 
WHERE updated_at > NOW() - INTERVAL '2 hours';

-- 3. Estadísticas actualizadas para mejor plan de ejecución
ANALYZE user_sessions;

-- 4. Verificar tamaño de la tabla
SELECT 
  pg_size_pretty(pg_total_relation_size('user_sessions')) as total_size,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '2 hours') as active_sessions
FROM user_sessions;