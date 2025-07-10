// core/utils/state-cleanup.utils.js - Utilidades para limpieza segura de estado
import logger from './logger.js';

const cleanupLogger = logger.child({ module: 'state-cleanup' });

/**
 * Limpieza segura de pdfAnalysis para optimizar userState
 * @param {Object} ctx - Contexto de Telegram
 * @param {string} reason - Razón de la limpieza ('flow_change', 'new_pdf', 'ttl_cleanup')
 * @returns {Object} - Estadísticas de limpieza
 */
export function safeCleanupPdfAnalysis(ctx, reason = 'flow_change') {
  const results = {
    userStateCleanup: false,
    sessionCleanup: false,
    reason: reason,
    bytesSaved: 0
  };

  // Calcular bytes que vamos a ahorrar
  if (ctx.userState?.pdfAnalysis) {
    results.bytesSaved = JSON.stringify(ctx.userState.pdfAnalysis).length;
  }

  // 1. SIEMPRE limpiar userState (liberar memoria de sesión)
  if (ctx.userState?.pdfAnalysis) {
    console.log(`🧹 Limpiando userState.pdfAnalysis (${results.bytesSaved} bytes, razón: ${reason})`);
    delete ctx.userState.pdfAnalysis;
    results.userStateCleanup = true;
    
    cleanupLogger.debug({ 
      userId: ctx.from?.id, 
      reason, 
      bytesSaved: results.bytesSaved 
    }, 'pdfAnalysis limpiado de userState');
  }

  // 2. Limpiar session SELECTIVAMENTE
  if (ctx.session?.pdfAnalysis) {
    const age = Date.now() - ctx.session.pdfAnalysis.timestamp;
    const TTL = 30 * 60 * 1000; // 30 minutos
    
    // Limpiar session si:
    // - Es muy viejo (>30 min)
    // - Viene nuevo PDF
    // - Cambio a menu principal (reset completo)
    if (age > TTL || reason === 'new_pdf' || reason === 'menu_principal') {
      console.log(`🧹 Limpiando session.pdfAnalysis (${Math.round(age/60000)}min, razón: ${reason})`);
      delete ctx.session.pdfAnalysis;
      results.sessionCleanup = true;
      
      cleanupLogger.debug({ 
        userId: ctx.from?.id, 
        reason, 
        ageMinutes: Math.round(age/60000) 
      }, 'pdfAnalysis limpiado de session');
    } else {
      console.log(`💾 Manteniendo session.pdfAnalysis como fallback (${Math.round(age/60000)}min)`);
      
      cleanupLogger.debug({ 
        userId: ctx.from?.id, 
        ageMinutes: Math.round(age/60000) 
      }, 'pdfAnalysis mantenido en session como fallback');
    }
  }

  return results;
}

/**
 * Limpieza TTL automática para todos los datos temporales pesados
 * @param {Object} ctx - Contexto de Telegram
 * @returns {Object} - Estadísticas de limpieza
 */
export function cleanupExpiredTempData(ctx) {
  const results = {
    pdfCleanup: false,
    userStateSize: 0,
    optimizedSize: 0
  };

  // Medir tamaño antes
  results.userStateSize = JSON.stringify(ctx.userState || {}).length;

  // Limpiar PDF expirado
  if (ctx.userState?.pdfAnalysis) {
    const age = Date.now() - ctx.userState.pdfAnalysis.timestamp;
    const TTL = 30 * 60 * 1000; // 30 minutos
    
    if (age > TTL) {
      console.log(`🧹 TTL: Limpiando pdfAnalysis expirado (${Math.round(age/60000)} min)`);
      delete ctx.userState.pdfAnalysis;
      results.pdfCleanup = true;
    }
  }

  // Limpiar otros datos temporales si están muy viejos
  const tempFields = ['axaSummary', 'facturaId', 'clienteNombre'];
  tempFields.forEach(field => {
    if (ctx.userState?.[field]) {
      // Solo limpiar si hay evidencia de que es viejo (no timestamp directo)
      // En el futuro podríamos agregar timestamps a estos campos
      cleanupLogger.debug({ field }, 'Campo temporal detectado sin TTL');
    }
  });

  // Medir tamaño después
  results.optimizedSize = JSON.stringify(ctx.userState || {}).length;

  return results;
}

/**
 * Limpieza completa al cambiar entre flujos principales
 * @param {Object} ctx - Contexto de Telegram
 * @param {string} newFlow - Nuevo flujo ('axa', 'chubb', 'pdf', 'menu')
 */
export function cleanupFlowChange(ctx, newFlow) {
  console.log(`🔄 CAMBIO DE FLUJO: → ${newFlow}`);
  
  const initialSize = JSON.stringify(ctx.userState || {}).length;
  
  // Limpiar pdfAnalysis según el nuevo flujo
  const reason = newFlow === 'menu' ? 'menu_principal' : 'flow_change';
  const pdfCleanup = safeCleanupPdfAnalysis(ctx, reason);
  
  // Limpieza cruzada existente (mantener el patrón actual)
  if (newFlow === 'axa') {
    // Limpiar estado CHUBB
    delete ctx.userState.chubbGrupos;
    delete ctx.userState.chubbColumnMappings;
    delete ctx.userState.chubbMontosPorGrupo;
    delete ctx.userState.chubbClientId;
    console.log('🧹 Estado CHUBB limpiado para flujo AXA');
  } else if (newFlow === 'chubb') {
    // Limpiar estado AXA
    delete ctx.userState.axaData;
    delete ctx.userState.axaColumnMappings;
    delete ctx.userState.axaClientId;
    delete ctx.userState.axaSummary;
    console.log('🧹 Estado AXA limpiado para flujo CHUBB');
  }
  
  const finalSize = JSON.stringify(ctx.userState || {}).length;
  const improvement = Math.round((1 - finalSize / initialSize) * 100);
  
  console.log(`📊 OPTIMIZACIÓN: ${initialSize}B → ${finalSize}B (${improvement}% reducción)`);
  
  cleanupLogger.info({ 
    userId: ctx.from?.id, 
    newFlow, 
    initialSize, 
    finalSize, 
    improvement,
    pdfBytesSaved: pdfCleanup.bytesSaved
  }, 'Cambio de flujo con limpieza');
}

export default {
  safeCleanupPdfAnalysis,
  cleanupExpiredTempData,
  cleanupFlowChange
};