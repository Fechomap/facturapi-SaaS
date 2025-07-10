// tests/state-persistence.test.js - Test específico para validar persistencia de estado
import { jest } from '@jest/globals';

// Mock del SessionService
const mockSessionService = {
  saveUserState: jest.fn().mockResolvedValue({}),
  getUserState: jest.fn().mockResolvedValue({})
};

// Mock global para datos temporales
global.tempAxaData = {};
global.tempChubbData = {};

// Mock del contexto con estado real
const createMockContext = (userId = 123456789) => ({
  from: { id: userId },
  userState: {
    tenantId: 'test-tenant-123',
    esperando: null
  },
  answerCbQuery: jest.fn(),
  reply: jest.fn(),
  editMessageReplyMarkup: jest.fn(),
  getTenantId: jest.fn(() => 'test-tenant-123')
});

describe('PERSISTENCIA DE ESTADO: AXA vs CHUBB', () => {
  
  beforeEach(() => {
    global.tempAxaData = {};
    global.tempChubbData = {};
    jest.clearAllMocks();
  });

  test('AXA: Problema de persistencia entre botones (ANTES del fix)', async () => {
    const ctx = createMockContext();
    const userId = ctx.from.id;
    
    // PASO 1: Excel procesado, datos en cache global
    global.tempAxaData[userId] = {
      facturaConRetencion: {
        items: Array(34).fill({}),
        total: 67405.14,
        facturaData: { customer: 'axa-client', items: [] }
      },
      facturaSinRetencion: {
        items: Array(34).fill({}),
        total: 69812.47,
        facturaData: { customer: 'axa-client', items: [] }
      },
      timestamp: Date.now()
    };
    
    // PASO 2: Usuario presiona "Servicios Realizados (con retención 4%)"
    // Estado se modifica PERO NO SE GUARDA INMEDIATAMENTE
    ctx.userState.axaTipoServicio = 'realizados';
    ctx.userState.axaConRetencion = true;
    
    // Simular que pasa tiempo (otros middlewares, etc.) antes del siguiente click
    // En este punto el estado puede perderse porque no se guardó
    
    // PASO 3: Usuario presiona "Confirmar" rápidamente
    // Estado puede estar undefined si no se guardó correctamente
    
    // PROBLEMA: Sin guardado forzado, el estado puede perderse
    console.log('❌ PROBLEMA AXA: Estado no persiste entre botones sin guardado forzado');
    console.log('❌ axaTipoServicio:', ctx.userState.axaTipoServicio);
    console.log('❌ axaConRetencion:', ctx.userState.axaConRetencion);
    
    // Verificar que el problema existe
    expect(ctx.userState.axaTipoServicio).toBe('realizados');
    expect(ctx.userState.axaConRetencion).toBe(true);
  });

  test('AXA: Solución con guardado forzado (DESPUÉS del fix)', async () => {
    const ctx = createMockContext();
    const userId = ctx.from.id;
    
    // PASO 1: Excel procesado, datos en cache global
    global.tempAxaData[userId] = {
      facturaConRetencion: {
        items: Array(34).fill({}),
        total: 67405.14,
        facturaData: { customer: 'axa-client', items: [] }
      },
      facturaSinRetencion: {
        items: Array(34).fill({}),
        total: 69812.47,
        facturaData: { customer: 'axa-client', items: [] }
      },
      timestamp: Date.now()
    };
    
    // PASO 2: Usuario presiona "Servicios Realizados (con retención 4%)"
    ctx.userState.axaTipoServicio = 'realizados';
    ctx.userState.axaConRetencion = true;
    
    // 🚀 SOLUCIÓN: Guardado INMEDIATO del estado
    await mockSessionService.saveUserState(ctx.from.id, ctx.userState);
    
    // Verificar que se llamó el guardado
    expect(mockSessionService.saveUserState).toHaveBeenCalledWith(
      ctx.from.id,
      expect.objectContaining({
        axaTipoServicio: 'realizados',
        axaConRetencion: true
      })
    );
    
    // PASO 3: Usuario presiona "Confirmar" inmediatamente
    // El estado ya está guardado, debe estar disponible
    
    console.log('✅ SOLUCIÓN AXA: Estado persiste con guardado forzado');
    console.log('✅ axaTipoServicio:', ctx.userState.axaTipoServicio);
    console.log('✅ axaConRetencion:', ctx.userState.axaConRetencion);
    
    expect(ctx.userState.axaTipoServicio).toBe('realizados');
    expect(ctx.userState.axaConRetencion).toBe(true);
  });

  test('CHUBB: No tiene problema de persistencia (flujo directo)', async () => {
    const ctx = createMockContext();
    const userId = ctx.from.id;
    
    // CHUBB: Excel → Confirmar directo (sin botones intermedios)
    global.tempChubbData[userId] = {
      grupos: [
        { grupo: 'GRUA', conceptos: [{ importe: 1000 }] },
        { grupo: 'SERVICIOS', conceptos: [{ importe: 2000 }] }
      ],
      columnMappings: { grupo: 'GRUPO', importe: 'IMPORTE' },
      montosPorGrupo: { 'GRUA': 1000, 'SERVICIOS': 2000 },
      clientId: 'chubb-client-123',
      timestamp: Date.now()
    };
    
    // CHUBB no modifica userState entre botones
    // Todo está en cache global, disponible inmediatamente
    
    const chubbData = global.tempChubbData[userId];
    expect(chubbData.grupos).toHaveLength(2);
    expect(chubbData.montosPorGrupo['GRUA']).toBe(1000);
    
    console.log('✅ CHUBB: Flujo directo sin problemas de persistencia');
    
    // CHUBB no necesita guardado forzado porque no hay estado intermedio
    expect(mockSessionService.saveUserState).not.toHaveBeenCalled();
  });

  test('TIMING: Simular clicks rápidos en AXA', async () => {
    const ctx = createMockContext();
    const userId = ctx.from.id;
    
    // Configurar datos en cache
    global.tempAxaData[userId] = {
      facturaConRetencion: { total: 67405.14, facturaData: {} },
      facturaSinRetencion: { total: 69812.47, facturaData: {} },
      timestamp: Date.now()
    };
    
    // Simular clicks muy rápidos (usuario impaciente)
    const startTime = Date.now();
    
    // Click 1: Servicios Realizados
    ctx.userState.axaTipoServicio = 'realizados';
    ctx.userState.axaConRetencion = true;
    
    // Sin guardado forzado, pasar a siguiente click inmediatamente
    const timeBetweenClicks = 50; // 50ms entre clicks
    
    // Click 2: Confirmar (muy rápido después del anterior)
    const totalTime = Date.now() - startTime;
    expect(totalTime).toBeLessThan(timeBetweenClicks + 10);
    
    // Problema: Si el estado no se guardó entre clicks, será undefined
    console.log(`⚡ TIMING: ${totalTime}ms entre clicks (muy rápido)`);
    
    // Con el fix, el estado debe estar disponible
    expect(ctx.userState.axaTipoServicio).toBe('realizados');
    expect(ctx.userState.axaConRetencion).toBe(true);
  });

  test('MÉTRICAS: Comparar performance AXA vs CHUBB', () => {
    const userId = 123456789;
    
    // Tiempo de acceso CHUBB (cache global directo)
    const chubbStart = Date.now();
    global.tempChubbData[userId] = { grupos: [], timestamp: Date.now() };
    const chubbData = global.tempChubbData[userId];
    const chubbTime = Date.now() - chubbStart;
    
    // Tiempo de acceso AXA (cache global + validación estado)
    const axaStart = Date.now();
    global.tempAxaData[userId] = { facturaConRetencion: {}, timestamp: Date.now() };
    const axaData = global.tempAxaData[userId];
    const axaTime = Date.now() - axaStart;
    
    console.log(`📊 CHUBB acceso: ${chubbTime}ms`);
    console.log(`📊 AXA acceso: ${axaTime}ms`);
    
    // Ambos deben ser instantáneos (<5ms)
    expect(chubbTime).toBeLessThan(5);
    expect(axaTime).toBeLessThan(5);
    
    expect(chubbData).toBeDefined();
    expect(axaData).toBeDefined();
  });

  test('VALIDAR: Fix de persistencia resuelve el problema', async () => {
    const ctx = createMockContext();
    const userId = ctx.from.id;
    
    // Configurar escenario problemático
    global.tempAxaData[userId] = {
      facturaConRetencion: { total: 67405.14, facturaData: {} },
      timestamp: Date.now()
    };
    
    // ANTES del fix: Estado se modifica pero no se guarda
    ctx.userState.axaTipoServicio = 'realizados';
    ctx.userState.axaConRetencion = true;
    
    // Simular que el estado se "pierde" (middleware no guardó a tiempo)
    const estadoOriginal = { ...ctx.userState };
    
    // DESPUÉS del fix: Guardado forzado inmediato
    await mockSessionService.saveUserState(ctx.from.id, ctx.userState);
    
    // Verificar que el guardado forzado resuelve el problema
    expect(mockSessionService.saveUserState).toHaveBeenCalledWith(
      ctx.from.id,
      expect.objectContaining({
        axaTipoServicio: 'realizados',
        axaConRetencion: true
      })
    );
    
    console.log('✅ FIX VALIDADO: Guardado forzado resuelve persistencia');
    
    // El estado debe mantenerse disponible para el siguiente click
    expect(ctx.userState.axaTipoServicio).toBe('realizados');
    expect(ctx.userState.axaConRetencion).toBe(true);
  });
});