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
- [ ] VACUUM FULL ejecutado
- [ ] ANALYZE ejecutado
- [ ] Índices creados
- [ ] Autovacuum configurado

### 2.2 Código
```bash
# Verificar cambios
git status
git diff services/tenant.service.js

# Commit y deploy
git add -A
git commit -m "perf: Optimizar getNextFolio y eliminar redundancias"
git push origin main
git push heroku main
```
- [ ] getNextFolio optimizado
- [ ] Cache de FacturAPI implementado
- [ ] Redundancias eliminadas

### 2.3 Esperar que se reinicie la aplicación
```bash
# Verificar logs de Heroku
heroku logs --tail
```
- [ ] Deploy exitoso
- [ ] Sin errores en logs

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
- Intento 1: _____ segundos
- Intento 2: _____ segundos
- Intento 3: _____ segundos
- Intento 4: _____ segundos
- Intento 5: _____ segundos
- **Promedio**: _____ segundos

### 4.2 Monitorear logs en tiempo real
```bash
heroku logs --tail | grep -E "(Execution time|Performance|Error)"
```
- [ ] Sin errores
- [ ] Tiempos mejorados en logs

### 4.3 Verificar métricas de Heroku
```bash
heroku pg:diagnose
heroku pg:info
```
- [ ] Sin alertas de rendimiento
- [ ] Conexiones estables

---

## 📈 PASO 5: DOCUMENTAR RESULTADOS

### 5.1 Crear tabla comparativa final

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|---------|
| getNextFolio | ___ms | ___ms | __% |
| getUserState | ___ms | ___ms | __% |
| getFacturapiClient | ___ms | ___ms | __% |
| findCustomer | ___ms | ___ms | __% |
| **TOTAL BOT** | ___ms | ___ms | __% |

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
git push heroku main

# En PostgreSQL
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
1. Revisar logs: `heroku logs --tail`
2. Verificar que el fallback funciona
3. Rollback si es necesario

### Si las métricas no mejoran:
1. Verificar que el deploy se completó
2. Verificar que no hay otros cuellos de botella
3. Revisar conexión a base de datos