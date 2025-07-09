// tests/redis-session.service.test.js
import redisSessionService from '../services/redis-session.service.js';

describe('Redis Session Service', () => {
  beforeAll(async () => {
    // Inicializar el servicio antes de las pruebas
    await redisSessionService.initialize();
  });

  afterAll(async () => {
    // Limpiar después de las pruebas
    await redisSessionService.disconnect();
  });

  beforeEach(async () => {
    // Limpiar sesiones de prueba antes de cada test
    await redisSessionService.cleanupMemoryStore();
  });

  describe('Session CRUD Operations', () => {
    test('should save and retrieve session data correctly', async () => {
      const sessionId = 'test_session_123';
      const sessionData = {
        userId: 'user_456',
        tenantId: 'tenant_789',
        pdfAnalysis: {
          id: 'analysis_123',
          analysis: { clientName: 'Test Client SA' },
          timestamp: Date.now()
        }
      };

      // Guardar sesión
      const saveResult = await redisSessionService.setSession(sessionId, sessionData, 3600);
      expect(saveResult.success).toBe(true);

      // Recuperar sesión
      const getResult = await redisSessionService.getSession(sessionId);
      expect(getResult.success).toBe(true);
      expect(getResult.data.userId).toBe(sessionData.userId);
      expect(getResult.data.pdfAnalysis.analysis.clientName).toBe('Test Client SA');

      // Limpiar
      await redisSessionService.deleteSession(sessionId);
    });

    test('should handle non-existent sessions gracefully', async () => {
      const result = await redisSessionService.getSession('non_existent_session');
      expect(result.success).toBe(false);
      expect(result.error).toContain('no encontrada');
    });

    test('should delete sessions correctly', async () => {
      const sessionId = 'test_delete_session';
      const sessionData = { userId: 'test_user' };

      // Crear y verificar
      await redisSessionService.setSession(sessionId, sessionData);
      let getResult = await redisSessionService.getSession(sessionId);
      expect(getResult.success).toBe(true);

      // Eliminar y verificar
      const deleteResult = await redisSessionService.deleteSession(sessionId);
      expect(deleteResult.success).toBe(true);

      getResult = await redisSessionService.getSession(sessionId);
      expect(getResult.success).toBe(false);
    });
  });

  describe('Session Persistence Across Workers', () => {
    test('should persist complex data structures between simulated workers', async () => {
      const sessionId = 'worker_test_session';
      const complexData = {
        userId: 'user_123',
        tenantId: 'tenant_456',
        pdfAnalysis: {
          id: 'analysis_789',
          analysis: {
            clientName: 'COMPLEJO EMPRESARIAL SA DE CV',
            clientCode: 'CLI001',
            orderNumber: 'ORD-2025-001',
            totalAmount: 1160.00,
            confidence: 85,
            items: [
              { description: 'Producto 1', amount: 500 },
              { description: 'Producto 2', amount: 660 }
            ]
          },
          validation: { isValid: true },
          timestamp: Date.now()
        },
        facturaState: {
          step: 'confirmation',
          transactionId: 'tx_123456'
        }
      };

      // Worker 1: Guardar datos
      await redisSessionService.setSession(sessionId, complexData);

      // Simular latencia entre workers
      await new Promise(resolve => setTimeout(resolve, 100));

      // Worker 2: Recuperar datos
      const retrievedResult = await redisSessionService.getSession(sessionId);
      
      expect(retrievedResult.success).toBe(true);
      expect(retrievedResult.data.pdfAnalysis.analysis.clientName).toBe('COMPLEJO EMPRESARIAL SA DE CV');
      expect(retrievedResult.data.pdfAnalysis.analysis.items).toHaveLength(2);
      expect(retrievedResult.data.facturaState.transactionId).toBe('tx_123456');

      // Limpiar
      await redisSessionService.deleteSession(sessionId);
    });

    test('should handle concurrent access from multiple workers', async () => {
      const sessionId = 'concurrent_test_session';
      const baseData = { userId: 'concurrent_user', counter: 0 };

      // Guardar datos iniciales
      await redisSessionService.setSession(sessionId, baseData);

      // Simular múltiples workers accediendo concurrentemente
      const workers = Array.from({ length: 5 }, async (_, index) => {
        const result = await redisSessionService.getSession(sessionId);
        expect(result.success).toBe(true);
        expect(result.data.userId).toBe('concurrent_user');
        
        // Cada worker actualiza con su índice
        const updatedData = { ...result.data, workerId: index };
        await redisSessionService.setSession(sessionId, updatedData);
        return index;
      });

      await Promise.all(workers);

      // Verificar que los datos se mantuvieron consistentes
      const finalResult = await redisSessionService.getSession(sessionId);
      expect(finalResult.success).toBe(true);
      expect(finalResult.data.userId).toBe('concurrent_user');

      // Limpiar
      await redisSessionService.deleteSession(sessionId);
    });
  });

  describe('TTL and Expiration', () => {
    test('should respect TTL settings', async () => {
      const sessionId = 'ttl_test_session';
      const sessionData = { userId: 'ttl_user' };

      // Guardar con TTL muy corto (1 segundo)
      await redisSessionService.setSession(sessionId, sessionData, 1);

      // Verificar que existe inmediatamente
      let result = await redisSessionService.getSession(sessionId);
      expect(result.success).toBe(true);

      // Esperar expiración
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Verificar que expiró
      result = await redisSessionService.getSession(sessionId);
      expect(result.success).toBe(false);
    }, 3000);
  });

  describe('Error Handling', () => {
    test('should handle invalid session data gracefully', async () => {
      const sessionId = 'invalid_data_session';
      
      // Intentar guardar datos circulares (no serializables)
      const circularData = { userId: 'test' };
      circularData.self = circularData;

      const result = await redisSessionService.setSession(sessionId, circularData);
      
      // Debería manejar el error sin crashear
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should provide meaningful error messages', async () => {
      const result = await redisSessionService.getSession('');
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
    });
  });

  describe('Statistics and Health Check', () => {
    test('should provide accurate statistics', async () => {
      const stats = await redisSessionService.getStats();
      
      expect(stats).toHaveProperty('type');
      expect(stats).toHaveProperty('connected');
      expect(stats.type === 'redis' || stats.type === 'memory').toBe(true);
      
      if (stats.type === 'redis') {
        expect(stats).toHaveProperty('activeSessions');
        expect(typeof stats.activeSessions).toBe('number');
      }
    });

    test('should indicate proper connection status', async () => {
      const stats = await redisSessionService.getStats();
      
      // En ambiente de test, debería estar conectado o usar memoria
      expect(stats.type === 'redis' || stats.type === 'memory').toBe(true);
      
      if (stats.type === 'redis') {
        expect(stats.connected).toBe(true);
      }
    });
  });

  describe('Bug Prevention Tests', () => {
    test('should prevent data loss between workers (Bug Fix Verification)', async () => {
      const sessionId = 'bug_prevention_session';
      
      // Simular el bug original: datos de PDF analysis perdidos entre workers
      const pdfAnalysisData = {
        userId: 'user_bug_test',
        pdfAnalysis: {
          id: 'analysis_bug_test',
          analysis: {
            clientName: 'BUG TEST CLIENT SA',
            orderNumber: 'BUG-001',
            totalAmount: 999.99
          },
          timestamp: Date.now()
        }
      };

      // Worker 1: Guarda análisis de PDF
      await redisSessionService.setSession(sessionId, pdfAnalysisData);

      // Worker 2: Debe poder recuperar los datos
      const recoveredData = await redisSessionService.getSession(sessionId);
      expect(recoveredData.success).toBe(true);
      expect(recoveredData.data.pdfAnalysis.analysis.clientName).toBe('BUG TEST CLIENT SA');

      // Worker 3: Simula generación de factura (actualiza estado)
      const updatedData = {
        ...recoveredData.data,
        facturaId: 'factura_123',
        folioFactura: '456',
        series: 'A',
        facturaGenerada: true
      };

      await redisSessionService.setSession(sessionId, updatedData);

      // Worker 4: Debe poder acceder a datos de factura para descarga
      const finalData = await redisSessionService.getSession(sessionId);
      expect(finalData.success).toBe(true);
      expect(finalData.data.facturaId).toBe('factura_123');
      expect(finalData.data.series).toBe('A');

      // Limpiar
      await redisSessionService.deleteSession(sessionId);
    });

    test('should handle rapid successive operations without data corruption', async () => {
      const sessionId = 'rapid_ops_session';
      const baseData = { userId: 'rapid_user', operations: [] };

      // Realizar operaciones rápidas y sucesivas
      for (let i = 0; i < 10; i++) {
        const data = { ...baseData, operations: [...baseData.operations, `op_${i}`] };
        await redisSessionService.setSession(sessionId, data);
        baseData.operations.push(`op_${i}`);
      }

      // Verificar integridad final
      const finalResult = await redisSessionService.getSession(sessionId);
      expect(finalResult.success).toBe(true);
      expect(finalResult.data.operations).toHaveLength(10);

      // Limpiar
      await redisSessionService.deleteSession(sessionId);
    });
  });
});