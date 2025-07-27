-- scripts/database-migration.sql
-- Migración para agregar campos de FacturAPI a TenantInvoice

-- PASO 1: Agregar nuevos campos a la tabla existente
ALTER TABLE tenant_invoices 
ADD COLUMN uuid VARCHAR(36),                    -- UUID/Folio Fiscal del SAT
ADD COLUMN subtotal DECIMAL(12, 2),            -- Subtotal antes de impuestos
ADD COLUMN iva_amount DECIMAL(12, 2),          -- Monto específico de IVA
ADD COLUMN retencion_amount DECIMAL(12, 2),    -- Monto específico de retención
ADD COLUMN currency VARCHAR(3) DEFAULT 'MXN',  -- Moneda
ADD COLUMN verification_url TEXT,              -- URL de verificación SAT
ADD COLUMN last_synced_at TIMESTAMP,           -- Última sincronización con FacturAPI
ADD COLUMN facturapi_status VARCHAR(20);       -- Estado en FacturAPI

-- PASO 2: Crear índices para optimizar consultas de reportes
CREATE INDEX idx_tenant_invoices_uuid ON tenant_invoices(uuid);
CREATE INDEX idx_tenant_invoices_currency ON tenant_invoices(tenant_id, currency);
CREATE INDEX idx_tenant_invoices_sync ON tenant_invoices(last_synced_at);

-- PASO 3: Crear tabla temporal para migración de datos
CREATE TABLE IF NOT EXISTS temp_invoice_migration (
    id SERIAL PRIMARY KEY,
    tenant_invoice_id INTEGER REFERENCES tenant_invoices(id),
    uuid VARCHAR(36),
    subtotal DECIMAL(12, 2),
    iva_amount DECIMAL(12, 2),
    retencion_amount DECIMAL(12, 2),
    currency VARCHAR(3),
    verification_url TEXT,
    migration_status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    error_message TEXT
);

-- PASO 4: Función para aplicar datos migrados
CREATE OR REPLACE FUNCTION apply_migration_data()
RETURNS INTEGER AS $$
DECLARE
    affected_rows INTEGER := 0;
    migration_record RECORD;
BEGIN
    -- Aplicar datos de la tabla temporal a la tabla principal
    FOR migration_record IN 
        SELECT * FROM temp_invoice_migration 
        WHERE migration_status = 'pending'
    LOOP
        UPDATE tenant_invoices 
        SET 
            uuid = migration_record.uuid,
            subtotal = migration_record.subtotal,
            iva_amount = migration_record.iva_amount,
            retencion_amount = migration_record.retencion_amount,
            currency = migration_record.currency,
            verification_url = migration_record.verification_url,
            last_synced_at = NOW(),
            facturapi_status = 'valid'
        WHERE id = migration_record.tenant_invoice_id;
        
        -- Marcar como aplicado
        UPDATE temp_invoice_migration 
        SET migration_status = 'applied'
        WHERE id = migration_record.id;
        
        affected_rows := affected_rows + 1;
    END LOOP;
    
    RETURN affected_rows;
END;
$$ LANGUAGE plpgsql;

-- PASO 5: Crear vista para reportes optimizados
CREATE OR REPLACE VIEW invoice_report_view AS
SELECT 
    ti.id,
    ti.tenant_id,
    ti.series || ti.folio_number AS folio_completo,
    ti.uuid AS folio_fiscal,
    tc.legal_name AS cliente_nombre,
    tc.rfc AS cliente_rfc,
    ti.invoice_date AS fecha_factura,
    ti.subtotal,
    ti.iva_amount,
    ti.retencion_amount,
    ti.total,
    ti.status AS estado,
    ti.verification_url,
    ti.series,
    ti.folio_number,
    ti.currency AS moneda,
    ti.last_synced_at,
    t.business_name AS empresa_emisor
FROM tenant_invoices ti
LEFT JOIN tenant_customers tc ON ti.customer_id = tc.id
LEFT JOIN tenants t ON ti.tenant_id = t.id
WHERE ti.uuid IS NOT NULL; -- Solo facturas con datos completos

-- PASO 6: Comentarios para documentación
COMMENT ON COLUMN tenant_invoices.uuid IS 'UUID/Folio Fiscal del SAT obtenido de FacturAPI';
COMMENT ON COLUMN tenant_invoices.subtotal IS 'Subtotal antes de impuestos calculado desde items de FacturAPI';
COMMENT ON COLUMN tenant_invoices.iva_amount IS 'Monto específico de IVA extraído de taxes de FacturAPI';
COMMENT ON COLUMN tenant_invoices.retencion_amount IS 'Monto específico de retención extraído de taxes de FacturAPI';
COMMENT ON VIEW invoice_report_view IS 'Vista optimizada para generación de reportes Excel';