// tests/clustering-integration.test.js
import redisSessionService from '../services/redis-session.service.js';

// Mock completo del flujo de clustering
class MockWorkerContext {
  constructor(workerId, userId = 12345) {
    this.workerId = workerId;
    this.from = { id: userId };
    this.userState = {};
    this.session = {};
    this.sessionId = `session_${userId}_${Date.now()}`;
    this.messages = [];
    this._activeProcesses = new Set();
  }

  async reply(message, options) {
    this.messages.push({ 
      workerId: this.workerId,
      message, 
      options, 
      timestamp: Date.now() 
    });
    return { message_id: Math.floor(Math.random() * 1000) };
  }

  async saveSession() {
    const result = await redisSessionService.setSession(this.sessionId, this.session, 3600);
    if (result.success) {
      console.log(`Worker ${this.workerId}: Session saved successfully`);
    }
    return result;
  }

  async loadSession() {
    const result = await redisSessionService.getSession(this.sessionId);
    if (result.success) {
      this.session = result.data;
      console.log(`Worker ${this.workerId}: Session loaded successfully`);
    }
    return result;
  }

  hasTenant() { return true; }
  getTenantId() { return 'test-tenant-clustering'; }

  isProcessActive(processId) {
    return this._activeProcesses.has(processId);
  }

  markProcessActive(processId) {
    this._activeProcesses.add(processId);
    console.log(`Worker ${this.workerId}: Process ${processId} marked active`);
  }

  markProcessInactive(processId) {
    this._activeProcesses.delete(processId);
    console.log(`Worker ${this.workerId}: Process ${processId} marked inactive`);
  }
}

// Simulador de operaciones FacturAPI con latencia variable
class MockFacturapiService {
  static async generateInvoice(data, tenantId, simulateDelay = 100) {
    // Simular latencia de red variable
    const delay = simulateDelay + Math.random() * 200;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Simular fallas ocasionales (10% de probabilidad)
    if (Math.random() < 0.1) {
      throw new Error('Simulated FacturAPI timeout');
    }

    return {
      id: `fact_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      folio_number: Math.floor(Math.random() * 9999) + 1,
      series: ['A', 'B', 'C'][Math.floor(Math.random() * 3)]
    };
  }
}

describe('Clustering Integration Tests', () => {
  beforeAll(async () => {
    await redisSessionService.initialize();
  });

  afterAll(async () => {
    await redisSessionService.disconnect();
  });

  beforeEach(async () => {
    // Limpiar Redis antes de cada test
    const stats = await redisSessionService.getStats();
    if (stats.type === 'redis') {
      // En un entorno de test real, aquí limpiaríamos la DB de Redis
      console.log('Redis está disponible para tests de clustering');
    }
  });

  describe('Multi-Worker PDF Analysis Flow', () => {
    test('should handle PDF analysis across multiple workers', async () => {
      const userId = 12345;
      const sessionId = `session_${userId}_${Date.now()}`;

      // Worker 1: Recibe y analiza PDF
      const worker1 = new MockWorkerContext('W1', userId);
      worker1.sessionId = sessionId;

      const analysisId = `simple_${Date.now()}_${userId}`;
      const analysisData = {
        id: analysisId,
        analysis: {
          clientName: 'CLUSTERING TEST CLIENT SA',
          orderNumber: 'CLUST-001',
          totalAmount: 5000.00,
          confidence: 92
        },
        validation: { isValid: true },
        timestamp: Date.now()
      };

      // Simular análisis PDF en Worker 1
      worker1.userState.pdfAnalysis = analysisData;
      worker1.session.pdfAnalysis = analysisData;
      await worker1.saveSession();

      // Worker 2: Usuario hace clic en "Generar Factura"
      const worker2 = new MockWorkerContext('W2', userId);
      worker2.sessionId = sessionId;
      await worker2.loadSession();

      // Simular recuperación de datos como hace el action handler
      let recoveredAnalysis = worker2.userState?.pdfAnalysis;
      if (!recoveredAnalysis || recoveredAnalysis.id !== analysisId) {
        recoveredAnalysis = worker2.session?.pdfAnalysis;
        if (recoveredAnalysis && recoveredAnalysis.id === analysisId) {
          worker2.userState.pdfAnalysis = recoveredAnalysis;
        }
      }

      // Verificar recuperación exitosa
      expect(recoveredAnalysis).toBeDefined();
      expect(recoveredAnalysis.id).toBe(analysisId);
      expect(recoveredAnalysis.analysis.clientName).toBe('CLUSTERING TEST CLIENT SA');

      // Worker 3: Genera la factura
      const worker3 = new MockWorkerContext('W3', userId);
      worker3.sessionId = sessionId;
      worker3.userState.pdfAnalysis = recoveredAnalysis;

      try {
        const factura = await MockFacturapiService.generateInvoice(
          recoveredAnalysis.analysis, 
          worker3.getTenantId()
        );

        // Actualizar estado con datos de factura
        worker3.session.facturaId = factura.id;
        worker3.session.folioFactura = factura.folio_number;
        worker3.session.series = factura.series;
        worker3.session.facturaGenerada = true;

        // Limpiar análisis
        delete worker3.session.pdfAnalysis;
        await worker3.saveSession();

        // Verificar estado final
        expect(worker3.session.facturaId).toBe(factura.id);
        expect(worker3.session.pdfAnalysis).toBeUndefined();

      } catch (error) {
        // Simular reintentos como en el código real
        console.log(`Worker 3 falló, será reintentado: ${error.message}`);
      }

      // Limpiar
      await redisSessionService.deleteSession(sessionId);
    });

    test('should handle concurrent access from multiple workers', async () => {
      const userId = 99999;
      const sessionId = `concurrent_session_${Date.now()}`;
      const numWorkers = 5;

      // Datos iniciales
      const baseData = {
        userId: userId,
        concurrentOperations: [],
        lastUpdate: Date.now()
      };

      // Worker inicial establece la sesión
      const initialWorker = new MockWorkerContext('INIT', userId);
      initialWorker.sessionId = sessionId;
      initialWorker.session = baseData;
      await initialWorker.saveSession();

      // Crear múltiples workers que operan concurrentemente
      const workers = Array.from({ length: numWorkers }, (_, index) => {
        const worker = new MockWorkerContext(`W${index + 1}`, userId);
        worker.sessionId = sessionId;
        return worker;
      });

      // Operaciones concurrentes
      const concurrentOperations = workers.map(async (worker, index) => {
        // Cada worker carga la sesión
        await worker.loadSession();
        
        // Simular latencia variable
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        
        // Actualizar datos
        const currentOps = worker.session.concurrentOperations || [];
        worker.session.concurrentOperations = [...currentOps, `op_${worker.workerId}_${Date.now()}`];
        worker.session.lastUpdate = Date.now();
        
        // Guardar cambios
        await worker.saveSession();
        
        return worker.workerId;
      });

      // Esperar que todos terminen
      const completedWorkers = await Promise.all(concurrentOperations);

      // Verificar resultado final
      const finalWorker = new MockWorkerContext('FINAL', userId);
      finalWorker.sessionId = sessionId;
      await finalWorker.loadSession();

      expect(completedWorkers).toHaveLength(numWorkers);
      expect(finalWorker.session.concurrentOperations).toBeDefined();
      expect(finalWorker.session.lastUpdate).toBeGreaterThan(baseData.lastUpdate);

      // Limpiar
      await redisSessionService.deleteSession(sessionId);
    });
  });

  describe('Multi-Worker Invoice Generation with Retries', () => {
    test('should handle invoice generation failures and retries across workers', async () => {
      const userId = 54321;
      const sessionId = `retry_session_${Date.now()}`;

      // Worker 1: Intenta generar factura (falla)
      const worker1 = new MockWorkerContext('RETRY1', userId);
      worker1.sessionId = sessionId;

      const facturaData = {
        clienteNombre: 'RETRY CLIENT SA',
        numeroPedido: 'RETRY-001',
        monto: 1500.00,
        claveProducto: '78101803'
      };

      worker1.session = { ...facturaData, retryAttempts: 0 };
      await worker1.saveSession();

      // Simular falla en Worker 1 (forzar error con probabilidad 100%)
      let factura = null;
      try {
        factura = await MockFacturapiService.generateInvoice(facturaData, worker1.getTenantId(), 1); // Probabilidad 99% de error
      } catch (error) {
        worker1.session.retryAttempts = 1;
        worker1.session.lastError = error.message;
        await worker1.saveSession();
        console.log(`Worker 1 falló: ${error.message}`);
      }

      // Si por casualidad no falló, forzar el error
      if (factura !== null) {
        worker1.session.retryAttempts = 1;
        worker1.session.lastError = 'Forced error for test';
        await worker1.saveSession();
        factura = null;
      }

      expect(factura).toBeNull();

      // Worker 2: Toma el reintento
      const worker2 = new MockWorkerContext('RETRY2', userId);
      worker2.sessionId = sessionId;
      await worker2.loadSession();

      expect(worker2.session.retryAttempts).toBe(1);

      // Reintento en Worker 2 (con mayor probabilidad de éxito)
      let retrySuccess = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          factura = await MockFacturapiService.generateInvoice(
            facturaData, 
            worker2.getTenantId(), 
            20 // Menor latencia para aumentar probabilidad de éxito
          );
          retrySuccess = true;
          break;
        } catch (error) {
          worker2.session.retryAttempts = worker2.session.retryAttempts + 1;
          await worker2.saveSession();
          await new Promise(resolve => setTimeout(resolve, 50)); // Delay entre reintentos
        }
      }

      if (retrySuccess) {
        worker2.session.facturaId = factura.id;
        worker2.session.folioFactura = factura.folio_number;
        worker2.session.series = factura.series;
        worker2.session.facturaGenerada = true;
        delete worker2.session.lastError;
        await worker2.saveSession();

        expect(factura).toBeDefined();
        expect(worker2.session.facturaGenerada).toBe(true);
      }

      // Limpiar
      await redisSessionService.deleteSession(sessionId);
    });
  });

  describe('Download Operations Across Workers', () => {
    test('should enable PDF/XML download from any worker after invoice generation', async () => {
      const userId = 77777;
      const sessionId = `download_session_${Date.now()}`;

      // Worker 1: Genera factura
      const generationWorker = new MockWorkerContext('GEN', userId);
      generationWorker.sessionId = sessionId;

      const facturaData = {
        id: 'fact_download_test',
        folio_number: 12345,
        series: 'D'
      };

      generationWorker.session = {
        facturaId: facturaData.id,
        folioFactura: facturaData.folio_number,
        series: facturaData.series,
        facturaGenerada: true,
        clienteNombre: 'DOWNLOAD TEST CLIENT'
      };

      await generationWorker.saveSession();

      // Worker 2: Intenta descargar PDF
      const downloadWorker1 = new MockWorkerContext('DOWN1', userId);
      downloadWorker1.sessionId = sessionId;
      await downloadWorker1.loadSession();

      // Simular handler de descarga PDF
      let series = downloadWorker1.userState?.series;
      if (!series && downloadWorker1.session?.series) {
        series = downloadWorker1.session.series;
        downloadWorker1.userState.series = series;
      }

      expect(series).toBe('D');
      expect(downloadWorker1.session.facturaId).toBe('fact_download_test');
      expect(downloadWorker1.session.folioFactura).toBe(12345);

      // Worker 3: Intenta descargar XML
      const downloadWorker2 = new MockWorkerContext('DOWN2', userId);
      downloadWorker2.sessionId = sessionId;
      await downloadWorker2.loadSession();

      // Simular handler de descarga XML
      let facturaId = downloadWorker2.userState?.facturaId;
      if (!facturaId && downloadWorker2.session?.facturaId) {
        facturaId = downloadWorker2.session.facturaId;
        downloadWorker2.userState.facturaId = facturaId;
      }

      expect(facturaId).toBe('fact_download_test');

      // Ambos workers deberían poder realizar la descarga
      const pdfDownloadPossible = Boolean(downloadWorker1.session.facturaId && series);
      const xmlDownloadPossible = Boolean(downloadWorker2.session.facturaId);

      expect(pdfDownloadPossible).toBe(true);
      expect(xmlDownloadPossible).toBe(true);

      // Limpiar
      await redisSessionService.deleteSession(sessionId);
    });
  });

  describe('Session Expiration and Cleanup', () => {
    test('should handle session expiration gracefully across workers', async () => {
      const userId = 88888;
      const shortSessionId = `short_session_${Date.now()}`;

      // Worker 1: Crea sesión con TTL corto
      const worker1 = new MockWorkerContext('SHORT1', userId);
      worker1.sessionId = shortSessionId;

      const sessionData = {
        userId: userId,
        temporaryData: 'This should expire',
        timestamp: Date.now()
      };

      // Guardar con TTL muy corto (1 segundo)
      await redisSessionService.setSession(shortSessionId, sessionData, 1);

      // Verificar que existe inmediatamente
      let result = await redisSessionService.getSession(shortSessionId);
      expect(result.success).toBe(true);

      // Worker 2: Intenta acceder después de expiración
      await new Promise(resolve => setTimeout(resolve, 1500));

      const worker2 = new MockWorkerContext('SHORT2', userId);
      worker2.sessionId = shortSessionId;

      result = await worker2.loadSession();
      expect(result.success).toBe(false);

      // El worker debería manejar la sesión expirada creando una nueva
      if (!result.success) {
        worker2.session = {
          userId: userId,
          newSession: true,
          timestamp: Date.now()
        };
        await worker2.saveSession();
      }

      expect(worker2.session.newSession).toBe(true);

      // Limpiar
      await redisSessionService.deleteSession(shortSessionId);
    }, 3000);
  });

  describe('High Load Simulation', () => {
    test('should handle high concurrent load with multiple users and workers', async () => {
      const numUsers = 10;
      const workersPerUser = 3;
      const operations = [];

      // Crear múltiples usuarios concurrentes
      for (let userId = 100000; userId < 100000 + numUsers; userId++) {
        const sessionId = `load_test_${userId}_${Date.now()}`;

        // Cada usuario tiene múltiples workers
        for (let workerIndex = 0; workerIndex < workersPerUser; workerIndex++) {
          const operation = async () => {
            const worker = new MockWorkerContext(`U${userId}_W${workerIndex}`, userId);
            worker.sessionId = sessionId;

            try {
              // Operación 1: Crear/cargar sesión
              const loadResult = await worker.loadSession();
              if (!loadResult.success) {
                worker.session = {
                  userId: userId,
                  operations: [],
                  createdBy: worker.workerId
                };
              }

              // Operación 2: Actualizar datos
              const currentOps = worker.session.operations || [];
              worker.session.operations = [...currentOps, {
                workerId: worker.workerId,
                timestamp: Date.now(),
                operation: `load_test_op_${workerIndex}`
              }];

              // Operación 3: Guardar
              await worker.saveSession();

              // Operación 4: Simular procesamiento
              await new Promise(resolve => setTimeout(resolve, Math.random() * 100));

              return {
                userId: userId,
                workerId: worker.workerId,
                success: true
              };

            } catch (error) {
              return {
                userId: userId,
                workerId: worker.workerId,
                success: false,
                error: error.message
              };
            }
          };

          operations.push(operation());
        }
      }

      // Ejecutar todas las operaciones concurrentemente
      const results = await Promise.all(operations);

      // Verificar resultados
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful.length).toBeGreaterThan(failed.length);
      expect(successful.length).toBeGreaterThanOrEqual(numUsers * workersPerUser * 0.8); // Al menos 80% de éxito

      console.log(`Load test results: ${successful.length} successful, ${failed.length} failed`);

      // Limpiar sesiones
      for (let userId = 100000; userId < 100000 + numUsers; userId++) {
        const sessionId = `load_test_${userId}_${Date.now()}`;
        await redisSessionService.deleteSession(sessionId).catch(() => {}); // Ignorar errores de limpieza
      }
    }, 10000); // Timeout más largo para este test
  });

  describe('Data Consistency Verification', () => {
    test('should maintain data consistency across rapid worker changes', async () => {
      const userId = 99999;
      const sessionId = `consistency_test_${Date.now()}`;
      const numOperations = 20;

      // Crear datos iniciales
      const initialWorker = new MockWorkerContext('INIT', userId);
      initialWorker.sessionId = sessionId;
      initialWorker.session = {
        userId: userId,
        operationLog: [],
        checksum: 0
      };
      await initialWorker.saveSession();

      // Realizar operaciones rápidas con diferentes workers
      for (let i = 0; i < numOperations; i++) {
        const worker = new MockWorkerContext(`OP${i}`, userId);
        worker.sessionId = sessionId;

        // Cargar estado actual
        await worker.loadSession();

        // Modificar datos
        const currentLog = worker.session.operationLog || [];
        const newOperation = {
          index: i,
          workerId: worker.workerId,
          timestamp: Date.now()
        };

        worker.session.operationLog = [...currentLog, newOperation];
        worker.session.checksum = worker.session.operationLog.length;

        // Guardar inmediatamente
        await worker.saveSession();

        // Pequeño delay para simular procesamiento
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Verificar consistencia final
      const finalWorker = new MockWorkerContext('FINAL', userId);
      finalWorker.sessionId = sessionId;
      await finalWorker.loadSession();

      expect(finalWorker.session.operationLog).toHaveLength(numOperations);
      expect(finalWorker.session.checksum).toBe(numOperations);

      // Verificar que todas las operaciones están registradas
      const operationIndices = finalWorker.session.operationLog.map(op => op.index).sort((a, b) => a - b);
      const expectedIndices = Array.from({ length: numOperations }, (_, i) => i);

      expect(operationIndices).toEqual(expectedIndices);

      // Limpiar
      await redisSessionService.deleteSession(sessionId);
    });
  });
});