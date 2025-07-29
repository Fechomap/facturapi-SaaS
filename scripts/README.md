# Scripts de Utilidad

Colección de scripts organizados por categoría para el mantenimiento y administración del sistema FacturAPI SaaS.

## 📁 Estructura

### 🗄️ `/database/`

Scripts relacionados con la base de datos:

- `cleanup-database.js` - Limpieza completa de datos (desarrollo)
- `cleanup-sessions.js` - Limpieza de sesiones expiradas
- `/backups/backup_dbs.sh` - Crear backups de todas las DB
- `/backups/restore_dbs.sh` - Restaurar desde backup

### 👥 `/admin/`

Scripts de administración y configuración:

- `create-subscription-plan.js` - Crear nuevos planes de suscripción
- `check-plans.js` - Verificar estado de planes existentes
- `update-plan-price.js` - Actualizar precios de planes

### 📊 `/monitoring/`

Scripts de monitoreo y análisis:

- `benchmark-before-after.js` - Medición de performance del sistema
- `audit-env.js` - Auditoría de variables de entorno

### 🧪 `/testing/`

Scripts de testing y diagnóstico:

- `test-clustering.js` - Pruebas de clustering con Redis
- `test-redis.js` - Verificación de conexión Redis
- `test-expired-subscriptions.js` - Testing de lógica de suscripciones

### 🔧 `/maintenance/`

Scripts de mantenimiento y verificación:

- `check-invoice-dates-simple.js` - Verificar fechas entre PostgreSQL y FacturAPI
- `debug-tenant-check.js` - Debug de información básica de tenant

### 📊 `/data-extraction/`

Scripts para extracción completa de datos:

- `facturapi-export-complete.js` - Extrae todas las facturas de FacturAPI (CSV + Excel)
- `postgresql-export.js` - Extrae todas las facturas de PostgreSQL (CSV + Excel)

## 🚀 Uso

```bash
# Ejecutar script de base de datos
node scripts/database/cleanup-database.js

# Ejecutar script de administración
node scripts/admin/create-subscription-plan.js

# Ejecutar benchmark
node scripts/monitoring/benchmark-before-after.js

# Testing
node scripts/testing/test-redis.js

# Extracción de datos
node scripts/data-extraction/facturapi-export-complete.js
node scripts/data-extraction/postgresql-export.js

# Mantenimiento
node scripts/maintenance/check-invoice-dates-simple.js [tenantId] [limit]
node scripts/maintenance/debug-tenant-check.js [tenantId]

# Backup y Restore
npm run backup:create
npm run backup:restore
```

## ⚠️ Precauciones

- **Scripts de database**: Usar con cuidado en producción
- **Scripts de admin**: Verificar datos antes de ejecutar
- **Scripts de testing**: Seguros para usar en cualquier entorno
- **Monitoreo**: Pueden ejecutarse en producción sin riesgo
