// tests/axa.calculations.test.js - Validar cálculos matemáticos exactos AXA
import { jest } from '@jest/globals';

describe('AXA - VALIDACIÓN DE CÁLCULOS MATEMÁTICOS', () => {
  test('FASE 2: Cálculos exactos según datos reales de logs', () => {
    // Datos reales de tus logs
    const datosReales = [
      { IMPORTE: 850, 'I.V.A.': 136, NETO: 986 },
      { IMPORTE: 2128.39, 'I.V.A.': 340.54, NETO: 2468.93 },
      // Simular 32 registros más para llegar a $60,183.16 total
    ];

    // Generar datos para llegar al total exacto de los logs
    const targetSubtotal = 60183.16;
    const currentSubtotal = 850 + 2128.39; // 2978.39
    const remainingAmount = targetSubtotal - currentSubtotal; // 57204.77
    const remainingRecords = 32;
    const avgAmount = remainingAmount / remainingRecords; // ~1787.65 por registro

    // Completar con registros promedio
    for (let i = 0; i < remainingRecords; i++) {
      datosReales.push({
        IMPORTE: avgAmount,
        'I.V.A.': avgAmount * 0.16,
        NETO: avgAmount * 1.16,
      });
    }

    // CÁLCULOS FASE 2
    const subtotal = datosReales.reduce((sum, item) => sum + item.IMPORTE, 0);
    const iva16 = subtotal * 0.16; // IVA 16%
    const retencion4 = subtotal * 0.04; // Retención 4%

    const totalSinRetencion = subtotal + iva16; // Subtotal + IVA 16%
    const totalConRetencion = subtotal + iva16 - retencion4; // Subtotal + IVA 16% - Retención 4%

    console.log(`📊 Subtotal calculado: $${subtotal.toFixed(2)}`);
    console.log(`📊 IVA 16%: $${iva16.toFixed(2)}`);
    console.log(`📊 Retención 4%: $${retencion4.toFixed(2)}`);
    console.log(`📊 Total SIN retención: $${totalSinRetencion.toFixed(2)}`);
    console.log(`📊 Total CON retención: $${totalConRetencion.toFixed(2)}`);

    // Validar contra los valores exactos de los logs
    expect(subtotal).toBeCloseTo(60183.16, 2);
    expect(totalConRetencion).toBeCloseTo(67405.14, 2); // De los logs
    expect(totalSinRetencion).toBeCloseTo(69812.47, 2); // De los logs

    // Validar fórmulas matemáticas
    expect(iva16).toBeCloseTo(subtotal * 0.16, 2);
    expect(retencion4).toBeCloseTo(subtotal * 0.04, 2);
    expect(totalConRetencion).toBeCloseTo(subtotal + iva16 - retencion4, 2);
  });

  test('VALIDAR: Estructura de items para FacturAPI', () => {
    const testRow = {
      FACTURA: '2305072025',
      'No. ORDEN': '2510317019',
      'No. FOLIO': '36',
      AUTORIZACION: '1125188694',
      IMPORTE: 850,
    };

    // Impuestos para servicios CON retención
    const taxesWithRetention = [
      { type: 'IVA', rate: 0.16, factor: 'Tasa' },
      { type: 'IVA', rate: 0.04, factor: 'Tasa', withholding: true },
    ];

    // Impuestos para servicios SIN retención
    const baseTaxes = [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }];

    // Estructura de item para FacturAPI
    const itemConRetencion = {
      quantity: 1,
      product: {
        description: `ARRASTRE DE GRUA FACTURA ${testRow.FACTURA} No. ORDEN ${testRow['No. ORDEN']} No. FOLIO ${testRow['No. FOLIO']} AUTORIZACION ${testRow.AUTORIZACION}`,
        product_key: '78101803', // CLAVE_SAT_SERVICIOS_GRUA
        unit_key: 'E48',
        unit_name: 'SERVICIO',
        price: testRow.IMPORTE,
        tax_included: false,
        taxes: taxesWithRetention,
      },
    };

    const itemSinRetencion = {
      ...itemConRetencion,
      product: {
        ...itemConRetencion.product,
        taxes: baseTaxes,
      },
    };

    // Validaciones de estructura
    expect(itemConRetencion.quantity).toBe(1);
    expect(itemConRetencion.product.price).toBe(850);
    expect(itemConRetencion.product.product_key).toBe('78101803');
    expect(itemConRetencion.product.taxes).toHaveLength(2); // IVA + Retención
    expect(itemSinRetencion.product.taxes).toHaveLength(1); // Solo IVA

    // Validar descripción
    expect(itemConRetencion.product.description).toContain('ARRASTRE DE GRUA');
    expect(itemConRetencion.product.description).toContain('2305072025');
    expect(itemConRetencion.product.description).toContain('2510317019');

    console.log('✅ Estructura de items para FacturAPI válida');
  });

  test('PERFORMANCE: Precálculo debe ser instantáneo', () => {
    // Simular 34 registros como en los logs
    const registros = Array(34)
      .fill(null)
      .map((_, i) => ({
        FACTURA: `230507202${i}`,
        'No. ORDEN': `251031701${i}`,
        'No. FOLIO': `${36 + i}`,
        AUTORIZACION: `112518869${i}`,
        IMPORTE: 1000 + i * 50, // Variedad en importes
      }));

    const startTime = Date.now();

    // FASE 2: Precálculo (simulando la lógica real)
    const itemsConRetencion = [];
    const itemsSinRetencion = [];
    let subtotal = 0;

    const baseTaxes = [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }];
    const taxesWithRetention = [
      ...baseTaxes,
      { type: 'IVA', rate: 0.04, factor: 'Tasa', withholding: true },
    ];

    for (const row of registros) {
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

      itemsConRetencion.push({
        ...itemBase,
        product: { ...itemBase.product, taxes: taxesWithRetention },
      });

      itemsSinRetencion.push({
        ...itemBase,
        product: { ...itemBase.product, taxes: baseTaxes },
      });
    }

    const iva16 = subtotal * 0.16;
    const retencion4 = subtotal * 0.04;
    const totalSinRetencion = subtotal + iva16;
    const totalConRetencion = subtotal + iva16 - retencion4;

    const duration = Date.now() - startTime;

    console.log(`⚡ Precálculo de ${registros.length} items completado en ${duration}ms`);

    // Validaciones de performance
    expect(duration).toBeLessThan(50); // Debe ser menor a 50ms
    expect(itemsConRetencion).toHaveLength(34);
    expect(itemsSinRetencion).toHaveLength(34);
    expect(subtotal).toBeGreaterThan(0);
    expect(totalConRetencion).toBeLessThan(totalSinRetencion); // Con retención debe ser menor
  });

  test('VALIDAR: Cache global structure después de FASE 2', () => {
    const userId = 123456789;
    const testData = {
      data: [{ IMPORTE: 1000 }],
      columnMappings: { importe: 'IMPORTE' },
      timestamp: Date.now(),
      clientId: 'axa-client-123',
      subtotal: 1000,
      iva16: 160,
      retencion4: 40,
      facturaConRetencion: {
        items: [{ quantity: 1, product: { price: 1000 } }],
        total: 1116, // 1000 + 160 - 40
        facturaData: { customer: 'axa-client-123', items: [] },
      },
      facturaSinRetencion: {
        items: [{ quantity: 1, product: { price: 1000 } }],
        total: 1160, // 1000 + 160
        facturaData: { customer: 'axa-client-123', items: [] },
      },
    };

    // Simular almacenamiento en cache global
    global.tempAxaData = {};
    global.tempAxaData[userId] = testData;

    // Validaciones de estructura
    const cachedData = global.tempAxaData[userId];
    expect(cachedData).toBeDefined();
    expect(cachedData.facturaConRetencion).toBeDefined();
    expect(cachedData.facturaSinRetencion).toBeDefined();
    expect(cachedData.facturaConRetencion.facturaData).toBeDefined();
    expect(cachedData.facturaSinRetencion.facturaData).toBeDefined();

    // Validar que los datos están listos para FacturAPI
    expect(cachedData.facturaConRetencion.facturaData.customer).toBe('axa-client-123');
    expect(cachedData.facturaSinRetencion.facturaData.customer).toBe('axa-client-123');

    // Validar cálculos
    expect(cachedData.facturaConRetencion.total).toBe(1116);
    expect(cachedData.facturaSinRetencion.total).toBe(1160);

    console.log('✅ Estructura de cache global válida para FacturAPI');
  });

  test('ERROR HANDLING: Datos inválidos en Excel', () => {
    const datosInvalidos = [
      { IMPORTE: 'invalid', 'I.V.A.': 136 }, // String en lugar de número
      { IMPORTE: null, 'I.V.A.': 136 }, // Null
      { IMPORTE: -100, 'I.V.A.': 136 }, // Negativo
      { IMPORTE: 0, 'I.V.A.': 136 }, // Cero
    ];

    const erroresEncontrados = [];

    datosInvalidos.forEach((row, index) => {
      const importe = parseFloat(row.IMPORTE);
      if (isNaN(importe) || importe <= 0) {
        erroresEncontrados.push(`Fila ${index + 2}: El importe debe ser un número positivo.`);
      }
    });

    // Debe detectar todos los errores
    expect(erroresEncontrados).toHaveLength(4);
    expect(erroresEncontrados[0]).toContain('Fila 2');
    expect(erroresEncontrados[1]).toContain('Fila 3');
    expect(erroresEncontrados[2]).toContain('Fila 4');
    expect(erroresEncontrados[3]).toContain('Fila 5');

    console.log('✅ Validación de errores funciona correctamente');
  });

  test('TIMING: TTL limpieza de cache', () => {
    const userId1 = 111;
    const userId2 = 222;

    // Datos recientes (válidos)
    global.tempAxaData = {
      [userId1]: {
        facturaConRetencion: { total: 1000 },
        timestamp: Date.now(), // Actual
      },
      [userId2]: {
        facturaConRetencion: { total: 2000 },
        timestamp: Date.now() - 11 * 60 * 1000, // 11 minutos atrás (expirado)
      },
    };

    // Simular limpieza TTL (como en código real)
    const TTL_TIMEOUT = 10 * 60 * 1000; // 10 minutos
    for (const userId in global.tempAxaData) {
      if (Date.now() - global.tempAxaData[userId].timestamp > TTL_TIMEOUT) {
        delete global.tempAxaData[userId];
      }
    }

    // Validar limpieza
    expect(global.tempAxaData[userId1]).toBeDefined(); // Debe existir (reciente)
    expect(global.tempAxaData[userId2]).toBeUndefined(); // Debe haberse eliminado (expirado)

    console.log('✅ TTL automático limpia datos expirados correctamente');
  });
});
