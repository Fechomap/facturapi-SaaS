# Análisis Detallado de Performance - Bot de Facturación Multitenant

## 🔴 PROBLEMA IDENTIFICADO
- **Bot**: 8-10 segundos para procesar una factura pequeña
- **CURL directo**: 2-4 segundos para la misma operación
- **Diferencia**: 4-6 segundos de overhead en el bot

## 📊 MÉTRICAS OBTENIDAS DEL DIAGNÓSTICO

### Tiempos de Operación (ms)
```
1. Inicialización Total: 966.53ms
   - Conexión DB: 731.05ms (75.6%)
   - Conexión Redis: 235.45ms (24.4%)

2. Resolución de Tenant: 323.89ms
   - Find Tenant: 133.45ms
   - Subscription Check: 128.14ms
   - Redis Session Load: 62.24ms

3. Búsqueda de Cliente: 126.10ms (solo local)

4. Análisis PDF: 48.83ms

5. Total operaciones DB: 387.69ms
6. Redis Operations: 62.24ms
```

## 🔍 FLUJO DETALLADO DE PROCESAMIENTO

### ETAPA 1: RECEPCIÓN DE ARCHIVO (PDF/Excel)
```
1.1 Bot recibe documento
1.2 Validación tipo archivo
1.3 Verificación de tenant (ctx.hasTenant())
1.4 Limpieza de análisis previo (safeCleanupPdfAnalysis)
1.5 Mensaje de progreso inicial
```

### ETAPA 2: DESCARGA Y ANÁLISIS
```
2.1 downloadTelegramFile()
    - ctx.telegram.getFileLink(fileId) ← API Call Telegram
    - axios download stream ← Network I/O
    - fs.createWriteStream() ← Disk I/O
    
2.2 PDFAnalysisService.analyzePDF()
    - fs.readFileSync() ← Disk I/O
    - pdf-parse import dinámico ← Module Loading
    - Extracción de texto
    - Identificación tipo documento
    - Extracción información clave
```

### ETAPA 3: CONFIRMACIÓN Y PREPARACIÓN
```
3.1 showSimpleAnalysisResults()
    - Generación ID análisis
    - Guardar en ctx.userState.pdfAnalysis
    - ctx.saveSession() ← Redis Write
    
3.2 Usuario confirma datos
    - bot.action callback
    - ctx.answerCbQuery()
    - Reintentos para obtener datos (3x con 500ms delay)
```

### ETAPA 4: GENERACIÓN DE FACTURA
```
4.1 generateSimpleInvoice()
    - Obtener tenantId
    
4.2 Búsqueda de Cliente
    - prisma.tenantCustomer.findFirst() ← DB Query
    - Si no encuentra:
      - facturapIService.getFacturapiClient() ← DB Query
      - facturapi.customers.list() ← API Call (30s timeout!)
      
4.3 InvoiceService.generateInvoice()
    - TenantService.getNextFolio()
      - prisma.tenantFolio.findUnique() ← DB Query
      - prisma.tenantFolio.update() ← DB Write
    - Preparación datos factura
    - facturapiQueueService.enqueue()
      - facturapi.invoices.create() ← API Call (2-4s)
    - TenantService.saveInvoice()
      - prisma.tenantInvoice.create() ← DB Write
    - Incrementar contador suscripción
      - prisma.tenantSubscription.update() ← DB Write
```

## 🚨 CUELLOS DE BOTELLA IDENTIFICADOS

### 1. **CONEXIÓN INICIAL A DB (731ms)**
- Se conecta a DB en cada operación
- No hay pool de conexiones persistente
- Prisma crea nueva conexión cada vez

### 2. **BÚSQUEDAS REDUNDANTES**
- `findTenant()` se ejecuta múltiples veces
- Verificación de suscripción en cada operación
- No hay caché de datos del tenant

### 3. **OPERACIONES SÍNCRONAS BLOQUEANTES**
```javascript
// En PDFAnalysisService
const dataBuffer = fs.readFileSync(filePath); // Bloquea event loop
```

### 4. **LLAMADA A FACTURAPI PARA BUSCAR CLIENTES**
- Si cliente no está en DB local, busca en FacturAPI
- Esta operación puede tardar 30+ segundos
- No hay timeout configurado

### 5. **MÚLTIPLES ESCRITURAS A REDIS**
- saveSession() después de cada cambio
- No hay batching de operaciones

### 6. **ACTUALIZACIONES DE MENSAJE EXCESIVAS**
- updateProgressMessage() se llama múltiples veces
- Cada actualización es una llamada a Telegram API

### 7. **TRANSACCIONES NO OPTIMIZADAS**
- Folio, factura y suscripción se actualizan por separado
- No hay uso de transacciones Prisma

## 🛠️ SOLUCIONES PROPUESTAS

### 1. **Pool de Conexiones Persistente**
```javascript
// En lib/prisma.js
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: ['error', 'warn'],
  // Pool de conexiones
  connection_limit: 10,
});

// Mantener conexión caliente
setInterval(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, 30000);
```

### 2. **Caché en Memoria para Tenant**
```javascript
class TenantCache {
  constructor() {
    this.cache = new Map();
    this.ttl = 5 * 60 * 1000; // 5 minutos
  }
  
  async get(tenantId) {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.data;
    }
    
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { 
        subscriptions: {
          where: { status: { in: ['active', 'trial'] } },
          include: { plan: true }
        }
      }
    });
    
    this.cache.set(tenantId, { data: tenant, timestamp: Date.now() });
    return tenant;
  }
}
```

### 3. **Operaciones Asíncronas No Bloqueantes**
```javascript
// Reemplazar fs.readFileSync con:
import { promises as fs } from 'fs';
const dataBuffer = await fs.readFile(filePath);
```

### 4. **Timeout y Caché para Búsqueda de Clientes**
```javascript
// Agregar timeout a búsqueda en FacturAPI
const clientes = await Promise.race([
  facturapi.customers.list({ q: clientName }),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Timeout')), 5000)
  )
]);

// Caché de clientes frecuentes
const clientCache = new NodeCache({ stdTTL: 600 }); // 10 min
```

### 5. **Batching de Operaciones Redis**
```javascript
class SessionBatcher {
  constructor() {
    this.pending = new Map();
    this.flushInterval = 100; // ms
    this.scheduleFlush();
  }
  
  async save(key, data) {
    this.pending.set(key, data);
  }
  
  async flush() {
    if (this.pending.size === 0) return;
    
    const pipeline = redis.pipeline();
    for (const [key, data] of this.pending) {
      pipeline.setex(key, 3600, JSON.stringify(data));
    }
    await pipeline.exec();
    this.pending.clear();
  }
}
```

### 6. **Throttling de Actualizaciones de Progreso**
```javascript
const progressThrottle = throttle(async (ctx, messageId, text) => {
  await ctx.telegram.editMessageText(
    ctx.chat.id,
    messageId,
    null,
    text,
    { parse_mode: 'Markdown' }
  );
}, 500); // Máximo una actualización cada 500ms
```

### 7. **Transacciones Optimizadas**
```javascript
// Usar transacción para operaciones relacionadas
const result = await prisma.$transaction(async (tx) => {
  // Obtener y actualizar folio
  const folio = await tx.tenantFolio.update({
    where: { tenantId_series: { tenantId, series: 'A' } },
    data: { currentNumber: { increment: 1 } }
  });
  
  // Crear factura
  const invoice = await tx.tenantInvoice.create({
    data: { /* ... */ }
  });
  
  // Actualizar suscripción
  await tx.tenantSubscription.update({
    where: { id: subscriptionId },
    data: { invoicesUsed: { increment: 1 } }
  });
  
  return { folio, invoice };
});
```

## 📈 HERRAMIENTAS DE PROFILING RECOMENDADAS

### 1. **Para Node.js**
```bash
# Clinic.js - Suite completa de profiling
npm install -g clinic
clinic doctor -- node bot.js
clinic flame -- node bot.js
clinic bubbleprof -- node bot.js

# 0x - Flame graphs
npm install -g 0x
0x bot.js

# Node.js built-in profiler
node --prof bot.js
node --prof-process isolate-*.log > processed.txt
```

### 2. **Para PostgreSQL**
```sql
-- Activar pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Ver queries lentas
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC;

-- Analizar plan de ejecución
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM tenant_customers 
WHERE tenant_id = '...' AND legal_name ILIKE '%SOS%';
```

### 3. **Para Monitoreo Distribuido**
```javascript
// OpenTelemetry
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { PrismaInstrumentation } from '@prisma/instrumentation';

const provider = new NodeTracerProvider();
provider.register();

registerInstrumentations({
  instrumentations: [
    new PrismaInstrumentation(),
    new HttpInstrumentation(),
    new RedisInstrumentation(),
  ],
});
```

### 4. **Logging Estructurado**
```javascript
// Configurar Pino para performance
import pino from 'pino';

const logger = pino({
  level: 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      duration: Date.now() - req.startTime,
    }),
  },
});

// Middleware de timing
app.use((req, res, next) => {
  req.startTime = Date.now();
  res.on('finish', () => {
    logger.info({
      duration: Date.now() - req.startTime,
      statusCode: res.statusCode,
    }, 'Request completed');
  });
  next();
});
```

## 🎯 MÉTRICAS OBJETIVO

Después de implementar las optimizaciones:
- Conexión DB: < 50ms (con pool caliente)
- Búsqueda cliente local: < 20ms (con índices)
- Generación factura total: < 3s
- Tiempo total bot: < 4s (similar a CURL)

## 🚀 PLAN DE IMPLEMENTACIÓN

1. **Fase 1**: Implementar pool de conexiones y caché de tenant (1 día)
2. **Fase 2**: Optimizar búsquedas de cliente y timeouts (1 día)
3. **Fase 3**: Implementar batching y transacciones (2 días)
4. **Fase 4**: Profiling y ajuste fino (1 día)

## 📊 BENCHMARK COMPARATIVO

```bash
# Script para comparar Bot vs CURL
#!/bin/bash

# CURL directo
time curl -X POST https://api.facturapi.io/v2/invoices \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{...}'

# Bot (después de optimizaciones)
time node scripts/test-invoice-generation.js
```