-- SAFE Migration: Add Performance Indexes
-- Created: 2025-07-11
-- Purpose: Optimize frequent queries with ZERO downtime approach

-- SAFETY MEASURES:
-- 1. All indexes created CONCURRENTLY (no table locks)
-- 2. IF NOT EXISTS prevents errors on re-run
-- 3. Individual statements for rollback capability
-- 4. Conservative approach for production

-- Set statement timeout to prevent hanging
SET statement_timeout = '30min';

-- Index 1: tenant_customers legal_name search (CONCURRENT)
-- Used in: services/invoice.service.js:66
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_customers_legal_name_search 
ON tenant_customers(tenant_id, legal_name varchar_pattern_ops);

-- Index 2: tenant_invoices date range queries (CONCURRENT)  
-- Used in: api/controllers/invoice.controller.js - pagination
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_invoices_tenant_date 
ON tenant_invoices(tenant_id, created_at DESC);

-- Index 3: tenant_invoices folio lookup (CONCURRENT)
-- Used in: api/controllers/invoice.controller.js:650
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_invoices_tenant_folio 
ON tenant_invoices(tenant_id, folio_number);

-- Index 4: tenant_invoices status filtering (CONCURRENT)
-- Used in: services/invoice.service.js - status queries  
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_invoices_tenant_status 
ON tenant_invoices(tenant_id, status);

-- Index 5: tenant_subscriptions for middleware (CONCURRENT)
-- Used in: api/middlewares/tenant.middleware.js:90
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_subscriptions_tenant_created 
ON tenant_subscriptions(tenant_id, created_at DESC);

-- VALIDATION: Check if indexes were created successfully
SELECT 
  schemaname,
  tablename, 
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes 
WHERE indexrelname LIKE 'idx_tenant_%'
ORDER BY tablename, indexname;

-- ROLLBACK SCRIPT (uncomment if needed):
/*
DROP INDEX CONCURRENTLY IF EXISTS idx_tenant_customers_legal_name_search;
DROP INDEX CONCURRENTLY IF EXISTS idx_tenant_invoices_tenant_date;
DROP INDEX CONCURRENTLY IF EXISTS idx_tenant_invoices_tenant_folio; 
DROP INDEX CONCURRENTLY IF EXISTS idx_tenant_invoices_tenant_status;
DROP INDEX CONCURRENTLY IF EXISTS idx_tenant_subscriptions_tenant_created;
*/