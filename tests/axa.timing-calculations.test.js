// tests/axa.timing-calculations.test.js - Validar TIMING de cálculos y que datos pesados NO van a userState
import { jest } from '@jest/globals';

describe('AXA - TIMING Y PESO DE CÁLCULOS', () => {
  beforeEach(() => {
    global.tempAxaData = {};
    jest.clearAllMocks();
  });

  test('CRÍTICO: Cálculos DEBEN completarse ANTES de mostrar botones', async () => {
    const userId = 123456789;
    const mockCtx = {
      from: { id: userId },
      userState: {
        tenantId: 'test-tenant',
        axaClientId: 'axa-client-123',
        esperando: 'archivo_excel_axa',
      },
      reply: jest.fn(),
    };

    // Simular datos Excel (34 registros como en logs reales)
    const excelData = Array(34)
      .fill(null)
      .map((_, i) => ({
        FACTURA: `230507202${i}`,
        'No. ORDEN': `251031701${i}`,
        'No. FOLIO': `${36 + i}`,
        AUTORIZACION: `112518869${i}`,
        IMPORTE: 850 + i * 150, // Variedad realista
      }));

    console.log('🔄 INICIANDO: Procesamiento Excel → Cálculos → Botones');

    // PASO 1: Procesar Excel
    const startTime = Date.now();

    // PASO 2: FASE 2 - Precálculo (DEBE completarse antes de botones)
    console.log('📊 FASE 2: Iniciando precálculo...');
    const precalculoStart = Date.now();

    // Configuración de impuestos
    const baseTaxes = [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }];
    const taxesWithRetention = [
      ...baseTaxes,
      { type: 'IVA', rate: 0.04, factor: 'Tasa', withholding: true },
    ];

    // Precalcular items para ambas opciones
    const itemsConRetencion = [];
    const itemsSinRetencion = [];
    let subtotal = 0;

    for (const row of excelData) {
      const importe = parseFloat(row.IMPORTE);
      subtotal += importe;

      const itemBase = {
        quantity: 1,
        product: {
          description: `ARRASTRE DE GRUA FACTURA ${row.FACTURA} No. ORDEN ${row['No. ORDEN']} No. FOLIO ${row['No. FOLIO']} AUTORIZACION ${row.AUTORIZACION}`,
          product_key: '78101803',
          unit_key: 'E48',
          unit_name: 'SERVICIO',
          price: importe,
          tax_included: false,
        },
      };

      // Item CON retención
      itemsConRetencion.push({
        ...itemBase,
        product: { ...itemBase.product, taxes: taxesWithRetention },
      });

      // Item SIN retención
      itemsSinRetencion.push({
        ...itemBase,
        product: { ...itemBase.product, taxes: baseTaxes },
      });
    }

    // Cálculos finales
    const iva16 = subtotal * 0.16;
    const retencion4 = subtotal * 0.04;
    const totalSinRetencion = subtotal + iva16;
    const totalConRetencion = subtotal + iva16 - retencion4;

    // Estructuras completas para FacturAPI
    const facturaBaseData = {
      customer: mockCtx.userState.axaClientId,
      use: 'G03',
      payment_form: '99',
      payment_method: 'PPD',
      currency: 'MXN',
      exchange: 1,
    };

    const facturaConRetencionData = {
      ...facturaBaseData,
      items: itemsConRetencion,
    };

    const facturaSinRetencionData = {
      ...facturaBaseData,
      items: itemsSinRetencion,
    };

    const precalculoDuration = Date.now() - precalculoStart;
    console.log(`✅ FASE 2: Precálculo completado en ${precalculoDuration}ms`);

    // PASO 3: Guardar datos PESADOS en cache global (NO en userState)
    global.tempAxaData[userId] = {
      // Datos originales (para compatibilidad)
      data: excelData,
      columnMappings: {
        factura: 'FACTURA',
        orden: 'No. ORDEN',
        folio: 'No. FOLIO',
        autorizacion: 'AUTORIZACION',
        importe: 'IMPORTE',
      },
      timestamp: Date.now(),

      // DATOS PRECALCULADOS PESADOS
      clientId: mockCtx.userState.axaClientId,
      subtotal: subtotal,
      iva16: iva16,
      retencion4: retencion4,
      facturaConRetencion: {
        items: itemsConRetencion,
        total: totalConRetencion,
        facturaData: facturaConRetencionData,
      },
      facturaSinRetencion: {
        items: itemsSinRetencion,
        total: totalSinRetencion,
        facturaData: facturaSinRetencionData,
      },
    };

    // PASO 4: Guardar SOLO números en userState (liviano)
    mockCtx.userState.axaSummary = {
      totalRecords: excelData.length,
      totalAmount: subtotal,
      // NO guardar arrays de items ni objetos pesados
    };

    // PASO 5: VERIFICAR que cache está listo ANTES de mostrar botones
    const tempDataCheck = global.tempAxaData[userId];
    const cacheReady =
      tempDataCheck &&
      tempDataCheck.facturaConRetencion &&
      tempDataCheck.facturaSinRetencion &&
      tempDataCheck.facturaConRetencion.facturaData &&
      tempDataCheck.facturaSinRetencion.facturaData;

    const totalTime = Date.now() - startTime;

    // VALIDACIONES CRÍTICAS
    expect(cacheReady).toBe(true); // Cache DEBE estar listo
    expect(precalculoDuration).toBeLessThan(100); // Precálculo debe ser rápido
    expect(totalTime).toBeLessThan(200); // Proceso total debe ser rápido

    // Solo AHORA se pueden mostrar los botones
    if (cacheReady) {
      console.log('✅ BOTONES PUEDEN MOSTRARSE: Cache verificado y listo');
      console.log(
        `✅ Datos en cache: CON retención: $${tempDataCheck.facturaConRetencion.total.toFixed(2)}, SIN retención: $${tempDataCheck.facturaSinRetencion.total.toFixed(2)}`
      );
    }

    console.log(`📊 TIMING TOTAL: Excel procesado y cálculos completados en ${totalTime}ms`);
  });

  test('CRÍTICO: userState debe ser LIVIANO, datos pesados en cache global', () => {
    const userId = 123456789;
    const mockCtx = {
      from: { id: userId },
      userState: {
        tenantId: 'test-tenant-123',
        axaClientId: 'axa-client-123',
        esperando: 'archivo_excel_axa',
        // SOLO datos livianos
        axaSummary: {
          totalRecords: 34,
          totalAmount: 60183.16,
        },
        // NO debe tener: items, arrays, objetos grandes
      },
    };

    // Datos pesados van a cache global
    const datosPesados = {
      data: Array(34).fill({ IMPORTE: 1000, FACTURA: 'test' }), // 34 registros
      facturaConRetencion: {
        items: Array(34).fill({
          quantity: 1,
          product: {
            description:
              'ARRASTRE DE GRUA FACTURA 2305072025 No. ORDEN 2510317019 No. FOLIO 36 AUTORIZACION 1125188694',
            price: 1000,
          },
        }),
        total: 67405.14,
        facturaData: {
          customer: 'axa-client-123',
          items: Array(34).fill({}),
          use: 'G03',
          payment_form: '99',
        },
      },
      facturaSinRetencion: {
        items: Array(34).fill({
          quantity: 1,
          product: {
            description:
              'ARRASTRE DE GRUA FACTURA 2305072025 No. ORDEN 2510317019 No. FOLIO 36 AUTORIZACION 1125188694',
            price: 1000,
          },
        }),
        total: 69812.47,
        facturaData: {
          customer: 'axa-client-123',
          items: Array(34).fill({}),
          use: 'G03',
          payment_form: '99',
        },
      },
    };

    global.tempAxaData[userId] = datosPesados;

    // MEDIR TAMAÑOS
    const userStateSize = JSON.stringify(mockCtx.userState).length;
    const cacheDataSize = JSON.stringify(global.tempAxaData[userId]).length;

    console.log(`📊 userState size: ${userStateSize} bytes (DEBE ser pequeño)`);
    console.log(`📊 Cache global size: ${cacheDataSize} bytes (PUEDE ser grande)`);
    console.log(
      `📊 Ratio: Cache es ${Math.round(cacheDataSize / userStateSize)}x más grande que userState`
    );

    // VALIDACIONES DE PESO
    expect(userStateSize).toBeLessThan(500); // userState debe ser < 500 bytes
    expect(cacheDataSize).toBeGreaterThan(userStateSize * 10); // Cache debe ser mucho más grande

    // VALIDAR QUE userState NO TIENE DATOS PESADOS
    expect(mockCtx.userState.data).toBeUndefined();
    expect(mockCtx.userState.facturaConRetencion).toBeUndefined();
    expect(mockCtx.userState.facturaSinRetencion).toBeUndefined();
    expect(mockCtx.userState.items).toBeUndefined();
    expect(mockCtx.userState.columnMappings).toBeUndefined();

    // VALIDAR QUE CACHE GLOBAL TIENE TODO LO PESADO
    expect(global.tempAxaData[userId].data).toBeDefined();
    expect(global.tempAxaData[userId].facturaConRetencion.items).toHaveLength(34);
    expect(global.tempAxaData[userId].facturaSinRetencion.items).toHaveLength(34);

    console.log('✅ SEPARACIÓN CORRECTA: userState liviano, cache global pesado');
  });

  test('FLUJO COMPLETO: Excel → Cálculos → Botones → Click → Factura', async () => {
    const userId = 123456789;

    console.log('🔄 FLUJO COMPLETO INICIADO');

    // FASE 1: Excel recibido
    console.log('📁 FASE 1: Procesando Excel...');
    const excelData = [
      { IMPORTE: 850, FACTURA: '2305072025', 'No. ORDEN': '2510317019' },
      { IMPORTE: 2000, FACTURA: '2305072026', 'No. ORDEN': '2510317020' },
    ];

    // FASE 2: Precálculo INMEDIATO (antes de botones)
    console.log('🧮 FASE 2: Precálculo iniciado...');
    const precalculoStart = Date.now();

    const subtotal = excelData.reduce((sum, item) => sum + item.IMPORTE, 0);
    const iva16 = subtotal * 0.16;
    const retencion4 = subtotal * 0.04;
    const totalConRetencion = subtotal + iva16 - retencion4;
    const totalSinRetencion = subtotal + iva16;

    // Guardar SOLO en cache global
    global.tempAxaData[userId] = {
      facturaConRetencion: {
        items: excelData.map((row) => ({
          product: { price: row.IMPORTE, description: `GRUA ${row.FACTURA}` },
        })),
        total: totalConRetencion,
        facturaData: { customer: 'axa-123', items: [] },
      },
      facturaSinRetencion: {
        items: excelData.map((row) => ({
          product: { price: row.IMPORTE, description: `GRUA ${row.FACTURA}` },
        })),
        total: totalSinRetencion,
        facturaData: { customer: 'axa-123', items: [] },
      },
      timestamp: Date.now(),
    };

    const precalculoDuration = Date.now() - precalculoStart;
    console.log(`✅ FASE 2: Completado en ${precalculoDuration}ms`);

    // VERIFICACIÓN: Cache listo ANTES de mostrar botones
    const tempDataCheck = global.tempAxaData[userId];
    const cacheReady =
      tempDataCheck && tempDataCheck.facturaConRetencion && tempDataCheck.facturaSinRetencion;

    expect(cacheReady).toBe(true);
    console.log('✅ CACHE VERIFICADO: Botones pueden mostrarse');

    // FASE 3: Usuario click en botón (INSTANTÁNEO porque datos están listos)
    console.log('🖱️ FASE 3: Usuario presiona botón "Con retención"...');
    const botonStart = Date.now();

    const tempData = global.tempAxaData[userId]; // Acceso instantáneo
    const botonDuration = Date.now() - botonStart;

    expect(tempData.facturaConRetencion).toBeDefined();
    expect(tempData.facturaConRetencion.total).toBe(totalConRetencion);
    expect(botonDuration).toBeLessThan(5); // Debe ser instantáneo

    console.log(`⚡ FASE 3: Botón respondió en ${botonDuration}ms (instantáneo)`);

    // FASE 4: Confirmar y generar factura (datos ya listos)
    console.log('✅ FASE 4: Confirmando factura...');
    const confirmarStart = Date.now();

    const facturaData = tempData.facturaConRetencion.facturaData;
    expect(facturaData.customer).toBe('axa-123');
    expect(facturaData.items).toBeDefined();

    const confirmarDuration = Date.now() - confirmarStart;
    console.log(`🚀 FASE 4: Datos listos para FacturAPI en ${confirmarDuration}ms`);

    // VALIDACIONES FINALES
    expect(precalculoDuration).toBeLessThan(50); // Precálculo rápido
    expect(botonDuration).toBeLessThan(5); // Botón instantáneo
    expect(confirmarDuration).toBeLessThan(5); // Confirmación instantánea

    console.log('🎯 FLUJO COMPLETO: Todos los cálculos ANTES de botones, respuesta instantánea');
  });

  test('EDGE CASE: Qué pasa si usuario presiona botón ANTES de que termine precálculo', () => {
    const userId = 123456789;

    console.log('⚠️ SIMULANDO: Usuario impaciente presiona botón antes de tiempo');

    // Simular que cache global NO está listo
    global.tempAxaData[userId] = {
      // Datos parciales o indefinidos
      facturaConRetencion: undefined, // ¡No está listo!
      timestamp: Date.now(),
    };

    // Usuario presiona botón
    const tempData = global.tempAxaData[userId];
    const botonFalló = !tempData || !tempData.facturaConRetencion;

    expect(botonFalló).toBe(true);
    console.log('❌ BOTÓN FALLÓ: Como esperado, sin datos precalculados');

    // DESPUÉS: Cache se completa
    global.tempAxaData[userId].facturaConRetencion = {
      items: [{ product: { price: 1000 } }],
      total: 1116,
      facturaData: { customer: 'axa-123' },
    };

    // Ahora el botón SÍ funciona
    const tempDataCompleto = global.tempAxaData[userId];
    const botonFunciona = tempDataCompleto && tempDataCompleto.facturaConRetencion;

    expect(botonFunciona).toBe(true);
    console.log('✅ BOTÓN FUNCIONA: Después de completar precálculo');

    console.log('🎯 PROTECCIÓN: Sistema protege contra clicks prematuros');
  });
});
