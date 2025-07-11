// tests/setup.js - Setup global para tests Jest
import dotenv from 'dotenv';

// Cargar variables de entorno para tests
dotenv.config();

// Mock console methods para tests más limpios (opcional)
const originalError = console.error;
const originalWarn = console.warn;

beforeAll(() => {
  // Suprimir algunos logs durante tests para output más limpio
  console.error = (...args) => {
    // Solo mostrar errores que no sean de Redis/test
    if (!args[0]?.toString().includes('Redis') && !args[0]?.toString().includes('test')) {
      originalError(...args);
    }
  };

  console.warn = (...args) => {
    // Solo mostrar warnings importantes
    if (!args[0]?.toString().includes('ExperimentalWarning')) {
      originalWarn(...args);
    }
  };
});

afterAll(() => {
  // Restaurar console methods
  console.error = originalError;
  console.warn = originalWarn;
});

// Global test utilities
global.testUtils = {
  createMockTelegramContext: (userId = 12345) => ({
    from: { id: userId },
    userState: {},
    session: {},
    sessionId: `test_session_${userId}_${Date.now()}`,
    messages: [],
    async reply(message, options) {
      this.messages.push({ message, options });
      return { message_id: Math.floor(Math.random() * 1000) };
    },
    hasTenant: () => true,
    getTenantId: () => 'test-tenant-123',
  }),

  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

  generateTestAnalysisData: (overrides = {}) => ({
    id: `test_analysis_${Date.now()}`,
    analysis: {
      clientName: 'TEST CLIENT SA DE CV',
      orderNumber: 'TEST-001',
      totalAmount: 1000.0,
      confidence: 85,
      ...overrides.analysis,
    },
    validation: { isValid: true },
    timestamp: Date.now(),
    ...overrides,
  }),

  generateTestFacturaData: (overrides = {}) => ({
    id: `fact_test_${Date.now()}`,
    folio_number: Math.floor(Math.random() * 9999) + 1,
    series: 'A',
    ...overrides,
  }),
};
