// tests/excel-detection.simple.test.js - Test simple del fix del bug de Excel
import { jest } from '@jest/globals';
import { debeDetectarExcel, esArchivoExcelValido } from '../core/utils/excel-detection.utils.js';

describe('Excel Detection - Solución SIMPLE', () => {
  test('CASO 1: Estado esperando funciona (método original)', () => {
    const mockCtx = {
      userState: {
        esperando: 'archivo_excel_axa',
        axaClientId: 'axa-123',
      },
    };

    const detectado = debeDetectarExcel(mockCtx, 'axa');
    expect(detectado).toBe(true);
    console.log('✅ CASO 1: Estado esperando detectado correctamente');
  });

  test('CASO 2: Flujo activo sin esperando funciona (fix para bug)', () => {
    const mockCtx = {
      userState: {
        esperando: null, // PROBLEMA: estado perdido
        axaClientId: 'axa-123', // PERO: flujo activo
        facturaGenerada: false,
      },
    };

    const detectado = debeDetectarExcel(mockCtx, 'axa');
    expect(detectado).toBe(true);
    console.log('✅ CASO 2: Flujo activo detectado como fallback');
  });

  test('CASO 3: Sin estado ni flujo activo, no detecta', () => {
    const mockCtx = {
      userState: {
        esperando: null,
        facturaGenerada: true, // Procesamiento completado
      },
    };

    const detectado = debeDetectarExcel(mockCtx, 'axa');
    expect(detectado).toBe(false);
    console.log('✅ CASO 3: Correctamente no detecta cuando no debe');
  });

  test('CASO 4: CHUBB funciona igual que AXA', () => {
    const mockCtxChubb = {
      userState: {
        esperando: null,
        chubbClientId: 'chubb-456',
        facturaGenerada: false,
      },
    };

    const detectado = debeDetectarExcel(mockCtxChubb, 'chubb');
    expect(detectado).toBe(true);
    console.log('✅ CASO 4: CHUBB funciona igual que AXA');
  });

  test('CASO 5: Validación Excel funciona', () => {
    const archivos = [
      { file_name: 'datos.xlsx', esperado: true },
      { file_name: 'reporte.xls', esperado: true },
      { file_name: 'documento.pdf', esperado: false },
      { file_name: null, esperado: false },
    ];

    archivos.forEach(({ file_name, esperado }) => {
      const documento = file_name ? { file_name } : null;
      const resultado = esArchivoExcelValido(documento);
      expect(resultado).toBe(esperado);
    });

    console.log('✅ CASO 5: Validación Excel funciona correctamente');
  });

  test('BUG SCENARIO: Reproducer el problema original', () => {
    console.log('🚨 SIMULANDO: Problema original del usuario');

    // ANTES del fix: solo verificaba esperando
    function deteccionAntigua(ctx, tipoCliente) {
      return ctx.userState?.esperando === `archivo_excel_${tipoCliente}`;
    }

    // DESPUÉS del fix: verifica esperando O flujo activo
    function deteccionNueva(ctx, tipoCliente) {
      const esperandoValue = `archivo_excel_${tipoCliente}`;
      const clientIdField = `${tipoCliente}ClientId`;

      const estaEsperando = ctx.userState?.esperando === esperandoValue;
      const flujoActivo = ctx.userState?.[clientIdField] && !ctx.userState?.facturaGenerada;

      return estaEsperando || flujoActivo;
    }

    const mockCtx = {
      userState: {
        esperando: null, // Estado perdido por timing
        axaClientId: 'axa-789',
        facturaGenerada: false,
      },
    };

    // ANTES: no detectaba (BUG)
    const antiguoResultado = deteccionAntigua(mockCtx, 'axa');
    expect(antiguoResultado).toBe(false);
    console.log('❌ ANTES: No detectaba Excel (bug confirmado)');

    // DESPUÉS: sí detecta (FIX)
    const nuevoResultado = deteccionNueva(mockCtx, 'axa');
    expect(nuevoResultado).toBe(true);
    console.log('✅ DESPUÉS: Sí detecta Excel (bug solucionado)');

    // Verificar que nuestra función actual funciona igual
    const nuestraFuncion = debeDetectarExcel(mockCtx, 'axa');
    expect(nuestraFuncion).toBe(true);
    console.log('✅ CONFIRMADO: Nuestra función soluciona el bug');
  });
});
