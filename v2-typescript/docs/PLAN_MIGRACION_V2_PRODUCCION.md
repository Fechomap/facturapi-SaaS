# 🚀 PLAN DE MIGRACIÓN V1 → V2 EN PRODUCCIÓN

**Fecha:** 2025-11-08
**Versión:** 2.0
**Basado en:** PROCEDIMIENTO_MIGRACION_PRODUCCION.md (✅ probado en desarrollo)
**Estado:** 🟡 En progreso

---

## ✅ ESTADO ACTUAL (2025-11-08 00:10)

### Migraciones de Schema - ✅ COMPLETADAS

**Ejecutado en Railway producción:**
1. ✅ Limpieza de historial de migraciones (DELETE FROM _prisma_migrations)
2. ✅ Baseline creado: `20251108000913_init_clean_baseline`
3. ✅ Migración aplicada: `20251108015520_add_invoice_financial_data`

**Resultado:**
```
Facturas ANTES:   1,859
Facturas DESPUÉS: 1,859  ✅ CERO pérdida de datos
Columnas creadas: 13     ✅ (subtotal, iva_amount, retencion_amount, currency, items, etc.)
Índices creados:  3      ✅ (currency, payment_method, uso_cfdi)
```

**Backup:**
```
Archivo: backups/railway/backup_pre_v2_migration_20251107_235621.sql
Tamaño: 733KB
Estado: ✅ Verificado
```

---

## 🔧 PRÓXIMOS PASOS

### PASO 7: Población de Datos Históricos desde FacturAPI

**Preparación:**
```bash
cd v2-typescript

# Asegurarse que .env apunta a Railway
# DATABASE_URL=postgresql://postgres:eLQHlZEgKsaLftJFoUXcxipIdoyKhvJy@hopper.proxy.rlwy.net:17544/railway
```

#### 7.1. Migrar UUIDs faltantes (~2 min)

```bash
# Dry run primero (simulación)
npx tsx scripts/migrate-uuids.ts --dry-run

# Si OK, ejecutar REAL
npx tsx scripts/migrate-uuids.ts
```

**Output esperado:**
```
✅ MIGRACIÓN COMPLETADA
   Total facturas sin UUID: X
   UUIDs actualizados: X
   Errores: 0
   Duración: ~1-2 minutos
```

#### 7.2. Obtener datos completos desde FacturAPI (~10-15 min)

```bash
# Dry run primero
npx tsx scripts/migrate-invoice-complete-data.ts --dry-run

# Si OK, ejecutar REAL
npx tsx scripts/migrate-invoice-complete-data.ts
```

**Output esperado:**
```
✅ MIGRACIÓN COMPLETADA
   Facturas sin datos: 1859
   Actualizadas: ~1800
   Errores: pocos
   Omitidas (404): ~50-100 (facturas canceladas/antiguas)
   Duración: ~10-15 minutos
```

**Notas:**
- Procesa en chunks de 10 para no saturar FacturAPI
- Los 404 son normales (facturas canceladas o muy antiguas)
- Obtiene: items, currency, payment_form, uso_cfdi, etc.

#### 7.3. Recalcular subtotales desde items (~30 seg)

```bash
# Dry run
npx tsx scripts/recalculate-subtotal-from-items.ts --dry-run

# Si OK, ejecutar REAL
npx tsx scripts/recalculate-subtotal-from-items.ts
```

**Output esperado:**
```
✅ RECÁLCULO COMPLETADO
   Total procesadas: ~1800
   Actualizadas: ~1800
   Errores: 0
   Duración: ~30 segundos
```

**Nota:** MUY RÁPIDO porque lee items desde BD (sin llamar API).

#### 7.4. Verificar resultado final

```bash
npx tsx scripts/verify-invoice-complete-data.ts --count 50
```

**Resultado esperado:**
```
✅ VERIFICACIÓN COMPLETADA
   50/50 facturas tienen datos completos (100.00%)
   🎉 PERFECTO: Todas las facturas tienen datos completos!

   ✅ Cálculo correcto: subtotal + IVA - retención = total
```

---

### PASO 8: Deploy V2 a Railway

#### 8.1. Commit de migraciones y configuración

```bash
cd /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS

# Commit migraciones
git add v2-typescript/prisma/migrations/
git add v2-typescript/prisma/schema.prisma
git commit -m "feat: aplicar migraciones schema en Railway producción

Migraciones completadas en Railway:
- 20251108000913_init_clean_baseline
- 20251108015520_add_invoice_financial_data

Resultado:
- 1,859 facturas intactas (0 pérdidas)
- 13 columnas financieras nuevas
- 3 índices de optimización

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>"

# Commit configuración Railway
git add railway.json ROLLBACK_V1.md v2-typescript/docs/
git commit -m "feat: configurar Railway para V2 TypeScript

- railway.json: build y start desde v2-typescript/
- Documentación: PLAN_MIGRACION, ROLLBACK, LIMPIEZA
- Procedimiento probado y verificado

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>"

# Push
git push origin main
```

#### 8.2. Railway deployará automáticamente

- Railway detecta cambios en `railway.json`
- Build: `cd v2-typescript && npm install && npm run build`
- Start: `cd v2-typescript && npx prisma migrate deploy && node dist/cluster.js & node dist/bot.js`

**Tiempo estimado:** 5-10 minutos

---

### PASO 9: Verificación Post-Deploy

#### 9.1. Monitorear logs Railway

```bash
railway logs --tail 200
```

Buscar:
- ✅ "Server listening on port..."
- ✅ "Bot iniciado correctamente"
- ✅ "Redis conectado"
- ❌ Sin errores críticos

#### 9.2. Probar TODAS las funcionalidades

**Desde Telegram:**

1. **Menu Principal:** `/start` → Ver menú completo
2. **CHUBB:** Excel → 3 facturas (con/sin retención + otros)
3. **Club Asistencia:** Excel → Columnas detectadas correctamente
4. **Qualitas:** Excel → 5 servicios (formato 3 líneas)
5. **AXA:** Excel → Factura generada
6. **ESCOTEL:** Excel → Factura generada
7. **Normal:** Cliente → Pedido → Monto → Factura
8. **PDF/XML:** Descargar archivos
9. **Reportes:** Generar Excel

#### 9.3. Verificar facturas nuevas

```bash
# Conectar a Railway
cd v2-typescript
# Activar .env con Railway

npx tsx scripts/verify-invoice-complete-data.ts --count 10
```

**Todas las facturas nuevas (generadas con V2) deben tener:**
- ✅ UUID
- ✅ Subtotal, IVA, Retención calculados
- ✅ Currency, payment_form, uso_cfdi
- ✅ Items guardados (JSON)

---

## 📊 CHECKLIST COMPLETO

### Pre-Deploy ✅
- [x] Backup creado: `backup_pre_v2_migration_20251107_235621.sql` (733KB)
- [x] Migraciones aplicadas en Railway
- [x] 1,859 facturas verificadas (0 pérdidas)
- [x] 13 columnas nuevas creadas
- [x] 3 índices creados
- [x] `railway.json` actualizado

### Población de Datos (PENDIENTE)
- [ ] Script `migrate-uuids.ts` ejecutado
- [ ] Script `migrate-invoice-complete-data.ts` ejecutado
- [ ] Script `recalculate-subtotal-from-items.ts` ejecutado
- [ ] Verificación muestra >99% facturas completas

### Deploy V2 (PENDIENTE)
- [ ] Código pusheado a `main`
- [ ] Railway build exitoso
- [ ] Bot responde a `/start`
- [ ] CHUBB genera 3 facturas
- [ ] Club Asistencia detecta columnas
- [ ] Qualitas procesa 5 servicios
- [ ] Facturas nuevas tienen datos completos

### Monitoreo 24h (PENDIENTE)
- [ ] Logs cada 2 horas
- [ ] Sin errores críticos
- [ ] Performance normal
- [ ] Usuarios satisfechos

---

## 🔄 PLAN DE ROLLBACK

**Ver documento:** `/ROLLBACK_V1.md`

### Rollback Rápido (5 minutos)

1. Revertir `railway.json`:
```json
{
  "deploy": {
    "startCommand": "npx prisma db push --accept-data-loss && node server.js"
  }
}
```

2. Commit y push:
```bash
git checkout railway.json  # O editar manualmente
git commit -m "rollback: volver a V1"
git push origin main
```

3. Railway re-deploya V1 automáticamente

**IMPORTANTE:** Solo hacer rollback por errores CRÍTICOS que impidan operación.

---

## 🧹 LIMPIEZA CÓDIGO V1 (Día 8+)

**Ver documento:** `v2-typescript/docs/LIMPIEZA_V1_LEGACY.md`

**SOLO ejecutar si:**
- ✅ V2 funciona 7+ días sin incidentes
- ✅ Todas las funcionalidades OK
- ✅ Equipo de acuerdo

**Eliminar:**
- `server.js`, `cluster.js`, `bot.js`
- Carpetas: `/bot`, `/routes`, `/tests`
- Documentación legacy

---

## 📝 SCRIPTS UTILIZADOS

**Migración de Schema (YA EJECUTADOS):**
1. `npx prisma db pull` - Introspección
2. `npx prisma migrate diff` - Generar baseline
3. `npx prisma migrate resolve` - Marcar aplicada
4. `npx prisma migrate deploy` - Aplicar campos financieros

**Población de Datos (PENDIENTES):**
1. `scripts/migrate-uuids.ts` - Poblar UUIDs
2. `scripts/migrate-invoice-complete-data.ts` - Obtener datos FacturAPI
3. `scripts/recalculate-subtotal-from-items.ts` - Calcular subtotales
4. `scripts/verify-invoice-complete-data.ts` - Verificar resultado

---

## 📞 RECURSOS

**Documentación:**
- Procedimiento completo: `PROCEDIMIENTO_MIGRACION_PRODUCCION.md`
- Rollback: `/ROLLBACK_V1.md`
- Limpieza: `LIMPIEZA_V1_LEGACY.md`

**Logs Railway:**
```bash
railway logs --tail 200
railway status
```

**Backup:**
```bash
# Restaurar si es necesario
psql "postgresql://..." < backups/railway/backup_pre_v2_migration_20251107_235621.sql
```

---

**Última actualización:** 2025-11-08 00:10
**Próximo paso:** Ejecutar población de datos (PASO 7)
