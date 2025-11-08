# 🐛 DEBUG: Error "No hay datos de análisis de lote disponibles"

**Fecha:** 2025-11-07 17:56
**Commit HEAD:** a1d495a
**Archivo afectado:** `pdf-batch.handler.ts`

---

## Síntomas

Usuario envía 9 PDFs para facturación:
- ✅ Procesamiento exitoso (9 PDFs analizados con 100% confianza)
- ✅ Sesión guardada en BD (log confirma: "Sesión del lote de análisis guardada en BD")
- ❌ Al presionar botón "Generar Facturas" → Error: "No hay datos de análisis de lote disponibles"

**Logs:**
```
[17:56:01] INFO: Procesando lote 14100478066654457 con 9 PDFs
[17:56:11] INFO: Sesión del lote de análisis guardada en BD
[17:56:11] INFO: batch_processing_completed - successCount: 9, failCount: 0
[Usuario presiona botón "Generar Facturas"]
❌ No hay datos de análisis de lote disponibles. Por favor, envía los PDFs de nuevo.
```

---

## Análisis del Flujo

### 1. Guardar Estado (pdf-batch.handler.ts:212-234)

```typescript
// Guardar resultados en userState
ctx.userState.batchAnalysis = batchData;

const userId = ctx.from?.id || ctx.callbackQuery?.from?.id;
if (userId) {
  await SessionService.saveUserStateImmediate(userId, ctx.userState);
  logger.info({ tenantId, userId }, 'Sesión guardada en BD');
}
```

**userId utilizado:**
- En procesamiento de lote: `ctx.from.id` (quien envió los PDFs)
- Tipo: `number` (ID de Telegram)

### 2. Cargar Estado (session.service.ts:410-445)

```typescript
// Middleware ejecuta antes de action handler
createMiddleware() {
  return async (ctx: any, next: any) => {
    const userId = ctx.from?.id;  // ← ¿Existe en callbacks?

    if (isStartCommand) {
      // ... estado parcial
    } else {
      userState = await this.getUserState(userId);  // ← Carga desde BD
    }

    ctx.userState = userState;  // ← Asigna a contexto
    await next();  // ← Continúa a action handler
  }
}
```

**userId utilizado:**
- En callback de botón: `ctx.from?.id`
- ⚠️ **POSIBLE PROBLEMA:** ¿`ctx.from` existe en `ctx.callbackQuery`?

### 3. Action Handler (pdf-batch.handler.ts:278-288)

```typescript
bot.action('batch_generate_invoices', async (ctx: BotContext): Promise<void> => {
  await ctx.answerCbQuery('Iniciando generación...');

  const batchData = ctx.userState?.batchAnalysis;  // ← Lee de userState

  if (!batchData || !batchData.results || batchData.results.length === 0) {
    await ctx.reply('❌ No hay datos de análisis de lote disponibles.');
    return;
  }
```

**Lectura:**
- Espera que `ctx.userState.batchAnalysis` esté poblado por el middleware
- Si está vacío → Error

---

## Hipótesis del Problema

### Hipótesis #1: ctx.from en Callbacks ⭐ **MÁS PROBABLE**

**En mensajes:**
- `ctx.from.id` = ID del usuario que envió el mensaje ✅

**En callbacks (botones):**
- `ctx.from` puede ser `undefined` en algunas versiones de Telegraf
- Debería ser: `ctx.callbackQuery?.from?.id`

**Evidencia:**
```typescript
// Al guardar, el código maneja ambos casos:
const userId = ctx.from?.id || ctx.callbackQuery?.from?.id;

// Pero el middleware SOLO usa:
const userId = ctx.from?.id;  // ❌ Puede ser undefined en callbacks
```

**Resultado:**
- Guardar: Usa `ctx.callbackQuery.from.id` (funciona)
- Cargar (middleware): Usa `ctx.from.id` (undefined en callback)
- userId diferente o undefined → No encuentra la sesión → `userState` vacío

---

### Hipótesis #2: Timing/Race Condition

**Secuencia temporal:**
1. Usuario envía PDFs → Procesamiento → Guarda en BD
2. Usuario presiona botón INMEDIATAMENTE
3. Middleware intenta cargar desde BD pero la transacción aún no completó

**Menos probable porque:**
- Los logs muestran "Sesión guardada" ANTES de mostrar los botones
- `saveUserStateImmediate` usa `await` (debería esperar)

---

### Hipótesis #3: Cache Redis

**Problema:**
- `saveUserStateImmediate` guarda en BD pero NO actualiza cache Redis
- Middleware intenta leer de cache Redis primero
- Cache está vacío → No lee de BD → `userState` vacío

**Evidencia en session.service.ts:98-105:**
```typescript
static async getUserState(telegramId): Promise<SessionState> {
  // 1. Intenta Redis primero
  const redisResult = await redisSessionService.getSession(cacheKey);
  if (redisResult.success) {
    return redisResult.data as SessionState;  // ← Devuelve cache (puede estar vacío)
  }

  // 2. Si no hay en Redis, lee de BD
  const session = await prisma.userSession.findUnique(...);
}
```

**Pero en saveUserStateImmediate (líneas 240-280):**
```typescript
static async saveUserStateImmediate(telegramId, state): Promise<void> {
  // Guarda en BD
  await prisma.userSession.upsert({
    where: { telegramId },
    update: { sessionData: state },
    create: { telegramId, sessionData: state },
  });

  // ⚠️ NO actualiza Redis
  // El cache puede tener datos viejos
}
```

---

## Comparación con Commit Anterior (e471ec0)

**Commit e471ec0** (ayer 23:02) - "aplicar Regla de Oro POST_MORTEM":
- Eliminó retry loop complejo
- Simplificó guardado y lectura de `userState`
- Funcionó correctamente (según usuario)

**Commit a1d495a** (hoy 17:31) - "implementación auditoría CUA":
- Modificó `session.service.ts` (cambios en activeProcesses con TTL)
- Modificó `multi-auth.middleware.ts` (redujo cache TTL de 5min a 1min)
- **NO tocó** `pdf-batch.handler.ts`

**Conclusión:**
- El problema NO es nuevo código en pdf-batch.handler
- Podría ser efecto secundario de cambios en session.service o cache

---

## Plan de Acción

### Paso 1: Verificar ctx.from en Callbacks ⭐

**Archivo:** `src/core/auth/session.service.ts:420-433`

**ANTES:**
```typescript
const userId = ctx.from?.id;
```

**DESPUÉS:**
```typescript
const userId = ctx.from?.id || ctx.callbackQuery?.from?.id;
```

**Justificación:**
- Igualar lógica con pdf-batch.handler.ts línea 226
- Asegurar que callbacks obtengan userId correctamente

---

### Paso 2: Actualizar Cache Redis al Guardar

**Archivo:** `src/core/auth/session.service.ts:240-280`

**AGREGAR después de upsert:**
```typescript
static async saveUserStateImmediate(telegramId, state) {
  const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);

  // 1. Guardar en BD
  await prisma.userSession.upsert({
    where: { telegramId: telegramIdBigInt },
    update: { sessionData: state, updatedAt: new Date() },
    create: { telegramId: telegramIdBigInt, sessionData: state },
  });

  // 2. NUEVO: Actualizar cache Redis inmediatamente
  const cacheKey = `session:${telegramIdBigInt.toString()}`;
  await redisSessionService.setSession(cacheKey, state);  // ← AGREGAR ESTA LÍNEA

  logger.debug({ telegramId }, 'Estado guardado en BD y cache');
}
```

**Justificación:**
- Mantener BD y cache sincronizados
- Evitar leer datos obsoletos del cache

---

### Paso 3: Logging Detallado

**Archivo:** `src/core/auth/session.service.ts:410-445`

**AGREGAR logs:**
```typescript
createMiddleware() {
  return async (ctx, next) => {
    const userId = ctx.from?.id || ctx.callbackQuery?.from?.id;

    // AGREGAR log de diagnóstico
    sessionLogger.debug({
      userId,
      fromId: ctx.from?.id,
      callbackFromId: ctx.callbackQuery?.from?.id,
      updateType: ctx.updateType,
    }, 'Middleware: identificando usuario');

    if (!userId) {
      sessionLogger.warn('Middleware: userId no disponible');
      return next();
    }

    // ...
  }
}
```

---

## Testing

### Caso de Prueba

1. Enviar 2-3 PDFs para análisis
2. Esperar confirmación "Análisis completado"
3. Presionar botón "Generar Facturas"
4. Verificar que NO da error "No hay datos"
5. Revisar logs para confirmar userId consistente

### Validación

**Logs esperados:**
```
[DEBUG] Middleware: identificando usuario - userId: 7143094298, fromId: undefined, callbackFromId: 7143094298
[DEBUG] Cargando estado desde BD para usuario 7143094298
[DEBUG] Estado cargado: { batchAnalysis: { results: [...] } }
[INFO] Generando facturas desde lote con 9 PDFs
```

---

## Notas Adicionales

**Commits relacionados:**
- `16d0dfa`: Implementación solución lotes PDF con telegraf-media-group
- `74b56fc`: Resolver pérdida de contexto en callbacks
- `e471ec0`: Aplicar Regla de Oro POST_MORTEM (funcionó)
- `a1d495a`: Auditoría CUA (problema apareció después)

**Archivos clave:**
- `/src/bot/handlers/pdf-batch.handler.ts`
- `/src/core/auth/session.service.ts`
- `/src/services/redis-session.service.ts`

**Status actual:**
- Cambios en stash: `WIP: cambios de validación UUID`
- Branch: `main`
- HEAD: `a1d495a`
