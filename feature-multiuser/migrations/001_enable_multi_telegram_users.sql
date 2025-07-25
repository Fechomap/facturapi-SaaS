-- ==========================================
-- MIGRACIÓN: Habilitar múltiples usuarios Telegram por tenant
-- FECHA: 2025-07-25
-- AUTOR: Claude (Anthropic)
-- ==========================================

-- ⚠️ IMPORTANTE: NO EJECUTAR SIN BACKUP COMPLETO DE LA BD

-- FASE 1: Preparación (verificar datos existentes)
-- ==========================================

-- Verificar usuarios actuales y posibles duplicados
SELECT 
    t.business_name,
    tu.telegram_id,
    tu.first_name,
    tu.is_authorized,
    COUNT(*) as user_count
FROM tenant_users tu
JOIN tenants t ON tu.tenant_id = t.id
GROUP BY t.business_name, tu.telegram_id, tu.first_name, tu.is_authorized
HAVING COUNT(*) > 1;

-- FASE 2: Modificación del Schema
-- ==========================================

-- Paso 1: Eliminar constraint único de telegram_id
ALTER TABLE tenant_users 
DROP CONSTRAINT IF EXISTS tenant_users_telegram_id_key;

-- Paso 2: Crear índice compuesto único (tenant_id, telegram_id)
-- Esto permite el mismo telegram_id en diferentes tenants, pero no duplicados en el mismo tenant
ALTER TABLE tenant_users 
ADD CONSTRAINT tenant_users_tenant_telegram_unique 
UNIQUE (tenant_id, telegram_id);

-- Paso 3: Actualizar tabla de sesiones para soportar múltiples contextos
-- Mantener compatibilidad hacia atrás
CREATE INDEX IF NOT EXISTS idx_user_sessions_telegram_tenant 
ON user_sessions(telegram_id);

-- FASE 3: Datos de migración (si es necesario)
-- ==========================================

-- Si hay usuarios duplicados, esta consulta los identificará
-- Los duplicados deberán resolverse manualmente antes de aplicar la migración

-- FASE 4: Verificación post-migración
-- ==========================================

-- Verificar que el constraint se aplicó correctamente
SELECT 
    conname, 
    pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'tenant_users'::regclass 
AND contype = 'u';

-- Verificar que no hay datos inconsistentes
SELECT 
    tenant_id,
    telegram_id,
    COUNT(*) as duplicates
FROM tenant_users
GROUP BY tenant_id, telegram_id
HAVING COUNT(*) > 1;

-- ==========================================
-- ROLLBACK PLAN (en caso de problemas)
-- ==========================================

-- Para revertir los cambios:
/*
-- 1. Eliminar constraint compuesto
ALTER TABLE tenant_users 
DROP CONSTRAINT IF EXISTS tenant_users_tenant_telegram_unique;

-- 2. Restaurar constraint único original (solo si no hay duplicados)
ALTER TABLE tenant_users 
ADD CONSTRAINT tenant_users_telegram_id_key 
UNIQUE (telegram_id);
*/

-- ==========================================
-- NOTAS IMPORTANTES
-- ==========================================

/*
1. Esta migración debe ejecutarse en horario de menor tráfico
2. Hacer backup completo ANTES de ejecutar
3. Probar primero en ambiente de staging
4. Tener plan de rollback listo
5. Monitorear aplicación post-migración

COMANDOS PARA EJECUTAR (cuando esté listo):
1. pg_dump -h host -U user -d database > backup_pre_multiuser.sql
2. psql -h host -U user -d database -f 001_enable_multi_telegram_users.sql
3. Verificar que la aplicación funciona correctamente
*/