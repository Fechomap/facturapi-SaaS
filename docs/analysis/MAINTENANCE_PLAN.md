# 🔧 Plan de Mantenimiento - FacturAPI SaaS

## Estado Actual del Sistema

**Última revisión**: ${new Date().toISOString()}  
**Base de datos**: PostgreSQL (Multi-tenant)  
**Archivos**: 323MB node_modules, archivos temp acumulándose  
**Logs**: Sin rotación, archivo único creciendo  

---

## 📊 Análisis de Necesidades de Mantenimiento

### **✅ Ya Implementado**
- ✅ Backups automáticos en `/backups/` 
- ✅ Jobs programados para suscripciones (`jobs/subscription.job.js`)
- ✅ Script de limpieza interactiva (`cleanup-database.js`)
- ✅ Almacenamiento organizado por tenant/fecha

### **⚠️ Requiere Atención**
- ❌ **Base de datos**: Sin VACUUM/ANALYZE automático
- ❌ **Archivos temporales**: Acumulación en `/temp/`
- ❌ **Logs**: Sin rotación, crecimiento ilimitado
- ❌ **Sesiones**: Acumulación de sesiones antiguas
- ❌ **Auditoría**: Logs de auditoría sin límite de retención

---

## 🗃️ Mantenimiento de Base de Datos

### **Problema Identificado**
```sql
-- Tablas que crecen sin límite:
audit_logs           -- Logs de auditoría (sin retención)
user_sessions        -- Sesiones de Telegram (sin cleanup)
notifications        -- Notificaciones históricas
tenant_payments      -- Historial completo de pagos
tenant_invoices      -- Facturas (crecimiento normal)
```

### **Mantenimiento PostgreSQL Requerido**

#### **Diario (Automático)**
```sql
-- Limpieza de sesiones expiradas
DELETE FROM user_sessions 
WHERE updated_at < NOW() - INTERVAL '7 days';

-- Limpieza de notificaciones antiguas  
DELETE FROM notifications 
WHERE created_at < NOW() - INTERVAL '30 days' AND status = 'sent';
```

#### **Semanal (Automatizar)**
```sql
-- Optimización de base de datos
VACUUM ANALYZE tenant_invoices;
VACUUM ANALYZE audit_logs;
VACUUM ANALYZE tenant_subscriptions;
VACUUM ANALYZE tenant_payments;

-- Reindexación si es necesario
REINDEX TABLE user_sessions;
```

#### **Mensual (Manual)**
```sql
-- Limpieza profunda de audit logs (retener 90 días)
DELETE FROM audit_logs 
WHERE created_at < NOW() - INTERVAL '90 days';

-- Estadísticas de uso
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## 📁 Mantenimiento de Archivos

### **Estado Actual**
```bash
/temp/                    # 3 archivos obsoletos
/logs/2025-04-29.log     # 47KB, sin rotación  
/storage/                # Organizado por tenant (OK)
/node_modules/           # 323MB (normal)
```

### **Limpieza de Archivos Temporales**

#### **Script de Limpieza Diaria**
```javascript
// scripts/cleanup-temp-files.js
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const TEMP_DIR = './temp';
const MAX_AGE_HOURS = 24;

export async function cleanupTempFiles() {
  const cutoffTime = Date.now() - (MAX_AGE_HOURS * 60 * 60 * 1000);
  
  try {
    const files = await glob(`${TEMP_DIR}/*`);
    let cleaned = 0;
    
    for (const file of files) {
      const stats = fs.statSync(file);
      if (stats.mtime.getTime() < cutoffTime) {
        fs.unlinkSync(file);
        cleaned++;
        console.log(`🗑️ Eliminado archivo temporal: ${file}`);
      }
    }
    
    console.log(`✅ Limpieza completada: ${cleaned} archivos eliminados`);
  } catch (error) {
    console.error('❌ Error en limpieza de archivos:', error);
  }
}
```

### **Rotación de Logs**

#### **Configuración de Winston (Recomendado)**
```javascript
// core/utils/logger.js - Agregar rotación
import winston from 'winston';
import 'winston-daily-rotate-file';

const logger = winston.createLogger({
  transports: [
    new winston.transports.DailyRotateFile({
      filename: './logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '30d' // Retener 30 días
    })
  ]
});
```

---

## ⏰ Cronograma de Mantenimiento

### **🟢 DIARIO (Automático)**
| Hora | Tarea | Script |
|------|-------|--------|
| 02:00 | Limpieza archivos temporales | `cleanup-temp-files.js` |
| 02:30 | Limpieza sesiones expiradas | SQL automático |
| 03:00 | Backup incremental | `backup_dbs.sh` |

### **🟡 SEMANAL (Domingos 2:00 AM)**
| Tarea | Descripción |
|-------|-------------|
| VACUUM ANALYZE | Optimizar todas las tablas |
| Limpieza notificaciones | Eliminar > 30 días |
| Reporte de uso | Estadísticas de espacio |

### **🔴 MENSUAL (Primer domingo del mes)**
| Tarea | Descripción |
|-------|-------------|
| Limpieza audit_logs | Retener solo 90 días |
| Análisis de rendimiento | Consultas lentas |
| Actualización dependencias | `npm audit fix` |
| Revisión de backups | Verificar integridad |

---

## 🛠️ Scripts de Mantenimiento a Crear

### **1. Mantenimiento Diario**
```javascript
// scripts/daily-maintenance.js
import { cleanupTempFiles } from './cleanup-temp-files.js';
import { cleanupExpiredSessions } from './cleanup-sessions.js';

async function dailyMaintenance() {
  console.log('🔧 Iniciando mantenimiento diario...');
  
  await cleanupTempFiles();
  await cleanupExpiredSessions();
  
  console.log('✅ Mantenimiento diario completado');
}

export default dailyMaintenance;
```

### **2. Mantenimiento Semanal**
```javascript
// scripts/weekly-maintenance.js
import prisma from '../lib/prisma.js';

async function weeklyMaintenance() {
  console.log('🔧 Iniciando mantenimiento semanal...');
  
  // VACUUM ANALYZE
  await prisma.$executeRaw`VACUUM ANALYZE`;
  
  // Limpieza de notificaciones
  const deletedNotifications = await prisma.notification.deleteMany({
    where: {
      createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      status: 'sent'
    }
  });
  
  console.log(`✅ Mantenimiento semanal completado. ${deletedNotifications.count} notificaciones eliminadas`);
}

export default weeklyMaintenance;
```

### **3. Monitoreo de Espacio**
```javascript
// scripts/disk-space-monitor.js
import fs from 'fs';
import { execSync } from 'child_process';

function checkDiskSpace() {
  // Verificar espacio en disco
  const diskUsage = execSync('df -h .').toString();
  
  // Verificar tamaño de base de datos
  const dbSizes = execSync(`
    psql $DATABASE_URL -c "
    SELECT pg_size_pretty(pg_database_size(current_database())) as database_size;
    "
  `).toString();
  
  console.log('💿 Uso de disco:', diskUsage);
  console.log('🗃️ Tamaño BD:', dbSizes);
}
```

---

## 📈 Métricas de Monitoreo

### **KPIs de Mantenimiento**
- **Espacio en disco**: < 80% de uso
- **Tamaño de BD**: Crecimiento < 10% semanal
- **Archivos temp**: < 100 archivos en `/temp/`
- **Logs**: Rotación diaria funcionando
- **Sesiones activas**: < 1000 sesiones concurrentes

### **Alertas Automáticas**
```javascript
// Configurar alertas cuando:
// - Espacio en disco > 85%
// - Base de datos > 1GB
// - Archivos temp > 500MB
// - Logs sin rotar > 3 días
```

---

## 🚨 Procedimientos de Emergencia

### **Si la Base de Datos está Lenta**
```sql
-- 1. Identificar consultas lentas
SELECT query, mean_time, calls 
FROM pg_stat_statements 
ORDER BY mean_time DESC LIMIT 10;

-- 2. Forzar VACUUM FULL (solo en emergencia)
VACUUM FULL ANALYZE;

-- 3. Reiniciar conexiones
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE state = 'idle' AND state_change < now() - interval '1 hour';
```

### **Si se Queda sin Espacio**
```bash
# 1. Limpiar archivos temporales inmediatamente
rm -f ./temp/*

# 2. Rotar logs manualmente  
gzip ./logs/*.log

# 3. Limpieza de emergencia BD
node scripts/emergency-cleanup.js
```

---

## ✅ Checklist de Implementación

### **Inmediato (Esta semana)**
- [ ] Crear script `cleanup-temp-files.js`
- [ ] Implementar limpieza de sesiones expiradas
- [ ] Configurar rotación de logs con Winston
- [ ] Probar scripts de mantenimiento en desarrollo

### **Corto plazo (2 semanas)**
- [ ] Automatizar mantenimiento diario con cron job
- [ ] Implementar mantenimiento semanal
- [ ] Configurar alertas de espacio en disco
- [ ] Documentar procedimientos de emergencia

### **Mediano plazo (1 mes)**
- [ ] Análisis de rendimiento de consultas
- [ ] Optimización de índices de BD
- [ ] Monitoreo automático de métricas
- [ ] Plan de escalabilidad

---

## 💡 Recomendaciones Finales

### **Prioridad Alta**
1. **Implementar limpieza diaria** de archivos temporales
2. **Configurar rotación de logs** inmediatamente
3. **Automatizar limpieza de sesiones** expiradas

### **Prioridad Media**
1. **VACUUM semanal automático** para PostgreSQL
2. **Monitoreo de espacio** en disco
3. **Alertas automáticas** por crecimiento anormal

### **Prioridad Baja**
1. **Optimización de consultas** cuando sea necesario
2. **Migración a logs estructurados** (JSON)
3. **Cache Redis** para sesiones (futuro)

---

## 📞 Contacto y Responsabilidades

**Mantenimiento Diario**: Automático (cron jobs)  
**Mantenimiento Semanal**: Automático + verificación manual  
**Mantenimiento Mensual**: Manual + análisis  
**Emergencias**: Procedimientos documentados arriba

---

*Documento creado: ${new Date().toISOString()}*  
*Próxima revisión: Mensual*  
*Responsable: Equipo de Desarrollo*