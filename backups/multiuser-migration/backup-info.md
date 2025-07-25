# 🛡️ Backup para Migración Multiusuario

## 📅 Información del Backup

- **Fecha**: 2025-07-25
- **Propósito**: Backup de seguridad antes de implementar soporte multiusuario Telegram
- **Base de datos**: Railway PostgreSQL
- **Rama**: feature/multi-telegram-users

## 📋 Contenido del Backup

1. **schema-before.sql** - Schema actual de BD
2. **data-critical.sql** - Datos críticos (tenants, users, invoices)
3. **full-backup.sql** - Backup completo de toda la BD
4. **verification.log** - Log de verificación del backup

## 🔧 Comandos de Restauración

```bash
# Verificar backup
pg_restore --list full-backup.sql

# Restaurar completamente (EN CASO DE EMERGENCIA)
psql $DATABASE_URL < full-backup.sql

# Restaurar solo schema
psql $DATABASE_URL < schema-before.sql
```

## ⚠️ IMPORTANTE

- **NO eliminar** estos archivos hasta confirmar que la migración fue exitosa
- **Probar restauración** en ambiente de testing antes de usar en producción
- **Contactar DBA** si hay problemas con la restauración