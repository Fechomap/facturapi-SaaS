-- SCRIPT URGENTE PARA RESOLVER PROBLEMAS DE RENDIMIENTO
-- Ejecutar INMEDIATAMENTE en la base de datos

-- 1. VACUUM FULL en tablas con bloat crítico
-- NOTA: Esto bloqueará las tablas temporalmente, hazlo en horario de bajo tráfico
VACUUM FULL tenant_folios;
VACUUM FULL user_sessions;
VACUUM FULL tenant_customers;
VACUUM FULL tenant_invoices;
VACUUM FULL tenant_subscriptions;

-- 2. Actualizar estadísticas
ANALYZE;

-- 3. Verificar que el índice se use correctamente
EXPLAIN (ANALYZE, BUFFERS) 
UPDATE tenant_folios 
SET current_number = current_number + 1 
WHERE tenant_id = '3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb'::uuid 
AND series = 'A';

-- 4. Si aún no usa el índice, forzar su recreación
REINDEX TABLE tenant_folios;

-- 5. Configurar autovacuum más agresivo
ALTER TABLE tenant_folios SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.005
);

ALTER TABLE user_sessions SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.005
);

-- 6. Crear índices faltantes para optimización adicional
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_customer_search 
ON tenant_customers(tenant_id, legal_name text_pattern_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_invoice_list 
ON tenant_invoices(tenant_id, created_at DESC);

-- 7. Verificar resultados
SELECT 
  relname,
  n_live_tup,
  n_dead_tup,
  last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC;