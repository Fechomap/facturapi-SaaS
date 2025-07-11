# 🚨 CUELLOS DE BOTELLA ENCONTRADOS - ANÁLISIS DEFINITIVO

## 📊 DATOS REALES DE MEDICIÓN

### Tiempos Medidos en el Flujo Real:

```
1. Conexión a Prisma: 492.59ms
2. Buscar Tenant Activo: 387.05ms
3. Buscar Cliente en DB Local: 126.28ms
5. Obtener Siguiente Folio: 993.06ms ⚠️
6. Verificar Retención (2da llamada FacturAPI): 367.69ms
8. Crear Factura en FacturAPI: 2063.19ms (simulado)
9. Registrar Factura en DB: 7.04ms
10. Actualizar Contador Suscripción: 247.37ms

TOTAL: 4,686.80ms (4.7 segundos)
```

## 🔴 PROBLEMAS CRÍTICOS IDENTIFICADOS

### 1. **OBTENER FOLIO TARDA 1 SEGUNDO (993ms)**

```javascript
// En TenantService.getNextFolio()
let folio = await prisma.tenantFolio.findUnique({...}); // Query 1
await prisma.tenantFolio.update({...}); // Query 2
```

**Problema**: Dos queries separadas sin transacción. Posible race condition.

### 2. **DOBLE INICIALIZACIÓN DE FACTURAPI**

```javascript
// Primera vez: Para verificar retención (367ms)
const facturapi = await FacturapiService.getFacturapiClient(tenant.id);
const cliente = await facturapi.customers.retrieve(clienteId);

// Segunda vez: Para crear factura (incluido en los 2063ms)
const facturapi = await FacturapiService.getFacturapiClient(tenant.id);
```

**Problema**: Se crea el cliente FacturAPI dos veces, importando el módulo dinámicamente cada vez.

### 3. **BÚSQUEDA REDUNDANTE DE CLIENTE**

El flujo actual hace:

1. Busca cliente en DB local
2. Si encuentra, usa el ID
3. Luego VUELVE a buscar el cliente en FacturAPI para verificar retención
4. Esto es una llamada HTTP innecesaria de ~400ms

### 4. **CONEXIÓN A PRISMA NO REUTILIZADA**

- Primera conexión: 492ms
- Cada query posterior crea nuevas conexiones
- No hay pool de conexiones configurado

### 5. **OPERACIONES NO OPTIMIZADAS EN BD**

```sql
-- getNextFolio hace esto:
SELECT * FROM tenant_folios WHERE tenant_id = ? AND series = ?;
UPDATE tenant_folios SET current_number = current_number + 1 WHERE id = ?;

-- Debería ser:
UPDATE tenant_folios
SET current_number = current_number + 1
WHERE tenant_id = ? AND series = ?
RETURNING current_number;
```

## 💡 SOLUCIONES INMEDIATAS

### 1. **Optimizar getNextFolio() - Reducir de 993ms a ~50ms**

```javascript
static async getNextFolio(tenantId, series = 'A') {
  // Una sola query atómica
  const result = await prisma.$queryRaw`
    UPDATE tenant_folios
    SET current_number = current_number + 1
    WHERE tenant_id = ${tenantId}::uuid AND series = ${series}
    RETURNING current_number - 1 as folio_number
  `;

  if (!result[0]) {
    // Si no existe, crear con valor inicial
    const newFolio = await prisma.tenantFolio.create({
      data: { tenantId, series, currentNumber: 801 }
    });
    return 800;
  }

  return result[0].folio_number;
}
```

### 2. **Cache de Cliente FacturAPI - Eliminar 367ms**

```javascript
class InvoiceService {
  static clientCache = new Map();

  static async generateInvoice(data, tenantId) {
    // ... código anterior ...

    // Verificar retención desde BD local
    let requiresWithholding = false;
    if (localCustomer) {
      // Agregar campo 'requiresWithholding' a la tabla tenant_customers
      requiresWithholding =
        localCustomer.requiresWithholding ||
        localCustomer.legalName.includes('INFOASIST') ||
        localCustomer.legalName.includes('ARSA') ||
        localCustomer.legalName.includes('S.O.S');
    }

    // NO hacer segunda llamada a FacturAPI para verificar
  }
}
```

### 3. **Pool de Conexiones Persistente - Reducir 492ms a ~10ms**

```javascript
// lib/prisma.js
import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
  return new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
};

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma;

// Mantener conexión caliente
setInterval(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error('Error keeping connection alive:', error);
  }
}, 30000);

export default prisma;
```

### 4. **Singleton para FacturAPI - Evitar importación dinámica**

```javascript
class FacturapiService {
  static instances = new Map();

  static async getFacturapiClient(tenantId) {
    // Verificar si ya existe instancia
    if (this.instances.has(tenantId)) {
      return this.instances.get(tenantId);
    }

    // ... código de creación ...

    // Guardar instancia
    this.instances.set(tenantId, client);

    // Limpiar cache después de 5 minutos
    setTimeout(
      () => {
        this.instances.delete(tenantId);
      },
      5 * 60 * 1000
    );

    return client;
  }
}
```

### 5. **Transacción para Factura Completa**

```javascript
static async generateInvoice(data, tenantId) {
  return await prisma.$transaction(async (tx) => {
    // 1. Obtener folio atómicamente
    const folioResult = await tx.$queryRaw`
      UPDATE tenant_folios
      SET current_number = current_number + 1
      WHERE tenant_id = ${tenantId}::uuid AND series = 'A'
      RETURNING current_number - 1 as folio_number
    `;

    const folioNumber = folioResult[0].folio_number;

    // 2. Crear factura en FacturAPI
    const factura = await this.createInFacturAPI(data, folioNumber);

    // 3. Guardar en DB y actualizar suscripción en una transacción
    const [invoice, subscription] = await Promise.all([
      tx.tenantInvoice.create({ /* ... */ }),
      tx.tenantSubscription.update({ /* ... */ })
    ]);

    return factura;
  });
}
```

## 📈 IMPACTO ESPERADO

### Antes (medición actual):

- Total: 4,686ms
- Desglose:
  - Conexión DB: 492ms
  - Queries DB: ~1,750ms
  - FacturAPI: ~2,400ms

### Después (con optimizaciones):

- Total estimado: ~2,200ms
- Desglose:
  - Conexión DB: 10ms (pool caliente)
  - Queries DB: ~150ms (optimizadas)
  - FacturAPI: ~2,000ms (solo creación)

**Reducción esperada: 53% (de 4.7s a 2.2s)**

## 🚀 PLAN DE IMPLEMENTACIÓN PRIORITARIO

### Día 1 - Quick Wins (2-3 horas)

1. ✅ Implementar pool de conexiones persistente
2. ✅ Optimizar getNextFolio() con query atómica
3. ✅ Eliminar verificación redundante de retención

### Día 2 - Optimizaciones Medias (4-5 horas)

1. ✅ Implementar singleton para FacturAPI
2. ✅ Agregar campo requiresWithholding a tenant_customers
3. ✅ Implementar transacciones para operaciones relacionadas

### Día 3 - Monitoring (2-3 horas)

1. ✅ Agregar métricas con OpenTelemetry
2. ✅ Configurar alertas para operaciones > 3s
3. ✅ Dashboard de performance en tiempo real

## 🔧 COMANDOS PARA DEBUGGING

```bash
# Ver queries lentas en PostgreSQL
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE query LIKE '%tenant_folios%'
ORDER BY mean_exec_time DESC;

# Profiling con clinic.js
clinic doctor -- node bot.js
clinic flame -- node scripts/measure-invoice-flow.js

# Monitorear conexiones DB
SELECT count(*) FROM pg_stat_activity
WHERE datname = 'your_db_name';
```

## ⚡ CONCLUSIÓN

El problema principal NO es la API de FacturAPI (que es consistentemente 2-4s), sino:

1. **Folio update no optimizado** (1s)
2. **Doble inicialización de FacturAPI** (400ms)
3. **Conexión fría a DB** (500ms)
4. **Queries redundantes** (400ms)

Con las optimizaciones propuestas, el bot debería alcanzar tiempos similares a CURL directo.
