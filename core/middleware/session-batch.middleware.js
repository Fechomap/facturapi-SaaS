// core/middleware/session-batch.middleware.js
// Middleware para hacer batch de operaciones de sesión

import SessionService from '../auth/session.service.js';

const pendingUpdates = new Map();
let isProcessing = false;

/**
 * Procesa todas las actualizaciones pendientes en batch
 */
async function processBatch() {
  if (pendingUpdates.size === 0 || isProcessing) return;

  isProcessing = true;

  const updates = Array.from(pendingUpdates.entries());
  pendingUpdates.clear();

  console.log(`[SESSION_BATCH] Procesando ${updates.length} actualizaciones en batch`);

  try {
    await Promise.all(
      updates.map(([userId, state]) =>
        SessionService.saveUserState(userId, state).catch((error) =>
          console.error(`[SESSION_BATCH] Error guardando estado para ${userId}:`, error)
        )
      )
    );
  } finally {
    isProcessing = false;
    // Volver a procesar si hay nuevas actualizaciones
    if (pendingUpdates.size > 0) {
      process.nextTick(processBatch);
    }
  }
}

/**
 * Middleware que hace batch de actualizaciones de sesión
 */
export function sessionBatchMiddleware(ctx, next) {
  // Interceptar guardado de estado
  ctx.saveSession = async () => {
    const userId = ctx.from?.id;
    if (!userId || !ctx.userState) return;

    // Agregar a la cola de actualizaciones
    pendingUpdates.set(userId, { ...ctx.userState });

    // Disparar el procesamiento en el siguiente tick del event loop
    if (!isProcessing) {
      process.nextTick(processBatch);
    }
  };

  return next();
}

export default sessionBatchMiddleware;
