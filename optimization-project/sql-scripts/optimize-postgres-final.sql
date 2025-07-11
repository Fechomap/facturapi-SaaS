
-- OPTIMIZACIÓN DE POSTGRESQL PARA FACTURAPI BOT
-- Ejecutar con usuario con permisos de administrador

-- 1. CREAR ÍNDICES FALTANTES (CRÍTICO)
-- Nota: Ya existe índice en tenant_folios, pero verificar su uso

-- Índice para búsquedas de clientes (LIKE)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_customer_search 
ON tenant_customers(tenant_id, legal_name text_pattern_ops);

-- Índice para listados de facturas
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_invoice_list 
ON tenant_invoices(tenant_id, created_at DESC);

-- Índice para búsquedas de suscripciones activas
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_subscription_active 
ON tenant_subscriptions(tenant_id, status) 
WHERE status IN ('active', 'trial');

-- 2. OPTIMIZAR TABLAS CON BLOAT
VACUUM ANALYZE tenant_folios;
VACUUM ANALYZE user_sessions;
VACUUM ANALYZE tenant_customers;
VACUUM ANALYZE tenant_invoices;

-- 3. CONFIGURACIÓN DE RENDIMIENTO
-- Ajustar según tu RAM disponible
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET work_mem = '16MB';
ALTER SYSTEM SET maintenance_work_mem = '128MB';

-- Para SSD
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;

-- 4. AUTOVACUUM MÁS AGRESIVO PARA TABLAS CRÍTICAS
ALTER TABLE tenant_folios SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);

ALTER TABLE user_sessions SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);

-- 5. ESTADÍSTICAS EXTENDIDAS
CREATE STATISTICS IF NOT EXISTS tenant_folio_stats (dependencies) 
ON tenant_id, series FROM tenant_folios;

-- 6. RECARGAR CONFIGURACIÓN
SELECT pg_reload_conf();

-- 7. MONITOREO - Habilitar pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
