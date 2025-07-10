// tests/excel-detection.unified.test.js - Validar solución unified AXA + CHUBB
import { jest } from '@jest/globals';
import { debeDetectarExcel, setEsperandoExcelFlag, clearEsperandoExcelFlag, esArchivoExcelValido } from '../core/utils/excel-detection.utils.js';

describe('SOLUCIÓN UNIFIED: Excel Detection Bug Fix', () => {

  beforeEach(() => {
    global.tempAxaData = {};
    global.tempChubbData = {};
    jest.clearAllMocks();
  });

  test('BUG FIX: AXA Excel detection con fallbacks robustos', () => {
    console.log('🔍 PROBANDO: AXA con detección robusta');
    
    const userId = 123456789;
    const mockCtx = {
      from: { id: userId },
      userState: {
        tenantId: 'test-tenant',
        axaClientId: 'axa-client-123',
        esperando: null // Estado perdido
      },
      message: {
        document: {
          file_name: 'AXA.xlsx',
          file_id: 'test-file-123'
        }
      }
    };

    // ESCENARIO: Usuario presiona menu_axa
    console.log('👆 PASO 1: Usuario presiona menu_axa');
    setEsperandoExcelFlag(userId, 'axa', 'axa-client-123');

    // Simular que userState se pierde (timing issue)
    mockCtx.userState.esperando = null;
    console.log('⏰ PROBLEMA: Estado perdido en userState');

    // VALIDAR: Debe detectar por cache global
    const detectadoAxa = debeDetectarExcel(mockCtx, 'axa');
    expect(detectadoAxa).toBe(true);
    console.log('✅ AXA: Detectado por cache global fallback');

    // VALIDAR: Excel válido
    const excelValido = esArchivoExcelValido(mockCtx.message.document);
    expect(excelValido).toBe(true);
    console.log('✅ AXA: Archivo Excel válido');

    // LIMPIAR después del procesamiento (simular finalización completa)
    clearEsperandoExcelFlag(userId, 'axa');
    mockCtx.userState.facturaGenerada = true; // Marcar procesamiento completado
    const detectadoDespues = debeDetectarExcel(mockCtx, 'axa');
    expect(detectadoDespues).toBe(false);
    console.log('🧹 AXA: Flag limpiado correctamente');
  });

  test('BUG FIX: CHUBB Excel detection con fallbacks robustos', () => {
    console.log('🔍 PROBANDO: CHUBB con detección robusta');
    
    const userId = 987654321;
    const mockCtx = {
      from: { id: userId },
      userState: {
        tenantId: 'test-tenant',
        chubbClientId: 'chubb-client-456',
        esperando: null // Estado perdido
      },
      message: {
        document: {
          file_name: 'CHUBB.xls',
          file_id: 'test-file-456'
        }
      }
    };

    // ESCENARIO: Usuario presiona menu_chubb
    console.log('👆 PASO 1: Usuario presiona menu_chubb');
    setEsperandoExcelFlag(userId, 'chubb', 'chubb-client-456');

    // Simular que userState se pierde (timing issue)
    mockCtx.userState.esperando = null;
    console.log('⏰ PROBLEMA: Estado perdido en userState');

    // VALIDAR: Debe detectar por cache global
    const detectadoChubb = debeDetectarExcel(mockCtx, 'chubb');
    expect(detectadoChubb).toBe(true);
    console.log('✅ CHUBB: Detectado por cache global fallback');

    // VALIDAR: Excel válido
    const excelValido = esArchivoExcelValido(mockCtx.message.document);
    expect(excelValido).toBe(true);
    console.log('✅ CHUBB: Archivo Excel válido');

    // LIMPIAR después del procesamiento (simular finalización completa)
    clearEsperandoExcelFlag(userId, 'chubb');
    mockCtx.userState.facturaGenerada = true; // Marcar procesamiento completado
    const detectadoDespues = debeDetectarExcel(mockCtx, 'chubb');
    expect(detectadoDespues).toBe(false);
    console.log('🧹 CHUBB: Flag limpiado correctamente');
  });

  test('EDGE CASE: Múltiples usuarios simultáneos no se interfieren', () => {
    console.log('🔍 PROBANDO: Múltiples usuarios simultáneos');
    
    const usuario1 = 111111111;
    const usuario2 = 222222222;
    
    const ctx1 = {
      from: { id: usuario1 },
      userState: { esperando: null, axaClientId: 'axa-1' }
    };
    
    const ctx2 = {
      from: { id: usuario2 },
      userState: { esperando: null, chubbClientId: 'chubb-2' }
    };

    // Usuario 1 presiona AXA
    setEsperandoExcelFlag(usuario1, 'axa', 'axa-1');
    console.log('👤 Usuario 1: Activó AXA');
    
    // Usuario 2 presiona CHUBB
    setEsperandoExcelFlag(usuario2, 'chubb', 'chubb-2');
    console.log('👤 Usuario 2: Activó CHUBB');

    // Verificar que no se interfieren
    const usuario1Axa = debeDetectarExcel(ctx1, 'axa');
    const usuario1Chubb = debeDetectarExcel(ctx1, 'chubb');
    const usuario2Axa = debeDetectarExcel(ctx2, 'axa');
    const usuario2Chubb = debeDetectarExcel(ctx2, 'chubb');

    expect(usuario1Axa).toBe(true);   // Usuario 1 debe detectar AXA
    expect(usuario1Chubb).toBe(false); // Usuario 1 NO debe detectar CHUBB
    expect(usuario2Axa).toBe(false);   // Usuario 2 NO debe detectar AXA
    expect(usuario2Chubb).toBe(true);  // Usuario 2 debe detectar CHUBB

    console.log('✅ AISLAMIENTO: Usuarios no se interfieren');
  });

  test('TTL CLEANUP: Flags expirados se ignoran correctamente', () => {
    console.log('🔍 PROBANDO: TTL cleanup de flags');
    
    const userId = 555555555;
    const mockCtx = {
      from: { id: userId },
      userState: { esperando: null, axaClientId: 'axa-test', facturaGenerada: true }
    };

    // Establecer flag con timestamp viejo (simulando expiración)
    global.tempAxaData[userId] = {
      esperandoExcel: true,
      timestamp: Date.now() - (6 * 60 * 1000), // 6 minutos atrás (expirado)
      clientId: 'axa-test'
    };

    console.log('⏰ Flag establecido hace 6 minutos (expirado)');

    // Debe detectar que está expirado
    const detectado = debeDetectarExcel(mockCtx, 'axa');
    expect(detectado).toBe(false);
    console.log('✅ TTL: Flag expirado ignorado correctamente');

    // Establecer flag reciente Y quitar facturaGenerada para simular flujo activo
    global.tempAxaData[userId].timestamp = Date.now();
    mockCtx.userState.facturaGenerada = false; // Simular flujo activo
    console.log('🔄 Flag renovado con timestamp actual y flujo activo');

    const detectadoRenovado = debeDetectarExcel(mockCtx, 'axa');
    expect(detectadoRenovado).toBe(true);
    console.log('✅ TTL: Flag reciente detectado correctamente');
  });

  test('VALIDACIÓN: Archivos no-Excel rechazados correctamente', () => {
    console.log('🔍 PROBANDO: Validación de archivos no-Excel');
    
    const archivosTest = [
      { file_name: 'documento.pdf', esperado: false },
      { file_name: 'imagen.jpg', esperado: false },
      { file_name: 'data.csv', esperado: false },
      { file_name: 'archivo.txt', esperado: false },
      { file_name: 'datos.xlsx', esperado: true },
      { file_name: 'reporte.xls', esperado: true },
      { file_name: 'MAYUSCULAS.XLSX', esperado: true },
      { file_name: null, esperado: false },
      { file_name: undefined, esperado: false }
    ];

    archivosTest.forEach(({ file_name, esperado }) => {
      const documento = file_name ? { file_name } : null;
      const resultado = esArchivoExcelValido(documento);
      
      expect(resultado).toBe(esperado);
      console.log(`${esperado ? '✅' : '❌'} ${file_name || 'null'}: ${resultado}`);
    });

    console.log('✅ VALIDACIÓN: Archivos filtrados correctamente');
  });

  test('PERFORMANCE: Detección robusta mantiene velocidad', () => {
    console.log('🔍 PROBANDO: Performance de detección robusta');
    
    const userId = 777777777;
    const mockCtx = {
      from: { id: userId },
      userState: {
        esperando: 'archivo_excel_axa',
        axaClientId: 'axa-performance'
      }
    };

    // Llenar cache con muchos usuarios para simular carga
    for (let i = 0; i < 1000; i++) {
      global.tempAxaData[i] = {
        esperandoExcel: true,
        timestamp: Date.now(),
        clientId: `test-${i}`
      };
    }

    console.log('📊 Cache poblado con 1000 usuarios');

    // Medir tiempo de detección
    const iterations = 100;
    const startTime = Date.now();
    
    for (let i = 0; i < iterations; i++) {
      debeDetectarExcel(mockCtx, 'axa');
    }
    
    const totalTime = Date.now() - startTime;
    const avgTime = totalTime / iterations;

    console.log(`⚡ ${iterations} detecciones en ${totalTime}ms`);
    console.log(`📊 Promedio: ${avgTime.toFixed(2)}ms por detección`);

    // Debe ser rápido incluso con cache poblado
    expect(avgTime).toBeLessThan(1); // Menos de 1ms promedio
    console.log('✅ PERFORMANCE: Detección robusta mantiene velocidad');
  });

  test('INTEGRACIÓN: Flujo completo AXA y CHUBB', () => {
    console.log('🔍 PROBANDO: Flujo completo integrado');
    
    const userId = 888888888;
    
    // FASE 1: Usuario usa AXA
    const ctxAxa = {
      from: { id: userId },
      userState: { 
        esperando: null,
        axaClientId: 'axa-integration'
      },
      message: {
        document: { file_name: 'axa_data.xlsx' }
      }
    };

    // Simular click en menu_axa
    setEsperandoExcelFlag(userId, 'axa', 'axa-integration');
    ctxAxa.userState.esperando = 'archivo_excel_axa';
    
    // Validar que AXA funciona
    expect(debeDetectarExcel(ctxAxa, 'axa')).toBe(true);
    expect(esArchivoExcelValido(ctxAxa.message.document)).toBe(true);
    console.log('✅ FASE 1: AXA funcionando');

    // Simular procesamiento completo AXA
    clearEsperandoExcelFlag(userId, 'axa');
    ctxAxa.userState.esperando = null;
    ctxAxa.userState.facturaGenerada = true;
    
    // FASE 2: Mismo usuario usa CHUBB
    const ctxChubb = {
      from: { id: userId },
      userState: { 
        esperando: null,
        chubbClientId: 'chubb-integration'
      },
      message: {
        document: { file_name: 'chubb_data.xls' }
      }
    };

    // Simular click en menu_chubb
    setEsperandoExcelFlag(userId, 'chubb', 'chubb-integration');
    ctxChubb.userState.esperando = 'archivo_excel_chubb';
    
    // Validar que CHUBB funciona
    expect(debeDetectarExcel(ctxChubb, 'chubb')).toBe(true);
    expect(esArchivoExcelValido(ctxChubb.message.document)).toBe(true);
    console.log('✅ FASE 2: CHUBB funcionando');

    // Validar que no hay interferencia entre AXA y CHUBB
    expect(debeDetectarExcel(ctxChubb, 'axa')).toBe(false);
    expect(debeDetectarExcel(ctxAxa, 'chubb')).toBe(false);
    console.log('✅ INTEGRACIÓN: AXA y CHUBB funcionan independientemente');

    // Cleanup final
    clearEsperandoExcelFlag(userId, 'chubb');
    ctxChubb.userState.facturaGenerada = true;
  });
});