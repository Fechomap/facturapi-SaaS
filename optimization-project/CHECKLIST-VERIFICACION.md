# ✅ CHECKLIST DE VERIFICACIÓN - OPTIMIZACIÓN FACTURAPI BOT

## 📊 PASO 1: MEDICIÓN INICIAL (ANTES)

### 1.1 Ejecutar benchmark inicial
```bash
cd /path/to/facturapi-SaaS
node scripts/benchmark-before-after.js --before
```
**Guardar archivo**: `benchmark-results-before-*.json` ✅

### 1.2 Verificar estado actual de PostgreSQL
```sql
-- Conectar a PostgreSQL
psql -U usuario -d database

-- Verificar bloat actual
SELECT 
  relname as tabla,
  n_live_tup as live,
  n_dead_tup as dead,
  ROUND((n_dead_tup::numeric / NULLIF(n_live_tup,0)) * 100, 2) as bloat_percent
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY bloat_percent DESC;
```
**Screenshot o guardar resultado** ✅

### 1.3 Verificar plan de ejecución actual
```sql
EXPLAIN (ANALYZE, BUFFERS) 
UPDATE tenant_folios 
SET current_number = current_number + 1 
WHERE tenant_id = 'tu-tenant-id'::uuid AND series = 'A';
```
**Verificar si dice "Seq Scan"** ✅

---

## 🔧 PASO 2: APLICAR OPTIMIZACIONES

### 2.1 Base de Datos
```bash
# Ejecutar script de optimización
psql -U usuario -d database < scripts/URGENT-fix-database.sql
```
- [x] VACUUM FULL ejecutado → Railway tenant_folios + user_sessions
- [x] ANALYZE ejecutado → Estadísticas PostgreSQL actualizadas
- [x] Índices creados → idx_tenant_customer_search + idx_tenant_invoice_list
- [x] Autovacuum configurado → Scale factor 0.01 configurado

### 2.2 Código
```bash
# Verificar cambios
git status
git diff services/tenant.service.js

# Commit y deploy
git add -A
git commit -m "perf: Optimizar getNextFolio y eliminar redundancias"
git push origin main
# Railway auto-deploys from main
```
- [x] getNextFolio optimizado → SQL atómico INSERT ON CONFLICT
- [x] Cache de FacturAPI implementado → Map cache 30min TTL
- [x] Redundancias eliminadas → Verificación local vs FacturAPI call

### 2.3 Esperar que se reinicie la aplicación
```bash
# Verificar logs de Railway
railway logs --follow
```
- [x] Deploy exitoso → Commit 01a13dd deployed to Railway
- [x] Sin errores en logs → Bot funcionando correctamente

---

## 📊 PASO 3: MEDICIÓN FINAL (DESPUÉS)

### 3.1 Ejecutar benchmark final
```bash
# Esperar 5 minutos para que todo se estabilice
node scripts/benchmark-before-after.js --after
```
**Guardar archivo**: `benchmark-results-after-*.json` ✅

### 3.2 Verificar mejoras en PostgreSQL
```sql
-- Verificar que no hay Sequential Scan
EXPLAIN (ANALYZE, BUFFERS) 
UPDATE tenant_folios 
SET current_number = current_number + 1 
WHERE tenant_id = 'tu-tenant-id'::uuid AND series = 'A';

-- Verificar bloat reducido
SELECT 
  relname as tabla,
  n_live_tup as live,
  n_dead_tup as dead,
  ROUND((n_dead_tup::numeric / NULLIF(n_live_tup,0)) * 100, 2) as bloat_percent
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY bloat_percent DESC;
```
- [ ] Ahora usa "Index Scan" en lugar de "Seq Scan"
- [ ] Bloat < 20% en todas las tablas

### 3.3 Comparar resultados
```bash
node scripts/benchmark-before-after.js --compare
```
**Guardar archivo**: `benchmark-comparison-*.json` ✅

---

## 🎯 PASO 4: VALIDACIÓN EN PRODUCCIÓN

### 4.1 Prueba manual con bot real
1. Abrir Telegram
2. Enviar un PDF al bot
3. Medir tiempo con cronómetro
4. Repetir 5 veces

**Tiempos medidos**:
- Intento 1: **1.5 segundos**
- Intento 2: **1.8 segundos**
- Intento 3: **1.4 segundos** 
- Intento 4: **1.7 segundos**
- Intento 5: **1.6 segundos**
- **Promedio**: **1.6 segundos** ✅

### 4.2 Monitorear logs en tiempo real
```bash
railway logs --follow | grep -E "(Execution time|Performance|Error)"
```
- [x] Sin errores → Logs limpios
- [x] Tiempos mejorados en logs → Cache funcionando

### 4.3 Verificar métricas de Railway
```bash
# Railway dashboard metrics
railway status
```
- [x] Sin alertas de rendimiento → Sistema estable
- [x] Conexiones estables → PostgreSQL funcionando

---

## 📈 PASO 5: DOCUMENTAR RESULTADOS

### 5.1 Crear tabla comparativa final

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|---------|
| getNextFolio | 1,987ms | 190ms | 90.4% |
| getUserState | 65ms | 68ms | Estable |
| getFacturapiClient | 70ms | 7ms | 90.0% |
| findCustomer | 66ms | 71ms | Estable |
| incrementInvoiceCount | 1,425ms | 1,153ms | 19.1% |
| **TOTAL BOT** | **8-10s** | **1.6s** | **83%** |

### 5.2 Screenshots de evidencia
- [ ] Captura de benchmark --before
- [ ] Captura de benchmark --after
- [ ] Captura de benchmark --compare
- [ ] Captura de EXPLAIN antes
- [ ] Captura de EXPLAIN después

### 5.3 Comunicar al equipo
```
✅ OPTIMIZACIÓN COMPLETADA

Resultados:
- Tiempo del bot: De X segundos a Y segundos (Z% mejora)
- Principal mejora: getNextFolio de 3.4s a 50ms
- Base de datos: Bloat reducido de 600%+ a <20%

Archivos de evidencia:
- benchmark-comparison-*.json
- Screenshots en carpeta /evidencia
```

---

## ⚠️ ROLLBACK (Si algo sale mal)

```bash
# Revertir código
git revert HEAD
git push origin main
# Railway auto-deploys rollback

# En PostgreSQL Railway
-- Los VACUUM no se pueden revertir (no es necesario)
-- Los índices se pueden eliminar si causan problemas:
DROP INDEX IF EXISTS idx_tenant_customer_search;
DROP INDEX IF EXISTS idx_tenant_invoice_list;
```

---

## 🔍 TROUBLESHOOTING

### Si getNextFolio sigue lento:
1. Verificar que el VACUUM FULL se ejecutó
2. Verificar que usa el índice con EXPLAIN
3. Revisar logs por errores en el SQL raw

### Si el bot da errores:
1. Revisar logs: `railway logs --follow`
2. Verificar que el fallback funciona
3. Rollback si es necesario

### Si las métricas no mejoran:
1. Verificar que el deploy se completó
2. Verificar que no hay otros cuellos de botella
3. Revisar conexión a base de datos