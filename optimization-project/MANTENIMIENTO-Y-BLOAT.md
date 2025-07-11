# 🛡️ PLAN MANTENIMIENTO PostgreSQL Y PREVENCIÓN BLOAT

## 📁 ARCHIVOS BENCHMARK ENCONTRADOS

### En Raíz del Proyecto:
```
benchmark-comparison-1752202669144.json     ← Comparación inicial
benchmark-results-before-1752202383857.json ← BEFORE original  
benchmark-results-after-1752202497330.json  ← AFTER primera prueba
benchmark-results-after-1752204264038.json  ← AFTER optimización local
benchmark-results-after-1752205237309.json  ← AFTER Railway inicial
benchmark-results-after-1752205879723.json  ← AFTER final post-VACUUM
```

### ⚠️ **ACCIÓN REQUERIDA: ORGANIZAR ARCHIVOS**
```bash
# Mover archivos a carpeta evidence
mkdir -p optimization-project/evidence/benchmarks
mv benchmark-*.json optimization-project/evidence/benchmarks/

# Renombrar para claridad
cd optimization-project/evidence/benchmarks/
mv benchmark-results-before-1752202383857.json 01-BEFORE-original.json
mv benchmark-results-after-1752204264038.json 02-AFTER-local-optimized.json  
mv benchmark-results-after-1752205237309.json 03-AFTER-railway-pre-vacuum.json
mv benchmark-results-after-1752205879723.json 04-AFTER-railway-final.json
mv benchmark-comparison-1752202669144.json 05-comparison-analysis.json
```

---

## 🔍 ANÁLISIS BLOAT PostgreSQL

### **¿QUÉ CAUSÓ EL BLOAT ORIGINAL?**

#### Evidencia Encontrada:
- **tenant_folios**: 633% bloat
- **user_sessions**: 1,166% bloat  
- **Causas identificadas**:
  1. **Alto UPDATE frequency** sin VACUUM automático
  2. **Dead tuples acumulados** (95% de la tabla)
  3. **Autovacuum insuficiente** para carga de trabajo

### **DIAGNÓSTICO TÉCNICO**:
```sql
-- Lo que encontramos:
SELECT 
  schemaname,
  tablename,
  n_live_tup,
  n_dead_tup,
  ROUND((n_dead_tup::float / GREATEST(n_live_tup, 1) * 100), 2) as bloat_percent
FROM pg_stat_user_tables 
WHERE n_dead_tup > 0
ORDER BY bloat_percent DESC;

-- tenant_folios: 633% dead tuples
-- user_sessions: 1,166% dead tuples
```

---

## ⚠️ **¿VOLVERÁ A OCURRIR EL BLOAT?**

### **SÍ, VOLVERÁ A OCURRIR** si no se toman medidas preventivas:

#### **Factores de Riesgo**:
1. **tenant_folios**: Se actualiza con cada factura (~100/día)
2. **user_sessions**: Se actualiza constantemente (Redis + PostgreSQL)
3. **Autovacuum default**: Insuficiente para nuestra carga

#### **Timeline Estimado**:
- **Sin mantenimiento**: Bloat regresa en **2-3 meses**
- **Con autovacuum mejorado**: Bloat regresa en **6-8 meses**  
- **Con mantenimiento programado**: **Controlado permanentemente**

---

## 🛠️ CONFIGURACIONES IMPLEMENTADAS

### **1. Autovacuum Agresivo** (YA IMPLEMENTADO):
```sql
-- Configurado durante optimización
ALTER TABLE tenant_folios SET (
  autovacuum_vacuum_scale_factor = 0.01,    -- VACUUM cuando 1% dead tuples
  autovacuum_analyze_scale_factor = 0.005   -- ANALYZE cuando 0.5% dead tuples
);

ALTER TABLE user_sessions SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.005
);
```

### **2. Índices Optimizados** (YA IMPLEMENTADO):
```sql
-- Índices creados para reducir overhead
CREATE INDEX CONCURRENTLY idx_tenant_customer_search 
ON tenant_customers(tenant_id, legal_name text_pattern_ops);

CREATE INDEX CONCURRENTLY idx_tenant_invoice_list 
ON tenant_invoices(tenant_id, created_at DESC);
```

---

## 📅 PLAN MANTENIMIENTO PREVENTIVO

### **AUTOMATIZADO** (Recomendado):

#### **Opción 1: Railway Cron Jobs**
```javascript
// scripts/maintenance/weekly-vacuum.js
const { exec } = require('child_process');

const DATABASE_URL = process.env.DATABASE_URL;

async function weeklyMaintenance() {
  const commands = [
    'VACUUM tenant_folios;',
    'VACUUM user_sessions;', 
    'VACUUM tenant_invoices;',
    'ANALYZE;',
    'REINDEX TABLE tenant_folios;'
  ];
  
  for (const cmd of commands) {
    console.log(`Ejecutando: ${cmd}`);
    await execSQL(cmd);
  }
}

// Ejecutar cada domingo 2AM
if (new Date().getDay() === 0 && new Date().getHours() === 2) {
  weeklyMaintenance();
}
```

#### **Opción 2: GitHub Actions**
```yaml
# .github/workflows/database-maintenance.yml
name: Database Maintenance
on:
  schedule:
    - cron: '0 2 * * 0'  # Domingos 2AM

jobs:
  vacuum:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run VACUUM
        run: |
          PGPASSWORD=${{ secrets.DB_PASSWORD }} psql -h ${{ secrets.DB_HOST }} -U postgres -d railway -c "
          VACUUM tenant_folios;
          VACUUM user_sessions;
          ANALYZE;
          "
```

### **MANUAL** (Backup):

#### **Script Semanal**:
```bash
#!/bin/bash
# scripts/maintenance/weekly-maintenance.sh

echo "🔧 Iniciando mantenimiento semanal..."

# 1. Backup antes de mantenimiento
./backups/backup_dbs.sh

# 2. VACUUM tablas críticas  
PGPASSWORD=eLQHlZEgKsaLftJFoUXcxipIdoyKhvJy psql \
  -h hopper.proxy.rlwy.net -p 17544 -U postgres -d railway \
  -c "VACUUM tenant_folios; VACUUM user_sessions; ANALYZE;"

# 3. Verificar bloat
PGPASSWORD=eLQHlZEgKsaLftJFoUXcxipIdoyKhvJy psql \
  -h hopper.proxy.rlwy.net -p 17544 -U postgres -d railway \
  -c "
  SELECT 
    tablename,
    n_live_tup,
    n_dead_tup,
    ROUND((n_dead_tup::float / GREATEST(n_live_tup, 1) * 100), 2) as bloat_percent
  FROM pg_stat_user_tables 
  WHERE schemaname = 'public' AND n_dead_tup > 0
  ORDER BY bloat_percent DESC;
  "

echo "✅ Mantenimiento completado"
```

---

## 📊 MONITOREO BLOAT

### **Script Diagnóstico**:
```bash
# scripts/maintenance/check-bloat.sh
#!/bin/bash

echo "📊 Verificando bloat en PostgreSQL..."

PGPASSWORD=eLQHlZEgKsaLftJFoUXcxipIdoyKhvJy psql \
  -h hopper.proxy.rlwy.net -p 17544 -U postgres -d railway \
  -c "
  SELECT 
    tablename,
    n_live_tup as live_rows,
    n_dead_tup as dead_rows,
    ROUND((n_dead_tup::float / GREATEST(n_live_tup, 1) * 100), 2) as bloat_percent,
    CASE 
      WHEN n_dead_tup::float / GREATEST(n_live_tup, 1) > 2 THEN '🚨 CRÍTICO'
      WHEN n_dead_tup::float / GREATEST(n_live_tup, 1) > 0.5 THEN '⚠️ ALTO'  
      WHEN n_dead_tup::float / GREATEST(n_live_tup, 1) > 0.1 THEN '🟡 MEDIO'
      ELSE '✅ NORMAL'
    END as status
  FROM pg_stat_user_tables 
  WHERE schemaname = 'public'
  ORDER BY bloat_percent DESC;
  "
```

### **Alertas Recomendadas**:
- **>50% bloat**: ⚠️ VACUUM requerido
- **>200% bloat**: 🚨 VACUUM URGENTE  
- **>500% bloat**: 🆘 VACUUM FULL requerido

---

## 🎯 CRONOGRAMA MANTENIMIENTO

### **FRECUENCIAS RECOMENDADAS**:

| Acción | Frecuencia | Script |
|--------|------------|--------|
| **VACUUM ligero** | Semanal | `weekly-maintenance.sh` |
| **Verificar bloat** | Diario | `check-bloat.sh` |
| **VACUUM FULL** | Trimestral | Manual + backup |
| **REINDEX** | Mensual | Incluido en weekly |
| **Backup completo** | Antes c/mantenimiento | `backup_dbs.sh` |

### **Calendario Sugerido**:
- **Domingos 2AM**: VACUUM semanal
- **Lunes 6AM**: Verificación bloat
- **Primer domingo mes**: REINDEX + análisis profundo
- **Trimestral**: VACUUM FULL (mantenimiento mayor)

---

## ⚡ OPTIMIZACIONES ADICIONALES

### **Para Reducir Bloat Futuro**:

#### **1. Optimizar Updates**:
```javascript
// En lugar de múltiples updates
await prisma.tenantFolio.update({ where: {...}, data: {currentNumber: {increment: 1}} });
await prisma.tenantFolio.update({ where: {...}, data: {updatedAt: new Date()} });

// Usar update único
await prisma.tenantFolio.update({ 
  where: {...}, 
  data: { 
    currentNumber: {increment: 1},
    updatedAt: new Date()
  }
});
```

#### **2. Session Cleanup**:
```javascript
// Implementar limpieza automática sessions viejas
await prisma.userSession.deleteMany({
  where: {
    updatedAt: {
      lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 días
    }
  }
});
```

#### **3. Connection Pooling**:
```javascript
// En prisma.js - reducir overhead conexiones
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  pool: {
    timeout: 20,
    size: 5
  }
});
```

---

## 📋 CHECKLIST IMPLEMENTACIÓN

### **Inmediato** (Esta semana):
- [ ] Crear scripts de mantenimiento
- [ ] Configurar script check-bloat.sh
- [ ] Organizar archivos benchmark en carpeta evidence
- [ ] Documentar cronograma mantenimiento

### **Corto Plazo** (Próximas 2 semanas):
- [ ] Implementar GitHub Actions maintenance
- [ ] Configurar alertas bloat 
- [ ] Crear dashboard monitoreo PostgreSQL
- [ ] Primera ejecución mantenimiento programado

### **Mediano Plazo** (Próximo mes):
- [ ] Optimizar queries que causan bloat
- [ ] Implementar session cleanup automático
- [ ] Revisar configuración autovacuum basada en métricas
- [ ] Análisis capacity planning

---

## 🚨 PLAN CONTINGENCIA

### **Si Bloat Supera 500%**:
1. **Backup inmediato**
2. **VACUUM FULL en horario bajo tráfico**
3. **Verificar autovacuum settings**
4. **Analizar queries problemáticas**

### **Si Performance Degrada**:
1. **Ejecutar check-bloat.sh**
2. **VACUUM urgente si bloat >200%**
3. **Revisar slow query log**
4. **Considerar REINDEX**

---

**Documento creado**: 11 Julio 2025  
**Próxima revisión**: 18 Julio 2025  
**Responsable**: Mantenimiento Database Team