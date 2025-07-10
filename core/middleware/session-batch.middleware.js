// core/middleware/session-batch.middleware.js
// Middleware para hacer batch de operaciones de sesión

const pendingUpdates = new Map();
let batchTimer = null;

/**
 * Procesa todas las actualizaciones pendientes en batch
 */
async function processBatch() {
  if (pendingUpdates.size === 0) return;
  
  const updates = Array.from(pendingUpdates.entries());
  pendingUpdates.clear();
  
  console.log(`[SESSION_BATCH] Procesando ${updates.length} actualizaciones en batch`);
  
  // Procesar todas las actualizaciones en paralelo
  await Promise.all(
    updates.map(async ([userId, state]) => {
      try {
        const SessionService = await import('../auth/session.service.js');
        await SessionService.default.saveUserState(userId, state);
      } catch (error) {
        console.error(`[SESSION_BATCH] Error guardando estado para ${userId}:`, error);
      }
    })
  );
}

/**
 * Middleware que hace batch de actualizaciones de sesión
 */
export function sessionBatchMiddleware(ctx, next) {
  // Interceptar guardado de estado
  const originalSave = ctx.saveSession;
  
  ctx.saveSession = async () => {
    const userId = ctx.from?.id;
    if (!userId || !ctx.userState) return;
    
    // Agregar a la cola de actualizaciones
    pendingUpdates.set(userId, { ...ctx.userState });
    
    // Programar batch si no está programado
    if (!batchTimer) {
      batchTimer = setTimeout(async () => {
        await processBatch();
        batchTimer = null;
      }, 100); // Procesar cada 100ms
    }
  };
  
  return next();
}

export default sessionBatchMiddleware;