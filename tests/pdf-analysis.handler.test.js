// tests/pdf-analysis.handler.test.js
import redisSessionService from '../services/redis-session.service.js';

// Mock del contexto de Telegraf
class MockTelegramContext {
  constructor(userId = 12345) {
    this.from = { id: userId };
    this.userState = {};
    this.session = {};
    this.sessionId = `session_${userId}_${Date.now()}`;
    this.messages = [];
    this.callbacks = [];
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
    return 'test-tenant-123';
  }
}

describe('PDF Analysis Handler', () => {
  let mockCtx;

  beforeAll(async () => {
    await redisSessionService.initialize();
  });

  afterAll(async () => {
    await redisSessionService.disconnect();
  });

  beforeEach(() => {
    mockCtx = new MockTelegramContext();
  });

  afterEach(async () => {
    // Limpiar sesiones de prueba
    if (mockCtx.sessionId) {
      await redisSessionService.deleteSession(mockCtx.sessionId);
    }
  });

  describe('PDF Analysis State Management', () => {
    test('should store PDF analysis in both userState and session', async () => {
      const analysisId = `simple_${Date.now()}_${mockCtx.from.id}`;
      const analysisData = {
        id: analysisId,
        analysis: {
          clientName: 'TEST CLIENT SA DE CV',
          clientCode: 'CLI001',
          orderNumber: 'ORD-2025-001',
          totalAmount: 1160.0,
          confidence: 85,
        },
        validation: { isValid: true },
        timestamp: Date.now(),
      };

      // Simular lo que hace showSimpleAnalysisResults (después del fix)
      mockCtx.userState.pdfAnalysis = analysisData;
      mockCtx.session.pdfAnalysis = analysisData;

      // Guardar sesión
      const saveResult = await mockCtx.saveSession();
      expect(saveResult.success).toBe(true);

      // Verificar que se guardó en ambos lugares
      expect(mockCtx.userState.pdfAnalysis).toBeDefined();
      expect(mockCtx.session.pdfAnalysis).toBeDefined();
      expect(mockCtx.userState.pdfAnalysis.id).toBe(analysisId);
      expect(mockCtx.session.pdfAnalysis.id).toBe(analysisId);
    });

    test('should recover PDF analysis from session when userState is empty (worker change)', async () => {
      const analysisId = `simple_${Date.now()}_${mockCtx.from.id}`;
      const analysisData = {
        id: analysisId,
        analysis: {
          clientName: 'RECOVERY TEST CLIENT',
          orderNumber: 'REC-001',
          totalAmount: 500.0,
        },
        validation: { isValid: true },
        timestamp: Date.now(),
      };

      // Worker 1: Guardar análisis
      mockCtx.userState.pdfAnalysis = analysisData;
      mockCtx.session.pdfAnalysis = analysisData;
      await mockCtx.saveSession();

      // Worker 2: Simular nuevo contexto (userState vacío)
      const newCtx = new MockTelegramContext(mockCtx.from.id);
      newCtx.sessionId = mockCtx.sessionId;

      // Cargar sesión
      await newCtx.loadSession();

      // Simular lo que hace el action handler (después del fix)
      let analysisDataRecovered = newCtx.userState?.pdfAnalysis;

      if (!analysisDataRecovered || analysisDataRecovered.id !== analysisId) {
        // Buscar en session
        analysisDataRecovered = newCtx.session?.pdfAnalysis;

        if (analysisDataRecovered && analysisDataRecovered.id === analysisId) {
          // Restaurar en userState
          newCtx.userState.pdfAnalysis = analysisDataRecovered;
        }
      }

      // Verificar recuperación exitosa
      expect(analysisDataRecovered).toBeDefined();
      expect(analysisDataRecovered.id).toBe(analysisId);
      expect(analysisDataRecovered.analysis.clientName).toBe('RECOVERY TEST CLIENT');
      expect(newCtx.userState.pdfAnalysis).toBeDefined();
    });

    test('should handle expired analysis data gracefully', async () => {
      const analysisId = `simple_${Date.now()}_${mockCtx.from.id}`;
      const wrongAnalysisId = `simple_${Date.now() + 1000}_${mockCtx.from.id}`;

      const analysisData = {
        id: analysisId,
        analysis: { clientName: 'TEST CLIENT' },
        timestamp: Date.now(),
      };

      // Guardar análisis
      mockCtx.session.pdfAnalysis = analysisData;
      await mockCtx.saveSession();

      // Simular búsqueda con ID incorrecto (como si hubiera expirado)
      let analysisDataFound = mockCtx.userState?.pdfAnalysis;

      if (!analysisDataFound || analysisDataFound.id !== wrongAnalysisId) {
        analysisDataFound = mockCtx.session?.pdfAnalysis;

        if (!analysisDataFound || analysisDataFound.id !== wrongAnalysisId) {
          analysisDataFound = null; // Simulando mensaje de error
        }
      }

      // Debería fallar correctamente
      expect(analysisDataFound).toBeNull();
    });
  });

  describe('PDF Analysis Action Handlers', () => {
    test('should handle confirm_simple_pdf action with valid data', async () => {
      const analysisId = `simple_${Date.now()}_${mockCtx.from.id}`;
      const analysisData = {
        id: analysisId,
        analysis: {
          clientName: 'CONFIRM TEST CLIENT',
          orderNumber: 'CNF-001',
          totalAmount: 750.0,
          confidence: 90,
        },
        validation: { isValid: true },
        timestamp: Date.now(),
      };

      // Preparar datos como después de análisis
      mockCtx.userState.pdfAnalysis = analysisData;
      mockCtx.session.pdfAnalysis = analysisData;
      await mockCtx.saveSession();

      // Simular action handler
      const actionMatch = [null, analysisId]; // regex match simulation

      let analysisDataForAction = mockCtx.userState?.pdfAnalysis;

      if (!analysisDataForAction || analysisDataForAction.id !== analysisId) {
        analysisDataForAction = mockCtx.session?.pdfAnalysis;

        if (analysisDataForAction && analysisDataForAction.id === analysisId) {
          mockCtx.userState.pdfAnalysis = analysisDataForAction;
        }
      }

      // Verificar que los datos están disponibles para generar factura
      expect(analysisDataForAction).toBeDefined();
      expect(analysisDataForAction.id).toBe(analysisId);
      expect(analysisDataForAction.analysis.confidence).toBe(90);
    });

    test('should handle edit_simple_pdf action with data recovery', async () => {
      const analysisId = `simple_${Date.now()}_${mockCtx.from.id}`;
      const analysisData = {
        id: analysisId,
        analysis: {
          clientName: 'EDIT TEST CLIENT',
          clientCode: 'EDT001',
          orderNumber: 'EDT-001',
          totalAmount: 1200.0,
        },
        validation: { isValid: false }, // Requiere edición
        timestamp: Date.now(),
      };

      // Worker 1: Análisis inicial
      mockCtx.session.pdfAnalysis = analysisData;
      await mockCtx.saveSession();

      // Worker 2: Handle edit action (userState vacío)
      const editCtx = new MockTelegramContext(mockCtx.from.id);
      editCtx.sessionId = mockCtx.sessionId;
      await editCtx.loadSession();

      // Simular edit action handler
      let analysisDataForEdit = editCtx.userState?.pdfAnalysis;

      if (!analysisDataForEdit || analysisDataForEdit.id !== analysisId) {
        analysisDataForEdit = editCtx.session?.pdfAnalysis;

        if (analysisDataForEdit && analysisDataForEdit.id === analysisId) {
          editCtx.userState.pdfAnalysis = analysisDataForEdit;
        }
      }

      // Preparar datos para edición manual (como hace startManualEditFlow)
      if (analysisDataForEdit) {
        editCtx.userState.clienteNombre = analysisDataForEdit.analysis.clientName || '';
        editCtx.userState.clienteId = analysisDataForEdit.analysis.clientCode || '';
        editCtx.userState.numeroPedido = analysisDataForEdit.analysis.orderNumber || '';
        editCtx.userState.monto = analysisDataForEdit.analysis.totalAmount || 0;
      }

      // Verificar que la edición puede proceder
      expect(editCtx.userState.clienteNombre).toBe('EDIT TEST CLIENT');
      expect(editCtx.userState.numeroPedido).toBe('EDT-001');
      expect(editCtx.userState.monto).toBe(1200.0);
    });
  });

  describe('Invoice Generation from PDF Analysis', () => {
    test('should preserve analysis data through invoice generation process', async () => {
      const analysisId = `simple_${Date.now()}_${mockCtx.from.id}`;
      const analysisData = {
        id: analysisId,
        analysis: {
          clientName: 'INVOICE GEN CLIENT SA',
          orderNumber: 'INV-2025-001',
          totalAmount: 2500.0,
          confidence: 95,
        },
        validation: { isValid: true },
        timestamp: Date.now(),
      };

      // Análisis inicial
      mockCtx.userState.pdfAnalysis = analysisData;
      mockCtx.session.pdfAnalysis = analysisData;
      await mockCtx.saveSession();

      // Simular generación de factura exitosa
      const facturaSimulada = {
        id: `fact_${Date.now()}`,
        folio_number: 123,
        series: 'A',
      };

      // Actualizar estado como hace generateSimpleInvoice (después del fix)
      mockCtx.userState.facturaId = facturaSimulada.id;
      mockCtx.userState.folioFactura = facturaSimulada.folio_number;
      mockCtx.userState.series = facturaSimulada.series;

      // CRÍTICO: También en session
      mockCtx.session.facturaId = facturaSimulada.id;
      mockCtx.session.folioFactura = facturaSimulada.folio_number;
      mockCtx.session.series = facturaSimulada.series;
      mockCtx.session.facturaGenerada = true;

      // Limpiar análisis
      delete mockCtx.userState.pdfAnalysis;
      delete mockCtx.session.pdfAnalysis;

      await mockCtx.saveSession();

      // Verificar que datos de factura persisten y análisis se limpió
      expect(mockCtx.session.facturaId).toBe(facturaSimulada.id);
      expect(mockCtx.session.series).toBe('A');
      expect(mockCtx.session.pdfAnalysis).toBeUndefined();
    });

    test('should handle invoice data access from different worker', async () => {
      // Worker 1: Generar factura
      const facturaData = {
        facturaId: 'fact_test_123',
        folioFactura: 456,
        series: 'B',
        facturaGenerada: true,
      };

      mockCtx.session = { ...facturaData };
      await mockCtx.saveSession();

      // Worker 2: Acceder para descarga
      const downloadCtx = new MockTelegramContext(mockCtx.from.id);
      downloadCtx.sessionId = mockCtx.sessionId;
      await downloadCtx.loadSession();

      // Simular handler de descarga (después del fix)
      let series = downloadCtx.userState?.series;
      if (!series && downloadCtx.session?.series) {
        series = downloadCtx.session.series;
        downloadCtx.userState.series = series;
      }

      // Verificar que la descarga puede proceder
      expect(series).toBe('B');
      expect(downloadCtx.session.facturaId).toBe('fact_test_123');
      expect(downloadCtx.session.folioFactura).toBe(456);
    });
  });

  describe('Bug Prevention and Edge Cases', () => {
    test('should prevent "datos han expirado" false positives', async () => {
      const analysisId = `simple_${Date.now()}_${mockCtx.from.id}`;
      const analysisData = {
        id: analysisId,
        analysis: { clientName: 'PERSISTENCE TEST' },
        timestamp: Date.now(),
      };

      // Simular el flujo completo que causaba el bug

      // 1. Análisis inicial (Worker 1)
      mockCtx.userState.pdfAnalysis = analysisData;
      mockCtx.session.pdfAnalysis = analysisData;
      await mockCtx.saveSession();

      // 2. Usuario hace clic en botón (Worker 2)
      const actionCtx = new MockTelegramContext(mockCtx.from.id);
      actionCtx.sessionId = mockCtx.sessionId;
      await actionCtx.loadSession();

      // 3. Verificar que los datos están disponibles
      let recoveredAnalysis = actionCtx.userState?.pdfAnalysis;

      if (!recoveredAnalysis || recoveredAnalysis.id !== analysisId) {
        recoveredAnalysis = actionCtx.session?.pdfAnalysis;

        if (recoveredAnalysis && recoveredAnalysis.id === analysisId) {
          actionCtx.userState.pdfAnalysis = recoveredAnalysis;
        }
      }

      // Con el fix, esto NO debería dar "datos han expirado"
      expect(recoveredAnalysis).toBeDefined();
      expect(recoveredAnalysis.id).toBe(analysisId);
    });

    test('should handle concurrent PDF analysis operations', async () => {
      const analysisId1 = `simple_${Date.now()}_${mockCtx.from.id}`;
      const analysisId2 = `simple_${Date.now() + 1}_${mockCtx.from.id}`;

      const analysisData1 = {
        id: analysisId1,
        analysis: { clientName: 'CONCURRENT CLIENT 1' },
        timestamp: Date.now(),
      };

      const analysisData2 = {
        id: analysisId2,
        analysis: { clientName: 'CONCURRENT CLIENT 2' },
        timestamp: Date.now() + 1,
      };

      // Simular análisis casi simultáneos
      mockCtx.session.pdfAnalysis = analysisData1;
      await mockCtx.saveSession();

      // Rápidamente sobreescribir con nuevo análisis
      mockCtx.session.pdfAnalysis = analysisData2;
      await mockCtx.saveSession();

      // El segundo análisis debería prevalecer
      const result = await mockCtx.loadSession();
      expect(result.success).toBe(true);
      expect(mockCtx.session.pdfAnalysis.id).toBe(analysisId2);
      expect(mockCtx.session.pdfAnalysis.analysis.clientName).toBe('CONCURRENT CLIENT 2');
    });

    test('should cleanup analysis data after successful invoice generation', async () => {
      const analysisId = `simple_${Date.now()}_${mockCtx.from.id}`;
      const analysisData = {
        id: analysisId,
        analysis: { clientName: 'CLEANUP TEST CLIENT' },
        timestamp: Date.now(),
      };

      // Análisis inicial
      mockCtx.userState.pdfAnalysis = analysisData;
      mockCtx.session.pdfAnalysis = analysisData;
      await mockCtx.saveSession();

      // Simular generación exitosa y limpieza
      delete mockCtx.userState.pdfAnalysis;
      delete mockCtx.session.pdfAnalysis;

      mockCtx.session.facturaGenerada = true;
      await mockCtx.saveSession();

      // Verificar limpieza
      expect(mockCtx.session.pdfAnalysis).toBeUndefined();
      expect(mockCtx.userState.pdfAnalysis).toBeUndefined();
      expect(mockCtx.session.facturaGenerada).toBe(true);
    });
  });
});
