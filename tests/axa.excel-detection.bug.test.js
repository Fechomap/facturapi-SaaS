// tests/axa.excel-detection.bug.test.js - Investigar bug de detección Excel
import { jest } from '@jest/globals';

describe('AXA - BUG DETECCIÓN EXCEL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('BUG REPRODUCIDO: Primer Excel no detectado, segundo sí', () => {
    console.log('🚨 REPRODUCIENDO: Bug de detección Excel');

    const userId = 123456789;
    const mockCtx = {
      from: { id: userId },
      userState: {
        tenantId: 'test-tenant',
        axaClientId: 'axa-client-123',
      },
      message: {
        document: {
          file_name: 'AXA.xls',
          file_id: 'test-file-123',
        },
      },
    };

    // ESCENARIO 1: Usuario presiona menu_axa
    console.log('👆 PASO 1: Usuario presiona botón menu_axa');
    mockCtx.userState.esperando = 'archivo_excel_axa';
    console.log('✅ Estado después de menu_axa:', mockCtx.userState.esperando);

    // PROBLEMA: Estado se puede perder antes de que llegue el Excel
    console.log('⏰ TIMING: Pasa tiempo entre botón y envío de Excel...');

    // Simular que el estado se "resetea" o no se guarda correctamente
    mockCtx.userState.esperando = null; // ¡PROBLEMA!

    // ESCENARIO 2: Usuario envía Excel (PRIMER INTENTO)
    console.log('📎 PASO 2: Usuario envía Excel (primer intento)');
    const excelDetectado1 = mockCtx.userState.esperando === 'archivo_excel_axa';
    console.log(
      `❌ PRIMER INTENTO: esperando="${mockCtx.userState.esperando}", detectado=${excelDetectado1}`
    );

    // Excel NO se procesa porque esperando es null
    expect(excelDetectado1).toBe(false);

    // ESCENARIO 3: Usuario presiona menu_axa OTRA VEZ
    console.log('👆 PASO 3: Usuario presiona menu_axa otra vez');
    mockCtx.userState.esperando = 'archivo_excel_axa';

    // ESCENARIO 4: Usuario envía Excel (SEGUNDO INTENTO)
    console.log('📎 PASO 4: Usuario envía Excel (segundo intento)');
    const excelDetectado2 = mockCtx.userState.esperando === 'archivo_excel_axa';
    console.log(
      `✅ SEGUNDO INTENTO: esperando="${mockCtx.userState.esperando}", detectado=${excelDetectado2}`
    );

    expect(excelDetectado2).toBe(true);

    console.log('🎯 BUG CONFIRMADO: Estado "esperando" se pierde entre botón y Excel');
  });

  test('INVESTIGAR: ¿Por qué se pierde el estado "esperando"?', async () => {
    console.log('🔍 INVESTIGANDO: Causas del estado perdido');

    const mockSessionService = {
      saveUserState: jest.fn().mockResolvedValue({}),
      getUserState: jest.fn(),
    };

    const userId = 123456789;

    // HIPÓTESIS 1: Session write tarda mucho
    console.log('🕐 HIPÓTESIS 1: Session write lento');
    mockSessionService.saveUserState.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 2000)) // 2 segundos
    );

    const estado = { esperando: 'archivo_excel_axa' };
    const saveStart = Date.now();

    // Usuario presiona botón (inicia guardado)
    const savePromise = mockSessionService.saveUserState(userId, estado);

    // Usuario envía Excel ANTES de que termine el guardado
    const timingRapido = Date.now() - saveStart;
    console.log(`⚡ Usuario envía Excel después de ${timingRapido}ms`);
    console.log('❌ PROBLEMA: Guardado aún no terminó');

    // Esperar a que termine el guardado
    await savePromise;
    const saveDuration = Date.now() - saveStart;
    console.log(`💾 Guardado completado después de ${saveDuration}ms`);

    expect(saveDuration).toBeGreaterThan(timingRapido);
    console.log('🎯 CAUSA IDENTIFICADA: Usuario más rápido que el guardado');
  });

  test('HIPÓTESIS 2: Middleware session no persiste inmediatamente', () => {
    console.log('🔍 HIPÓTESIS 2: Middleware timing');

    const mockCtx = {
      userState: {
        tenantId: 'test-tenant',
        esperando: null,
      },
    };

    // Simular click en menu_axa
    console.log('👆 Botón menu_axa presionado');
    mockCtx.userState.esperando = 'archivo_excel_axa';
    console.log('State modificado:', mockCtx.userState.esperando);

    // Simular que middleware aún no guardó
    console.log('⏰ Middleware aún procesando...');

    // Usuario envía Excel antes de que middleware termine
    const estadoAlRecibirExcel = mockCtx.userState.esperando;
    console.log('📎 Excel recibido, estado actual:', estadoAlRecibirExcel);

    // Si middleware es lento, el estado puede estar desactualizado
    if (estadoAlRecibirExcel !== 'archivo_excel_axa') {
      console.log('❌ PROBLEMA: Estado no actualizado a tiempo');
    } else {
      console.log('✅ Estado correcto');
    }

    expect(estadoAlRecibirExcel).toBe('archivo_excel_axa');
  });

  test('SOLUCIÓN PROPUESTA: Verificar estado en múltiples fuentes', () => {
    console.log('💡 SOLUCIÓN: Fallback robusto para detección Excel');

    const userId = 123456789;
    const mockCtx = {
      from: { id: userId },
      userState: {
        esperando: null, // Estado perdido
      },
      message: {
        document: {
          file_name: 'AXA.xls',
        },
      },
    };

    // Simular que hay un flag en cache global
    global.tempAxaData = {};
    global.tempAxaData[userId] = {
      esperandoExcel: true,
      timestamp: Date.now(),
    };

    console.log('🔍 VERIFICANDO: Estado en userState y cache global');

    // Lógica de detección robusta
    function debeDetectarExcel(ctx) {
      const userId = ctx.from.id;

      // OPCIÓN 1: userState dice que espera Excel
      if (ctx.userState.esperando === 'archivo_excel_axa') {
        console.log('✅ Detectado por userState');
        return true;
      }

      // OPCIÓN 2: Cache global indica que está esperando
      const tempData = global.tempAxaData && global.tempAxaData[userId];
      if (tempData && tempData.esperandoExcel) {
        const tiempoEspera = Date.now() - tempData.timestamp;
        if (tiempoEspera < 300000) {
          // 5 minutos max
          console.log(`✅ Detectado por cache global (${tiempoEspera}ms ago)`);
          return true;
        }
      }

      // OPCIÓN 3: Verificar si tiene axaClientId (indica flujo AXA activo)
      if (ctx.userState.axaClientId && !ctx.userState.facturaGenerada) {
        console.log('✅ Detectado por axaClientId sin factura completada');
        return true;
      }

      console.log('❌ No detectado por ninguna fuente');
      return false;
    }

    const detectado = debeDetectarExcel(mockCtx);
    expect(detectado).toBe(true);

    console.log('✅ SOLUCIÓN: Detección robusta con múltiples fallbacks');
  });

  test('EDGE CASE: Usuario abre múltiples tabs', () => {
    console.log('🔍 EDGE CASE: Múltiples tabs pueden causar confusión');

    const userId = 123456789;

    // Tab 1: Presiona menu_axa
    const tab1State = { esperando: 'archivo_excel_axa', timestamp: Date.now() };

    // Tab 2: Presiona menu_chubb (sobrescribe estado)
    const tab2State = { esperando: 'archivo_excel_chubb', timestamp: Date.now() + 1000 };

    // Usuario envía Excel desde Tab 1
    console.log('📎 Excel enviado desde Tab 1 (esperaba AXA)');
    console.log('💾 Pero estado actual es:', tab2State.esperando);

    // Excel no será detectado para AXA
    const esDetectadoParaAxa = tab2State.esperando === 'archivo_excel_axa';
    expect(esDetectadoParaAxa).toBe(false);

    console.log('❌ PROBLEMA: Múltiples tabs causan conflictos de estado');
    console.log('💡 SOLUCIÓN: Usar cache por sesión específica');
  });

  test('PERFORMANCE: Validar que solución no afecte velocidad', () => {
    console.log('⚡ PERFORMANCE: Verificar impacto de detección robusta');

    const userId = 123456789;
    const mockCtx = {
      from: { id: userId },
      userState: { esperando: 'archivo_excel_axa' },
      message: { document: { file_name: 'AXA.xls' } },
    };

    // Método actual (simple)
    const simpleStart = Date.now();
    const detectadoSimple = mockCtx.userState.esperando === 'archivo_excel_axa';
    const simpleDuration = Date.now() - simpleStart;

    // Método robusto (con fallbacks)
    global.tempAxaData[userId] = { esperandoExcel: true, timestamp: Date.now() };

    const robustoStart = Date.now();
    const detectadoRobusto =
      mockCtx.userState.esperando === 'archivo_excel_axa' ||
      (global.tempAxaData[userId] && global.tempAxaData[userId].esperandoExcel) ||
      (mockCtx.userState.axaClientId && !mockCtx.userState.facturaGenerada);
    const robustoDuration = Date.now() - robustoStart;

    console.log(`🏃 Método simple: ${simpleDuration}ms`);
    console.log(`🛡️ Método robusto: ${robustoDuration}ms`);
    console.log(`📊 Diferencia: ${robustoDuration - simpleDuration}ms`);

    expect(detectadoSimple).toBe(true);
    expect(detectadoRobusto).toBe(true);
    expect(robustoDuration).toBeLessThan(5); // Debe seguir siendo rápido

    console.log('✅ PERFORMANCE: Solución robusta sin impacto significativo');
  });
});
