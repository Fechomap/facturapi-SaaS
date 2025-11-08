# 📦 Migración Pendiente: Poblar UUID en Datos Históricos

**Fecha creación:** 2025-11-08
**Estado:** ⏳ PENDIENTE DE EJECUTAR EN PRODUCCIÓN
**Prioridad:** 🟡 MEDIA (funciona sin esto, pero mejora rendimiento)
**Relacionado con:** MIGRATION_UUID_PRODUCCION.md (commit 4285ac1)

---

## 📋 Contexto

**Situación actual:**
- ✅ **Código implementado** (commit 4285ac1): Las facturas NUEVAS se guardan con UUID
- ✅ **Campo existe en BD:** `tenant_invoices.uuid` (VARCHAR 100)
- ✅ **Script probado en desarrollo:** Migró 1,697 facturas en ~1.5 minutos
- ❌ **Datos históricos en producción:** Facturas antiguas tienen `uuid = NULL`

**Impacto de NO ejecutar el script:**
- ⚠️ Facturas nuevas: Funcionan perfecto (tienen UUID)
- ⚠️ Facturas antiguas: Funcionan pero sin UUID (campos en NULL)
- ⚠️ Reportes Excel: Columna UUID estará vacía para facturas antiguas
- ⚠️ Verificación SAT: No disponible para facturas antiguas

---

## 🎯 ¿Qué hace el script?

**Script:** `scripts/migrate-uuids.ts`

**Función:**
1. Busca facturas con `uuid IS NULL`
2. Llama a FacturAPI para obtener el UUID
3. Actualiza la BD con el UUID obtenido

**Características:**
- ✅ Procesa en chunks de 20 (no satura API)
- ✅ Soporta modo `--dry-run` (simulación)
- ✅ Muestra progreso cada 100 facturas
- ✅ Maneja errores (404, Unauthorized)
- ✅ RÁPIDO: ~1.5 minutos para 1,697 facturas

---

## 📊 Resultados en Desarrollo

**Ejecutado:** 2025-11-08
**Modo:** REAL (BD modificada)

```
Total facturas: 1,698
Actualizadas: 1,697
Errores: 1 (Unauthorized en 1 tenant)
Tasa de éxito: 99.94%
Duración: 1.45 minutos
```

**Tenants procesados:**
- ✅ Prueba sa de cv: 1,354 facturas
- ✅ Transportes y Grúas Halcones: 89 facturas
- ✅ ALFREDO ALEJANDRO PEREZ AGUILAR: 254 facturas
- ❌ Asistencia vial grupo Troya: 1 error (API key inválida)

---

## 🔧 Procedimiento para Producción

### PASO 1: Verificar cuántas facturas necesitan UUID

```bash
psql -h <PROD_HOST> -U <PROD_USER> -d <PROD_DATABASE> << 'SQL'
SELECT COUNT(*) as sin_uuid FROM tenant_invoices WHERE uuid IS NULL;
SQL
```

---

### PASO 2: Ejecutar en modo DRY RUN (simulación)

```bash
npx tsx scripts/migrate-uuids.ts --dry-run
```

**Revisar output:**
- Total de facturas sin UUID
- Tenants a procesar
- Errores esperados (404, Unauthorized)
- Tiempo estimado

---

### PASO 3: Ejecutar REAL (poblar UUIDs)

```bash
npx tsx scripts/migrate-uuids.ts
```

**Tiempo estimado:**
- 1,000 facturas: ~1-2 minutos
- 5,000 facturas: ~5-7 minutos
- 10,000 facturas: ~10-15 minutos

**Output esperado:**
```
🚀 MIGRACIÓN EN MODO REAL
================================================================================
   Total facturas sin UUID: 5000
   Tenants a procesar: 10

   Progreso: 100/5000
   Progreso: 500/5000
   ...

✅ MIGRACIÓN COMPLETADA
   Facturas actualizadas: 4998/5000
   Errores: 2
   Tasa de éxito: 99.96%
```

---

### PASO 4: Verificar resultado

```bash
# Verificar porcentaje con UUID
psql -h <PROD_HOST> -U <PROD_USER> -d <PROD_DATABASE> << 'SQL'
SELECT
  COUNT(*) as total,
  COUNT(uuid) as con_uuid,
  ROUND((COUNT(uuid)::numeric / COUNT(*)::numeric) * 100, 2) as porcentaje
FROM tenant_invoices;
SQL

# Resultado esperado: >99% con UUID

# Ver ejemplos
psql -h <PROD_HOST> -U <PROD_USER> -d <PROD_DATABASE> << 'SQL'
SELECT id, series, folio_number, uuid
FROM tenant_invoices
WHERE uuid IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
SQL
```

---

## ⚠️ Notas Importantes

**¿Es obligatorio ejecutarlo?**
- ❌ **NO es crítico** - El sistema funciona sin esto
- ✅ **Recomendado** - Mejora reportes y permite verificación SAT

**¿Cuándo ejecutarlo?**
- 🕐 Horario de bajo tráfico
- 📅 Después del commit de datos completos (este)
- ⏰ Puede hacerse semanas después si se desea

**¿Qué pasa si NO se ejecuta?**
- Facturas nuevas: Tienen UUID ✅
- Facturas antiguas: Sin UUID ⚠️
- Reportes Excel: Columna UUID parcialmente vacía
- Verificación SAT: No disponible para facturas antiguas

---

## 🔄 Rollback

Si algo sale mal:

```bash
# El script NO modifica nada más que el campo uuid
# NO hay rollback necesario - solo UUID queda en NULL
# NO afecta totales, clientes, ni datos críticos
```

---

## ✅ Checklist

**Antes de ejecutar:**
- [ ] Backup de BD realizado
- [ ] Horario de bajo tráfico confirmado
- [ ] Script probado en dry-run

**Después de ejecutar:**
- [ ] >99% facturas con UUID
- [ ] Reportes Excel muestran UUID
- [ ] Sin errores en logs

---

**Creado:** 2025-11-08
**Estado:** ⏳ Pendiente de ejecutar en producción
**Relacionado con:**
- ✅ MIGRATION_UUID_PRODUCCION.md (código ya implementado)
- ✅ Commit 4285ac1 (UUID en código)
- ⏳ Script `migrate-uuids.ts` (listo para producción)
