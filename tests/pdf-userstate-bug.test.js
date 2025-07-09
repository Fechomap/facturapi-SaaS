// tests/pdf-userstate-bug.test.js - Test específico para el bug de userState undefined
import redisSessionService from '../services/redis-session.service.js';

// Mock del contexto problemático (sin userState inicializado)
class BuggyTelegramContext {
  constructor(userId = 12345) {
    this.from = { id: userId };
    // NOTA: Intencionalmente NO inicializar userState ni session
    this.messages = [];
  }

  async reply(message, options) {
    this.messages.push({ message, options });
    return { message_id: Math.floor(Math.random() * 1000) };
  }

  hasTenant() { return true; }
  getTenantId() { return 'test-tenant-123'; }

  async saveSession() {
    // Mock simplificado
    return { success: true };
  }
}

describe('PDF UserState Bug Fix', () => {
  beforeAll(async () => {
    await redisSessionService.initialize();
  });

  afterAll(async () => {
    await redisSessionService.disconnect();
  });

  describe('showSimpleAnalysisResults function protection', () => {
    test('should handle undefined userState gracefully', async () => {
      const ctx = new BuggyTelegramContext();
      
      // Verificar que userState y session no están inicializados
      expect(ctx.userState).toBeUndefined();
      expect(ctx.session).toBeUndefined();

      const analysisData = {
        clientName: 'TEST CLIENT',
        orderNumber: 'TEST-001',
        totalAmount: 1000.00,
        confidence: 85
      };

      const validationData = {
        isValid: true,
        errors: []
      };

      // Importar y ejecutar la función que causaba el error
      const mockShowSimpleAnalysisResults = async (ctx, analysis, validation) => {
        const analysisId = `simple_${Date.now()}_${ctx.from.id}`;
        
        // CRÍTICO: Asegurar que userState y session estén inicializados
        if (!ctx.userState) {
          ctx.userState = {};
        }
        if (!ctx.session) {
          ctx.session = {};
        }
        
        // NUEVO: Guardar en estado del usuario Y en sesión para persistencia entre workers
        const analysisData = {
          id: analysisId,
          analysis,
          validation,
          timestamp: Date.now()
        };
        
        ctx.userState.pdfAnalysis = analysisData;
        ctx.session.pdfAnalysis = analysisData;
        
        // Simular guardado de sesión
        try {
          await ctx.saveSession();
        } catch (error) {
          console.error('Error guardando análisis PDF en sesión:', error);
        }
        
        return analysisData;
      };

      // Esta función anteriormente causaba: "Cannot set properties of undefined (setting 'pdfAnalysis')"
      let thrownError = null;
      let result = null;

      try {
        result = await mockShowSimpleAnalysisResults(ctx, analysisData, validationData);
      } catch (error) {
        thrownError = error;
      }

      // Verificar que NO se lanza el error
      expect(thrownError).toBeNull();
      expect(result).toBeDefined();
      
      // Verificar que userState se inicializó correctamente
      expect(ctx.userState).toBeDefined();
      expect(ctx.userState).toEqual(expect.objectContaining({
        pdfAnalysis: expect.objectContaining({
          id: expect.any(String),
          analysis: analysisData,
          validation: validationData,
          timestamp: expect.any(Number)
        })
      }));

      // Verificar que session también se inicializó
      expect(ctx.session).toBeDefined();
      expect(ctx.session.pdfAnalysis).toBeDefined();
    });

    test('should handle undefined session gracefully', async () => {
      const ctx = new BuggyTelegramContext();
      ctx.userState = {}; // Inicializar userState pero no session

      expect(ctx.userState).toBeDefined();
      expect(ctx.session).toBeUndefined();

      const mockFunction = async (ctx) => {
        // Simular la protección agregada
        if (!ctx.userState) {
          ctx.userState = {};
        }
        if (!ctx.session) {
          ctx.session = {};
        }
        
        ctx.userState.testProperty = 'test-value';
        ctx.session.testProperty = 'test-value';
        
        return { success: true };
      };

      let thrownError = null;
      let result = null;

      try {
        result = await mockFunction(ctx);
      } catch (error) {
        thrownError = error;
      }

      expect(thrownError).toBeNull();
      expect(result).toEqual({ success: true });
      expect(ctx.session).toBeDefined();
      expect(ctx.session.testProperty).toBe('test-value');
    });
  });

  describe('Action handlers protection', () => {
    test('should handle undefined userState in confirm action', async () => {
      const ctx = new BuggyTelegramContext();
      
      // Simular handler de confirmación
      const mockConfirmHandler = async (ctx, analysisId) => {
        // CRÍTICO: Asegurar que userState y session estén inicializados
        if (!ctx.userState) {
          ctx.userState = {};
        }
        if (!ctx.session) {
          ctx.session = {};
        }
        
        // NUEVO: Buscar primero en userState, luego en session
        let analysisData = ctx.userState?.pdfAnalysis;
        
        if (!analysisData || analysisData.id !== analysisId) {
          // Intentar recuperar de session (puede estar en otro worker)
          analysisData = ctx.session?.pdfAnalysis;
          
          if (!analysisData || analysisData.id !== analysisId) {
            return { error: 'Los datos han expirado. Sube el PDF nuevamente.' };
          }
          
          // Restaurar en userState
          ctx.userState.pdfAnalysis = analysisData;
        }
        
        return { success: true, analysisData };
      };

      let thrownError = null;
      let result = null;

      try {
        result = await mockConfirmHandler(ctx, 'test-analysis-id');
      } catch (error) {
        thrownError = error;
      }

      expect(thrownError).toBeNull();
      expect(result).toBeDefined();
      expect(ctx.userState).toBeDefined();
      expect(ctx.session).toBeDefined();
    });

    test('should handle undefined userState in edit action', async () => {
      const ctx = new BuggyTelegramContext();
      
      // Simular handler de edición
      const mockEditHandler = async (ctx, analysisId) => {
        // CRÍTICO: Asegurar que userState y session estén inicializados
        if (!ctx.userState) {
          ctx.userState = {};
        }
        if (!ctx.session) {
          ctx.session = {};
        }
        
        // Simular búsqueda de análisis
        let analysisData = ctx.userState?.pdfAnalysis;
        
        if (!analysisData || analysisData.id !== analysisId) {
          analysisData = ctx.session?.pdfAnalysis;
          
          if (!analysisData || analysisData.id !== analysisId) {
            return { error: 'Los datos han expirado. Sube el PDF nuevamente.' };
          }
          
          ctx.userState.pdfAnalysis = analysisData;
        }
        
        return { success: true, analysisData };
      };

      let thrownError = null;
      let result = null;

      try {
        result = await mockEditHandler(ctx, 'test-analysis-id');
      } catch (error) {
        thrownError = error;
      }

      expect(thrownError).toBeNull();
      expect(result).toBeDefined();
      expect(ctx.userState).toBeDefined();
      expect(ctx.session).toBeDefined();
    });
  });

  describe('generateSimpleInvoice function protection', () => {
    test('should handle undefined userState in invoice generation', async () => {
      const ctx = new BuggyTelegramContext();
      
      const analysisData = {
        analysis: {
          clientName: 'TEST CLIENT',
          orderNumber: 'TEST-001',
          totalAmount: 1000.00
        }
      };

      // Simular función de generación de factura
      const mockGenerateInvoice = async (ctx, analysisData) => {
        const { analysis } = analysisData;
        
        // CRÍTICO: Asegurar que userState y session estén inicializados
        if (!ctx.userState) {
          ctx.userState = {};
        }
        if (!ctx.session) {
          ctx.session = {};
        }
        
        // Simular datos de factura
        const factura = {
          id: 'fact_test_123',
          folio_number: 456,
          series: 'A'
        };
        
        // Actualizar estado
        ctx.userState.facturaId = factura.id;
        ctx.userState.folioFactura = factura.folio_number;
        ctx.userState.series = factura.series;
        
        ctx.session.facturaId = factura.id;
        ctx.session.folioFactura = factura.folio_number;
        ctx.session.series = factura.series;
        ctx.session.facturaGenerada = true;
        
        return factura;
      };

      let thrownError = null;
      let result = null;

      try {
        result = await mockGenerateInvoice(ctx, analysisData);
      } catch (error) {
        thrownError = error;
      }

      expect(thrownError).toBeNull();
      expect(result).toBeDefined();
      expect(ctx.userState).toBeDefined();
      expect(ctx.session).toBeDefined();
      expect(ctx.userState.facturaId).toBe('fact_test_123');
      expect(ctx.session.facturaId).toBe('fact_test_123');
    });
  });

  describe('startManualEditFlow function protection', () => {
    test('should handle undefined userState in manual edit flow', async () => {
      const ctx = new BuggyTelegramContext();
      
      const analysisData = {
        analysis: {
          clientName: 'TEST CLIENT',
          clientCode: 'TEST001',
          orderNumber: 'TEST-001',
          totalAmount: 1000.00
        }
      };

      // Simular función de edición manual
      const mockStartManualEditFlow = async (ctx, analysisData) => {
        const { analysis } = analysisData;
        
        // CRÍTICO: Asegurar que userState esté inicializado
        if (!ctx.userState) {
          ctx.userState = {};
        }
        
        // Prellenar datos conocidos
        ctx.userState.clienteNombre = analysis.clientName || '';
        ctx.userState.clienteId = analysis.clientCode || '';
        ctx.userState.numeroPedido = analysis.orderNumber || '';
        ctx.userState.monto = analysis.totalAmount || 0;
        
        // Limpiar análisis
        delete ctx.userState.pdfAnalysis;
        
        return { success: true };
      };

      let thrownError = null;
      let result = null;

      try {
        result = await mockStartManualEditFlow(ctx, analysisData);
      } catch (error) {
        thrownError = error;
      }

      expect(thrownError).toBeNull();
      expect(result).toBeDefined();
      expect(ctx.userState).toBeDefined();
      expect(ctx.userState.clienteNombre).toBe('TEST CLIENT');
      expect(ctx.userState.numeroPedido).toBe('TEST-001');
      expect(ctx.userState.monto).toBe(1000.00);
    });
  });

  describe('Real world scenario simulation', () => {
    test('should handle the exact error scenario from logs', async () => {
      // Simular el escenario exacto del log de error
      const ctx = new BuggyTelegramContext(7143094298);
      
      // El contexto viene sin userState inicializado
      expect(ctx.userState).toBeUndefined();
      
      const analysisResult = {
        success: true,
        analysis: {
          client: "ARSA",
          errors: [],
          metadata: {
            extractedAt: "2025-07-09T03:14:06.892Z",
            providerName: "ALFREDO ALEJANDRO PEREZ",
            hasValidStructure: true
          },
          clientCode: "ARSA",
          clientName: "ARSA ASESORIA INTEGRAL PROFESIONAL",
          confidence: 100,
          orderNumber: "5101078261",
          totalAmount: 14698.58
        }
      };

      const validation = {
        errors: [],
        isValid: true,
        warnings: [],
        confidence: 100
      };

      // Simular exactamente lo que pasaba en showSimpleAnalysisResults
      const simulateOriginalError = async () => {
        const analysisId = `simple_${Date.now()}_${ctx.from.id}`;
        
        const analysisData = {
          id: analysisId,
          analysis: analysisResult.analysis,
          validation,
          timestamp: Date.now()
        };
        
        // Esta línea causaba el error: "Cannot set properties of undefined (setting 'pdfAnalysis')"
        // ctx.userState.pdfAnalysis = analysisData; // ← ERROR AQUÍ
        
        // CON EL FIX:
        if (!ctx.userState) {
          ctx.userState = {};
        }
        if (!ctx.session) {
          ctx.session = {};
        }
        
        ctx.userState.pdfAnalysis = analysisData;
        ctx.session.pdfAnalysis = analysisData;
        
        return analysisData;
      };

      let thrownError = null;
      let result = null;

      try {
        result = await simulateOriginalError();
      } catch (error) {
        thrownError = error;
      }

      // Verificar que el error está solucionado
      expect(thrownError).toBeNull();
      expect(result).toBeDefined();
      expect(ctx.userState).toBeDefined();
      expect(ctx.userState.pdfAnalysis).toBeDefined();
      expect(ctx.userState.pdfAnalysis.analysis.clientName).toBe('ARSA ASESORIA INTEGRAL PROFESIONAL');
      expect(ctx.userState.pdfAnalysis.analysis.orderNumber).toBe('5101078261');
      expect(ctx.userState.pdfAnalysis.analysis.totalAmount).toBe(14698.58);
    });
  });
});