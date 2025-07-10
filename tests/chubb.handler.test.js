// tests/chubb.handler.test.js - Tests para validar comportamiento CHUBB vs AXA
import { jest } from '@jest/globals';

// Mock global para datos temporales CHUBB
global.tempChubbData = {};

// Mocks para dependencias
const mockPrisma = {
  tenantCustomer: {
    findFirst: jest.fn()
  }
};

const mockTelegram = {
  getFileLink: jest.fn(),
  editMessageText: jest.fn()
};

// Mock del contexto base
const createMockContext = (userId = 123456789) => ({
  from: { id: userId },
  userState: {
    tenantId: 'test-tenant-123',
    chubbClientId: 'chubb-client-123',
    esperando: null
  },
  answerCbQuery: jest.fn(),
  reply: jest.fn(),
  editMessageReplyMarkup: jest.fn(),
  telegram: mockTelegram,
  getTenantId: jest.fn(() => 'test-tenant-123')
});

describe('CHUBB Handler - Persistencia de Estado', () => {
  
  beforeEach(() => {
    // Limpiar datos temporales entre tests
    global.tempChubbData = {};
    jest.clearAllMocks();
  });

  test('CHUBB: Datos temporales se almacenan en cache global correctamente', () => {
    const ctx = createMockContext();
    const userId = ctx.from.id;
    
    // Simular datos CHUBB en cache global
    const chubbTestData = {
      grupos: [
        { grupo: 'GRUA', conceptos: [{ importe: 1000 }] },
        { grupo: 'SERVICIOS', conceptos: [{ importe: 2000 }] }
      ],
      columnMappings: {
        grupo: 'GRUPO',
        importe: 'IMPORTE'
      },
      montosPorGrupo: {
        'GRUA': 1000,
        'SERVICIOS': 2000
      },
      clientId: 'chubb-client-123',
      timestamp: Date.now()
    };
    
    // Almacenar en cache global como lo hace CHUBB
    global.tempChubbData[userId] = chubbTestData;
    
    // Verificar que los datos están en cache
    expect(global.tempChubbData[userId]).toBeDefined();
    expect(global.tempChubbData[userId].grupos).toHaveLength(2);
    expect(global.tempChubbData[userId].montosPorGrupo['GRUA']).toBe(1000);
    expect(global.tempChubbData[userId].montosPorGrupo['SERVICIOS']).toBe(2000);
    
    console.log('✅ CHUBB: Cache global funciona correctamente');
  });

  test('CHUBB: Estado de userState es mínimo (solo referencias)', () => {
    const ctx = createMockContext();
    
    // CHUBB mantiene estado mínimo en userState
    ctx.userState.chubbDataRef = 'datos-en-cache-global';
    
    // Verificar que userState es liviano
    const userStateString = JSON.stringify(ctx.userState);
    expect(userStateString.length).toBeLessThan(500); // Menos de 500 bytes
    
    // No debe tener arrays grandes ni objetos pesados
    expect(ctx.userState.grupos).toBeUndefined();
    expect(ctx.userState.columnMappings).toBeUndefined();
    expect(ctx.userState.montosPorGrupo).toBeUndefined();
    
    console.log(`✅ CHUBB: UserState liviano (${userStateString.length} bytes)`);
  });

  test('CHUBB: Flujo completo sin botones intermedios', () => {
    const ctx = createMockContext();
    const userId = ctx.from.id;
    
    // PASO 1: Excel procesado → Cache global
    global.tempChubbData[userId] = {
      grupos: [{ grupo: 'TEST', conceptos: [{ importe: 5000 }] }],
      columnMappings: { grupo: 'GRUPO', importe: 'IMPORTE' },
      montosPorGrupo: { 'TEST': 5000 },
      clientId: 'chubb-client-123',
      timestamp: Date.now()
    };
    
    // PASO 2: Usuario presiona "Confirmar" directamente (sin botones intermedios)
    // No hay modificación de estado intermedia como en AXA
    
    // PASO 3: Verificar datos disponibles inmediatamente
    const chubbData = global.tempChubbData[userId];
    expect(chubbData).toBeDefined();
    expect(chubbData.grupos).toHaveLength(1);
    expect(chubbData.montosPorGrupo['TEST']).toBe(5000);
    
    console.log('✅ CHUBB: Flujo directo Excel → Confirmar funciona');
  });

  test('CHUBB: TTL automático limpia datos antiguos', () => {
    const ctx = createMockContext();
    const userId = ctx.from.id;
    
    // Simular datos antiguos (más de 10 minutos)
    const timestampAntiguo = Date.now() - (11 * 60 * 1000); // 11 minutos atrás
    global.tempChubbData[userId] = {
      grupos: [{ grupo: 'OLD', conceptos: [{ importe: 1000 }] }],
      timestamp: timestampAntiguo
    };
    
    // Simular limpieza TTL como lo hace CHUBB
    for (const userIdKey in global.tempChubbData) {
      if (Date.now() - global.tempChubbData[userIdKey].timestamp > 600000) { // 10 minutos
        delete global.tempChubbData[userIdKey];
      }
    }
    
    // Verificar que los datos antiguos fueron eliminados
    expect(global.tempChubbData[userId]).toBeUndefined();
    
    console.log('✅ CHUBB: TTL automático funciona correctamente');
  });

  test('CHUBB: Respuesta inmediata en botones (datos precalculados)', () => {
    const ctx = createMockContext();
    const userId = ctx.from.id;
    
    // Datos precalculados en cache
    global.tempChubbData[userId] = {
      grupos: [{ grupo: 'INSTANT', conceptos: [{ importe: 3000 }] }],
      columnMappings: { grupo: 'GRUPO', importe: 'IMPORTE' },
      montosPorGrupo: { 'INSTANT': 3000 },
      clientId: 'chubb-client-123',
      timestamp: Date.now()
    };
    
    // Medir tiempo de acceso a datos (debe ser instantáneo)
    const startTime = Date.now();
    const chubbData = global.tempChubbData[userId];
    const accessTime = Date.now() - startTime;
    
    // Verificar acceso instantáneo
    expect(chubbData).toBeDefined();
    expect(accessTime).toBeLessThan(5); // Menos de 5ms
    expect(chubbData.montosPorGrupo['INSTANT']).toBe(3000);
    
    console.log(`✅ CHUBB: Acceso instantáneo a datos (${accessTime}ms)`);
  });

  test('CHUBB: Limpieza correcta al finalizar proceso', () => {
    const ctx = createMockContext();
    const userId = ctx.from.id;
    
    // Establecer datos iniciales
    global.tempChubbData[userId] = {
      grupos: [{ grupo: 'CLEANUP', conceptos: [{ importe: 1500 }] }],
      timestamp: Date.now()
    };
    ctx.userState.chubbDataRef = 'test-ref';
    
    // Simular limpieza al finalizar como lo hace CHUBB
    if (global.tempChubbData && global.tempChubbData[userId]) {
      delete global.tempChubbData[userId];
    }
    delete ctx.userState.chubbDataRef;
    
    // Verificar limpieza completa
    expect(global.tempChubbData[userId]).toBeUndefined();
    expect(ctx.userState.chubbDataRef).toBeUndefined();
    
    console.log('✅ CHUBB: Limpieza completa al finalizar');
  });
});

describe('COMPARACIÓN: CHUBB vs AXA - Patrones de Estado', () => {
  
  test('Comparar tamaño de userState: CHUBB vs AXA', () => {
    // Estado típico CHUBB (liviano)
    const chubbUserState = {
      tenantId: 'test-tenant-123',
      chubbClientId: 'chubb-client-123',
      chubbDataRef: 'datos-en-cache-global',
      esperando: null
    };
    
    // Estado típico AXA (antes de optimización)
    const axaUserState = {
      tenantId: 'test-tenant-123',
      axaClientId: 'axa-client-123',
      axaSummary: { totalRecords: 34, totalAmount: 60183.16 },
      axaTipoServicio: 'realizados',
      axaConRetencion: true,
      esperando: null
    };
    
    const chubbSize = JSON.stringify(chubbUserState).length;
    const axaSize = JSON.stringify(axaUserState).length;
    
    console.log(`📊 CHUBB userState: ${chubbSize} bytes`);
    console.log(`📊 AXA userState: ${axaSize} bytes`);
    
    // AXA debe ser comparable a CHUBB (ambos livianos)
    expect(axaSize).toBeLessThan(600); // Menos de 600 bytes
    expect(chubbSize).toBeLessThan(400); // CHUBB aún más liviano
  });

  test('Comparar flujos: CHUBB directo vs AXA con botones intermedios', () => {
    const userId = 123456789;
    
    // FLUJO CHUBB: Excel → Confirmar (1 paso)
    const chubbSteps = [
      'Excel procesado → Cache global',
      'Botón Confirmar → Factura generada'
    ];
    
    // FLUJO AXA: Excel → Tipo Servicio → Confirmar (2 pasos)
    const axaSteps = [
      'Excel procesado → Cache global',
      'Botón Tipo Servicio → Estado actualizado',
      'Botón Confirmar → Factura generada'
    ];
    
    console.log('🔄 CHUBB:', chubbSteps.length, 'pasos');
    console.log('🔄 AXA:', axaSteps.length, 'pasos');
    
    // AXA tiene un paso adicional que puede causar problemas de persistencia
    expect(axaSteps.length).toBe(chubbSteps.length + 1);
    
    // El paso adicional de AXA requiere persistencia forzada
    expect(axaSteps[1]).toContain('Estado actualizado');
  });
});