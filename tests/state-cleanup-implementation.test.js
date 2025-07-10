// tests/state-cleanup-implementation.test.js - Validar implementación de limpieza
import { jest } from '@jest/globals';
import { safeCleanupPdfAnalysis, cleanupFlowChange } from '../core/utils/state-cleanup.utils.js';

describe('IMPLEMENTACIÓN: Limpieza de estado userState optimizada', () => {

  beforeEach(() => {
    // Limpiar console.log mocks
    global.console = {
      ...console,
      log: jest.fn()
    };
  });

  test('INTEGRACIÓN: safeCleanupPdfAnalysis() funciona como esperado', () => {
    console.log('🧪 PROBANDO: Función safeCleanupPdfAnalysis()');
    
    const mockCtx = {
      from: { id: 123456789 },
      userState: {
        tenantId: 'tenant-123',
        userStatus: 'authorized',
        pdfAnalysis: {
          id: 'pdf_123_456',
          analysis: {
            client: 'INFOASIST',
            orderNumber: '5101078264',
            totalAmount: 996
          },
          timestamp: Date.now() - (5 * 60 * 1000) // 5 minutos atrás
        },
        axaClientId: 'axa-123'
      },
      session: {
        pdfAnalysis: {
          id: 'pdf_123_456',
          analysis: {
            client: 'INFOASIST',
            orderNumber: '5101078264',
            totalAmount: 996
          },
          timestamp: Date.now() - (5 * 60 * 1000)
        }
      }
    };

    const sizeBefore = JSON.stringify(mockCtx.userState).length;
    console.log(`📊 ANTES: userState = ${sizeBefore} bytes`);

    // EJECUTAR limpieza por cambio de flujo
    const result = safeCleanupPdfAnalysis(mockCtx, 'flow_change');

    const sizeAfter = JSON.stringify(mockCtx.userState).length;
    const improvement = Math.round((1 - sizeAfter / sizeBefore) * 100);

    console.log(`📊 DESPUÉS: userState = ${sizeAfter} bytes`);
    console.log(`🚀 MEJORA: ${improvement}% reducción`);

    // VALIDACIONES
    expect(result.userStateCleanup).toBe(true);
    expect(result.sessionCleanup).toBe(false); // Mantenido como fallback
    expect(result.bytesSaved).toBeGreaterThan(0);
    expect(mockCtx.userState.pdfAnalysis).toBeUndefined();
    expect(mockCtx.session.pdfAnalysis).toBeDefined(); // Fallback intacto
    expect(mockCtx.userState.tenantId).toBe('tenant-123'); // Datos esenciales mantenidos
    expect(improvement).toBeGreaterThan(30); // Al menos 30% mejora

    console.log(`✅ RESULTADO: ${result.bytesSaved} bytes liberados, ${improvement}% mejora`);
  });

  test('INTEGRACIÓN: cleanupFlowChange() optimiza correctamente', () => {
    console.log('🧪 PROBANDO: Función cleanupFlowChange()');
    
    const mockCtx = {
      from: { id: 987654321 },
      userState: {
        // DATOS ESENCIALES
        tenantId: 'tenant-456',
        userStatus: 'authorized',
        series: 'F',
        
        // DATOS PESADOS (deben limpiarse)
        pdfAnalysis: {
          id: 'pdf_old',
          analysis: { /* objeto pesado */ },
          timestamp: Date.now() - (10 * 60 * 1000) // 10 min viejo
        },
        
        // DATOS DE OTROS FLUJOS (deben limpiarse)
        chubbGrupos: [{ grupo: 'GRUA', conceptos: [] }],
        chubbColumnMappings: { grupo: 'GRUPO' },
        axaClientId: 'axa-viejo-123'
      },
      session: {
        pdfAnalysis: {
          id: 'pdf_old',
          timestamp: Date.now() - (10 * 60 * 1000)
        }
      }
    };

    const sizeBefore = JSON.stringify(mockCtx.userState).length;
    console.log(`📊 ANTES: userState = ${sizeBefore} bytes`);
    console.log(`📦 Campos antes: ${Object.keys(mockCtx.userState).join(', ')}`);

    // EJECUTAR cambio de flujo a AXA
    cleanupFlowChange(mockCtx, 'axa');

    const sizeAfter = JSON.stringify(mockCtx.userState).length;
    const improvement = Math.round((1 - sizeAfter / sizeBefore) * 100);

    console.log(`📊 DESPUÉS: userState = ${sizeAfter} bytes`);
    console.log(`📦 Campos después: ${Object.keys(mockCtx.userState).join(', ')}`);
    console.log(`🚀 MEJORA: ${improvement}% reducción`);

    // VALIDACIONES
    expect(mockCtx.userState.pdfAnalysis).toBeUndefined(); // PDF limpiado
    expect(mockCtx.userState.chubbGrupos).toBeUndefined(); // CHUBB limpiado  
    expect(mockCtx.userState.chubbColumnMappings).toBeUndefined(); // CHUBB limpiado
    expect(mockCtx.userState.tenantId).toBe('tenant-456'); // Esenciales mantenidos
    expect(mockCtx.userState.userStatus).toBe('authorized'); // Esenciales mantenidos
    expect(mockCtx.userState.series).toBe('F'); // Esenciales mantenidos
    expect(improvement).toBeGreaterThan(40); // Al menos 40% mejora

    console.log(`✅ RESULTADO: cleanupFlowChange() funcionó correctamente`);
  });

  test('ESCENARIO REAL: Simular log del usuario', () => {
    console.log('🎬 SIMULANDO: Escenario real del log del usuario');
    
    // DATOS EXACTOS del log real del usuario
    const userStateReal = {
      "series": "F",
      "tenantId": "3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb",
      "esperando": "archivo_excel_axa",
      "facturaId": "686f2f6c5a2816d6ab9cd93b",
      "axaSummary": { "totalAmount": 60183.16, "totalRecords": 34 },
      "tenantName": "Prueba sa de cv",
      "userStatus": "authorized",
      "axaClientId": "68671168de097f4e7bd4734c",
      "pdfAnalysis": {
        "id": "simple_1752117254789_7143094298",
        "analysis": {
          "client": "INFOASIST",
          "errors": [],
          "metadata": {
            "extractedAt": "2025-07-10T03:14:14.253Z",
            "providerName": "ALFREDO ALEJANDRO PEREZ",
            "hasValidStructure": true
          },
          "clientCode": "INFO",
          "clientName": "INFOASIST INFORMACION Y ASISTENCIA",
          "confidence": 100,
          "orderNumber": "5101078264",
          "totalAmount": 996
        },
        "timestamp": 1752117254789,
        "validation": {
          "errors": [],
          "isValid": true,
          "warnings": [],
          "confidence": 100
        }
      },
      "folioFactura": 165,
      "clienteNombre": "AXA ASSISTANCE MEXICO",
      "facturaGenerada": true
    };

    const mockCtx = {
      from: { id: 7143094298 },
      userState: { ...userStateReal },
      session: {}
    };

    const sizeBefore = JSON.stringify(mockCtx.userState).length;
    console.log(`📊 ESTADO REAL ANTES: ${sizeBefore} bytes`);
    console.log(`📦 pdfAnalysis: ${JSON.stringify(mockCtx.userState.pdfAnalysis).length} bytes (${Math.round((JSON.stringify(mockCtx.userState.pdfAnalysis).length / sizeBefore) * 100)}%)`);

    // SIMULAR: Usuario cambia de AXA a CHUBB
    console.log('\n👆 Usuario presiona menu_chubb...');
    cleanupFlowChange(mockCtx, 'chubb');

    const sizeAfter = JSON.stringify(mockCtx.userState).length;
    const improvement = Math.round((1 - sizeAfter / sizeBefore) * 100);

    console.log(`📊 ESTADO REAL DESPUÉS: ${sizeAfter} bytes`);
    console.log(`🚀 MEJORA REAL: ${improvement}% reducción`);
    console.log(`💾 BYTES AHORRADOS: ${sizeBefore - sizeAfter} bytes`);

    // VALIDACIONES
    expect(mockCtx.userState.pdfAnalysis).toBeUndefined(); // PDF viejo limpiado
    expect(mockCtx.userState.axaSummary).toBeUndefined(); // AXA datos limpiados
    expect(mockCtx.userState.axaClientId).toBeUndefined(); // AXA estado limpiado
    expect(mockCtx.userState.tenantId).toBeDefined(); // Esenciales mantenidos
    expect(mockCtx.userState.userStatus).toBeDefined(); // Esenciales mantenidos
    expect(improvement).toBeGreaterThan(45); // Mejora significativa

    console.log(`\n✅ RESULTADO REAL: De 823B → ${sizeAfter}B (${improvement}% mejora)`);
    console.log(`✅ PROBLEMA SOLUCIONADO: pdfAnalysis viejo eliminado automáticamente`);
  });

  test('EDGE CASE: PDF reciente durante cambio de flujo', () => {
    console.log('⚠️ EDGE CASE: PDF muy reciente durante cambio de flujo');
    
    const mockCtx = {
      from: { id: 111111111 },
      userState: {
        tenantId: 'tenant-test',
        pdfAnalysis: {
          id: 'pdf_recent',
          timestamp: Date.now() - (30 * 1000) // 30 segundos atrás (MUY RECIENTE)
        }
      },
      session: {
        pdfAnalysis: {
          id: 'pdf_recent',
          timestamp: Date.now() - (30 * 1000)
        }
      }
    };

    console.log('📊 ESTADO: PDF muy reciente (30 segundos)');
    
    // Cambio de flujo - debe limpiar userState pero mantener session
    const result = safeCleanupPdfAnalysis(mockCtx, 'flow_change');

    console.log(`📊 userState limpiado: ${result.userStateCleanup}`);
    console.log(`📊 session limpiado: ${result.sessionCleanup}`);

    // VALIDACIONES
    expect(result.userStateCleanup).toBe(true); // userState siempre se limpia
    expect(result.sessionCleanup).toBe(false); // session mantenido como fallback
    expect(mockCtx.userState.pdfAnalysis).toBeUndefined();
    expect(mockCtx.session.pdfAnalysis).toBeDefined(); // Fallback para recuperación

    console.log('✅ EDGE CASE: PDF reciente manejado correctamente');
  });

  test('PERFORMANCE: Medir impacto en operaciones DB simuladas', () => {
    console.log('⚡ PERFORMANCE: Medir impacto en operaciones DB');
    
    // Simular diferentes tamaños de userState
    const scenarios = [
      { name: 'Con pdfAnalysis pesado', userState: { 
        tenantId: 'test', 
        pdfAnalysis: { 
          analysis: new Array(100).fill('datos pesados'), 
          timestamp: Date.now() 
        } 
      }},
      { name: 'Sin pdfAnalysis', userState: { 
        tenantId: 'test' 
      }}
    ];

    const results = scenarios.map(scenario => {
      const data = JSON.stringify(scenario.userState);
      const size = data.length;
      
      // Simular tiempo de serialización/deserialización
      const startTime = Date.now();
      for (let i = 0; i < 1000; i++) {
        JSON.parse(data);
      }
      const duration = Date.now() - startTime;
      
      console.log(`📊 ${scenario.name}: ${size} bytes, ${duration}ms para 1000 ops`);
      
      return { name: scenario.name, size, duration };
    });

    const improvement = Math.round(results[1].duration / results[0].duration * 100) - 100;
    const sizeReduction = Math.round((1 - results[1].size / results[0].size) * 100);

    console.log(`🚀 MEJORA PERFORMANCE: ${Math.abs(improvement)}% más rápido`);
    console.log(`📦 REDUCCIÓN TAMAÑO: ${sizeReduction}%`);

    expect(results[1].duration).toBeLessThan(results[0].duration);
    expect(results[1].size).toBeLessThan(results[0].size);

    console.log('✅ PERFORMANCE: Mejora confirmada en operaciones de serialización');
  });
});