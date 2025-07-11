# Scripts de Base de Datos

Scripts para mantenimiento y administración de la base de datos PostgreSQL.

## 📝 Scripts Disponibles

### `cleanup-database.js`
**Propósito**: Limpieza completa de datos de desarrollo/testing

**Opciones**:
1. Limpieza completa (mantiene solo planes de suscripción)
2. Limpieza de facturas y clientes
3. Limpieza de tenant específico

**Uso**:
```bash
# Desarrollo local
node scripts/database/cleanup-database.js

# Railway (con precaución)
railway run node scripts/database/cleanup-database.js
```

**⚠️ Advertencia**: NO usar en producción sin backup

---

### `cleanup-sessions.js`
**Propósito**: Limpieza de sesiones expiradas de usuarios

**Funcionalidad**:
- Elimina sesiones vencidas de Redis
- Limpia datos temporales de usuarios
- Optimiza memoria de sesiones

**Uso**:
```bash
# Limpiar sesiones (seguro en producción)
node scripts/database/cleanup-sessions.js
```

**Configurado en package.json**:
```json
"cleanup:sessions": "node scripts/database/cleanup-sessions.js"
```

---

### 📂 `/backups/` - Scripts de Backup y Restore

#### `backup_dbs.sh`
**Propósito**: Crear backups de todas las bases de datos

**Funcionalidad**:
- Crea backup de Railway DB (producción)
- Backup de Staging DB
- Backup de SAAS DB
- Organiza en carpetas por timestamp

**Uso**:
```bash
# Crear backup (desde raíz del proyecto)
bash scripts/database/backups/backup_dbs.sh
```

#### `restore_dbs.sh`
**Propósito**: Restaurar base de datos desde backup

**Uso**:
```bash
# Restaurar desde backup específico
bash scripts/database/backups/restore_dbs.sh 20250415_1712
```

#### `README.txt`
**Propósito**: Comandos útiles para backup/restore

## 🔄 Frecuencia Recomendada

- **cleanup-sessions.js**: Diario (automático vía cron)
- **cleanup-database.js**: Solo para desarrollo/testing
- **backup_dbs.sh**: Semanal o antes de cambios importantes
- **restore_dbs.sh**: Solo cuando sea necesario restaurar