-- Migration: Add Performance Indexes
-- Created: 2025-07-11
-- Purpose: Optimize frequent queries identified in performance analysis

-- Index for tenant_customers.legal_name searches (used with LIKE queries)
-- Location: services/invoice.service.js:66 - contains search
CREATE INDEX IF NOT EXISTS idx_tenant_customers_legal_name_search 
ON tenant_customers(tenant_id, legal_name varchar_pattern_ops);

-- Composite index for tenant_invoices date range queries
-- Location: api/controllers/invoice.controller.js - date filtering
CREATE INDEX IF NOT EXISTS idx_tenant_invoices_tenant_date 
ON tenant_invoices(tenant_id, created_at DESC);

-- Index for tenant_invoices folio lookup
-- Location: api/controllers/invoice.controller.js:650 - folio search
CREATE INDEX IF NOT EXISTS idx_tenant_invoices_tenant_folio 
ON tenant_invoices(tenant_id, folio_number);

-- Index for tenant_invoices status filtering
-- Location: services/invoice.service.js - status queries
CREATE INDEX IF NOT EXISTS idx_tenant_invoices_tenant_status 
ON tenant_invoices(tenant_id, status);

-- Composite index for tenant_invoices customer queries
-- Location: services/invoice.service.js - customer filtering
CREATE INDEX IF NOT EXISTS idx_tenant_invoices_tenant_customer 
ON tenant_invoices(tenant_id, customer_id);

-- Index for tenant_subscriptions tenant lookup (used in middleware)
-- Location: api/middlewares/tenant.middleware.js:90
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant_created 
ON tenant_subscriptions(tenant_id, created_at DESC);

-- Index for tenant_folios atomic operations
-- Location: services/tenant.service.js:57 - atomic folio updates
CREATE INDEX IF NOT EXISTS idx_tenant_folios_tenant_series 
ON tenant_folios(tenant_id, series);

-- Index for user_sessions cleanup operations
-- Location: scripts/database/cleanup-database.js
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires 
ON user_sessions(expires_at) WHERE expires_at IS NOT NULL;

-- Performance validation queries
-- Uncomment to test index effectiveness

/*
-- Test query performance for legal_name search
EXPLAIN ANALYZE 
SELECT * FROM tenant_customers 
WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000' 
AND legal_name ILIKE '%PROTECCION%';

-- Test query performance for invoice date range
EXPLAIN ANALYZE 
SELECT * FROM tenant_invoices 
WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000' 
AND created_at >= '2024-01-01' 
AND created_at <= '2024-12-31'
ORDER BY created_at DESC
LIMIT 10;

-- Test query performance for folio lookup
EXPLAIN ANALYZE 
SELECT * FROM tenant_invoices 
WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000' 
AND folio_number = 1001;
*/

-- Log successful index creation
SELECT 'Performance indexes created successfully' as status;