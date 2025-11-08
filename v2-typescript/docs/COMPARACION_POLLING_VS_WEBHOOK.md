# COMPARACIÓN: POLLING vs WEBHOOK en Railway

**Fecha:** 2025-11-08
**Estado actual:** Polling (funcionando)
**Propuesta:** Cambiar a Webhook

---

## CONFIGURACIÓN ACTUAL (Polling)

### Railway Config

```json
// /Users/jhonvc/NODE HEROKU/facturapi-SaaS/railway.json
{
  "build": {
    "buildCommand": "cd v2-typescript && npm install && npx prisma generate && npm run build"
  },
  "deploy": {
    "startCommand": "cd v2-typescript && node dist/bot.js"
  }
}
```

### Lo que ejecuta

```bash
# Railway ejecuta desde raíz:
cd v2-typescript && node dist/bot.js

# Esto ejecuta:
- src/bot.ts compilado (bot.js)
- Bot en modo POLLING (línea 65: await bot.launch())
- SIN servidor Express
- SIN puerto público
```

### Características

| Aspecto | Valor |
|---------|-------|
| **Modo bot** | Polling (WebSocket a Telegram) |
| **Servidor web** | ❌ NO |
| **Puerto público** | ❌ NO |
| **Latencia** | 1-3 segundos |
| **Costo Railway** | $0/mes (worker process) |
| **Complejidad** | Baja |
| **Estado** | ✅ Funcionando en producción |

---

## CONFIGURACIÓN PROPUESTA (Webhook)

### Railway Config

```json
// /Users/jhonvc/NODE HEROKU/facturapi-SaaS/v2-typescript/railway.json (NUEVO)
{
  "build": {
    "buildCommand": "npm install && npx prisma generate && npm run build"
  },
  "deploy": {
    "startCommand": "node dist/server.js"
  }
}
```

### Railway Dashboard Config

```
Root Directory: v2-typescript
Variables:
  - NODE_ENV=production
  - PORT=3000 (o 3001)
  - RAILWAY_PUBLIC_DOMAIN=<auto-generado>
```

### Lo que ejecutará

```bash
# Railway ejecuta desde v2-typescript/:
node dist/server.js

# Esto ejecuta:
- src/server.ts compilado (server.js)
- Servidor Express en puerto 3001
- Bot en modo WEBHOOK (línea 57: setWebhook)
- API REST endpoints
- Endpoint /telegram-webhook
```

### Características

| Aspecto | Valor |
|---------|-------|
| **Modo bot** | Webhook (push de Telegram) |
| **Servidor web** | ✅ SÍ (Express) |
| **Puerto público** | ✅ SÍ (3001) |
| **Latencia** | <1 segundo (instantánea) |
| **Costo Railway** | $5/mes (servicio web) |
| **Complejidad** | Media |
| **Estado** | 🔄 Por implementar |

---

## DIFERENCIAS CLAVE

### 1. Entry Point

| Config | Actual | Propuesta |
|--------|--------|-----------|
| **Archivo ejecutado** | `dist/bot.js` | `dist/server.js` |
| **Código fuente** | `src/bot.ts` | `src/server.ts` |
| **Función** | Solo bot | Servidor + bot |

### 2. Modo del Bot

**Actual (bot.ts línea 65):**
```typescript
// Iniciar el bot en modo polling (sin servidor web)
await bot.launch();
botLogger.info('Bot iniciado en modo polling');
```

**Propuesta (server.ts líneas 54-58):**
```typescript
if (config.env === 'production' && config.isRailway) {
  // In production use webhook
  const webhookUrl = `${config.api.baseUrl}/telegram-webhook`;
  await telegramBot.telegram.setWebhook(webhookUrl);
  serverLogger.info(`Telegram webhook configured: ${webhookUrl}`);
}
```

### 3. Infraestructura Railway

| Aspecto | Polling (Actual) | Webhook (Propuesta) |
|---------|------------------|---------------------|
| **Tipo de servicio** | Worker (proceso background) | Web (servidor HTTP) |
| **Necesita puerto** | ❌ NO | ✅ SÍ (variable PORT) |
| **Necesita dominio público** | ❌ NO | ✅ SÍ (RAILWAY_PUBLIC_DOMAIN) |
| **Root Directory** | No configurado (usa raíz) | `v2-typescript` |
| **railway.json ubicación** | Raíz del repo | `v2-typescript/` |

### 4. Costo

| Config | Costo mensual Railway |
|--------|----------------------|
| **Polling** | $0 (worker process sin puerto) |
| **Webhook** | $5 (servicio web con puerto público) |

**Fuente:** Railway cobra por servicios web que exponen puertos públicos.

---

## VENTAJAS Y DESVENTAJAS

### Polling (Actual)

**✅ Ventajas:**
- Costo: $0/mes
- Simplicidad: Solo `bot.launch()`
- Sin dependencias de dominio público
- Funciona perfectamente para uso interno
- Ya está probado en producción

**❌ Desventajas:**
- Latencia: 1-3 segundos (no instantáneo)
- Polling constante a Telegram (uso de bandwidth bajo)

### Webhook (Propuesta)

**✅ Ventajas:**
- Latencia: <1 segundo (push instantáneo)
- Telegram envía mensajes inmediatamente
- Menos tráfico de red (no polling constante)
- Habilita API REST (si se necesita en futuro)

**❌ Desventajas:**
- Costo: +$5/mes
- Complejidad: Servidor Express + endpoint webhook
- Requiere dominio público estable
- Requiere configuración adicional en Railway
- Depende de RAILWAY_PUBLIC_DOMAIN

---

## PASOS PARA CAMBIAR A WEBHOOK

### Paso 1: Crear railway.json en v2-typescript

```bash
cat > /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/v2-typescript/railway.json << 'EOF'
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "nixpacks",
    "buildCommand": "npm install && npx prisma generate && npm run build"
  },
  "deploy": {
    "startCommand": "node dist/server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
EOF
```

### Paso 2: Eliminar railway.json de raíz

```bash
rm /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/railway.json
```

### Paso 3: Configurar Railway Dashboard

1. Ir a Railway Dashboard → Tu servicio → Settings
2. **Root Directory:** `v2-typescript`
3. **Variables:**
   ```
   NODE_ENV=production
   PORT=3001
   ```
   (RAILWAY_PUBLIC_DOMAIN se genera automáticamente)

### Paso 4: Verificar config/index.ts

Verificar que `config.api.port` lee de `process.env.PORT`:

```typescript
// src/config/index.ts línea 94
port: parseInt(process.env.API_PORT || '3001', 10),
```

**PROBLEMA DETECTADO:** El código lee `API_PORT`, no `PORT`.

**Solución:** En Railway, configurar:
```
API_PORT=3001
```

O cambiar código a:
```typescript
port: parseInt(process.env.PORT || process.env.API_PORT || '3001', 10),
```

### Paso 5: Commit y Deploy

```bash
cd /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS

git add v2-typescript/railway.json
git rm railway.json
git commit -m "feat: cambiar a modo webhook en Railway

- Crear railway.json en v2-typescript/
- Configurar Root Directory en Railway Dashboard
- Cambiar de bot.js (polling) a server.js (webhook)
- Latencia instantánea (<1s vs 1-3s)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

git push origin main
```

### Paso 6: Verificar Deployment

```bash
# Ver logs
railway logs --tail 100

# Buscar mensaje de webhook
railway logs | grep "Telegram webhook configured"

# Probar endpoint webhook
curl https://<tu-app>.railway.app/telegram-webhook
```

**Output esperado:**
```json
{
  "status": "Telegram webhook active",
  "bot_initialized": true
}
```

---

## RIESGOS DEL CAMBIO

### 🔴 Riesgos Críticos

1. **Downtime durante deploy:** El bot dejará de funcionar temporalmente
2. **Error de configuración:** Si Root Directory o PORT están mal, Railway fallará
3. **Webhook setup:** Telegram podría rechazar el webhook si el dominio no es HTTPS

### ⚠️ Riesgos Menores

1. **Costo adicional:** $5/mes
2. **Complejidad:** Más componentes que pueden fallar
3. **Dependencia de Railway domain:** Si cambia, hay que reconfigurar webhook

---

## PLAN DE ROLLBACK

Si el webhook falla:

```bash
# Restaurar railway.json en raíz
cat > /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/railway.json << 'EOF'
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
EOF

# Eliminar railway.json de v2-typescript
rm v2-typescript/railway.json

# Ir a Railway Dashboard → Settings → Root Directory → VACIAR (usar raíz)

# Commit y push
git add railway.json
git rm v2-typescript/railway.json
git commit -m "revert: volver a modo polling"
git push origin main
```

---

## RECOMENDACIÓN

### ❓ ¿Deberías hacer este cambio?

**Depende del caso de uso:**

#### ✅ SÍ cambiar a webhook si:
- Necesitas latencia instantánea (<1s)
- Vas a exponer API REST pública
- El bot es customer-facing (alta concurrencia)
- $5/mes es aceptable

#### ❌ NO cambiar a webhook si:
- El bot es solo para uso interno
- Latencia de 1-3s es aceptable
- Quieres minimizar costos
- Prefieres simplicidad (menos cosas que puedan fallar)

### 💡 Recomendación para tu caso

**MANTENER POLLING** por las siguientes razones:

1. **Bot de uso interno:** No es customer-facing
2. **Latencia aceptable:** 1-3s es perfectamente válido para facturación interna
3. **Costo cero:** No necesitas pagar $5/mes extra
4. **Funciona bien:** El bot está funcionando en producción sin problemas
5. **Simplicidad:** Menos componentes = menos cosas que puedan fallar

**Solo cambiar a webhook si en el futuro:**
- Necesitas API REST pública
- La latencia se vuelve crítica
- Agregas funcionalidades real-time

---

## DESARROLLO LOCAL

**IMPORTANTE:** El desarrollo local NO se ve afectado por este cambio.

### Polling (siempre en local)

```bash
# Desarrollo con polling (recomendado)
npm run dev:bot
# Ejecuta: tsx watch src/bot.ts (siempre polling)
```

### Webhook (si necesitas probar en local)

```bash
# Desarrollo con servidor completo
npm run dev
# Ejecuta: tsx watch src/server.ts

# server.ts detecta que NO es Railway, usa polling automáticamente:
if (config.env === 'production' && config.isRailway) {
  // webhook
} else {
  await telegramBot.launch(); // ← polling en desarrollo
}
```

**Conclusión:** En desarrollo local, SIEMPRE usas polling, independientemente de la configuración de Railway.

---

## RESUMEN EJECUTIVO

| Aspecto | Polling (Actual) | Webhook (Propuesta) |
|---------|------------------|---------------------|
| **Costo** | $0/mes | $5/mes |
| **Latencia** | 1-3s | <1s |
| **Complejidad** | Baja | Media |
| **Configuración Railway** | Simple | Requiere Root Directory + PORT |
| **Riesgo** | Bajo (ya funciona) | Medio (requiere cambios) |
| **Adecuado para uso interno** | ✅ Sí | ⚠️ Sobrecosto |

**Decisión recomendada:** MANTENER POLLING.

**Cuándo cambiar:** Si en el futuro necesitas API REST pública o latencia crítica.

---

**Fecha:** 2025-11-08
**Versión:** 1.0
**Autor:** Análisis técnico para decisión polling vs webhook
