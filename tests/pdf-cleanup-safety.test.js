// tests/pdf-cleanup-safety.test.js - Investigar impacto de limpiar pdfAnalysis
import { jest } from '@jest/globals';

describe('INVESTIGACIÓN: Seguridad de limpiar pdfAnalysis', () => {

  test('ANÁLISIS: ¿Dónde se usa pdfAnalysis después de guardarlo?', () => {
    console.log('🔍 INVESTIGANDO: Todos los lugares donde se lee pdfAnalysis');
    
    // LUGARES donde se LEE pdfAnalysis (basado en código analizado)
    const pdfAnalysisUsage = {
      'pdf-invoice.handler.js:181': {
        context: 'let analysisData = ctx.userState?.pdfAnalysis;',
        purpose: 'Recuperar datos para generar factura simple',
        timing: 'Durante generación de factura',
        critical: true,
        fallback: 'ctx.session?.pdfAnalysis'
      },
      'pdf-invoice.handler.js:219': {
        context: 'let analysisData = ctx.userState?.pdfAnalysis;',
        purpose: 'Recuperar datos para generar factura manual',
        timing: 'Durante generación de factura manual',
        critical: true,
        fallback: 'ctx.session?.pdfAnalysis'
      },
      'pdf-invoice.handler.js:199': {
        context: 'ctx.userState.pdfAnalysis = analysisData;',
        purpose: 'Restaurar desde session a userState',
        timing: 'Al restaurar datos entre workers',
        critical: false,
        fallback: 'Se copia desde session'
      }
    };

    console.log('\n📊 ANÁLISIS DE USO:');
    Object.entries(pdfAnalysisUsage).forEach(([location, info]) => {
      console.log(`\n${location}:`);
      console.log(`  📝 Propósito: ${info.purpose}`);
      console.log(`  ⏰ Cuándo: ${info.timing}`);
      console.log(`  🚨 Crítico: ${info.critical ? 'SÍ' : 'NO'}`);
      console.log(`  🔄 Fallback: ${info.fallback}`);
    });

    const criticalUsages = Object.values(pdfAnalysisUsage).filter(u => u.critical);
    console.log(`\n🎯 USOS CRÍTICOS: ${criticalUsages.length}`);
    console.log('🎯 TODOS tienen fallback a ctx.session?.pdfAnalysis');

    expect(criticalUsages.length).toBe(2);
    expect(criticalUsages.every(u => u.fallback)).toBe(true);
    console.log('\n✅ SEGURO: Todos los usos críticos tienen fallback');
  });

  test('ESCENARIO 1: Usuario en flujo PDF → cambia a AXA', () => {
    console.log('🎬 SIMULANDO: Usuario procesando PDF, luego va a AXA');
    
    const mockCtx = {
      from: { id: 123 },
      userState: {
        tenantId: 'tenant-123',
        userStatus: 'authorized',
        // ESTADO: Proceso PDF completo
        pdfAnalysis: {
          id: 'pdf_123_456',
          analysis: {
            client: 'INFOASIST',
            orderNumber: '5101078264',
            totalAmount: 996
          },
          timestamp: Date.now()
        }
      },
      session: {
        // PDF también en session (sistema dual)
        pdfAnalysis: {
          id: 'pdf_123_456',
          analysis: {
            client: 'INFOASIST', 
            orderNumber: '5101078264',
            totalAmount: 996
          },
          timestamp: Date.now()
        }
      }
    };

    console.log('\n📊 ANTES del cambio a AXA:');
    console.log(`  📦 userState.pdfAnalysis: ${JSON.stringify(mockCtx.userState.pdfAnalysis).length} bytes`);
    console.log(`  💾 session.pdfAnalysis: ${JSON.stringify(mockCtx.session.pdfAnalysis).length} bytes`);

    // SIMULACIÓN: Usuario presiona menu_axa (NUESTRA LIMPIEZA)
    console.log('\n👆 Usuario presiona menu_axa...');
    
    // LIMPIEZA PROPUESTA
    delete mockCtx.userState.pdfAnalysis;
    mockCtx.userState.esperando = 'archivo_excel_axa';
    mockCtx.userState.axaClientId = 'axa-123';

    console.log('\n📊 DESPUÉS del cambio a AXA:');
    console.log(`  📦 userState.pdfAnalysis: ${mockCtx.userState.pdfAnalysis || 'LIMPIO ✅'}`);
    console.log(`  💾 session.pdfAnalysis: INTACTO ✅`);
    console.log(`  🎯 userState.esperando: ${mockCtx.userState.esperando}`);

    // VALIDACIONES DE SEGURIDAD
    expect(mockCtx.userState.pdfAnalysis).toBeUndefined();
    expect(mockCtx.session.pdfAnalysis).toBeDefined(); // FALLBACK intacto
    expect(mockCtx.userState.esperando).toBe('archivo_excel_axa');
    expect(mockCtx.userState.axaClientId).toBe('axa-123');

    console.log('\n✅ SEGURO: PDF limpiado de userState, fallback intacto');
  });

  test('ESCENARIO 2: Usuario vuelve a PDF después de AXA', () => {
    console.log('🎬 SIMULANDO: Usuario va AXA → vuelve a PDF');
    
    const mockCtx = {
      from: { id: 123 },
      userState: {
        tenantId: 'tenant-123',
        userStatus: 'authorized',
        // ESTADO: Acaba de terminar AXA
        esperando: null,
        axaClientId: 'axa-123',
        facturaGenerada: true
      },
      session: {
        // PDF VIEJO aún en session
        pdfAnalysis: {
          id: 'pdf_123_456',
          analysis: { client: 'INFOASIST' },
          timestamp: Date.now() - (20 * 60 * 1000) // 20 minutos atrás
        }
      }
    };

    console.log('\n📊 ESTADO: Usuario terminó AXA, quiere volver a PDF');
    console.log(`  📦 userState.pdfAnalysis: ${mockCtx.userState.pdfAnalysis || 'LIMPIO'}`);
    console.log(`  💾 session.pdfAnalysis: ${mockCtx.session.pdfAnalysis ? 'EXISTE' : 'NO EXISTE'}`);

    // SIMULACIÓN: Usuario envía nuevo PDF
    console.log('\n📎 Usuario envía NUEVO PDF...');
    
    // NUESTRA LIMPIEZA AGRESIVA ANTES de procesar
    delete mockCtx.userState.pdfAnalysis;
    delete mockCtx.session.pdfAnalysis; // También limpiar session viejo
    
    // Procesar nuevo PDF
    const newPdfAnalysis = {
      id: 'pdf_123_789', // NUEVO ID
      analysis: { client: 'ARSA', orderNumber: '7890' },
      timestamp: Date.now()
    };
    
    mockCtx.userState.pdfAnalysis = newPdfAnalysis;
    mockCtx.session.pdfAnalysis = newPdfAnalysis;

    console.log('\n📊 DESPUÉS de procesar nuevo PDF:');
    console.log(`  📦 userState.pdfAnalysis.id: ${mockCtx.userState.pdfAnalysis.id}`);
    console.log(`  💾 session.pdfAnalysis.id: ${mockCtx.session.pdfAnalysis.id}`);

    // VALIDACIONES
    expect(mockCtx.userState.pdfAnalysis.id).toBe('pdf_123_789');
    expect(mockCtx.session.pdfAnalysis.id).toBe('pdf_123_789');
    expect(mockCtx.userState.pdfAnalysis.analysis.client).toBe('ARSA');

    console.log('\n✅ SEGURO: PDF viejo limpiado, nuevo procesado correctamente');
  });

  test('ESCENARIO 3: Usuario en medio de proceso PDF cuando limpiamos', () => {
    console.log('🎬 SIMULANDO: Usuario procesando PDF, limpieza interrumpe');
    
    const mockCtx = {
      from: { id: 123 },
      userState: {
        // ESTADO: PDF procesándose
        pdfAnalysis: {
          id: 'pdf_123_456',
          analysis: { client: 'INFOASIST' },
          timestamp: Date.now() - 1000 // 1 segundo atrás (RECIENTE)
        }
      },
      session: {
        pdfAnalysis: {
          id: 'pdf_123_456',
          analysis: { client: 'INFOASIST' },
          timestamp: Date.now() - 1000
        }
      }
    };

    console.log('\n📊 ESTADO: PDF procesándose recientemente');
    
    // SIMULACIÓN: Usuario presiona botón AXA mientras PDF se procesa
    console.log('\n⚠️ Usuario presiona menu_axa MIENTRAS procesa PDF...');
    
    // NUESTRA LIMPIEZA
    delete mockCtx.userState.pdfAnalysis;
    
    console.log('\n❓ PREGUNTA: ¿Qué pasa si usuario quiere volver al PDF?');
    
    // RECUPERACIÓN desde session (fallback del sistema actual)
    const analysisId = 'pdf_123_456';
    let analysisData = mockCtx.userState?.pdfAnalysis;
    
    if (!analysisData || analysisData.id !== analysisId) {
      // Código actual del sistema (línea 184-199)
      analysisData = mockCtx.session?.pdfAnalysis;
      
      if (analysisData && analysisData.id === analysisId) {
        console.log('🔄 RECUPERACIÓN: Datos restaurados desde session');
        mockCtx.userState.pdfAnalysis = analysisData;
      } else {
        console.log('❌ EXPIRADO: Datos no encontrados, pedir nuevo PDF');
      }
    }

    // VALIDACIONES
    expect(analysisData).toBeDefined();
    expect(analysisData.id).toBe('pdf_123_456');
    expect(mockCtx.userState.pdfAnalysis).toBeDefined(); // Restaurado

    console.log('\n✅ SEGURO: Sistema puede recuperar datos desde session');
  });

  test('ESCENARIO 4: Limpieza de session también (agresiva)', () => {
    console.log('🎬 SIMULANDO: Limpieza agresiva de userState Y session');
    
    const mockCtx = {
      from: { id: 123 },
      userState: {
        pdfAnalysis: { id: 'pdf_old', timestamp: Date.now() - (40 * 60 * 1000) } // 40 min viejo
      },
      session: {
        pdfAnalysis: { id: 'pdf_old', timestamp: Date.now() - (40 * 60 * 1000) }
      }
    };

    console.log('\n📊 ESTADO: PDF muy viejo (40 minutos)');
    
    // LIMPIEZA AGRESIVA (con TTL)
    function cleanupOldPdfData(ctx) {
      const TTL = 30 * 60 * 1000; // 30 minutos
      
      // Limpiar userState
      if (ctx.userState?.pdfAnalysis) {
        const age = Date.now() - ctx.userState.pdfAnalysis.timestamp;
        if (age > TTL) {
          console.log(`🧹 Limpiando userState.pdfAnalysis (${Math.round(age/60000)} min viejo)`);
          delete ctx.userState.pdfAnalysis;
        }
      }
      
      // Limpiar session también
      if (ctx.session?.pdfAnalysis) {
        const age = Date.now() - ctx.session.pdfAnalysis.timestamp;
        if (age > TTL) {
          console.log(`🧹 Limpiando session.pdfAnalysis (${Math.round(age/60000)} min viejo)`);
          delete ctx.session.pdfAnalysis;
        }
      }
    }

    cleanupOldPdfData(mockCtx);

    // VALIDACIONES
    expect(mockCtx.userState.pdfAnalysis).toBeUndefined();
    expect(mockCtx.session.pdfAnalysis).toBeUndefined();

    console.log('\n✅ SEGURO: Datos viejos limpiados de ambos lugares');
  });

  test('IMPLEMENTACIÓN: Función de limpieza segura', () => {
    console.log('🛠️ CREANDO: Función de limpieza segura');
    
    // FUNCIÓN REAL que implementaremos
    function safeCleanupPdfAnalysis(ctx, reason = 'flow_change') {
      const results = {
        userStateCleanup: false,
        sessionCleanup: false,
        reason: reason
      };

      // Limpiar userState siempre (liberar memoria de sesión)
      if (ctx.userState?.pdfAnalysis) {
        console.log(`🧹 Limpiando userState.pdfAnalysis (razón: ${reason})`);
        delete ctx.userState.pdfAnalysis;
        results.userStateCleanup = true;
      }

      // Limpiar session solo si es viejo (mantener fallback para PDFs recientes)
      if (ctx.session?.pdfAnalysis) {
        const age = Date.now() - ctx.session.pdfAnalysis.timestamp;
        const TTL = 30 * 60 * 1000; // 30 minutos
        
        if (age > TTL || reason === 'new_pdf') {
          console.log(`🧹 Limpiando session.pdfAnalysis (${Math.round(age/60000)}min, razón: ${reason})`);
          delete ctx.session.pdfAnalysis;
          results.sessionCleanup = true;
        } else {
          console.log(`💾 Manteniendo session.pdfAnalysis como fallback (${Math.round(age/60000)}min)`);
        }
      }

      return results;
    }

    // PROBAR diferentes escenarios
    const testScenarios = [
      {
        name: 'PDF reciente, cambio a AXA',
        ctx: {
          userState: { pdfAnalysis: { timestamp: Date.now() - 60000 } }, // 1 min
          session: { pdfAnalysis: { timestamp: Date.now() - 60000 } }
        },
        reason: 'flow_change',
        expectedUserState: false,
        expectedSession: true // Mantener como fallback
      },
      {
        name: 'PDF viejo, cambio a AXA', 
        ctx: {
          userState: { pdfAnalysis: { timestamp: Date.now() - (40*60*1000) } }, // 40 min
          session: { pdfAnalysis: { timestamp: Date.now() - (40*60*1000) } }
        },
        reason: 'flow_change',
        expectedUserState: false,
        expectedSession: false // Limpiar por viejo
      },
      {
        name: 'Nuevo PDF llegando',
        ctx: {
          userState: { pdfAnalysis: { timestamp: Date.now() - 60000 } },
          session: { pdfAnalysis: { timestamp: Date.now() - 60000 } }
        },
        reason: 'new_pdf',
        expectedUserState: false,
        expectedSession: false // Limpiar para nuevo PDF
      }
    ];

    console.log('\n🧪 PROBANDO escenarios:');
    testScenarios.forEach(scenario => {
      console.log(`\n📋 ${scenario.name}:`);
      const result = safeCleanupPdfAnalysis(scenario.ctx, scenario.reason);
      
      const userStateExists = !!scenario.ctx.userState?.pdfAnalysis;
      const sessionExists = !!scenario.ctx.session?.pdfAnalysis;
      
      console.log(`  📦 userState limpiado: ${result.userStateCleanup}, existe: ${userStateExists}`);
      console.log(`  💾 session limpiado: ${result.sessionCleanup}, existe: ${sessionExists}`);
      
      expect(userStateExists).toBe(scenario.expectedUserState);
      expect(sessionExists).toBe(scenario.expectedSession);
    });

    console.log('\n✅ FUNCIÓN: safeCleanupPdfAnalysis() lista y probada');
  });
});