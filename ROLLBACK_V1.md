# 🔄 PLAN DE ROLLBACK: V2 → V1

**⚠️ SOLO USAR EN CASO DE EMERGENCIA**

Este documento describe cómo volver a V1 rápidamente si V2 presenta problemas críticos en producción.

---

## 🚨 ¿Cuándo hacer rollback?

Hacer rollback inmediatamente si:
- ❌ El bot no responde a `/start`
- ❌ Las facturas no se generan correctamente
- ❌ Errores críticos constantes en logs
- ❌ Pérdida de datos detectada
- ❌ Timeouts o crashes frecuentes

**NO hacer rollback por:**
- ⚠️ Warnings menores en logs
- ⚠️ Errores aislados que se recuperan
- ⚠️ Performance ligeramente diferente

---

## ⚡ ROLLBACK RÁPIDO (5 minutos)

### Paso 1: Revertir railway.json

```bash
# Desde tu máquina local
cd /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS

# Copiar el contenido del archivo V1 (abajo)
# y sobrescribir railway.json
```

**Contenido de `railway.json` para V1:**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "nixpacks",
    "buildCommand": "echo Building facturapi-SaaS && npx prisma generate && cd frontend && npm install && CI=false npm run build"
  },
  "deploy": {
    "startCommand": "npx prisma db push --accept-data-loss && node server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

### Paso 2: Commit y Push

```bash
git add railway.json
git commit -m "rollback: volver a V1 por problemas en V2"
git push origin main
```

### Paso 3: Verificar Deploy en Railway

1. Railway detectará el push automáticamente
2. Iniciará un nuevo build con V1
3. En 3-5 minutos, V1 estará corriendo nuevamente

### Paso 4: Verificar que V1 funciona

```bash
# Ver logs en tiempo real
railway logs --tail 100

# Probar bot en Telegram
/start
```

---

## 🗄️ ROLLBACK CON RESTAURACIÓN DE BD (30 minutos)

**Solo si hay corrupción de datos o migraciones problemáticas:**

### Paso 1: Restaurar Backup de Railway

1. Ir a Railway Dashboard
2. Seleccionar tu proyecto
3. Click en el servicio **PostgreSQL**
4. Tab **Backups**
5. Buscar el backup **pre-migración** (fecha antes del deploy V2)
6. Click **Restore**
7. Confirmar restauración

**⏱️ Tiempo estimado:** 10-15 minutos

### Paso 2: Revertir Código a V1

Seguir los pasos de **ROLLBACK RÁPIDO** (arriba)

### Paso 3: Reiniciar Servicios

```bash
# Desde Railway Dashboard
# Services → tu-app → Settings → Restart
```

### Paso 4: Verificar Integridad

```bash
# Conectarse a PostgreSQL
railway connect PostgreSQL

# Verificar última factura
SELECT * FROM "TenantInvoice" ORDER BY "createdAt" DESC LIMIT 1;

# Salir
\q
```

---

## 📋 CHECKLIST DE ROLLBACK

### Durante el Rollback
- [ ] railway.json revertido a V1
- [ ] Código pusheado a `main`
- [ ] Railway build completado sin errores
- [ ] Servicios reiniciados

### Verificación Post-Rollback
- [ ] Bot responde a `/start`
- [ ] Menú principal se muestra correctamente
- [ ] Facturación CHUBB funciona
- [ ] Facturación normal funciona
- [ ] No hay errores en logs
- [ ] Última factura en BD es correcta

### Comunicación
- [ ] Notificar al equipo del rollback
- [ ] Documentar la razón del rollback
- [ ] Crear issue en GitHub con detalles del problema
- [ ] Planear fix en V2 antes de re-intentar

---

## 🔍 ANÁLISIS POST-ROLLBACK

Después de hacer rollback, investigar:

1. **¿Qué causó el problema?**
   - Revisar logs de V2
   - Identificar error específico
   - Reproducir localmente

2. **¿Se perdieron datos?**
   - Comparar última factura antes/después
   - Verificar integridad de Redis
   - Revisar logs de transacciones

3. **¿Qué hay que corregir en V2?**
   - Crear lista de bugs encontrados
   - Priorizar fixes
   - Probar localmente antes de re-deploy

---

## 📞 CONTACTO DE EMERGENCIA

Si necesitas ayuda durante el rollback:
- Revisar logs: `railway logs --tail 500`
- Verificar status: `railway status`
- Dashboard: https://railway.app

---

**RECORDATORIO:** Este rollback es **temporal**. Una vez identificado y corregido el problema en V2, se puede volver a intentar el deploy siguiendo el PLAN_MIGRACION_V2_PRODUCCION.md

**Creado:** 2025-11-08
**Versión:** 1.0
