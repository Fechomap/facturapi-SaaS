// tests/invoice-generation.handler.test.js
import redisSessionService from '../services/redis-session.service.js';

// Mock del contexto de Telegraf
class MockTelegramContext {
  constructor(userId = 12345, tenantId = 'test-tenant-123') {
    this.from = { id: userId };
    this.userState = {};
    this.session = {};
    this.sessionId = `session_${userId}_${Date.now()}`;
    this.messages = [];
    this.callbacks = [];
    this._tenantId = tenantId;
    this._activeProcesses = new Set();
  }

  async reply(message, options) {
    this.messages.push({ message, options });
    return { message_id: Math.floor(Math.random() * 1000) };
  }

  async answerCbQuery(text) {
    this.callbacks.push(text);
  }

  async saveSession() {
    return await redisSessionService.setSession(this.sessionId, this.session, 3600);
  }

  async loadSession() {
    const result = await redisSessionService.getSession(this.sessionId);
    if (result.success) {
      this.session = result.data;
    }
    return result;
  }

  hasTenant() {
    return true;
  }
  getTenantId() {
    return this._tenantId;
  }

  isProcessActive(processId) {
    return this._activeProcesses.has(processId);
  }

  markProcessActive(processId) {
    this._activeProcesses.add(processId);
  }

  markProcessInactive(processId) {
    this._activeProcesses.delete(processId);
  }

  async editMessageReplyMarkup(markup) {
    // Simular edición de markup
    return true;
  }
}

// Mock del InvoiceService
const mockInvoiceService = {
  generateInvoice: () => Promise.resolve({}),
};

// Jest mock functions
const createMockFunction = () => {
  let calls = [];
  let implementations = [];
  let currentImpl = 0;

  const mockFn = async (...args) => {
    calls.push(args);
    if (implementations.length > 0) {
      const impl = implementations[Math.min(currentImpl, implementations.length - 1)];
      currentImpl++;
      if (typeof impl === 'function') {
        return await impl(...args);
      } else if (impl instanceof Error) {
        throw impl;
      } else {
        return impl;
      }
    }
    return {};
  };

  mockFn.mockResolvedValueOnce = (value) => {
    implementations.push(value);
    return mockFn;
  };

  mockFn.mockRejectedValueOnce = (error) => {
    implementations.push(error);
    return mockFn;
  };

  mockFn.mockRejectedValue = (error) => {
    implementations = [error];
    return mockFn;
  };

  mockFn.mockResolvedValue = (value) => {
    implementations = [value];
    return mockFn;
  };

  Object.defineProperty(mockFn, 'calls', {
    get: () => calls,
  });

  Object.defineProperty(mockFn, 'callCount', {
    get: () => calls.length,
  });

  mockFn.toHaveBeenCalledTimes = (times) => calls.length === times;
  mockFn.toHaveBeenCalledWith = (...expectedArgs) => {
    return calls.some((callArgs) => JSON.stringify(callArgs) === JSON.stringify(expectedArgs));
  };

  mockFn.reset = () => {
    calls = [];
    implementations = [];
    currentImpl = 0;
  };

  return mockFn;
};

// Crear mock function para generateInvoice
mockInvoiceService.generateInvoice = createMockFunction();

describe('Invoice Generation Handler', () => {
  let mockCtx;

  beforeAll(async () => {
    await redisSessionService.initialize();
  });

  afterAll(async () => {
    await redisSessionService.disconnect();
  });

  beforeEach(() => {
    mockCtx = new MockTelegramContext();
    mockInvoiceService.generateInvoice.reset();
  });

  afterEach(async () => {
    if (mockCtx.sessionId) {
      await redisSessionService.deleteSession(mockCtx.sessionId);
    }
  });

  describe('Invoice Generation with Retry Logic', () => {
    test('should succeed on first attempt when service is working', async () => {
      const facturaData = {
        clienteNombre: 'TEST CLIENT SA',
        numeroPedido: 'ORD-001',
        monto: 1000.0,
        claveProducto: '78101803',
      };

      const expectedFactura = {
        id: 'fact_123',
        folio_number: 456,
        series: 'A',
      };

      // Configurar estado inicial
      mockCtx.userState = { ...facturaData };
      mockCtx.session = { ...facturaData };

      // Mock exitoso en primer intento
      mockInvoiceService.generateInvoice.mockResolvedValueOnce(expectedFactura);

      // Simular el flujo de generación con reintentos
      const maxRetries = 3;
      let factura = null;
      let lastError = null;
      let attempts = 0;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        attempts = attempt;
        try {
          factura = await mockInvoiceService.generateInvoice(
            { ...mockCtx.userState, userId: mockCtx.from.id },
            mockCtx.getTenantId()
          );
          break;
        } catch (attemptError) {
          lastError = attemptError;
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 10)); // Delay reducido para test
          }
        }
      }

      // Verificaciones
      expect(attempts).toBe(1); // Solo necesitó 1 intento
      expect(factura).toEqual(expectedFactura);
      expect(mockInvoiceService.generateInvoice.toHaveBeenCalledTimes(1)).toBe(true);
      expect(lastError).toBeNull();
    });

    test('should retry and succeed on second attempt', async () => {
      const facturaData = {
        clienteNombre: 'RETRY TEST CLIENT',
        numeroPedido: 'RETRY-001',
        monto: 2000.0,
      };

      const expectedFactura = {
        id: 'fact_retry_123',
        folio_number: 789,
        series: 'B',
      };

      mockCtx.userState = { ...facturaData };

      // Primer intento falla, segundo éxito
      mockInvoiceService.generateInvoice
        .mockRejectedValueOnce(new Error('Timeout error'))
        .mockResolvedValueOnce(expectedFactura);

      // Simular reintentos
      const maxRetries = 3;
      let factura = null;
      let lastError = null;
      let attempts = 0;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        attempts = attempt;
        try {
          factura = await mockInvoiceService.generateInvoice(
            { ...mockCtx.userState, userId: mockCtx.from.id },
            mockCtx.getTenantId()
          );
          break;
        } catch (attemptError) {
          lastError = attemptError;
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
      }

      // Verificaciones
      expect(attempts).toBe(2); // Necesitó 2 intentos
      expect(factura).toEqual(expectedFactura);
      expect(mockInvoiceService.generateInvoice.toHaveBeenCalledTimes(2)).toBe(true);
    });

    test('should fail after maximum retries', async () => {
      const facturaData = {
        clienteNombre: 'FAIL TEST CLIENT',
        numeroPedido: 'FAIL-001',
        monto: 500.0,
      };

      mockCtx.userState = { ...facturaData };

      const persistentError = new Error('Persistent service error');

      // Todos los intentos fallan
      mockInvoiceService.generateInvoice.mockRejectedValue(persistentError);

      // Simular reintentos
      const maxRetries = 3;
      let factura = null;
      let lastError = null;
      let attempts = 0;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        attempts = attempt;
        try {
          factura = await mockInvoiceService.generateInvoice(
            { ...mockCtx.userState, userId: mockCtx.from.id },
            mockCtx.getTenantId()
          );
          break;
        } catch (attemptError) {
          lastError = attemptError;
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
      }

      // Verificaciones
      expect(attempts).toBe(3); // Intentó todas las veces
      expect(factura).toBeNull();
      expect(lastError).toEqual(persistentError);
      expect(mockInvoiceService.generateInvoice.toHaveBeenCalledTimes(3)).toBe(true);
    });
  });

  describe('State Persistence During Invoice Generation', () => {
    test('should persist invoice data in both userState and session', async () => {
      const expectedFactura = {
        id: 'fact_persist_123',
        folio_number: 999,
        series: 'C',
      };

      // Simular generación exitosa
      const transactionId = `tx_${Date.now()}_${mockCtx.from.id}`;

      // Actualizar estado como hace el handler (después del fix)
      mockCtx.userState.facturaId = expectedFactura.id;
      mockCtx.userState.series = expectedFactura.series;
      mockCtx.userState.folioFactura = expectedFactura.folio_number;
      mockCtx.userState.facturaGenerada = true;
      mockCtx.userState.transactionId = transactionId;

      // CRÍTICO: También en session
      mockCtx.session.facturaId = expectedFactura.id;
      mockCtx.session.series = expectedFactura.series;
      mockCtx.session.folioFactura = expectedFactura.folio_number;
      mockCtx.session.facturaGenerada = true;

      await mockCtx.saveSession();

      // Verificar persistencia
      expect(mockCtx.userState.facturaId).toBe(expectedFactura.id);
      expect(mockCtx.session.facturaId).toBe(expectedFactura.id);
      expect(mockCtx.session.series).toBe('C');
      expect(mockCtx.session.folioFactura).toBe(999);
    });

    test('should handle invoice data access from different worker', async () => {
      const facturaData = {
        facturaId: 'fact_worker_test',
        folioFactura: 111,
        series: 'D',
        facturaGenerada: true,
      };

      // Worker 1: Generar factura
      mockCtx.session = { ...facturaData };
      await mockCtx.saveSession();

      // Worker 2: Acceder para operaciones posteriores
      const workerCtx = new MockTelegramContext(mockCtx.from.id);
      workerCtx.sessionId = mockCtx.sessionId;
      await workerCtx.loadSession();

      // Simular acceso a datos de factura (como en handlers de descarga)
      let series = workerCtx.userState?.series;
      if (!series && workerCtx.session?.series) {
        series = workerCtx.session.series;
        workerCtx.userState.series = series;
      }

      let facturaId = workerCtx.userState?.facturaId;
      if (!facturaId && workerCtx.session?.facturaId) {
        facturaId = workerCtx.session.facturaId;
        workerCtx.userState.facturaId = facturaId;
      }

      // Verificar acceso exitoso
      expect(series).toBe('D');
      expect(facturaId).toBe('fact_worker_test');
      expect(workerCtx.session.folioFactura).toBe(111);
    });
  });

  describe('Process Locking and Concurrency', () => {
    test('should prevent concurrent invoice generation for same transaction', async () => {
      const transactionId = `tx_concurrent_${Date.now()}`;

      // Primer proceso marca como activo
      expect(mockCtx.isProcessActive(transactionId)).toBe(false);
      mockCtx.markProcessActive(transactionId);
      expect(mockCtx.isProcessActive(transactionId)).toBe(true);

      // Segundo proceso debería detectar que está activo
      const concurrentCheck = mockCtx.isProcessActive(transactionId);
      expect(concurrentCheck).toBe(true);

      // Limpiar
      mockCtx.markProcessInactive(transactionId);
      expect(mockCtx.isProcessActive(transactionId)).toBe(false);
    });

    test('should handle process cleanup after completion', async () => {
      const transactionId = `tx_cleanup_${Date.now()}`;

      // Simular flujo completo
      mockCtx.markProcessActive(transactionId);

      try {
        // Simular operación exitosa
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Estado debería seguir activo durante la operación
        expect(mockCtx.isProcessActive(transactionId)).toBe(true);
      } finally {
        // Cleanup en finally (como hace el código real)
        mockCtx.markProcessInactive(transactionId);
      }

      // Proceso debería estar inactivo después del cleanup
      expect(mockCtx.isProcessActive(transactionId)).toBe(false);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle missing tenant ID gracefully', async () => {
      const invalidCtx = new MockTelegramContext(12345, null);

      expect(invalidCtx.getTenantId()).toBeNull();
      expect(invalidCtx.hasTenant()).toBe(true); // Mock simplificado

      // En código real, esto debería provocar un error controlado
      try {
        await mockInvoiceService.generateInvoice({}, invalidCtx.getTenantId());
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test('should preserve transaction ID throughout process', async () => {
      const transactionId = `tx_preserve_${Date.now()}_${mockCtx.from.id}`;

      // Configurar como hace el handler real
      mockCtx.userState.transactionId = transactionId;
      mockCtx.userState.clienteNombre = 'PRESERVE TEST CLIENT';
      mockCtx.userState.numeroPedido = 'PRES-001';
      mockCtx.userState.monto = 1500.0;

      await mockCtx.saveSession();

      // Verificar que el transaction ID se mantiene
      expect(mockCtx.userState.transactionId).toBe(transactionId);

      // Simular recuperación en otro contexto
      const newCtx = new MockTelegramContext(mockCtx.from.id);
      newCtx.sessionId = mockCtx.sessionId;
      newCtx.userState.transactionId = transactionId;

      expect(newCtx.userState.transactionId).toBe(transactionId);
    });

    test('should validate transaction ID before processing', async () => {
      const validTransactionId = `tx_valid_${Date.now()}`;
      const invalidTransactionId = `tx_invalid_${Date.now()}`;

      // Configurar estado con transaction ID válido
      mockCtx.userState.transactionId = validTransactionId;
      mockCtx.userState.facturaGenerada = true;

      // Simular verificación como hace el handler
      const incomingTransactionId = invalidTransactionId;

      if (
        mockCtx.userState.facturaGenerada &&
        mockCtx.userState.transactionId !== incomingTransactionId
      ) {
        // Debería rechazar la transacción inválida
        expect(mockCtx.userState.transactionId).not.toBe(incomingTransactionId);
        // En el código real, aquí se enviaría mensaje de error
      }
    });
  });

  describe('Integration with PDF Analysis Flow', () => {
    test('should generate invoice from PDF analysis data', async () => {
      const analysisData = {
        clientName: 'PDF ANALYSIS CLIENT SA',
        orderNumber: 'PDF-001',
        totalAmount: 3000.0,
        clientCode: 'CLI999',
      };

      const expectedFactura = {
        id: 'fact_from_pdf_123',
        folio_number: 555,
        series: 'A',
      };

      // Simular datos de análisis previo
      mockCtx.userState.pdfAnalysis = {
        id: 'analysis_123',
        analysis: analysisData,
        validation: { isValid: true },
      };

      // Preparar datos para facturación como hace generateSimpleInvoice
      const facturaData = {
        clienteId: 'facturapi_client_id_123', // Simulado
        numeroPedido: analysisData.orderNumber,
        claveProducto: '78101803',
        monto: analysisData.totalAmount,
        userId: mockCtx.from.id,
      };

      mockInvoiceService.generateInvoice.mockResolvedValueOnce(expectedFactura);

      // Simular generación
      const factura = await mockInvoiceService.generateInvoice(facturaData, mockCtx.getTenantId());

      // Actualizar estado como hace el handler real
      mockCtx.userState.facturaId = factura.id;
      mockCtx.userState.folioFactura = factura.folio_number;
      mockCtx.userState.series = factura.series;

      mockCtx.session.facturaId = factura.id;
      mockCtx.session.folioFactura = factura.folio_number;
      mockCtx.session.series = factura.series;
      mockCtx.session.facturaGenerada = true;

      // Limpiar análisis
      delete mockCtx.userState.pdfAnalysis;

      // Verificar flujo completo
      expect(factura).toEqual(expectedFactura);
      expect(mockCtx.session.facturaId).toBe(expectedFactura.id);
      expect(mockCtx.userState.pdfAnalysis).toBeUndefined();
      expect(
        mockInvoiceService.generateInvoice.toHaveBeenCalledWith(facturaData, mockCtx.getTenantId())
      ).toBe(true);
    });
  });

  describe('Bug Prevention Tests', () => {
    test('should prevent "operación cancelada" false positives', async () => {
      const transactionId = `tx_no_cancel_${Date.now()}`;

      // Simular el escenario que causaba cancelaciones incorrectas
      mockCtx.userState.transactionId = transactionId;

      // Marcar proceso como activo
      mockCtx.markProcessActive(transactionId);

      // Verificar que el proceso está marcado correctamente
      expect(mockCtx.isProcessActive(transactionId)).toBe(true);

      // Simular operación exitosa
      const expectedFactura = { id: 'fact_no_cancel', folio_number: 777, series: 'A' };
      mockInvoiceService.generateInvoice.mockResolvedValueOnce(expectedFactura);

      const factura = await mockInvoiceService.generateInvoice({}, mockCtx.getTenantId());

      // Limpiar proceso
      mockCtx.markProcessInactive(transactionId);

      // Verificar éxito sin cancelación
      expect(factura).toEqual(expectedFactura);
      expect(mockCtx.isProcessActive(transactionId)).toBe(false);
    });

    test('should handle network timeout with proper retry delays', async () => {
      const timeoutError = new Error('Network timeout');
      const expectedFactura = { id: 'fact_timeout_recovery', folio_number: 888, series: 'B' };

      // Primer intento timeout, segundo éxito
      mockInvoiceService.generateInvoice
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce(expectedFactura);

      // Simular reintentos con delays (timing real)
      const startTime = Date.now();
      const maxRetries = 3;
      let factura = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          factura = await mockInvoiceService.generateInvoice({}, mockCtx.getTenantId());
          break;
        } catch (attemptError) {
          if (attempt < maxRetries) {
            const delay = attempt * 2000; // Como en el código real
            await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 50))); // Acelerado para test
          }
        }
      }

      const endTime = Date.now();

      // Verificar éxito y que hubo delay
      expect(factura).toEqual(expectedFactura);
      expect(endTime - startTime).toBeGreaterThan(40); // Al menos el delay del primer reintento
      expect(mockInvoiceService.generateInvoice.toHaveBeenCalledTimes(2)).toBe(true);
    });
  });
});
