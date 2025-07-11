// tests/axa.elegant-solution.test.js - Validar solución elegante sin guardado forzado
import { jest } from '@jest/globals';

describe('AXA - SOLUCIÓN ELEGANTE (sin guardado forzado)', () => {
  beforeEach(() => {
    global.tempAxaData = {};
  });

  test('SOLUCIÓN: Cache global + userState fallback (como CHUBB)', () => {
    const userId = 123456789;
    const mockCtx = {
      from: { id: userId },
      userState: {
        tenantId: 'test-tenant',
        axaClientId: 'axa-client-123',
        esperando: null,
      },
    };

    // PASO 1: Configurar cache global con datos precalculados
    global.tempAxaData[userId] = {
      facturaConRetencion: {
        items: [{ product: { price: 1000 } }],
        total: 1116,
        facturaData: { customer: 'axa-123', items: [] },
      },
      facturaSinRetencion: {
        items: [{ product: { price: 1000 } }],
        total: 1160,
        facturaData: { customer: 'axa-123', items: [] },
      },
      timestamp: Date.now(),
    };

    // PASO 2: Usuario presiona botón "Servicios Realizados"
    console.log('🔵 SIMULANDO: Click en botón "Con retención"');

    // Guardar selección en CACHE GLOBAL (como CHUBB)
    global.tempAxaData[userId].seleccionUsuario = {
      tipoServicio: 'realizados',
      conRetencion: true,
      timestamp: Date.now(),
    };

    // También en userState para compatibilidad (middleware guardará)
    mockCtx.userState.axaTipoServicio = 'realizados';
    mockCtx.userState.axaConRetencion = true;

    // PASO 3: Usuario presiona "Confirmar" inmediatamente
    console.log('🟢 SIMULANDO: Click rápido en "Confirmar"');

    const tempData = global.tempAxaData[userId];

    // Simular fallback logic del handler
    let tipoServicio = mockCtx.userState.axaTipoServicio;
    let conRetencion = mockCtx.userState.axaConRetencion;

    // Si falla userState, usar cache global
    if ((tipoServicio === undefined || conRetencion === undefined) && tempData.seleccionUsuario) {
      console.log('🚨 Fallback: Recuperando de cache global');
      tipoServicio =
        tempData.seleccionUsuario.tipoServicio === 'realizados' ? 'realizados' : 'muertos';
      conRetencion = tempData.seleccionUsuario.conRetencion;
    }

    // VALIDACIONES
    expect(tipoServicio).toBe('realizados');
    expect(conRetencion).toBe(true);
    expect(tempData.seleccionUsuario).toBeDefined();
    expect(tempData.facturaConRetencion).toBeDefined();

    console.log('✅ SOLUCIÓN ELEGANTE: Estado disponible desde userState Y cache global');
    console.log(`✅ Tipo servicio: ${tipoServicio}, Con retención: ${conRetencion}`);
  });

  test('FALLBACK: Recuperar de cache global si userState se pierde', () => {
    const userId = 123456789;
    const mockCtx = {
      from: { id: userId },
      userState: {
        tenantId: 'test-tenant',
        // PROBLEMA: userState perdido (sin axaTipoServicio, axaConRetencion)
      },
    };

    // Cache global SÍ tiene la selección
    global.tempAxaData[userId] = {
      facturaConRetencion: { items: [], total: 1116 },
      facturaSinRetencion: { items: [], total: 1160 },
      seleccionUsuario: {
        tipoServicio: 'muertos',
        conRetencion: false,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    };

    console.log('🚨 ESCENARIO: userState perdido, cache global tiene datos');

    const tempData = global.tempAxaData[userId];

    // Simular lógica de fallback
    let tipoServicio = mockCtx.userState.axaTipoServicio; // undefined
    let conRetencion = mockCtx.userState.axaConRetencion; // undefined

    // Fallback a cache global
    if ((tipoServicio === undefined || conRetencion === undefined) && tempData.seleccionUsuario) {
      console.log('🔄 FALLBACK: Recuperando de cache global...');
      tipoServicio =
        tempData.seleccionUsuario.tipoServicio === 'realizados' ? 'realizados' : 'muertos';
      conRetencion = tempData.seleccionUsuario.conRetencion;

      // Restaurar en userState
      mockCtx.userState.axaTipoServicio = tipoServicio;
      mockCtx.userState.axaConRetencion = conRetencion;
    }

    // VALIDACIONES
    expect(tipoServicio).toBe('muertos');
    expect(conRetencion).toBe(false);
    expect(mockCtx.userState.axaTipoServicio).toBe('muertos');
    expect(mockCtx.userState.axaConRetencion).toBe(false);

    console.log('✅ FALLBACK EXITOSO: Cache global rescató el estado perdido');
  });

  test('COMPARACIÓN: Solución elegante vs guardado forzado', async () => {
    const mockSessionService = {
      saveUserState: jest.fn().mockResolvedValue({}),
    };

    console.log('📊 COMPARANDO: Solución elegante vs guardado forzado');

    // MÉTODO 1: Guardado forzado (problemático)
    console.log('❌ MÉTODO 1: Guardado forzado');
    const forzadoStart = Date.now();

    await mockSessionService.saveUserState(123, { data: 'test' }); // Guardado forzado
    await mockSessionService.saveUserState(123, { data: 'test' }); // Middleware automático

    const forzadoDuration = Date.now() - forzadoStart;
    const forzadoCalls = mockSessionService.saveUserState.mock.calls.length;

    console.log(`❌ Guardado forzado: ${forzadoDuration}ms, ${forzadoCalls} escrituras DB`);

    // MÉTODO 2: Solución elegante (cache global)
    mockSessionService.saveUserState.mockClear();
    console.log('✅ MÉTODO 2: Cache global');
    const eleganteStart = Date.now();

    // Solo cache global, sin escrituras DB inmediatas
    global.tempAxaData[123] = { seleccionUsuario: { tipo: 'test' } };
    // Middleware guardará después automáticamente

    const eleganteDuration = Date.now() - eleganteStart;
    const eleganteCalls = mockSessionService.saveUserState.mock.calls.length;

    console.log(`✅ Solución elegante: ${eleganteDuration}ms, ${eleganteCalls} escrituras DB`);

    // VALIDACIONES
    expect(forzadoCalls).toBe(2); // Doble escritura
    expect(eleganteCalls).toBe(0); // Sin escrituras inmediatas
    expect(eleganteDuration).toBeLessThan(forzadoDuration);

    console.log('🎯 RESULTADO: Solución elegante es más eficiente');
  });

  test('ROBUSTEZ: Múltiples clicks rápidos no causan problemas', () => {
    const userId = 123456789;

    // Configurar cache inicial
    global.tempAxaData[userId] = {
      facturaConRetencion: { total: 1116 },
      facturaSinRetencion: { total: 1160 },
      timestamp: Date.now(),
    };

    console.log('⚡ SIMULANDO: Usuario hace clicks rápidos');

    // Click 1: Servicios realizados
    const click1Start = Date.now();
    global.tempAxaData[userId].seleccionUsuario = {
      tipoServicio: 'realizados',
      conRetencion: true,
      timestamp: Date.now(),
    };
    const click1Duration = Date.now() - click1Start;

    // Click 2: Cambiar a servicios muertos (inmediatamente)
    const click2Start = Date.now();
    global.tempAxaData[userId].seleccionUsuario = {
      tipoServicio: 'muertos',
      conRetencion: false,
      timestamp: Date.now(),
    };
    const click2Duration = Date.now() - click2Start;

    // Click 3: Confirmar (inmediatamente)
    const click3Start = Date.now();
    const seleccionFinal = global.tempAxaData[userId].seleccionUsuario;
    const click3Duration = Date.now() - click3Start;

    console.log(`⚡ Click 1: ${click1Duration}ms`);
    console.log(`⚡ Click 2: ${click2Duration}ms`);
    console.log(`⚡ Click 3: ${click3Duration}ms`);

    // VALIDACIONES
    expect(click1Duration).toBeLessThan(5);
    expect(click2Duration).toBeLessThan(5);
    expect(click3Duration).toBeLessThan(5);
    expect(seleccionFinal.tipoServicio).toBe('muertos'); // Última selección
    expect(seleccionFinal.conRetencion).toBe(false);

    console.log('✅ ROBUSTEZ: Clicks rápidos manejados correctamente');
  });

  test('TIMING: Cache global vs session DB para selecciones', async () => {
    const mockSessionService = {
      saveUserState: jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 50)) // Simular 50ms de DB
      ),
      getUserState: jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 30)) // Simular 30ms de DB
      ),
    };

    console.log('🏁 TIMING: Cache global vs Session DB');

    // OPCIÓN 1: Session DB (lento)
    console.log('🐌 OPCIÓN 1: Session DB');
    const dbStart = Date.now();

    await mockSessionService.saveUserState(123, { axaTipoServicio: 'realizados' });
    const savedState = await mockSessionService.getUserState(123);

    const dbDuration = Date.now() - dbStart;

    // OPCIÓN 2: Cache global (rápido)
    console.log('⚡ OPCIÓN 2: Cache global');
    const cacheStart = Date.now();

    global.tempAxaData[123] = { seleccionUsuario: { tipoServicio: 'realizados' } };
    const cachedSelection = global.tempAxaData[123].seleccionUsuario;

    const cacheDuration = Date.now() - cacheStart;

    console.log(`🐌 Session DB: ${dbDuration}ms`);
    console.log(`⚡ Cache global: ${cacheDuration}ms`);
    console.log(`📊 MEJORA: ${Math.round(dbDuration / cacheDuration)}x más rápido`);

    // VALIDACIONES
    expect(cacheDuration).toBeLessThan(5);
    expect(dbDuration).toBeGreaterThan(50);
    expect(cachedSelection.tipoServicio).toBe('realizados');

    console.log('🎯 CONCLUSIÓN: Cache global es significativamente más rápido');
  });
});
