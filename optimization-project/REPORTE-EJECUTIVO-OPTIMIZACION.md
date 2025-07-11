# 📊 REPORTE EJECUTIVO: OPTIMIZACIÓN BOT FACTURAPI

**Fecha**: 10 Julio 2025  
**Estado**: CRÍTICO - Requiere acción inmediata

## 🚨 RESUMEN EJECUTIVO

### Situación Actual

- **CURL directo**: 4 segundos ✅
- **Bot actual**: 8-10 segundos ❌ (con picos variables)
- **Overhead**: 4-6 segundos adicionales (100-150% más lento)

### Hallazgos Principales

1. **getNextFolio**: 3.4 segundos promedio (86% del overhead)
2. **Bloat extremo en PostgreSQL**: hasta 1,166% en tablas críticas
3. **Sequential Scans**: PostgreSQL no usa índices existentes
4. **Doble inicialización**: FacturAPI client sin cache
5. **Búsquedas redundantes**: Cliente se verifica 2 veces

---

## 📋 ORDEN DE EJECUCIÓN (CRÍTICO)

### FASE 1: BASE DE DATOS (Hacer AHORA - 30 minutos)

```bash
# 1. Conectar a PostgreSQL
psql -U tu_usuario -d tu_base_de_datos

# 2. Ejecutar script URGENT-fix-database.sql
\i /path/to/facturapi-SaaS/scripts/URGENT-fix-database.sql
```

**Impacto esperado**: Reducir getNextFolio de 3,437ms → 50ms

### FASE 2: DEPLOY CÓDIGO OPTIMIZADO (Después del VACUUM - 15 minutos)

```bash
# 1. Los cambios ya están hechos en:
- services/tenant.service.js (getNextFolio optimizado)

# 2. Commit y deploy
git add services/tenant.service.js
git commit -m "perf: Optimizar getNextFolio con query atómica

Reduce tiempo de 3.4s a ~50ms usando INSERT ON CONFLICT"
git push origin main  # Railway auto-deploy
```

### FASE 3: IMPLEMENTAR CACHE (30 minutos)

#### Cache para FacturAPI Client:

```javascript
// services/facturapi.service.js - Agregar al inicio de la clase
class FacturapiService {
  static clientCache = new Map();
  static CLIENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutos

  static async getFacturapiClient(tenantId) {
    // Verificar cache
    const cached = this.clientCache.get(tenantId);
    if (cached && Date.now() - cached.timestamp < this.CLIENT_CACHE_TTL) {
      return cached.client;
    }

    // ... código existente para crear cliente ...

    // Guardar en cache
    this.clientCache.set(tenantId, {
      client,
      timestamp: Date.now()
    });

    return client;
  }
```

### FASE 4: ELIMINAR REDUNDANCIAS (20 minutos)

#### En invoice.service.js línea 98-124:

```javascript
// ELIMINAR esta verificación redundante:
// let requiresWithholding = false;
// try {
//   const cliente = await facturapi.customers.retrieve(data.clienteId);
//   ...
// }

// REEMPLAZAR por:
const requiresWithholding = ['INFOASIST', 'ARSA', 'S.O.S', 'SOS'].some((name) =>
  data.clienteNombre?.includes(name)
);
```

---

## 📊 MÉTRICAS Y MONITOREO

### Antes de optimizaciones:

```
Operación            | Tiempo
---------------------|--------
getNextFolio         | 3,437ms
getUserState (cold)  | 129ms
getFacturapiClient   | 200ms
findCustomer         | 128ms
incrementInvoiceCount| 917ms
TOTAL Bot            | ~7,766ms
```

### Después de optimizaciones:

```
Operación            | Esperado | Mejora
---------------------|----------|--------
getNextFolio         | 50ms     | 98.5%
getUserState (cold)  | 30ms     | 77%
getFacturapiClient   | 64ms     | 68%
findCustomer         | 20ms     | 84%
incrementInvoiceCount| 100ms    | 89%
TOTAL Bot            | ~4,200ms | 46%
```

---

## 🔍 VERIFICACIÓN POST-IMPLEMENTACIÓN

### 1. Verificar mejoras en DB:

```sql
-- Verificar que no hay Sequential Scans
EXPLAIN (ANALYZE, BUFFERS)
UPDATE tenant_folios
SET current_number = current_number + 1
WHERE tenant_id = 'tu-tenant-id'::uuid AND series = 'A';

-- Verificar bloat reducido
SELECT relname, n_dead_tup, n_live_tup,
  ROUND((n_dead_tup::numeric / NULLIF(n_live_tup, 0)) * 100, 2) as dead_percent
FROM pg_stat_user_tables
WHERE schemaname = 'public';
```

### 2. Ejecutar diagnóstico:

```bash
node scripts/diagnose-bottlenecks.js
```

### 3. Monitorear en producción:

- Logs de Railway: `railway logs --follow`
- Métricas de New Relic/DataDog si tienes
- Feedback de usuarios

---

## ⚠️ RIESGOS Y MITIGACIONES

1. **VACUUM FULL bloquea tablas**

   - Ejecutar en horario de bajo tráfico
   - O usar VACUUM simple primero

2. **Cambios en getNextFolio**

   - Tiene fallback al método anterior
   - Monitorear logs por errores

3. **Cache puede causar inconsistencias**
   - TTL de 30 minutos es conservador
   - Clear cache si hay cambios en API keys

---

## 📈 PRÓXIMOS PASOS (OPCIONAL)

1. **Connection Pooling con pgBouncer**

   - Reducir latencia de conexión
   - Mejor manejo de concurrencia

2. **Redis para sesiones**

   - Ya está parcialmente implementado
   - Completar migración

3. **Batch processing para Excel**

   - Procesar múltiples facturas en paralelo
   - Usar transacciones para atomicidad

4. **Monitoring avanzado**
   - Implementar pg_stat_statements
   - APM con New Relic o similar

---

## 🎯 CONCLUSIÓN

**Con solo ejecutar VACUUM FULL y deploy del código optimizado, el bot debería mejorar de 8-10 segundos a ~4.2 segundos**, igualando casi el rendimiento de CURL directo.

**Tiempo total estimado**: 1.5 horas
**Impacto**: 46% reducción en tiempo de respuesta
**Riesgo**: Bajo (con fallbacks implementados)
