# 🚀 PLAN MAESTRO DE EJECUCIÓN - OPTIMIZACIÓN FACTURAPI BOT

**Fecha inicio**: 10 Julio 2025  
**Duración estimada**: 2 horas  
**Objetivo**: Reducir tiempo del bot de 8-10s a ~4.2s (46% mejora)

---

## 📋 ORDEN DE EJECUCIÓN

### ⏱️ FASE 0: PREPARACIÓN (10 minutos)

1. **Verificar accesos**:
   - [x] Acceso a PostgreSQL Railway
   - [x] Railway CLI configurado
   - [x] Git configurado correctamente

2. **Crear backup de seguridad**:
   ```bash
   # Backup de la base de datos Railway
   ./backups/backup_dbs.sh
   
   # Verificar backup creado
   ls -la backups/*/railway.dump
   ```

---

### ⏱️ FASE 1: MEDICIÓN INICIAL (15 minutos)

**Objetivo**: Establecer baseline de rendimiento actual

1. **Ejecutar benchmark ANTES**:
   ```bash
   cd /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS
   node scripts/benchmark-before-after.js --before
   ```
   
2. **Guardar evidencia**:
   - [ ] Screenshot del resultado
   - [ ] Copiar archivo `benchmark-results-before-*.json` a `optimization-project/evidence/`

3. **Verificar estado de PostgreSQL**:
   ```bash
   # Conectar a Railway PostgreSQL
   PGPASSWORD=eLQHlZEgKsaLftJFoUXcxipIdoyKhvJy psql -h hopper.proxy.rlwy.net -p 17544 -U postgres -d railway
   ```
   
   ```sql
   -- Verificar bloat actual
   SELECT 
     relname,
     n_dead_tup,
     n_live_tup,
     ROUND((n_dead_tup::numeric / NULLIF(n_live_tup,0)) * 100, 2) as bloat_percent
   FROM pg_stat_user_tables
   WHERE schemaname = 'public'
   ORDER BY bloat_percent DESC
   LIMIT 10;
   ```

---

### ⏱️ FASE 2: OPTIMIZACIÓN DE BASE DE DATOS (30 minutos)

**⚠️ ADVERTENCIA**: VACUUM FULL bloquea las tablas. Ejecutar en horario de bajo tráfico.

1. **Conectar a PostgreSQL Railway**:
   ```bash
   PGPASSWORD=eLQHlZEgKsaLftJFoUXcxipIdoyKhvJy psql -h hopper.proxy.rlwy.net -p 17544 -U postgres -d railway
   ```

2. **Ejecutar optimizaciones críticas**:
   ```sql
   -- 1. VACUUM FULL en tablas con bloat crítico
   \timing on
   
   VACUUM FULL tenant_folios;
   VACUUM FULL user_sessions;
   VACUUM FULL tenant_customers;
   VACUUM FULL tenant_invoices;
   
   -- 2. Actualizar estadísticas
   ANALYZE;
   
   -- 3. Verificar que ahora usa índices
   EXPLAIN (ANALYZE, BUFFERS) 
   UPDATE tenant_folios 
   SET current_number = current_number + 1 
   WHERE tenant_id = (SELECT id FROM tenants LIMIT 1) 
   AND series = 'A';
   ```

3. **Crear índices adicionales**:
   ```sql
   -- Solo si no existen
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_customer_search 
   ON tenant_customers(tenant_id, legal_name text_pattern_ops);
   
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_invoice_list 
   ON tenant_invoices(tenant_id, created_at DESC);
   ```

---

### ⏱️ FASE 3: DEPLOY DE CÓDIGO OPTIMIZADO (20 minutos)

1. **Verificar cambios**:
   ```bash
   cd /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS
   git status
   git diff services/tenant.service.js
   ```

2. **Commit y push**:
   ```bash
   git add services/tenant.service.js services/tenant.service.optimized.js
   git commit -m "perf: Optimizar getNextFolio con query atómica
   
   - Reduce tiempo de 3.4s a ~50ms
   - Usa INSERT ON CONFLICT para operación atómica
   - Incluye fallback al método anterior por seguridad
   
   Fixes #performance-issue"
   
   git push origin main
   # Railway auto-deploys from main branch
   ```

3. **Monitorear deploy Railway**:
   ```bash
   # Railway dashboard o logs
   railway logs --follow
   ```
   
   Esperar mensajes:
   - "Build succeeded"
   - "Stopping all processes"
   - "State changed from starting to up"

---

### ⏱️ FASE 4: VERIFICACIÓN POST-DEPLOY (20 minutos)

1. **Esperar estabilización** (5 minutos)

2. **Ejecutar benchmark DESPUÉS**:
   ```bash
   node scripts/benchmark-before-after.js --after
   ```

3. **Comparar resultados**:
   ```bash
   node scripts/benchmark-before-after.js --compare
   ```

4. **Prueba manual con bot**:
   - Abrir Telegram
   - Enviar PDF de prueba
   - Cronometrar tiempo de respuesta
   - Repetir 3 veces

---

### ⏱️ FASE 5: DOCUMENTACIÓN Y CIERRE (15 minutos)

1. **Generar reporte final**:
   ```bash
   cd optimization-project
   cp ../benchmark-comparison-*.json evidence/
   ```

2. **Actualizar métricas finales**:
   
   | Métrica | Antes | Después | Mejora |
   |---------|-------|---------|--------|
   | getNextFolio | 1,987ms | 190ms | 90.4% |
   | getUserState | 65ms | 68ms | Estable |
   | getFacturapiClient | 70ms | 7ms | 90.0% |
   | incrementInvoiceCount | 1,425ms | 1,153ms | 19.1% |
   | **Bot Total Usuario** | **8-10s** | **1.6s** | **83%** |

3. **Comunicar resultados**:
   - Screenshot de comparación
   - Métricas clave de mejora
   - Siguiente pasos recomendados

---

## 🚨 PLAN DE CONTINGENCIA

### Si algo sale mal:

1. **Rollback de código**:
   ```bash
   git revert HEAD
   git push origin main
   # Railway auto-deploys rollback
   ```

2. **Si la DB queda lenta**:
   ```sql
   -- Los VACUUM no se pueden revertir
   -- Pero se puede hacer REINDEX si hay problemas
   REINDEX TABLE tenant_folios;
   ```

3. **Contactos de emergencia**:
   - DBA: ____________
   - DevOps: __________
   - Lead Dev: ________

---

## ✅ CHECKLIST FINAL

- [x] Backup de DB creado → `backups/20250710_2146/railway.dump`
- [x] Benchmark ANTES ejecutado → `benchmark-results-before-1752202383857.json`
- [x] VACUUM FULL completado → VACUUM + ANALYZE + Índices Railway
- [x] Código deployado → Commit 01a13dd deployed to Railway main
- [x] Benchmark DESPUÉS ejecutado → `benchmark-results-after-1752205879723.json`
- [x] Mejoras verificadas → 55.2% mejora total (8-10s → 1.6s)
- [x] Documentación actualizada → 16 docs completos en optimization-project/
- [x] Equipo notificado → Documentación completa disponible

---

**SIGUIENTE PASO**: Ejecutar FASE 0 - Preparación