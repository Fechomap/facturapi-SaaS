# PLAN DE FINALIZACION DE MIGRACION V1 → V2 EN RAILWAY

**Fecha:** 2025-11-08
**Estado:** Railway ejecutando V2 en modo polling (commit: eed20e2)
**Objetivo:** Completar migración de datos, optimizar configuración y limpiar V1

---

## INDICE

1. [Estado Actual](#estado-actual)
2. [Análisis Técnico: Webhook vs Polling](#analisis-tecnico-webhook-vs-polling)
3. [Plan: Reorganización railway.json](#plan-reorganizacion-railwayjson)
4. [Plan Completo para Ejecución](#plan-completo-para-ejecucion)
5. [Checklist de Verificación](#checklist-de-verificacion)

---

## ESTADO ACTUAL

### En Railway (Producción)

```
Commit: eed20e2 - "fix: ejecutar solo bot.js con polling (sin servidor web)"
Bot: Modo polling (sin servidor web)
Estado: Funcionando correctamente
Facturas: 1,859 intactas
Datos históricos: Columnas nuevas en NULL (pendiente población)
```

### Migraciones Aplicadas

13 columnas nuevas agregadas al schema:
- `subtotal`, `ivaAmount`, `retencionAmount`, `discount`
- `currency`, `paymentForm`, `paymentMethod`
- `verificationUrl`, `satCertNumber`
- `usoCfdi`, `tipoComprobante`, `exportacion`
- `items` (JSON con productos de la factura)

### Archivos Clave

```
/Users/jhonvc/NODE HEROKU/facturapi-SaaS/
├── railway.json                                    # Config actual (raíz)
├── v2-typescript/
│   ├── src/
│   │   ├── bot.ts                                 # Bot V2 (activo)
│   │   ├── server.ts                              # Server V2 (inactivo)
│   │   └── config/index.ts                        # Config env
│   └── scripts/
│       ├── migrate-invoice-complete-data.ts       # Script población datos
│       └── verify-invoice-complete-data.ts        # Script verificación
└── server.js, bot.js (V1 legacy - obsoletos)
```

---

## ANALISIS TECNICO: WEBHOOK VS POLLING

### Código Actual

#### bot.ts (Líneas 64-66)
```typescript
// Iniciar el bot en modo polling (sin servidor web)
await bot.launch();
botLogger.info('Bot iniciado en modo polling');
```

**ESTADO:** CORRECTO - Actualmente usa polling en Railway.

#### server.ts (Líneas 54-63)
```typescript
if (config.env === 'production' && config.isRailway) {
  // In production use webhook
  const webhookUrl = `${config.api.baseUrl}/telegram-webhook`;
  await telegramBot.telegram.setWebhook(webhookUrl);
  serverLogger.info(`Telegram webhook configured: ${webhookUrl}`);
} else {
  // In development or environments without webhook, use polling
  await telegramBot.launch();
  serverLogger.info('Telegram bot started in polling mode');
}
```

**ESTADO:** Este código NO se está ejecutando actualmente (Railway solo ejecuta bot.js).

#### config/index.ts (Líneas 14-16)
```typescript
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_RAILWAY = process.env.IS_RAILWAY === 'true' || Boolean(process.env.RAILWAY_ENVIRONMENT);
```

**DETECCION DE RAILWAY:**
- Variable `RAILWAY_ENVIRONMENT` está disponible automáticamente en Railway
- NO se necesita definir `IS_RAILWAY` manualmente
- El código actual detecta Railway correctamente

### Comparación: Webhook vs Polling

| Aspecto | Webhook | Polling |
|---------|---------|---------|
| **Requisito** | Servidor web (puerto abierto) | Solo conexión saliente |
| **Latencia** | Instantánea (push) | 1-3 segundos (pull) |
| **Recursos** | Servidor HTTP en PORT | Conexión WebSocket |
| **Simplicidad** | Requiere endpoint `/telegram-webhook` | Solo `bot.launch()` |
| **Confiabilidad** | Depende de Railway domain | Independiente |
| **Costo Railway** | $5/mes (servicio web) | $0 (solo worker) |

### Recomendación Actual

**MANTENER POLLING** por las siguientes razones:

1. **Costo:** Railway cobra $5/mes por servicio web, $0 por worker
2. **Simplicidad:** Polling no requiere servidor HTTP
3. **Funciona bien:** Bot responde en 1-3 segundos (acceptable para uso interno)
4. **Sin dependencias:** No depende de Railway domain para webhook

**EVIDENCIA EN LOGS:**
```
Bot iniciado en modo polling
Bot de Telegram iniciado correctamente
Entorno: production
```

### Escenario Futuro: Cambiar a Webhook

Si en el futuro se necesita latencia instantánea (ej: API pública):

**Cambios necesarios:**

1. **railway.json:**
```json
{
  "deploy": {
    "startCommand": "cd v2-typescript && node dist/server.js"
  }
}
```

2. **Variables de entorno (Railway Dashboard):**
```
PORT=3000
NODE_ENV=production
RAILWAY_PUBLIC_DOMAIN=<auto-generado-por-railway>
```

3. **Verificación:**
```bash
curl https://<tu-app>.railway.app/telegram-webhook
# Debería responder: {"status": "Telegram webhook active", "bot_initialized": true}
```

**NOTA:** NO hacer este cambio ahora. Polling funciona perfectamente.

---

## PLAN: REORGANIZACION RAILWAY.JSON

### Estado Actual

**Archivo:** `/Users/jhonvc/NODE HEROKU/facturapi-SaaS/railway.json` (raíz)

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "nixpacks",
    "buildCommand": "cd v2-typescript && npm install && npx prisma generate && npm run build"
  },
  "deploy": {
    "startCommand": "cd v2-typescript && node dist/bot.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**PROBLEMA:** Railway SIEMPRE busca `railway.json` en la raíz del repositorio.

### Investigación: ¿Railway puede leer railway.json desde subdirectorio?

**RESPUESTA: NO**

Railway tiene estas opciones:

1. **railway.json en raíz** (método actual) ✅
2. **Root Directory en Railway Dashboard** → Railway busca `railway.json` en ese subdirectorio
3. **Watch Paths** → Solo afecta deploys automáticos, no la ubicación de railway.json

### Opción 1: Mantener railway.json en raíz (RECOMENDADO)

**VENTAJAS:**
- Funciona actualmente sin cambios
- Railway lo detecta automáticamente
- No requiere configuración adicional en Dashboard

**DESVENTAJAS:**
- Comandos usan `cd v2-typescript` (un poco verbose)
- railway.json no está junto al código V2

**COMANDOS ACTUALES:**
```json
"buildCommand": "cd v2-typescript && npm install && npx prisma generate && npm run build"
"startCommand": "cd v2-typescript && node dist/bot.js"
```

### Opción 2: Usar Root Directory en Railway Dashboard

**CONFIGURACION:**
1. Ir a Railway Dashboard → Settings → Service Settings
2. Configurar `Root Directory: v2-typescript`
3. Mover `railway.json` a `/Users/jhonvc/NODE HEROKU/facturapi-SaaS/v2-typescript/railway.json`
4. Actualizar comandos (quitar `cd v2-typescript`)

**railway.json simplificado:**
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "nixpacks",
    "buildCommand": "npm install && npx prisma generate && npm run build"
  },
  "deploy": {
    "startCommand": "node dist/bot.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**VENTAJAS:**
- railway.json junto al código V2
- Comandos más limpios (sin `cd`)
- Preparado para futura eliminación de V1

**DESVENTAJAS:**
- Requiere cambio manual en Railway Dashboard
- Riesgo de romper deploy si se configura mal

### Opción 3: Mover V2 al raíz (FUTURO)

Después de eliminar V1 completamente:

```bash
mv v2-typescript/* ./
rm -rf v2-typescript/
```

Actualizar `railway.json` (ya en raíz, sin `cd`).

**NOTA:** Esta opción es para después de la limpieza V1 (ver `LIMPIEZA_V1_LEGACY.md`).

### DECISION RECOMENDADA

**MANTENER railway.json en raíz por ahora.**

**RAZONES:**
1. Funciona correctamente
2. Bajo riesgo
3. Los comandos `cd v2-typescript` son aceptables
4. Después de eliminar V1, podemos mover V2 al raíz (Opción 3)

**PLAN PARA EL FUTURO:**

1. **Hoy (Finalización V2):** Mantener railway.json en raíz
2. **Próxima semana (después de 7 días sin incidentes):** Ejecutar limpieza V1
3. **Post-limpieza (opcional):** Mover V2 al raíz y simplificar railway.json

---

## PLAN COMPLETO PARA EJECUCION

Este plan debe ejecutarse MAÑANA en el siguiente orden:

---

### FASE 1: POBLACION DE DATOS HISTORICOS

**Objetivo:** Obtener datos financieros completos de FacturAPI para facturas antiguas.

**Duración estimada:** 10-15 minutos (depende de cantidad de facturas)

#### Paso 1.1: Verificar estado actual

```bash
cd /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/v2-typescript

# Ver cuántas facturas necesitan migración
npx tsx scripts/verify-invoice-complete-data.ts --count 100
```

**OUTPUT ESPERADO:**
```
Total facturas: 100
Con datos completos: X (X%)
Sin datos completos: Y
```

**VERIFICACION:**
- Si `Sin datos completos = 0` → FASE 1 completa, saltar a FASE 2
- Si `Sin datos completos > 0` → Continuar con migración

#### Paso 1.2: Simulación (Dry Run)

```bash
# Simular migración SIN modificar BD
npx tsx scripts/migrate-invoice-complete-data.ts --dry-run
```

**OUTPUT ESPERADO:**
```
🧪 MODO DRY RUN - NO SE MODIFICARÁ LA BASE DE DATOS
Facturas sin datos completos encontradas: 1859
Tenants a procesar: X
...
✅ SIMULACIÓN COMPLETADA (DRY RUN)
   Facturas que se actualizarían: 1859/1859
   Errores: 0
   Omitidas (404): 0
   Tasa de éxito: 100.00%
```

**VERIFICACION:**
- Tasa de éxito debe ser > 95%
- Errores deben ser < 5%
- Si tasa < 95%, investigar errores antes de continuar

#### Paso 1.3: Migración REAL

```bash
# Ejecutar migración REAL (modifica BD)
npx tsx scripts/migrate-invoice-complete-data.ts
```

**OUTPUT ESPERADO:**
```
🚀 MIGRACIÓN EN MODO REAL - SE MODIFICARÁ LA BASE DE DATOS
...
✅ MIGRACIÓN COMPLETADA
   Facturas actualizadas: 1859/1859
   Base de datos modificada: SÍ ✅
```

**DURACIÓN:** 10-15 minutos para 1,859 facturas (chunks de 10, 200ms pausa)

#### Paso 1.4: Verificación post-migración

```bash
# Verificar que todas las facturas tienen datos completos
npx tsx scripts/verify-invoice-complete-data.ts --count 50
```

**OUTPUT ESPERADO:**
```
✅ ÚLTIMAS 50 FACTURAS CON DATOS COMPLETOS
   Total facturas: 50
   Con datos completos: 50 (100.00%)
   🎉 PERFECTO: Todas las facturas tienen datos completos!
```

**VERIFICACION:**
- `Con datos completos` debe ser 100%
- Revisar 3-5 facturas manualmente:
  - `subtotal` NO debe ser NULL
  - `ivaAmount` NO debe ser NULL
  - `currency` debe ser "MXN"
  - `items` debe tener JSON con productos

#### Paso 1.5: Commit cambios (si es necesario)

**IMPORTANTE:** Los datos se actualizaron en BD PostgreSQL (Railway), NO en código.

**NO hay cambios de código que commitear en esta fase.**

Solo documentar en logs internos que la migración se completó.

---

### FASE 2: REORGANIZACION DEL PROYECTO (OPCIONAL - POSTERGAR)

**DECISION:** POSTERGAR esta fase hasta después de eliminar V1.

**RAZON:** El railway.json actual funciona correctamente. Cambios innecesarios ahora.

**CUANDO EJECUTAR:**
- Después de 7 días sin incidentes
- Después de ejecutar `LIMPIEZA_V1_LEGACY.md`
- Cuando V1 haya sido eliminado del repositorio

**SKIP FASE 2 por ahora.**

---

### FASE 3: LIMPIEZA FINAL DE V1 (7+ DIAS POST-MIGRACION)

**Objetivo:** Eliminar código JavaScript V1 legacy del repositorio.

**Duración estimada:** 15-20 minutos

**PRE-REQUISITOS (TODOS deben cumplirse):**

- [ ] V2 ha estado en producción **mínimo 7 días consecutivos**
- [ ] **Cero incidentes críticos** en la última semana
- [ ] Todas las funcionalidades probadas (Chubb, Qualitas, AXA, Club, etc.)
- [ ] Logs NO muestran errores recurrentes
- [ ] Equipo de acuerdo en eliminar V1
- [ ] Backup reciente de BD disponible

**SI TODOS LOS REQUISITOS SE CUMPLEN:**

#### Paso 3.1: Crear rama de limpieza

```bash
cd /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS

# Asegurarse de estar en main actualizado
git checkout main
git pull origin main

# Crear rama de limpieza
git checkout -b cleanup/remove-v1-legacy
```

#### Paso 3.2: Eliminar archivos V1

**ARCHIVOS A ELIMINAR:**

```bash
# Archivos principales V1
rm server.js
rm cluster.js
rm bot.js

# Carpetas legacy V1
rm -rf bot/
rm -rf api/
rm -rf routes/
rm -rf tests/
rm -rf config/
rm -rf core/
rm -rf lib/
rm -rf jobs/
rm -rf services/
rm -rf utils/
rm -rf feature-multiuser/
```

**ARCHIVOS A CONSERVAR:**

```
v2-typescript/          # TODO el código V2
prisma/                 # Schema y migraciones
frontend/               # Frontend React (si existe)
backups/                # Backups importantes
docs/                   # Documentación
scripts/                # Scripts útiles (revisar)
temp/                   # Archivos temporales
logs/                   # Logs históricos
railway.json            # Config Railway
.env.example            # Ejemplo env vars
.gitignore              # Git config
README.md               # Documentación principal
package.json            # Actualizar (ver abajo)
```

#### Paso 3.3: Actualizar package.json raíz

Crear nuevo `package.json` apuntando a V2:

```json
{
  "name": "facturapi-saas",
  "version": "2.0.0",
  "description": "Sistema de facturación SaaS multi-tenant - TypeScript Edition",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "cd v2-typescript && npm run dev:all",
    "dev:bot": "cd v2-typescript && npm run dev:bot",
    "build": "cd v2-typescript && npm run build",
    "start": "cd v2-typescript && npm run start:all",
    "start:bot": "cd v2-typescript && npm run start:bot",
    "prisma:studio": "cd v2-typescript && npm run prisma:studio",
    "migrate": "cd v2-typescript && npm run prisma:migrate",
    "postinstall": "cd v2-typescript && npm install"
  },
  "engines": {
    "node": ">=18.x"
  }
}
```

#### Paso 3.4: Actualizar README.md

Actualizar referencias:
- Cambiar "JavaScript" → "TypeScript"
- Actualizar instrucciones instalación
- Actualizar estructura del proyecto
- Agregar nota: "Migración V1 → V2 completada"

#### Paso 3.5: Verificar cambios

```bash
# Ver qué archivos se eliminaron
git status

# Asegurarse de NO eliminar nada crítico
git diff package.json
git diff README.md
```

**VERIFICACION CRITICA:**
- `v2-typescript/` debe estar intacto
- `prisma/` debe estar intacto
- `railway.json` debe estar intacto

#### Paso 3.6: Commit y Push

```bash
# Agregar cambios
git add .

# Commit con mensaje descriptivo
git commit -m "chore: eliminar código legacy V1 JavaScript

V2 TypeScript completó 1 semana en producción sin incidentes.
Eliminando código JavaScript legacy innecesario.

Archivos eliminados:
- server.js, cluster.js, bot.js
- /bot, /api, /routes, /tests (V1)
- /config, /core, /lib, /jobs, /services, /utils (V1)

V2 TypeScript es ahora la única versión activa.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# Push
git push origin cleanup/remove-v1-legacy
```

#### Paso 3.7: Crear Pull Request

```bash
# Crear PR con gh CLI (si está instalado)
gh pr create --title "chore: Eliminar código legacy V1 JavaScript" --body "## Contexto

V2 TypeScript ha estado corriendo en Railway producción durante 7+ días sin incidentes.

## Cambios

- Eliminado código JavaScript V1 legacy
- Actualizado package.json raíz → V2
- Actualizado README.md

## Verificación

- [x] V2 funcionando 7+ días sin incidentes
- [x] Cero errores críticos en logs
- [x] Todas las funcionalidades probadas
- [x] Backup de BD disponible

Referencia: v2-typescript/docs/LIMPIEZA_V1_LEGACY.md"
```

**O crear PR manualmente en GitHub.**

#### Paso 3.8: Merge y monitoreo

1. **Revisar PR cuidadosamente**
2. **Merge a main**
3. **Monitorear Railway** próximos 30 minutos:
   - Railway debería hacer redeploy automáticamente
   - Bot debería seguir funcionando (usa `v2-typescript/`)
   - Logs deberían mostrar operación normal

**SI RAILWAY FALLA:**

```bash
# Revertir merge inmediatamente
git revert HEAD
git push origin main

# Railway volverá al estado anterior
```

---

### FASE 4: MONITOREO POST-MIGRACION

**Objetivo:** Asegurar que la migración fue exitosa y V2 funciona correctamente.

**Duración:** Continuo (primeras 24 horas críticas, luego 7 días)

#### Primeras 24 horas (CRITICAS)

**Monitoreo cada 2-3 horas:**

1. **Railway Logs:**
```bash
# Ver logs en tiempo real
railway logs --follow
```

**Buscar:**
- Errores de conexión BD
- Errores de Prisma Client
- Errores de FacturAPI
- Warnings de memoria/CPU

2. **Telegram Bot:**
- Enviar mensajes de prueba
- Verificar que responde en < 5 segundos
- Probar comandos principales:
  - `/start`
  - `/menu`
  - `/nueva_factura` (crear factura de prueba)
  - `/reporte` (generar Excel)

3. **Base de Datos:**
```bash
cd /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/v2-typescript

# Conectar a Prisma Studio
npm run prisma:studio
```

**Verificar:**
- Facturas nuevas tienen datos completos (`subtotal`, `ivaAmount`, etc.)
- UUID se genera correctamente
- `items` JSON se guarda correctamente

4. **Métricas de Rendimiento:**
- Tiempo de respuesta del bot (< 5 segundos)
- Tiempo de generación de reportes Excel (< 30 segundos)
- Uso de memoria en Railway (< 512MB)

#### Días 2-7 (VIGILANCIA)

**Monitoreo diario:**

1. **Revisar logs una vez al día:**
   - Errores acumulados
   - Warnings recurrentes
   - Operación normal

2. **Verificar funcionalidades críticas:**
   - Emisión de facturas (Chubb, Qualitas, AXA, Club)
   - Generación de reportes Excel
   - Descarga de PDF/XML
   - Complemento de pago (si se usa)

3. **Validar datos:**
```bash
# Verificar que nuevas facturas tienen datos completos
npx tsx scripts/verify-invoice-complete-data.ts --count 20
```

**OUTPUT ESPERADO:**
```
Con datos completos: 20/20 (100.00%)
🎉 PERFECTO
```

#### Plan de Rollback (SI ALGO SALE MAL)

**Escenario 1: Bot no responde**

```bash
# Ver logs de Railway
railway logs --tail 100

# Si hay error de código, revertir último commit
git revert HEAD
git push origin main

# Railway redeploy automático con código anterior
```

**Escenario 2: Errores de BD (Prisma)**

```bash
# Verificar que migraciones están aplicadas
cd /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/v2-typescript
npx prisma migrate status

# Si migraciones faltantes, aplicar
npx prisma migrate deploy
```

**Escenario 3: Datos corruptos en BD**

```bash
# Restaurar desde backup más reciente (Railway)
# Ir a Railway Dashboard → Database → Backups → Restore

# O ejecutar script de recuperación (si existe)
```

**Escenario 4: Railway no puede buildear**

```bash
# Verificar que railway.json es válido
cat railway.json

# Verificar que v2-typescript/package.json tiene scripts correctos
cd v2-typescript
npm run build  # Probar build localmente

# Si build falla, revisar dependencias
npm install
npx prisma generate
npm run build
```

#### Métricas Clave a Monitorear

| Métrica | Valor Normal | Acción si Excede |
|---------|--------------|------------------|
| Tiempo respuesta bot | < 5 seg | Revisar logs, verificar Redis |
| Errores en logs | 0-2 por día | Investigar causa raíz |
| Uso memoria Railway | < 512 MB | Optimizar queries Prisma |
| Facturas sin datos | 0% | Re-ejecutar migración |
| Downtime bot | 0 min/día | Revisar restart policy |

#### Checklist Diario (Días 1-7)

**TODOS LOS DIAS ejecutar:**

- [ ] Revisar logs Railway (errores críticos)
- [ ] Probar bot en Telegram (enviar mensaje)
- [ ] Verificar últimas facturas tienen datos completos
- [ ] Confirmar que no hay incidentes reportados

**SI TODOS LOS CHECKS PASAN 7 DÍAS CONSECUTIVOS:**

✅ **Migración V1 → V2 COMPLETADA CON EXITO**

Proceder con FASE 3 (Limpieza V1).

---

## CHECKLIST DE VERIFICACION

### Pre-Ejecución (HOY)

- [ ] Código V2 funcionando en Railway (commit: eed20e2)
- [ ] Bot responde a mensajes de Telegram
- [ ] Base de datos accesible desde local
- [ ] Scripts de migración probados localmente
- [ ] Backup reciente de BD disponible en Railway

### Día de Ejecución (MAÑANA)

**FASE 1: Población de Datos**

- [ ] Paso 1.1: Verificar estado actual (verificado)
- [ ] Paso 1.2: Simulación dry-run completada (tasa éxito > 95%)
- [ ] Paso 1.3: Migración REAL ejecutada
- [ ] Paso 1.4: Verificación post-migración (100% datos completos)
- [ ] Paso 1.5: Documentar completitud en logs internos

**FASE 2: Reorganización**

- [ ] SKIP - Posponer hasta después de limpieza V1

**FASE 3: Limpieza V1**

- [ ] SKIP - Ejecutar solo después de 7+ días sin incidentes

**FASE 4: Monitoreo (Día 1)**

- [ ] Hora 0: Migración completada
- [ ] Hora 2: Primera revisión logs (sin errores críticos)
- [ ] Hora 4: Segunda revisión logs (operación normal)
- [ ] Hora 8: Prueba funcionalidades (facturación, reportes)
- [ ] Hora 12: Tercera revisión logs
- [ ] Hora 24: Revisar métricas completas del día

### Post-Ejecución (Días 2-7)

**CADA DIA:**

- [ ] Día 2: Revisar logs, probar bot, verificar datos
- [ ] Día 3: Revisar logs, probar bot, verificar datos
- [ ] Día 4: Revisar logs, probar bot, verificar datos
- [ ] Día 5: Revisar logs, probar bot, verificar datos
- [ ] Día 6: Revisar logs, probar bot, verificar datos
- [ ] Día 7: Revisar logs, probar bot, verificar datos

**SI 7 DÍAS SIN INCIDENTES:**

- [ ] Ejecutar FASE 3 (Limpieza V1 Legacy)

---

## RESUMEN EJECUTIVO

### Comandos a Ejecutar Mañana (EN ORDEN)

```bash
# 1. Posicionarse en directorio V2
cd /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/v2-typescript

# 2. Verificar estado actual
npx tsx scripts/verify-invoice-complete-data.ts --count 100

# 3. Simulación (dry-run)
npx tsx scripts/migrate-invoice-complete-data.ts --dry-run

# 4. Migración REAL
npx tsx scripts/migrate-invoice-complete-data.ts

# 5. Verificación final
npx tsx scripts/verify-invoice-complete-data.ts --count 50

# 6. LISTO - Monitorear próximas 24 horas
```

### Tiempos Estimados

| Fase | Duración | Criticidad |
|------|----------|------------|
| Verificación inicial | 2 min | Baja |
| Simulación dry-run | 10 min | Media |
| Migración REAL | 15 min | ALTA |
| Verificación final | 2 min | ALTA |
| **TOTAL FASE 1** | **~30 min** | **ALTA** |
| Monitoreo Día 1 | Continuo | ALTA |
| Monitoreo Días 2-7 | 10 min/día | Media |
| Limpieza V1 (Día 8+) | 20 min | Media |

### Resultado Esperado

**Después de ejecutar este plan:**

1. ✅ Todas las 1,859 facturas tendrán datos completos
2. ✅ Nuevas facturas se guardarán con todos los campos
3. ✅ Reportes Excel mostrarán subtotal, IVA, retención
4. ✅ V2 TypeScript será la única versión activa
5. ✅ Código V1 JavaScript eliminado (después de 7 días)

### Plan de Contingencia

**SI ALGO SALE MAL:**

1. **Migración falla:** Re-ejecutar solo facturas con error
2. **Datos incorrectos:** Restaurar backup BD
3. **Bot deja de funcionar:** Revertir último commit
4. **Railway falla:** Rollback a commit anterior (eed20e2)

**BACKUP SIEMPRE DISPONIBLE EN RAILWAY**

---

## REFERENCIAS

- **Script migración:** `/Users/jhonvc/NODE HEROKU/facturapi-SaaS/v2-typescript/scripts/migrate-invoice-complete-data.ts`
- **Script verificación:** `/Users/jhonvc/NODE HEROKU/facturapi-SaaS/v2-typescript/scripts/verify-invoice-complete-data.ts`
- **Limpieza V1:** `/Users/jhonvc/NODE HEROKU/facturapi-SaaS/v2-typescript/docs/LIMPIEZA_V1_LEGACY.md`
- **Config Railway:** `/Users/jhonvc/NODE HEROKU/facturapi-SaaS/railway.json`

---

**Creado:** 2025-11-08
**Versión:** 1.0
**Próxima revisión:** Después de ejecutar FASE 1

---

## NOTAS FINALES

### Ventajas de V2 TypeScript

1. **Type Safety:** Errores detectados en compile-time
2. **Datos completos:** Todas las facturas con información financiera
3. **Performance:** Queries optimizadas con Prisma
4. **Escalabilidad:** Redis para sesiones multi-usuario
5. **Mantenibilidad:** Código organizado y documentado

### Próximos Pasos Post-Migración

1. **Semana 1:** Monitoreo intensivo V2
2. **Semana 2:** Limpieza código V1 legacy
3. **Semana 3:** Optimizaciones adicionales (si necesario)
4. **Semana 4:** Documentación final y cierre proyecto

### Contacto y Soporte

**Si surgen problemas durante la ejecución:**

1. Revisar logs de Railway: `railway logs --follow`
2. Consultar este documento (sección Plan de Contingencia)
3. Rollback a commit anterior si es crítico
4. Documentar incidente para análisis posterior

---

**FIN DEL DOCUMENTO**
