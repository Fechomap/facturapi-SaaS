# 🔍 Auditoría de Scripts - FacturAPI SaaS

## Fecha de Auditoría: ${new Date().toISOString()}

---

## 📋 Análisis Completo de Scripts

### **📂 Scripts en Raíz del Proyecto**

| Script                        | Estado          | Recomendación         | Razón                                    |
| ----------------------------- | --------------- | --------------------- | ---------------------------------------- |
| `server.js`                   | ✅ **MANTENER** | -                     | Servidor principal de la aplicación      |
| `bot.js`                      | ✅ **MANTENER** | -                     | Bot de Telegram principal                |
| `cleanup-database.js`         | ✅ **MANTENER** | Mover a `/scripts/`   | Script útil para mantenimiento manual    |
| `create-subscription-plan.js` | 🟡 **REVISAR**  | Actualizar o eliminar | Script específico con datos hardcodeados |

### **📂 Scripts en `/scripts/` Directory**

| Script                          | Estado          | Recomendación | Razón                                       |
| ------------------------------- | --------------- | ------------- | ------------------------------------------- |
| `audit-env.js`                  | ✅ **MANTENER** | -             | Útil para auditar configuración             |
| `check-plans.js`                | ✅ **MANTENER** | -             | Útil para verificar planes de Stripe        |
| `init-railway-db.js`            | 🔴 **ELIMINAR** | ❌            | Específico para Railway, datos hardcodeados |
| `railway-deploy.js`             | 🔴 **ELIMINAR** | ❌            | Deploy específico para Railway              |
| `start-mcp-server.js`           | ✅ **MANTENER** | -             | Necesario para funcionalidad MCP            |
| `test-expired-subscriptions.js` | ✅ **MANTENER** | -             | Testing de jobs críticos                    |
| `test-mcp-connection.js`        | ✅ **MANTENER** | -             | Testing de conectividad MCP                 |
| `update-plan-price.js`          | 🔴 **ELIMINAR** | ❌            | Script específico con ID hardcodeado        |

---

## 📊 Resumen de Recomendaciones

### **🔴 ELIMINAR (3 scripts)**

```bash
# Scripts obsoletos/específicos a eliminar:
rm scripts/init-railway-db.js      # Railway específico
rm scripts/railway-deploy.js       # Deploy específico
rm scripts/update-plan-price.js    # ID hardcodeado
```

### **🟡 REVISAR/ACTUALIZAR (1 script)**

```bash
# Scripts que necesitan actualización:
create-subscription-plan.js        # Actualizar o mover a /scripts/
```

### **✅ MANTENER (7 scripts)**

```bash
# Scripts esenciales del sistema:
server.js                           # ✅ Core - Servidor principal
bot.js                              # ✅ Core - Bot de Telegram
cleanup-database.js                 # ✅ Util - Mantenimiento manual
scripts/audit-env.js                # ✅ Util - Auditoría de config
scripts/check-plans.js              # ✅ Util - Verificar planes
scripts/start-mcp-server.js         # ✅ Core - MCP server
scripts/test-expired-subscriptions.js # ✅ Test - Jobs críticos
scripts/test-mcp-connection.js      # ✅ Test - Conectividad MCP
```

---

## 🗂️ Reorganización Propuesta

### **Estructura Actual:**

```
/
├── server.js                          ✅ BIEN
├── bot.js                             ✅ BIEN
├── cleanup-database.js                🔄 MOVER
├── create-subscription-plan.js        🔄 REVISAR
└── scripts/
    ├── audit-env.js                   ✅ BIEN
    ├── check-plans.js                 ✅ BIEN
    ├── init-railway-db.js             ❌ ELIMINAR
    ├── railway-deploy.js              ❌ ELIMINAR
    ├── start-mcp-server.js            ✅ BIEN
    ├── test-expired-subscriptions.js  ✅ BIEN
    ├── test-mcp-connection.js         ✅ BIEN
    └── update-plan-price.js           ❌ ELIMINAR
```

### **Estructura Propuesta:**

```
/
├── server.js                          # Servidor principal
├── bot.js                             # Bot de Telegram
└── scripts/
    ├── maintenance/
    │   ├── cleanup-database.js        # Movido desde raíz
    │   ├── create-subscription-plan.js # Actualizado y movido
    │   ├── daily-maintenance.js       # NUEVO - Mantenimiento diario
    │   └── weekly-maintenance.js      # NUEVO - Mantenimiento semanal
    ├── development/
    │   ├── audit-env.js
    │   ├── check-plans.js
    │   ├── test-expired-subscriptions.js
    │   └── test-mcp-connection.js
    └── mcp/
        └── start-mcp-server.js
```

---

## 🚨 Scripts Problemáticos Detallados

### **🔴 init-railway-db.js**

**Problema:**

```javascript
// Líneas 18-35: Datos hardcodeados específicos para Railway
await prisma.subscriptionPlan.createMany({
  data: [
    {
      name: 'Plan Básico',
      price: 599.0,
      stripePriceId: 'price_1RDww1P4Me2WA9wKONkcrai4', // ⚠️ HARDCODED
    },
  ],
});
```

**Solución:** Eliminar - funcionalidad duplicada en otros scripts.

### **🔴 railway-deploy.js**

**Problema:**

```javascript
// Script específico para Railway con lógica de deploy
execSync('npx prisma migrate deploy && npx prisma generate');
execSync('node scripts/init-railway-db.js'); // ⚠️ Dependencia circular
```

**Solución:** Eliminar - lógica movida a package.json scripts.

### **🔴 update-plan-price.js**

**Problema:**

```javascript
const STRIPE_PRICE_ID = 'price_1RE0sy08NU3gw60xfd2BivWP'; // ⚠️ HARDCODED
const updatedPlan = await prisma.subscriptionPlan.update({
  where: { id: 1 }, // ⚠️ ID HARDCODED
```

**Solución:** Eliminar - script de una sola vez ya ejecutado.

### **🟡 create-subscription-plan.js**

**Problema:**

```javascript
// Datos hardcodeados pero útil para desarrollo
stripeProductId: 'prod_S8DMoG02MoBqXg',     // ⚠️ HARDCODED
stripePriceId: 'price_1RDww1P4Me2WA9wKONkcrai4', // ⚠️ HARDCODED
```

**Solución:** Actualizar para recibir parámetros o eliminar si no se usa.

---

## 📝 Plan de Limpieza

### **Fase 1: Eliminación Inmediata**

```bash
# Hacer backup primero (por si acaso)
mkdir -p backups/scripts-backup-$(date +%Y%m%d)
cp scripts/init-railway-db.js backups/scripts-backup-$(date +%Y%m%d)/
cp scripts/railway-deploy.js backups/scripts-backup-$(date +%Y%m%d)/
cp scripts/update-plan-price.js backups/scripts-backup-$(date +%Y%m%d)/

# Eliminar scripts obsoletos
rm scripts/init-railway-db.js
rm scripts/railway-deploy.js
rm scripts/update-plan-price.js
```

### **Fase 2: Reorganización**

```bash
# Crear nueva estructura
mkdir -p scripts/maintenance
mkdir -p scripts/development
mkdir -p scripts/mcp

# Mover scripts
mv cleanup-database.js scripts/maintenance/
mv scripts/audit-env.js scripts/development/
mv scripts/check-plans.js scripts/development/
mv scripts/test-expired-subscriptions.js scripts/development/
mv scripts/test-mcp-connection.js scripts/development/
mv scripts/start-mcp-server.js scripts/mcp/
```

### **Fase 3: Actualización de Referencias**

```bash
# Actualizar package.json si hace referencia a scripts movidos
# Verificar si algún script hace referencia a otros scripts
```

---

## 🔧 Scripts de Mantenimiento Nuevos Recomendados

### **daily-maintenance.js**

```javascript
// scripts/maintenance/daily-maintenance.js
import { cleanupTempFiles } from './cleanup-temp-files.js';
import { cleanupExpiredSessions } from './cleanup-sessions.js';

async function dailyMaintenance() {
  console.log('🔧 Mantenimiento diario iniciado...');
  await cleanupTempFiles();
  await cleanupExpiredSessions();
  console.log('✅ Mantenimiento diario completado');
}
```

### **cleanup-temp-files.js**

```javascript
// scripts/maintenance/cleanup-temp-files.js
import fs from 'fs';
import { glob } from 'glob';

export async function cleanupTempFiles() {
  const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 horas
  const files = await glob('./temp/*');

  let cleaned = 0;
  for (const file of files) {
    const stats = fs.statSync(file);
    if (stats.mtime.getTime() < cutoffTime) {
      fs.unlinkSync(file);
      cleaned++;
    }
  }
  console.log(`🗑️ ${cleaned} archivos temporales eliminados`);
}
```

---

## ✅ Lista de Verificación para Limpieza

### **Antes de Eliminar**

- [ ] ✅ Hacer backup de scripts a eliminar
- [ ] ✅ Verificar que no hay referencias en package.json
- [ ] ✅ Verificar que no hay referencias en otros scripts
- [ ] ✅ Confirmar que Railway deploy funciona sin estos scripts

### **Después de Eliminar**

- [ ] ✅ Probar que el sistema sigue funcionando
- [ ] ✅ Verificar que los tests pasan
- [ ] ✅ Confirmar que MCP server arranca correctamente
- [ ] ✅ Verificar que los jobs programados funcionan

### **Reorganización**

- [ ] ✅ Crear nueva estructura de directorios
- [ ] ✅ Mover scripts a ubicaciones apropiadas
- [ ] ✅ Actualizar documentación
- [ ] ✅ Actualizar package.json si es necesario

---

## 🎯 Beneficios de la Limpieza

### **Inmediatos**

- ✅ **Menos confusión** - Scripts claros y organizados
- ✅ **Menos archivos** - Solo lo necesario
- ✅ **Mejor estructura** - Organización lógica

### **A Largo Plazo**

- ✅ **Mantenimiento más fácil** - Scripts bien categorizados
- ✅ **Menos bugs** - No hay scripts con datos hardcodeados
- ✅ **Mejor onboarding** - Nuevos desarrolladores entienden rápido

---

## 💡 Recomendaciones Adicionales

### **Naming Convention**

```bash
# Usar prefijos claros:
maintenance-*    # Scripts de mantenimiento
test-*          # Scripts de testing
setup-*         # Scripts de configuración
dev-*           # Scripts de desarrollo
```

### **Documentación**

```javascript
// Cada script debe tener:
/**
 * Script: Descripción clara
 * Uso: node scripts/path/script.js
 * Frecuencia: Diario/Semanal/Manual
 * Autor: Equipo de desarrollo
 * Última actualización: YYYY-MM-DD
 */
```

### **Error Handling**

```javascript
// Cada script debe incluir:
process.on('unhandledRejection', (error) => {
  console.error('Error no manejado:', error);
  process.exit(1);
});
```

---

**¿Procedemos con la limpieza? ¿Empezamos eliminando los scripts obsoletos?**
