# 🧹 PLAN DE LIMPIEZA - Eliminación de Stripe

## Plan de Ejecución Detallado

**Fecha inicio estimada**: A definir
**Duración estimada**: 3-5 días
**Riesgo general**: 🟢 BAJO

---

## 📋 PRE-REQUISITOS

### 1. Backups

```bash
# 1. Backup de base de datos producción
pg_dump $DATABASE_URL > backup_pre_stripe_cleanup_$(date +%Y%m%d).sql

# 2. Crear branch de trabajo
git checkout -b cleanup/stripe-removal

# 3. Verificar estado actual
git status
npm test
```

### 2. Verificación de Datos en Producción

**CRÍTICO**: Ejecutar ANTES de cualquier cambio en BD

```sql
-- Conectar a base de datos de producción
psql $DATABASE_URL

-- Verificar datos en campos Stripe
SELECT
  'subscription_plans' as table_name,
  COUNT(*) as total_rows,
  COUNT(stripe_product_id) as with_stripe_product,
  COUNT(stripe_price_id) as with_stripe_price
FROM subscription_plans
UNION ALL
SELECT
  'tenants',
  COUNT(*),
  COUNT(stripe_customer_id),
  0
FROM tenants
UNION ALL
SELECT
  'tenant_subscriptions',
  COUNT(*),
  COUNT(stripe_customer_id),
  COUNT(stripe_subscription_id)
FROM tenant_subscriptions
UNION ALL
SELECT
  'tenant_payments',
  COUNT(*),
  COUNT(stripe_payment_id),
  COUNT(stripe_invoice_id)
FROM tenant_payments;
```

**Decisión basada en resultados**:
- ✅ Si todos = 0: ELIMINAR campos de BD
- ⚠️ Si > 0: MANTENER campos, solo eliminar código

---

## 🗂️ FASE 1: ELIMINACIÓN DE ARCHIVOS COMPLETOS

### Día 1 - Mañana: Eliminar Servicios

```bash
# 1. Eliminar servicios Stripe
rm services/payment.service.js
rm services/stripe.service.js

# 2. Verificar que no se importan en ningún lado
grep -r "payment.service" --include="*.js" --exclude-dir=node_modules .
grep -r "stripe.service" --include="*.js" --exclude-dir=node_modules .

# 3. Si hay importaciones, documentarlas para modificar después
grep -r "payment.service" --include="*.js" --exclude-dir=node_modules . > imports_to_fix.txt

# 4. Commit
git add -A
git commit -m "chore: remove Stripe payment and stripe services"
```

### Día 1 - Tarde: Eliminar Tests

```bash
# 1. Eliminar tests de Stripe
rm tests/payment.service.test.js
rm tests/validate-stripe-webhook.js

# 2. Modificar test de subscription flow (eliminar partes de Stripe)
# Editar tests/test-subscription-flow.js manualmente
# Eliminar líneas que prueben lógica de Stripe

# 3. Verificar tests
npm test

# 4. Commit
git add -A
git commit -m "chore: remove Stripe-related tests"
```

### Día 1 - Tarde: Eliminar Scripts

```bash
# 1. Eliminar script obsoleto
rm scripts/admin/update-plan-price.js

# 2. Commit
git add -A
git commit -m "chore: remove Stripe plan update script"
```

---

## ✏️ FASE 2: MODIFICACIÓN DE ARCHIVOS COMPARTIDOS

### Día 2 - Mañana: Rutas y Controladores

#### api/routes/webhook.routes.js

```javascript
// ANTES:
import express from 'express';
import webhookController from '../controllers/webhook.controller.js';

const router = express.Router();

router.post('/stripe', webhookController.handleStripeWebhook);  // ❌ ELIMINAR
router.post('/facturapi', webhookController.handleFacturapiWebhook);
router.post('/:source', webhookController.handleGenericWebhook);

export default router;

// DESPUÉS:
import express from 'express';
import webhookController from '../controllers/webhook.controller.js';

const router = express.Router();

router.post('/facturapi', webhookController.handleFacturapiWebhook);
router.post('/:source', webhookController.handleGenericWebhook);

export default router;
```

#### api/controllers/webhook.controller.js

```javascript
// ELIMINAR TODO EL MÉTODO handleStripeWebhook (líneas 22-104)
// ELIMINAR import de payment.service (línea 4)

// ANTES:
import { handleWebhookEvent } from '../../services/payment.service.js';  // ❌ ELIMINAR

// Método completo a eliminar:
async handleStripeWebhook(req, res, _next) { ... }  // ❌ ELIMINAR TODO

// DESPUÉS:
// Solo mantener:
// - handleFacturapiWebhook
// - handleGenericWebhook
// - métodos privados (handleInvoiceCanceled, etc.)
```

**Comando**:
```bash
# Aplicar cambios y commit
git add api/routes/webhook.routes.js api/controllers/webhook.controller.js
git commit -m "refactor: remove Stripe webhook handling"
```

### Día 2 - Tarde: Configuración

#### config/services.js

```javascript
// ANTES (líneas a eliminar):
import Stripe from 'stripe';  // ❌ ELIMINAR

// Configuración de Stripe - ❌ ELIMINAR TODO
export const stripeConfig = {
  secretKey: process.env.STRIPE_SECRET_KEY,
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  apiVersion: '2023-10-16',
};

// Validación de Stripe - ❌ ELIMINAR
if (!stripeConfig.secretKey) {
  logger.warn('STRIPE_SECRET_KEY no configurada...');
}

// DESPUÉS:
// Solo mantener:
export const facturapiConfig = { ... };
```

#### config/index.js

```javascript
// ANTES (líneas a eliminar):
import { facturapiConfig, stripeConfig, validateServicesConfig } from './services.js';

const config = {
  // ... otras configs

  // Configuración de Stripe  // ❌ ELIMINAR
  stripe: stripeConfig,  // ❌ ELIMINAR

  // ... resto
};

// DESPUÉS:
import { facturapiConfig, validateServicesConfig } from './services.js';

const config = {
  // ... otras configs
  // ¡Stripe eliminado!
  // ... resto
};

// También actualizar getSafeConfig() para eliminar referencias a stripe
```

**Comando**:
```bash
git add config/services.js config/index.js
git commit -m "refactor: remove Stripe configuration"
```

### Día 2 - Tarde: Actualizar Scripts Admin

#### scripts/admin/create-subscription-plan.js

```javascript
// ELIMINAR campos Stripe del objeto data:

// ANTES:
const newPlan = await prisma.subscriptionPlan.create({
  data: {
    name: planName,
    description: planDescription,
    price: parseFloat(planPrice),
    currency: 'MXN',
    billingPeriod: 'monthly',
    invoiceLimit: parseInt(invoiceLimit, 10),
    isActive: true,
    stripeProductId: 'prod_S8DMoG02MoBqXg',  // ❌ ELIMINAR
    stripePriceId: 'price_1RDww1P4Me2WA9wKONkcrai4',  // ❌ ELIMINAR
  },
});

// DESPUÉS:
const newPlan = await prisma.subscriptionPlan.create({
  data: {
    name: planName,
    description: planDescription,
    price: parseFloat(planPrice),
    currency: 'MXN',
    billingPeriod: 'monthly',
    invoiceLimit: parseInt(invoiceLimit, 10),
    isActive: true,
    // Stripe fields removed
  },
});
```

#### scripts/admin/check-plans.js

```javascript
// Eliminar display de campos Stripe

// ANTES:
console.log('  Stripe Product ID:', plan.stripeProductId);  // ❌ ELIMINAR
console.log('  Stripe Price ID:', plan.stripePriceId);      // ❌ ELIMINAR

// DESPUÉS:
// Simplemente eliminar esas líneas
```

**Comando**:
```bash
git add scripts/admin/
git commit -m "refactor: remove Stripe fields from admin scripts"
```

---

## 🗄️ FASE 3: BASE DE DATOS

### Día 3 - Opción A: Mantener Campos (Si hay datos)

**Si la verificación mostró datos en campos Stripe**:

```bash
# NO hacer nada en la base de datos
# Solo actualizar documentación

echo "NOTA: Campos Stripe mantenidos en BD por datos históricos" > docs/STRIPE_LEGACY_FIELDS.md
git add docs/STRIPE_LEGACY_FIELDS.md
git commit -m "docs: document legacy Stripe fields in database"
```

### Día 3 - Opción B: Eliminar Campos (Si NO hay datos)

**Solo si la verificación mostró 0 datos**:

#### 1. Crear migración

```bash
# Crear nueva migración
npx prisma migrate dev --create-only --name remove_stripe_fields
```

#### 2. Editar migración generada

Editar archivo en `prisma/migrations/XXXXXXXX_remove_stripe_fields/migration.sql`:

```sql
-- Eliminar campos Stripe de subscription_plans
ALTER TABLE subscription_plans
  DROP COLUMN IF EXISTS stripe_product_id,
  DROP COLUMN IF EXISTS stripe_price_id;

-- Eliminar campos Stripe de tenants
ALTER TABLE tenants
  DROP COLUMN IF EXISTS stripe_customer_id;

-- Eliminar campos Stripe de tenant_subscriptions
ALTER TABLE tenant_subscriptions
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id;

-- Eliminar campos Stripe de tenant_payments
ALTER TABLE tenant_payments
  DROP COLUMN IF EXISTS stripe_payment_id,
  DROP COLUMN IF EXISTS stripe_invoice_id;
```

#### 3. Actualizar schema.prisma

```prisma
model SubscriptionPlan {
  id              Int                  @id @default(autoincrement())
  name            String               @db.VarChar(50)
  description     String?
  price           Decimal              @db.Decimal(10, 2)
  currency        String               @default("MXN") @db.VarChar(3)
  billingPeriod   String               @default("monthly") @db.VarChar(20)
  invoiceLimit    Int
  isActive        Boolean              @default(true)
  // stripeProductId String?           @map("stripe_product_id") @db.VarChar(100)  // ❌ ELIMINAR
  // stripePriceId   String?            @map("stripe_price_id") @db.VarChar(100)    // ❌ ELIMINAR
  createdAt       DateTime             @default(now()) @map("created_at")
  updatedAt       DateTime             @default(now()) @map("updated_at")
  subscriptions   TenantSubscription[]

  @@map("subscription_plans")
}

model Tenant {
  id                      String               @id @default(uuid()) @db.Uuid
  businessName            String               @map("business_name") @db.VarChar(255)
  rfc                     String               @unique @db.VarChar(20)
  email                   String               @db.VarChar(255)
  phone                   String?              @db.VarChar(20)
  address                 String?
  contactName             String?              @map("contact_name") @db.VarChar(255)
  facturapiOrganizationId String?              @map("facturapi_organization_id") @db.VarChar(100)
  facturapiApiKey         String?              @map("facturapi_api_key") @db.VarChar(255)
  isActive                Boolean              @default(true) @map("is_active")
  createdAt               DateTime             @default(now()) @map("created_at")
  updatedAt               DateTime             @default(now()) @map("updated_at")
  // stripeCustomerId     String?              @unique @map("stripe_customer_id") @db.VarChar(100)  // ❌ ELIMINAR
  // ... resto de relaciones
}

model TenantSubscription {
  id                    Int              @id @default(autoincrement())
  tenantId              String           @map("tenant_id") @db.Uuid
  planId                Int              @map("plan_id")
  // stripeCustomerId   String?          @map("stripe_customer_id") @db.VarChar(100)      // ❌ ELIMINAR
  // stripeSubscriptionId String?        @map("stripe_subscription_id") @db.VarChar(100)  // ❌ ELIMINAR
  status                String           @default("trial") @db.VarChar(20)
  // ... resto
}

model TenantPayment {
  id              Int                @id @default(autoincrement())
  tenantId        String             @map("tenant_id") @db.Uuid
  subscriptionId  Int                @map("subscription_id")
  amount          Decimal            @db.Decimal(10, 2)
  currency        String             @default("MXN") @db.VarChar(3)
  // stripePaymentId String?         @map("stripe_payment_id") @db.VarChar(100)  // ❌ ELIMINAR
  // stripeInvoiceId String?         @map("stripe_invoice_id") @db.VarChar(100)  // ❌ ELIMINAR
  paymentMethod   String?            @map("payment_method") @db.VarChar(50)
  status          String             @db.VarChar(20)
  // ... resto
}
```

#### 4. Aplicar migración

```bash
# Generar cliente Prisma actualizado
npx prisma generate

# Aplicar migración en desarrollo/staging primero
npx prisma migrate dev

# Verificar que funciona
npm test

# Cuando esté listo para producción:
npx prisma migrate deploy
```

**Commit**:
```bash
git add prisma/
git commit -m "refactor: remove Stripe fields from database schema"
```

---

## 📦 FASE 4: DEPENDENCIAS

### Día 3 - Tarde: Eliminar Stripe del package.json

```bash
# 1. Desinstalar Stripe
npm uninstall stripe

# 2. Verificar package.json actualizado
cat package.json | grep stripe  # No debería mostrar nada

# 3. Verificar que no rompimos nada
npm install
npm test

# 4. Commit
git add package.json package-lock.json
git commit -m "chore: remove Stripe dependency"
```

### Verificar Tamaño

```bash
# Antes y después
du -sh node_modules/  # Debería ser ~14-15MB menor
```

---

## 📝 FASE 5: DOCUMENTACIÓN Y VARIABLES DE ENTORNO

### Día 4: Actualizar Documentación

#### .env.example

```bash
# ELIMINAR líneas:
# === STRIPE ===
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxx          # ❌ ELIMINAR
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxx     # ❌ ELIMINAR
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxx        # ❌ ELIMINAR
```

#### README.md

Buscar y eliminar/actualizar referencias a Stripe:

```bash
# Buscar referencias
grep -n "Stripe\|stripe" README.md

# Editar manualmente para eliminar secciones de:
# - Configuración de Stripe
# - Variables de entorno de Stripe
# - Webhooks de Stripe
# - Flujos de pago con Stripe
```

#### Archivar docs/analysis/STRIPE_ANALYSIS.md

```bash
# Mover a archivo histórico
mkdir -p docs/archive
mv docs/analysis/STRIPE_ANALYSIS.md docs/archive/STRIPE_ANALYSIS_archived_$(date +%Y%m%d).md

git add docs/
git commit -m "docs: archive Stripe analysis documentation"
```

#### Actualizar AUDITORIA_COMPLETA_2025.md

Agregar sección al final:

```markdown
## ✅ LIMPIEZA EJECUTADA - Stripe Removal

**Fecha de ejecución**: YYYY-MM-DD
**Ejecutado por**: [Nombre]

### Cambios Aplicados
- ✅ Servicios eliminados: payment.service.js, stripe.service.js
- ✅ Tests eliminados: 2 archivos
- ✅ Scripts eliminados: 1 archivo
- ✅ Archivos modificados: 8 archivos
- ✅ Dependencias eliminadas: stripe@17.7.0
- ✅ Campos BD eliminados: [SÍ/NO]

### Resultados
- Líneas de código eliminadas: ~3,000
- Tamaño node_modules reducido: ~14.5MB
- Tests pasando: [#/total]
```

---

## 🧪 FASE 6: TESTING COMPLETO

### Día 4-5: Verificación Exhaustiva

#### 1. Tests Unitarios

```bash
# Ejecutar todos los tests
npm test

# Si hay fallos, documentarlos
npm test 2>&1 | tee test_results.txt
```

#### 2. Tests de Integración

```bash
# Test de clustering
npm run test:clustering

# Test de Redis
npm run test:redis

# Test de suscripciones (sin Stripe)
npm run test:subscription
```

#### 3. Verificación Manual

```bash
# Iniciar servidor
npm run dev

# Verificar logs - NO deberían haber errores relacionados a Stripe
# Verificar que API funciona
# Verificar que bot funciona
```

#### 4. Build de Producción

```bash
# Generar build
npm run build

# Verificar que no hay errores
```

---

## 🚀 FASE 7: DEPLOYMENT

### Staging

```bash
# 1. Push a staging branch
git push origin cleanup/stripe-removal:staging

# 2. Deploy a staging
# (Depende de tu setup - Railway, etc.)

# 3. Ejecutar migración si se eliminaron campos BD
# SSH a staging o via Railway CLI
npx prisma migrate deploy

# 4. Verificar que funciona
# - Hacer pruebas manuales
# - Verificar logs
# - Crear una factura de prueba
```

### Producción

```bash
# 1. Merge a main
git checkout main
git merge cleanup/stripe-removal

# 2. Tag de versión
git tag -a v2.0.0-stripe-cleanup -m "Remove Stripe integration"
git push origin main --tags

# 3. Deploy a producción
# (Según tu proceso)

# 4. BACKUP DE BD ANTES DE MIGRACIÓN (SI APLICA)
pg_dump $DATABASE_URL_PROD > backup_pre_migration_$(date +%Y%m%d_%H%M%S).sql

# 5. Ejecutar migración (solo si se eliminaron campos)
# Con mucho cuidado
npx prisma migrate deploy

# 6. Monitorear logs por 24-48 horas
# Verificar que no hay errores
```

---

## 🔙 ROLLBACK PLAN

### Si algo sale mal

#### Rollback de Código

```bash
# Revertir a versión anterior
git revert HEAD
git push origin main

# O hacer rollback del deploy
# (Según tu plataforma)
```

#### Rollback de Base de Datos

```bash
# Solo si se ejecutó migración de eliminación de campos

# 1. Restaurar desde backup
psql $DATABASE_URL < backup_pre_migration_YYYYMMDD_HHMMSS.sql

# 2. O crear migración inversa
npx prisma migrate dev --create-only --name rollback_stripe_fields

# Editar migración para re-agregar campos:
ALTER TABLE subscription_plans ADD COLUMN stripe_product_id VARCHAR(100);
ALTER TABLE subscription_plans ADD COLUMN stripe_price_id VARCHAR(100);
# ... etc

npx prisma migrate deploy
```

---

## ✅ CHECKLIST FINAL

### Pre-Ejecución
- [ ] Backup de base de datos producción
- [ ] Verificar datos en campos Stripe
- [ ] Todos los tests pasan
- [ ] Branch de trabajo creado
- [ ] Equipo notificado

### Día 1
- [ ] Servicios eliminados
- [ ] Tests eliminados
- [ ] Scripts eliminados
- [ ] Tests pasan
- [ ] Commits realizados

### Día 2
- [ ] Rutas modificadas
- [ ] Controladores modificados
- [ ] Configuración actualizada
- [ ] Scripts admin actualizados
- [ ] Tests pasan
- [ ] Commits realizados

### Día 3
- [ ] Decisión BD tomada (mantener/eliminar campos)
- [ ] Migración creada (si aplica)
- [ ] Schema actualizado (si aplica)
- [ ] Dependencia Stripe eliminada
- [ ] Tests pasan
- [ ] Commits realizados

### Día 4
- [ ] .env.example actualizado
- [ ] README actualizado
- [ ] Docs archivadas
- [ ] AUDITORIA actualizada
- [ ] Tests completos ejecutados
- [ ] Build de producción funciona

### Día 5
- [ ] Deploy a staging
- [ ] Verificación en staging
- [ ] Deploy a producción
- [ ] Migración ejecutada (si aplica)
- [ ] Monitoreo activo
- [ ] Equipo notificado de completion

---

## 📞 CONTACTO Y SOPORTE

Si encuentras problemas durante la ejecución:

1. ⚠️ **DETENER** inmediatamente
2. 📸 **DOCUMENTAR** el error (logs, screenshots)
3. 🔙 **CONSIDERAR** rollback si es crítico
4. 📝 **REPORTAR** en issue de GitHub

---

**Plan creado**: 2025-10-27
**Versión**: 1.0
