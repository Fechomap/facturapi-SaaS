-- ========================================
-- QUERIES DE VERIFICACIÓN - Campos Stripe
-- ========================================
-- Fecha: 2025-10-27
-- Propósito: Verificar si hay datos en campos Stripe antes de eliminarlos
-- IMPORTANTE: Estas queries son SOLO de lectura (SELECT), no modifican datos
--
-- Instrucciones de uso en Railway:
-- 1. Abrir Railway Dashboard
-- 2. Ir a tu proyecto facturapi-SaaS
-- 3. Click en PostgreSQL service
-- 4. Click en "Data" o "Query"
-- 5. Copiar y pegar estas queries una por una
-- 6. Documentar los resultados
-- ========================================

-- ========================================
-- 1. SUBSCRIPTION_PLANS
-- ========================================

-- Verificar datos en subscription_plans
SELECT
  COUNT(*) as total_planes,
  COUNT(stripe_product_id) as planes_con_product_id,
  COUNT(stripe_price_id) as planes_con_price_id,
  COUNT(*) - COUNT(stripe_product_id) as planes_sin_product_id,
  COUNT(*) - COUNT(stripe_price_id) as planes_sin_price_id
FROM subscription_plans;

-- Ver registros específicos con datos Stripe (si existen)
SELECT
  id,
  name,
  price,
  stripe_product_id,
  stripe_price_id,
  created_at
FROM subscription_plans
WHERE stripe_product_id IS NOT NULL OR stripe_price_id IS NOT NULL
LIMIT 10;

-- ========================================
-- 2. TENANTS
-- ========================================

-- Verificar datos en tenants
SELECT
  COUNT(*) as total_tenants,
  COUNT(stripe_customer_id) as tenants_con_customer_id,
  COUNT(*) - COUNT(stripe_customer_id) as tenants_sin_customer_id
FROM tenants;

-- Ver registros específicos con datos Stripe (si existen)
SELECT
  id,
  business_name,
  email,
  stripe_customer_id,
  is_active,
  created_at
FROM tenants
WHERE stripe_customer_id IS NOT NULL
LIMIT 10;

-- ========================================
-- 3. TENANT_SUBSCRIPTIONS
-- ========================================

-- Verificar datos en tenant_subscriptions
SELECT
  COUNT(*) as total_subscriptions,
  COUNT(stripe_customer_id) as subs_con_customer_id,
  COUNT(stripe_subscription_id) as subs_con_subscription_id,
  COUNT(*) - COUNT(stripe_customer_id) as subs_sin_customer_id,
  COUNT(*) - COUNT(stripe_subscription_id) as subs_sin_subscription_id
FROM tenant_subscriptions;

-- Ver registros específicos con datos Stripe (si existen)
SELECT
  id,
  tenant_id,
  plan_id,
  status,
  stripe_customer_id,
  stripe_subscription_id,
  created_at
FROM tenant_subscriptions
WHERE stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL
LIMIT 10;

-- ========================================
-- 4. TENANT_PAYMENTS
-- ========================================

-- Verificar datos en tenant_payments
SELECT
  COUNT(*) as total_payments,
  COUNT(stripe_payment_id) as payments_con_payment_id,
  COUNT(stripe_invoice_id) as payments_con_invoice_id,
  COUNT(*) - COUNT(stripe_payment_id) as payments_sin_payment_id,
  COUNT(*) - COUNT(stripe_invoice_id) as payments_sin_invoice_id
FROM tenant_payments;

-- Ver registros específicos con datos Stripe (si existen)
SELECT
  id,
  tenant_id,
  subscription_id,
  amount,
  status,
  stripe_payment_id,
  stripe_invoice_id,
  payment_date,
  created_at
FROM tenant_payments
WHERE stripe_payment_id IS NOT NULL OR stripe_invoice_id IS NOT NULL
LIMIT 10;

-- ========================================
-- 5. RESUMEN GLOBAL
-- ========================================

-- Vista consolidada de todos los campos Stripe
SELECT
  'subscription_plans' as tabla,
  COUNT(*) as total_registros,
  COUNT(stripe_product_id) as campo1_con_datos,
  COUNT(stripe_price_id) as campo2_con_datos,
  CASE
    WHEN COUNT(stripe_product_id) > 0 OR COUNT(stripe_price_id) > 0 THEN '❌ HAY DATOS'
    ELSE '✅ SIN DATOS'
  END as estado
FROM subscription_plans

UNION ALL

SELECT
  'tenants' as tabla,
  COUNT(*) as total_registros,
  COUNT(stripe_customer_id) as campo1_con_datos,
  0 as campo2_con_datos,
  CASE
    WHEN COUNT(stripe_customer_id) > 0 THEN '❌ HAY DATOS'
    ELSE '✅ SIN DATOS'
  END as estado
FROM tenants

UNION ALL

SELECT
  'tenant_subscriptions' as tabla,
  COUNT(*) as total_registros,
  COUNT(stripe_customer_id) as campo1_con_datos,
  COUNT(stripe_subscription_id) as campo2_con_datos,
  CASE
    WHEN COUNT(stripe_customer_id) > 0 OR COUNT(stripe_subscription_id) > 0 THEN '❌ HAY DATOS'
    ELSE '✅ SIN DATOS'
  END as estado
FROM tenant_subscriptions

UNION ALL

SELECT
  'tenant_payments' as tabla,
  COUNT(*) as total_registros,
  COUNT(stripe_payment_id) as campo1_con_datos,
  COUNT(stripe_invoice_id) as campo2_con_datos,
  CASE
    WHEN COUNT(stripe_payment_id) > 0 OR COUNT(stripe_invoice_id) > 0 THEN '❌ HAY DATOS'
    ELSE '✅ SIN DATOS'
  END as estado
FROM tenant_payments;

-- ========================================
-- 6. DECISIÓN RECOMENDADA
-- ========================================

-- Esta query te dice exactamente qué hacer
WITH conteos AS (
  SELECT
    (SELECT COUNT(stripe_product_id) + COUNT(stripe_price_id) FROM subscription_plans) +
    (SELECT COUNT(stripe_customer_id) FROM tenants) +
    (SELECT COUNT(stripe_customer_id) + COUNT(stripe_subscription_id) FROM tenant_subscriptions) +
    (SELECT COUNT(stripe_payment_id) + COUNT(stripe_invoice_id) FROM tenant_payments)
    AS total_datos_stripe
)
SELECT
  total_datos_stripe,
  CASE
    WHEN total_datos_stripe = 0 THEN
      '✅ RECOMENDACIÓN: ELIMINAR CAMPOS

      No hay datos en ningún campo Stripe.
      Es SEGURO proceder con OPCIÓN A del plan.

      Siguiente paso:
      1. Hacer backup de la BD
      2. Crear migración para eliminar campos
      3. Aplicar cambios'
    ELSE
      '⚠️ RECOMENDACIÓN: EVALUAR DATOS

      Hay ' || total_datos_stripe || ' valores en campos Stripe.
      Se debe decidir entre:

      OPCIÓN A: Backup + Limpiar datos + Eliminar campos
      OPCIÓN B: Mantener campos (documentar como legacy)

      Ejecutar queries individuales arriba para ver qué datos existen.'
  END as recomendacion
FROM conteos;

-- ========================================
-- INSTRUCCIONES FINALES
-- ========================================

-- Después de ejecutar estas queries:
--
-- 1. Documentar los resultados
-- 2. Revisar el archivo PLAN_ELIMINACION_CAMPOS_STRIPE_BD.md
-- 3. Tomar decisión informada
-- 4. Proceder según el plan elegido
--
-- ========================================
