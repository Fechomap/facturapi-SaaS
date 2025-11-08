# Propuesta: Guardar Datos Completos de Facturas en Base de Datos

**Fecha:** 2025-11-07
**Prioridad:** ALTA
**Impacto:** Rendimiento, Escalabilidad, Costos
**Estado:** Propuesta para Evaluación

---

## Resumen Ejecutivo

Actualmente guardamos solo **datos básicos** de las facturas (UUID, total, serie, folio), pero **NO guardamos datos financieros completos** como subtotal, IVA, retenciones, items, etc.

**Consecuencia:** Los reportes Excel deben llamar a FacturAPI o dejar campos en blanco, limitando la velocidad y funcionalidad.

**Propuesta:** Guardar TODOS los datos de la factura en el momento de crearla, eliminando la dependencia de FacturAPI para consultas y reportes.

---

## Problema Actual

### ❌ Lo que NO Guardamos

Campos financieros críticos que FacturAPI nos devuelve pero no almacenamos:

| Campo | Descripción | Impacto de NO tenerlo |
|-------|-------------|----------------------|
| `subtotal` | Monto antes de impuestos | Reportes incompletos, no podemos calcular márgenes |
| `ivaAmount` | Monto de IVA | No podemos hacer reportes fiscales sin llamar API |
| `retencionAmount` | Monto de retenciones | Contabilidad requiere llamadas a API |
| `currency` | Moneda (MXN, USD, etc.) | No podemos filtrar por moneda localmente |
| `verificationUrl` | URL de verificación SAT | Los usuarios no pueden verificar sin llamar API |
| `items` | Productos/servicios facturados | Análisis de productos imposible sin API |
| `paymentForm` | Forma de pago | Reportes de cobranza limitados |
| `paymentMethod` | Método de pago | Análisis de flujo de caja imposible |

### 📊 Esquema Actual vs Propuesto

**ACTUAL (TenantInvoice):**
```prisma
model TenantInvoice {
  id                 Int       @id @default(autoincrement())
  tenantId           String    @map("tenant_id") @db.Uuid
  facturapiInvoiceId String    @map("facturapi_invoice_id")
  series             String    @db.VarChar(5)
  folioNumber        Int       @map("folio_number")
  customerId         Int?      @map("customer_id")
  total              Decimal   @db.Decimal(12, 2)
  status             String    @db.VarChar(20)
  uuid               String?   @db.VarChar(100)
  // ... solo metadatos (fechas, tags, etc.)
}
```

**PROPUESTO (TenantInvoice - Enriquecido):**
```prisma
model TenantInvoice {
  // ... campos actuales ...

  // DATOS FINANCIEROS COMPLETOS
  subtotal           Decimal?  @db.Decimal(12, 2)   @map("subtotal")
  ivaAmount          Decimal?  @db.Decimal(12, 2)   @map("iva_amount")
  retencionAmount    Decimal?  @db.Decimal(12, 2)   @map("retencion_amount")
  discount           Decimal?  @db.Decimal(12, 2)   @map("discount")

  // DATOS DE PAGO
  currency           String?   @db.VarChar(3)        @map("currency")          // MXN, USD
  paymentForm        String?   @db.VarChar(50)       @map("payment_form")      // 01, 02, 03, etc.
  paymentMethod      String?   @db.VarChar(50)       @map("payment_method")    // PUE, PPD

  // DATOS DE VERIFICACIÓN
  verificationUrl    String?   @db.VarChar(500)      @map("verification_url")
  satCertNumber      String?   @db.VarChar(50)       @map("sat_cert_number")

  // ITEMS (JSON para flexibilidad)
  items              Json?                            @map("items")

  // DATOS FISCALES ADICIONALES
  usoCfdi            String?   @db.VarChar(10)       @map("uso_cfdi")          // G03, P01, etc.
  tipoComprobante    String?   @db.VarChar(10)       @map("tipo_comprobante")  // I, E, P, etc.
  exportacion        String?   @db.VarChar(10)       @map("exportacion")
}
```

---

## Análisis de Impacto

### 🔴 Situación ANTES (Estado Actual)

**Reportes Excel de 1,000 facturas:**

1. **Consulta BD:** ~200ms (obtener IDs básicos)
2. **Llamadas a FacturAPI:** 1,000 llamadas HTTP
   - En chunks de 20 = 50 chunks
   - ~300ms por chunk
   - **Total: ~15 segundos**
3. **Generación Excel:** ~500ms
4. **TOTAL: ~16 segundos**

**Problemas:**
- ❌ Lento e ineficiente
- ❌ Dependencia de FacturAPI (si está caído, no hay reportes)
- ❌ Costos de API elevados
- ❌ No escalable (10,000 facturas = 2+ minutos)

### 🟢 Situación DESPUÉS (Con Datos Completos)

**Reportes Excel de 1,000 facturas:**

1. **Consulta BD:** ~500ms (más datos, pero en una sola query)
2. **Llamadas a FacturAPI:** **0 llamadas** ✅
3. **Generación Excel:** ~500ms
4. **TOTAL: ~1 segundo**

**Mejoras:**
- ✅ **94% más rápido** (16s → 1s)
- ✅ **Zero dependencia** de FacturAPI para reportes
- ✅ **Reducción de costos** (menos llamadas API)
- ✅ **Escalabilidad** (10,000 facturas = ~5 segundos)

---

## Plan de Implementación

### Fase 1: Migración de Schema (2 horas)

#### 1.1 Crear Migración de Prisma

**Archivo:** `prisma/migrations/YYYYMMDDHHMMSS_add_invoice_complete_data/migration.sql`

```sql
-- Agregar campos financieros
ALTER TABLE "TenantInvoice"
  ADD COLUMN "subtotal" DECIMAL(12,2),
  ADD COLUMN "iva_amount" DECIMAL(12,2),
  ADD COLUMN "retencion_amount" DECIMAL(12,2),
  ADD COLUMN "discount" DECIMAL(12,2),
  ADD COLUMN "currency" VARCHAR(3) DEFAULT 'MXN',
  ADD COLUMN "payment_form" VARCHAR(50),
  ADD COLUMN "payment_method" VARCHAR(50),
  ADD COLUMN "verification_url" VARCHAR(500),
  ADD COLUMN "sat_cert_number" VARCHAR(50),
  ADD COLUMN "items" JSONB,
  ADD COLUMN "uso_cfdi" VARCHAR(10),
  ADD COLUMN "tipo_comprobante" VARCHAR(10),
  ADD COLUMN "exportacion" VARCHAR(10);

-- Índices para mejorar consultas
CREATE INDEX "TenantInvoice_currency_idx" ON "TenantInvoice"("currency");
CREATE INDEX "TenantInvoice_payment_method_idx" ON "TenantInvoice"("payment_method");
CREATE INDEX "TenantInvoice_uso_cfdi_idx" ON "TenantInvoice"("uso_cfdi");

-- Comentarios para documentación
COMMENT ON COLUMN "TenantInvoice"."subtotal" IS 'Monto antes de impuestos';
COMMENT ON COLUMN "TenantInvoice"."iva_amount" IS 'Monto total de IVA aplicado';
COMMENT ON COLUMN "TenantInvoice"."retencion_amount" IS 'Monto total de retenciones';
COMMENT ON COLUMN "TenantInvoice"."items" IS 'Array JSON de items/productos de la factura';
```

#### 1.2 Actualizar Schema de Prisma

**Archivo:** `prisma/schema.prisma`

```prisma
model TenantInvoice {
  id                 Int              @id @default(autoincrement())
  tenantId           String           @map("tenant_id") @db.Uuid
  facturapiInvoiceId String           @map("facturapi_invoice_id") @db.VarChar(100)
  series             String           @db.VarChar(5)
  folioNumber        Int              @map("folio_number")
  customerId         Int?             @map("customer_id")

  // DATOS FINANCIEROS
  total              Decimal          @db.Decimal(12, 2)
  subtotal           Decimal?         @db.Decimal(12, 2)
  ivaAmount          Decimal?         @map("iva_amount") @db.Decimal(12, 2)
  retencionAmount    Decimal?         @map("retencion_amount") @db.Decimal(12, 2)
  discount           Decimal?         @db.Decimal(12, 2)

  // DATOS DE PAGO
  currency           String?          @db.VarChar(3)
  paymentForm        String?          @map("payment_form") @db.VarChar(50)
  paymentMethod      String?          @map("payment_method") @db.VarChar(50)

  // DATOS SAT
  status             String           @db.VarChar(20)
  uuid               String?          @db.VarChar(100)
  verificationUrl    String?          @map("verification_url") @db.VarChar(500)
  satCertNumber      String?          @map("sat_cert_number") @db.VarChar(50)
  usoCfdi            String?          @map("uso_cfdi") @db.VarChar(10)
  tipoComprobante    String?          @map("tipo_comprobante") @db.VarChar(10)
  exportacion        String?          @db.VarChar(10)

  // ITEMS
  items              Json?

  // METADATOS (existentes)
  createdById        Int?             @map("created_by")
  createdAt          DateTime         @default(now()) @map("created_at")
  updatedAt          DateTime         @default(now()) @map("updated_at")
  dueDate            DateTime?        @map("due_date")
  invoiceDate        DateTime?        @map("invoice_date")
  lastDownloaded     DateTime?        @map("last_downloaded")
  paymentDate        DateTime?        @map("payment_date")
  paymentStatus      String?          @map("payment_status") @db.VarChar(20)
  tags               String?

  // RELACIONES (existentes)
  documents          TenantDocument[]
  createdBy          TenantUser?      @relation(fields: [createdById], references: [id])
  customer           TenantCustomer?  @relation(fields: [customerId], references: [id])
  tenant             Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, facturapiInvoiceId])
  @@unique([tenantId, series, folioNumber])
  @@index([currency])
  @@index([paymentMethod])
  @@index([usoCfdi])
  @@map("TenantInvoice")
}
```

#### 1.3 Ejecutar Migración

```bash
# Generar migración
npx prisma migrate dev --name add_invoice_complete_data

# Generar cliente de Prisma actualizado
npx prisma generate
```

---

### Fase 2: Modificar TenantService (1 hora)

**Archivo:** `src/core/tenant/tenant.service.ts`

#### 2.1 Actualizar `registerInvoice`

```typescript
static async registerInvoice(
  tenantId: string,
  facturapiInvoiceId: string,
  series: string,
  folioNumber: number,
  customerId: number | null,
  total: number,
  createdById: bigint | string | number | null,
  uuid: string,
  // NUEVOS PARÁMETROS (opcional con defaults)
  additionalData?: {
    subtotal?: number;
    ivaAmount?: number;
    retencionAmount?: number;
    discount?: number;
    currency?: string;
    paymentForm?: string;
    paymentMethod?: string;
    verificationUrl?: string;
    satCertNumber?: string;
    items?: any[];
    usoCfdi?: string;
    tipoComprobante?: string;
    exportacion?: string;
  }
) {
  const createdByIdInt = this.ensureInteger(createdById);

  const invoice = await prisma.$transaction(async (tx) => {
    await this.incrementInvoiceCounter(tenantId, series, tx);

    const invoice = await tx.tenantInvoice.create({
      data: {
        tenantId,
        facturapiInvoiceId,
        series,
        folioNumber,
        customerId,
        total,
        status: 'valid',
        createdById: createdByIdInt,
        invoiceDate: new Date(),
        uuid,
        // NUEVOS CAMPOS
        subtotal: additionalData?.subtotal,
        ivaAmount: additionalData?.ivaAmount,
        retencionAmount: additionalData?.retencionAmount,
        discount: additionalData?.discount,
        currency: additionalData?.currency || 'MXN',
        paymentForm: additionalData?.paymentForm,
        paymentMethod: additionalData?.paymentMethod,
        verificationUrl: additionalData?.verificationUrl,
        satCertNumber: additionalData?.satCertNumber,
        items: additionalData?.items,
        usoCfdi: additionalData?.usoCfdi,
        tipoComprobante: additionalData?.tipoComprobante,
        exportacion: additionalData?.exportacion,
      },
    });

    return invoice;
  });

  logger.info(
    { tenantId, series, folioNumber, uuid, hasCompleteData: !!additionalData },
    'Factura registrada con datos completos'
  );

  return invoice;
}
```

#### 2.2 Actualizar `registerInvoicesBatch`

```typescript
static async registerInvoicesBatch(
  tenantId: string,
  invoices: Array<{
    facturapiInvoiceId: string;
    series: string;
    folioNumber: number;
    customerId: number | null;
    total: number;
    createdById?: bigint | string | number | null;
    uuid: string;
    // NUEVOS CAMPOS OPCIONALES
    subtotal?: number;
    ivaAmount?: number;
    retencionAmount?: number;
    discount?: number;
    currency?: string;
    paymentForm?: string;
    paymentMethod?: string;
    verificationUrl?: string;
    satCertNumber?: string;
    items?: any[];
    usoCfdi?: string;
    tipoComprobante?: string;
    exportacion?: string;
  }>
) {
  const createdByIdInt = this.ensureInteger(invoices[0]?.createdById);

  const invoiceData = invoices.map((inv) => ({
    tenantId,
    facturapiInvoiceId: inv.facturapiInvoiceId,
    series: inv.series,
    folioNumber: inv.folioNumber,
    customerId: inv.customerId,
    total: inv.total,
    status: 'valid' as const,
    createdById: createdByIdInt,
    invoiceDate: new Date(),
    uuid: inv.uuid,
    // NUEVOS CAMPOS
    subtotal: inv.subtotal,
    ivaAmount: inv.ivaAmount,
    retencionAmount: inv.retencionAmount,
    discount: inv.discount,
    currency: inv.currency || 'MXN',
    paymentForm: inv.paymentForm,
    paymentMethod: inv.paymentMethod,
    verificationUrl: inv.verificationUrl,
    satCertNumber: inv.satCertNumber,
    items: inv.items,
    usoCfdi: inv.usoCfdi,
    tipoComprobante: inv.tipoComprobante,
    exportacion: inv.exportacion,
  }));

  const result = await prisma.$transaction(async (tx) => {
    // ... (resto del código de incremento de contadores)

    const result = await tx.tenantInvoice.createMany({
      data: invoiceData,
      skipDuplicates: true,
    });

    return result;
  });

  logger.info(
    { tenantId, count: invoices.length },
    'Facturas registradas en lote con datos completos'
  );

  return result;
}
```

---

### Fase 3: Modificar Handlers (3 horas)

Actualizar **TODOS** los handlers para extraer y pasar datos completos.

#### 3.1 Ejemplo: AXA Handler

**Archivo:** `src/bot/handlers/axa.handler.ts`

```typescript
// ANTES (línea ~567):
await TenantService.registerInvoice(
  tenantId,
  factura.id,
  factura.series,
  factura.folio_number,
  customerId,
  factura.total,
  userId,
  factura.uuid  // Solo UUID
);

// DESPUÉS:
await TenantService.registerInvoice(
  tenantId,
  factura.id,
  factura.series,
  factura.folio_number,
  customerId,
  factura.total,
  userId,
  factura.uuid,
  // NUEVOS DATOS COMPLETOS
  {
    subtotal: factura.subtotal,
    ivaAmount: this.calculateIVA(factura),
    retencionAmount: this.calculateRetencion(factura),
    discount: factura.discount || 0,
    currency: factura.currency || 'MXN',
    paymentForm: factura.payment_form,
    paymentMethod: factura.payment_method,
    verificationUrl: factura.verification_url,
    satCertNumber: factura.sat_cert_number,
    items: factura.items,
    usoCfdi: factura.use,
    tipoComprobante: factura.type,
    exportacion: factura.export,
  }
);

// Agregar funciones helper si no existen
private calculateIVA(factura: any): number {
  if (!factura.items) return 0;
  return factura.items.reduce((total: number, item: any) => {
    const ivaTax = item.product?.taxes?.find(
      (tax: any) => tax.type === 'IVA' && !tax.withholding
    );
    if (ivaTax) {
      const base = item.quantity * item.product.price;
      return total + base * (ivaTax.rate || 0);
    }
    return total;
  }, 0);
}

private calculateRetencion(factura: any): number {
  if (!factura.items) return 0;
  return factura.items.reduce((total: number, item: any) => {
    const retencionTax = item.product?.taxes?.find(
      (tax: any) => tax.withholding === true
    );
    if (retencionTax) {
      const base = item.quantity * item.product.price;
      return total + base * (retencionTax.rate || 0);
    }
    return total;
  }, 0);
}
```

**Aplicar el mismo patrón a:**
- ✅ `chubb.handler.ts` (3 llamadas a registerInvoice)
- ✅ `club-asistencia.handler.ts`
- ✅ `qualitas.handler.ts`
- ✅ `escotel.handler.ts`

---

### Fase 4: Optimizar Excel Report Service (1 hora)

**Archivo:** `src/services/excel-report.service.ts`

#### 4.1 Modificar `enrichWithFacturapiData` (VERSIÓN FINAL)

```typescript
/**
 * Enriquecer facturas - VERSIÓN FINAL CON DATOS COMPLETOS DE BD
 * NO llama NUNCA a FacturAPI si tenemos datos completos en BD
 */
static async enrichWithFacturapiData(
  tenantId: string,
  invoices: InvoiceWithRelations[],
  _config: ReportConfig
): Promise<EnrichedInvoice[]> {
  logger.info(
    { tenantId, count: invoices.length },
    'Enriqueciendo facturas - MODO DATOS COMPLETOS EN BD'
  );

  // IMPORTANTE: Ya NO necesitamos llamar a FacturAPI
  // Todos los datos están en la base de datos

  const enrichedInvoices: EnrichedInvoice[] = invoices.map((invoice) => {
    return {
      // Datos básicos
      id: invoice.id,
      facturapiInvoiceId: invoice.facturapiInvoiceId,
      series: invoice.series,
      folioNumber: invoice.folioNumber,
      total: parseFloat(invoice.total.toString()),
      status: invoice.status,
      createdAt: invoice.createdAt,
      invoiceDate: invoice.invoiceDate,
      realEmissionDate: invoice.invoiceDate,

      // Cliente
      customer: {
        legalName: invoice.customer?.legalName || 'N/A',
        rfc: invoice.customer?.rfc || 'N/A',
        email: invoice.customer?.email || '',
      },

      // Tenant
      tenant: {
        businessName: invoice.tenant?.businessName || 'N/A',
        rfc: invoice.tenant?.rfc || 'N/A',
      },

      // UUID y folios
      uuid: invoice.uuid || 'No disponible',
      folio: `${invoice.series}${invoice.folioNumber}`,
      folioFiscal: invoice.uuid || 'No disponible',

      // DATOS COMPLETOS DESDE BD (Ya no desde API!)
      subtotal: invoice.subtotal ? parseFloat(invoice.subtotal.toString()) : 0,
      ivaAmount: invoice.ivaAmount ? parseFloat(invoice.ivaAmount.toString()) : 0,
      retencionAmount: invoice.retencionAmount ? parseFloat(invoice.retencionAmount.toString()) : 0,
      currency: invoice.currency || 'MXN',
      verificationUrl: invoice.verificationUrl || '',

      // Metadatos
      processedAt: new Date().toISOString(),
    } as EnrichedInvoice;
  });

  logger.info(
    { total: enrichedInvoices.length },
    'Enriquecimiento completado SIN LLAMADAS A API'
  );

  return enrichedInvoices;
}
```

**Resultado:**
- ⚡ **Zero llamadas HTTP** a FacturAPI
- ⚡ **Tiempo: ~200ms** para 1,000 facturas (vs 16 segundos antes)
- ✅ **Datos completos** en el reporte

---

### Fase 5: Script de Migración de Datos Históricos (2 horas)

**Archivo:** `scripts/migrate-invoice-complete-data.ts`

```typescript
/**
 * Script de Migración: Poblar Datos Completos de Facturas Históricas
 *
 * Este script obtiene los datos completos (subtotal, IVA, items, etc.)
 * desde FacturAPI para todas las facturas que no los tienen en BD.
 *
 * Uso:
 *   npx tsx scripts/migrate-invoice-complete-data.ts              # Migración real
 *   npx tsx scripts/migrate-invoice-complete-data.ts --dry-run    # Simulación
 */

import { prisma } from '../src/config/database.js';
import FacturapiService from '../src/services/facturapi.service.js';
import { createModuleLogger } from '../src/core/utils/logger.js';

const logger = createModuleLogger('migrate-invoice-data');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

interface MigrationStats {
  totalInvoices: number;
  updated: number;
  errors: number;
  skipped: number;
}

async function migrateCompleteData() {
  const startTime = Date.now();

  if (isDryRun) {
    logger.warn('='.repeat(60));
    logger.warn('MODO DRY RUN - NO SE MODIFICARÁ LA BASE DE DATOS');
    logger.warn('='.repeat(60));
  }

  const stats: MigrationStats = {
    totalInvoices: 0,
    updated: 0,
    errors: 0,
    skipped: 0,
  };

  try {
    // 1. Obtener facturas sin datos completos (subtotal es NULL)
    const invoicesWithoutData = await prisma.tenantInvoice.findMany({
      where: {
        subtotal: null, // Si subtotal es null, asumimos que faltan todos los datos
      },
      select: {
        id: true,
        tenantId: true,
        facturapiInvoiceId: true,
        uuid: true,
      },
      orderBy: {
        tenantId: 'asc',
      },
    });

    stats.totalInvoices = invoicesWithoutData.length;

    logger.info(
      { count: stats.totalInvoices },
      'Facturas sin datos completos encontradas'
    );

    if (stats.totalInvoices === 0) {
      logger.info('No hay facturas para migrar. Todas tienen datos completos.');
      return stats;
    }

    // 2. Agrupar por tenant
    const byTenant = new Map<string, typeof invoicesWithoutData>();
    for (const invoice of invoicesWithoutData) {
      if (!byTenant.has(invoice.tenantId)) {
        byTenant.set(invoice.tenantId, []);
      }
      byTenant.get(invoice.tenantId)!.push(invoice);
    }

    logger.info({ tenants: byTenant.size }, 'Tenants a procesar');

    // 3. Procesar cada tenant
    for (const [tenantId, invoices] of byTenant.entries()) {
      logger.info({ tenantId, invoices: invoices.length }, 'Procesando tenant');

      try {
        const facturapiClient = await FacturapiService.getFacturapiClient(tenantId);

        // Procesar en chunks de 10
        const CHUNK_SIZE = 10;
        for (let i = 0; i < invoices.length; i += CHUNK_SIZE) {
          const chunk = invoices.slice(i, i + CHUNK_SIZE);

          const promises = chunk.map(async (invoice) => {
            try {
              // Obtener datos completos de FacturAPI
              const facturapiData = await facturapiClient.invoices.retrieve(
                invoice.facturapiInvoiceId
              );

              if (!facturapiData) {
                logger.warn({ invoiceId: invoice.id }, 'FacturAPI no devolvió datos');
                stats.errors++;
                return;
              }

              // Calcular IVA y retenciones
              const ivaAmount = this.calculateIVA(facturapiData);
              const retencionAmount = this.calculateRetencion(facturapiData);

              // Actualizar en BD (solo si NO es dry run)
              if (!isDryRun) {
                await prisma.tenantInvoice.update({
                  where: { id: invoice.id },
                  data: {
                    subtotal: facturapiData.subtotal,
                    ivaAmount,
                    retencionAmount,
                    discount: facturapiData.discount || 0,
                    currency: facturapiData.currency || 'MXN',
                    paymentForm: facturapiData.payment_form,
                    paymentMethod: facturapiData.payment_method,
                    verificationUrl: facturapiData.verification_url,
                    satCertNumber: facturapiData.sat_cert_number,
                    items: facturapiData.items,
                    usoCfdi: facturapiData.use,
                    tipoComprobante: facturapiData.type,
                    exportacion: facturapiData.export,
                  },
                });
              }

              stats.updated++;

              logger.debug(
                { invoiceId: invoice.id, dryRun: isDryRun },
                isDryRun ? 'Datos que se actualizarían' : 'Datos actualizados'
              );
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);

              if (errorMessage.includes('404')) {
                logger.warn({ invoiceId: invoice.id }, 'Factura no encontrada en FacturAPI');
                stats.skipped++;
              } else {
                logger.error({ invoiceId: invoice.id, error: errorMessage }, 'Error obteniendo datos');
                stats.errors++;
              }
            }
          });

          await Promise.all(promises);

          // Pausa entre chunks
          if (i + CHUNK_SIZE < invoices.length) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }

        logger.info({ tenantId }, 'Tenant procesado');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ tenantId, error: errorMessage }, 'Error procesando tenant');
        stats.errors += invoices.length;
      }

      // Pausa entre tenants
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const duration = Date.now() - startTime;
    const durationMin = (duration / 60000).toFixed(2);

    logger.info('='.repeat(60));
    if (isDryRun) {
      logger.warn('SIMULACIÓN COMPLETADA (DRY RUN)');
    } else {
      logger.info('MIGRACIÓN COMPLETADA');
    }
    logger.info('='.repeat(60));
    logger.info({
      stats: {
        mode: isDryRun ? 'DRY RUN (simulación)' : 'REAL (BD modificada)',
        total: stats.totalInvoices,
        updated: isDryRun ? `${stats.updated} (se actualizarían)` : stats.updated,
        errors: stats.errors,
        skipped: stats.skipped,
        successRate: `${((stats.updated / stats.totalInvoices) * 100).toFixed(2)}%`,
        duration: `${durationMin} minutos`,
      },
    });

    return stats;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, 'Error fatal en migración');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Funciones helper para calcular impuestos
function calculateIVA(facturapiData: any): number {
  if (!facturapiData.items) return 0;

  return facturapiData.items.reduce((total: number, item: any) => {
    const ivaTax = item.product?.taxes?.find(
      (tax: any) => tax.type === 'IVA' && !tax.withholding
    );
    if (ivaTax) {
      const base = item.quantity * item.product.price;
      return total + base * (ivaTax.rate || 0);
    }
    return total;
  }, 0);
}

function calculateRetencion(facturapiData: any): number {
  if (!facturapiData.items) return 0;

  return facturapiData.items.reduce((total: number, item: any) => {
    const retencionTax = item.product?.taxes?.find(
      (tax: any) => tax.withholding === true
    );
    if (retencionTax) {
      const base = item.quantity * item.product.price;
      return total + base * (retencionTax.rate || 0);
    }
    return total;
  }, 0);
}

// Ejecutar migración
migrateCompleteData()
  .then((stats) => {
    if (isDryRun) {
      console.log('\n✅ Simulación completada exitosamente (DRY RUN)');
      console.log(`   Facturas que se actualizarían: ${stats.updated}/${stats.totalInvoices}`);
      console.log(`   ⚠️  NOTA: BD NO fue modificada. Ejecuta sin --dry-run para aplicar cambios.`);
    } else {
      console.log('\n✅ Migración completada exitosamente');
      console.log(`   Facturas actualizadas: ${stats.updated}/${stats.totalInvoices}`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error en migración:', error);
    process.exit(1);
  });
```

---

## Beneficios Esperados

### ⚡ Rendimiento

| Operación | Antes | Después | Mejora |
|-----------|-------|---------|--------|
| Reporte 100 facturas | ~2s | ~0.2s | **90%** |
| Reporte 1,000 facturas | ~16s | ~1s | **94%** |
| Reporte 10,000 facturas | ~2min | ~5s | **97.5%** |

### 💰 Costos

- **Reducción de llamadas API:** 100% para reportes
- **Costo actual estimado:** $X por 1,000 llamadas
- **Ahorro anual:** Dependiendo del volumen

### 📊 Funcionalidad Nuevas Habilitadas

Con datos completos en BD, podemos crear:

1. **Reportes Fiscales Avanzados**
   - Declaraciones mensuales de IVA
   - Reportes de retenciones
   - Análisis de impuestos por periodo

2. **Dashboards en Tiempo Real**
   - Ventas por moneda
   - Análisis de productos más vendidos (items)
   - Métodos de pago preferidos

3. **Análisis de Negocio**
   - Márgenes de ganancia (subtotal vs total)
   - Tendencias de descuentos
   - Proyecciones de flujo de caja

4. **Búsquedas y Filtros Rápidos**
   - Facturas por forma de pago
   - Facturas por uso de CFDI
   - Facturas en USD/MXN

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Migración larga | ALTA | MEDIO | Ejecutar en horario de bajo tráfico |
| Incremento tamaño BD | ALTA | BAJO | Analizar almacenamiento antes, escalar si es necesario |
| Datos incompletos en FacturAPI | MEDIA | BAJO | Script maneja errores 404, continúa con otras facturas |
| Cambios rompen código existente | BAJA | ALTO | Todos los campos son opcionales (nullable) |

---

## Estimación de Esfuerzo

| Fase | Tiempo Estimado | Complejidad |
|------|----------------|-------------|
| Fase 1: Migración Schema | 2 horas | BAJA |
| Fase 2: Modificar TenantService | 1 hora | BAJA |
| Fase 3: Modificar Handlers (5 archivos) | 3 horas | MEDIA |
| Fase 4: Optimizar Excel Report | 1 hora | BAJA |
| Fase 5: Script Migración | 2 horas | MEDIA |
| Testing | 3 horas | MEDIA |
| **TOTAL** | **12 horas** | **~1.5 días de desarrollo** |

---

## Plan de Rollout

### Preparación (1 día antes)
- [ ] Backup completo de BD producción
- [ ] Revisar espacio en disco disponible
- [ ] Notificar al equipo del mantenimiento

### Ejecución (Sábado madrugada)
- [ ] **2:00 AM** - Crear backup
- [ ] **2:15 AM** - Ejecutar migración de schema
- [ ] **2:30 AM** - Deploy de código nuevo
- [ ] **2:45 AM** - Ejecutar script migración (DRY RUN)
- [ ] **3:00 AM** - Ejecutar script migración (REAL)
- [ ] **5:00 AM** - Verificar resultados
- [ ] **6:00 AM** - Testing completo
- [ ] **7:00 AM** - Monitoreo de reportes

### Post-Implementación
- [ ] Monitorear logs por 48 horas
- [ ] Verificar tiempos de respuesta de reportes
- [ ] Documentar lecciones aprendidas

---

## Métricas de Éxito

Al finalizar la implementación, verificar:

- [ ] **100%** de facturas nuevas tienen datos completos
- [ ] **>95%** de facturas antiguas migradas exitosamente
- [ ] **Reportes Excel >90% más rápidos**
- [ ] **Zero errores** en producción por 1 semana
- [ ] **Usuarios satisfechos** con velocidad de reportes

---

## Alternativas Consideradas

### Alternativa 1: Mantener Status Quo
**Pros:** No requiere desarrollo
**Contras:** Problema persiste, costos elevados, mala UX
**Veredicto:** ❌ No recomendado

### Alternativa 2: Cache en Redis
**Pros:** Más rápido que API, sin cambios en BD
**Contras:** Datos temporales, complejidad adicional, costos de Redis
**Veredicto:** ⚠️ Solución parcial

### Alternativa 3: Guardar Datos Completos (Esta Propuesta)
**Pros:** Solución permanente, máximo rendimiento, cero dependencias externas
**Contras:** Requiere migración de datos históricos
**Veredicto:** ✅ **RECOMENDADO**

---

## Conclusión

Guardar los datos completos de las facturas en nuestra base de datos es la **solución arquitectónica correcta** que:

1. ✅ **Elimina el cuello de botella** de llamadas a FacturAPI
2. ✅ **Mejora la experiencia del usuario** con reportes instantáneos
3. ✅ **Reduce costos operativos** (menos llamadas API)
4. ✅ **Habilita nuevas funcionalidades** (dashboards, análisis, búsquedas avanzadas)
5. ✅ **Escala mejor** conforme crece el volumen de facturas

**Recomendación:** Implementar en el siguiente sprint.

---

**Preparado por:** Claude Code
**Fecha:** 2025-11-07
**Revisión:** v1.0
**Estado:** Listo para evaluación del equipo
