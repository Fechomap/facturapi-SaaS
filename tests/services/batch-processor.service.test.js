// tests/services/batch-processor.service.test.js
import { jest } from '@jest/globals';
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Mock de dependencias
const mockPrisma = {
  tenantCustomer: {
    findFirst: jest.fn(),
  },
};

const mockPDFAnalysisService = {
  analyzePDF: jest.fn(),
};

const mockInvoiceService = {
  generateInvoice: jest.fn(),
};

const mockFacturapiQueueService = {
  enqueue: jest.fn(),
};

const mockAxios = jest.fn();

// Mock de módulos
jest.unstable_mockModule('../../lib/prisma.js', () => ({
  default: mockPrisma,
}));

jest.unstable_mockModule('../../services/pdf-analysis.service.js', () => ({
  default: mockPDFAnalysisService,
}));

jest.unstable_mockModule('../../services/invoice.service.js', () => ({
  default: mockInvoiceService,
}));

jest.unstable_mockModule('../../services/facturapi-queue.service.js', () => ({
  default: mockFacturapiQueueService,
}));

jest.unstable_mockModule('axios', () => ({
  default: mockAxios,
}));

// Importar el servicio a testear
const BatchProcessorService = await import('../../services/batch-processor.service.js');

describe('BatchProcessorService', () => {
  const mockTenantId = 'test-tenant-123';
  const mockCtx = {
    from: { id: 12345 },
    telegram: {
      getFileLink: jest.fn(),
    },
    message: {
      media_group_id: 'test-media-group',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    mockCtx.telegram.getFileLink.mockResolvedValue({
      href: 'https://api.telegram.org/file/test.pdf',
    });

    mockAxios.mockResolvedValue({
      data: {
        pipe: jest.fn((writer) => {
          // Simular escritura exitosa
          setTimeout(() => writer.emit('finish'), 10);
        }),
      },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateBatchId', () => {
    test('debe generar ID único para lote', () => {
      const batchId = BatchProcessorService.default.generateBatchId('media123', 'user456');
      expect(batchId).toBe('media123'); // Ahora usa el media_group_id directamente
    });

    test('debe usar timestamp si no hay mediaGroupId', () => {
      const batchId = BatchProcessorService.default.generateBatchId(null, 'user456');
      expect(batchId).toMatch(/^single_\d+_user456$/); // Ahora usa 'single_' prefix
    });
  });

  describe('validateBatch', () => {
    test('debe validar lote correcto', () => {
      const documents = [
        { file_name: 'test1.pdf', file_size: 1000 },
        { file_name: 'test2.pdf', file_size: 2000 },
      ];

      expect(() => {
        BatchProcessorService.default.validateBatch(documents);
      }).not.toThrow();
    });

    test('debe rechazar lote vacío', () => {
      expect(() => {
        BatchProcessorService.default.validateBatch([]);
      }).toThrow('No se encontraron documentos en el lote');
    });

    test('debe rechazar más de 10 PDFs', () => {
      const documents = Array(11)
        .fill()
        .map((_, i) => ({
          file_name: `test${i}.pdf`,
          file_size: 1000,
        }));

      expect(() => {
        BatchProcessorService.default.validateBatch(documents);
      }).toThrow('Máximo 10 PDFs por lote');
    });

    test('debe rechazar archivos no PDF', () => {
      const documents = [
        { file_name: 'test1.pdf', file_size: 1000 },
        { file_name: 'test2.docx', file_size: 1000 },
      ];

      expect(() => {
        BatchProcessorService.default.validateBatch(documents);
      }).toThrow('Todos los archivos deben ser PDF');
    });

    test('debe rechazar lote con tamaño excesivo', () => {
      const documents = [
        { file_name: 'test1.pdf', file_size: 60 * 1024 * 1024 }, // 60MB
        { file_name: 'test2.pdf', file_size: 60 * 1024 * 1024 }, // 60MB
      ];

      expect(() => {
        BatchProcessorService.default.validateBatch(documents);
      }).toThrow('Tamaño total excede 100MB');
    });
  });

  describe('analyzeSinglePDF', () => {
    test('debe analizar PDF exitosamente', async () => {
      const mockAnalysis = {
        clientName: 'Test Client',
        orderNumber: '12345',
        totalAmount: 100,
        confidence: 95,
      };

      mockPDFAnalysisService.analyzePDF.mockResolvedValue(mockAnalysis);

      const pdfInfo = {
        filePath: '/temp/test.pdf',
        originalName: 'test.pdf',
      };

      const result = await BatchProcessorService.default.analyzeSinglePDF(pdfInfo, mockTenantId);

      expect(result).toEqual({
        success: true,
        fileName: 'test.pdf',
        filePath: '/temp/test.pdf',
        analysis: mockAnalysis,
        processingTime: expect.any(Number),
      });

      expect(mockPDFAnalysisService.analyzePDF).toHaveBeenCalledWith('/temp/test.pdf');
    });

    test('debe manejar error en análisis', async () => {
      mockPDFAnalysisService.analyzePDF.mockRejectedValue(new Error('PDF corrupto'));

      const pdfInfo = {
        filePath: '/temp/test.pdf',
        originalName: 'test.pdf',
      };

      const result = await BatchProcessorService.default.analyzeSinglePDF(pdfInfo, mockTenantId);

      expect(result).toEqual({
        success: false,
        fileName: 'test.pdf',
        filePath: '/temp/test.pdf',
        error: 'PDF corrupto',
        processingTime: expect.any(Number),
      });
    });

    test('debe manejar timeout en análisis', async () => {
      // Mock que nunca resuelve para simular timeout
      mockPDFAnalysisService.analyzePDF.mockImplementation(
        () => new Promise(() => {}) // Promise que nunca resuelve
      );

      const pdfInfo = {
        filePath: '/temp/test.pdf',
        originalName: 'test.pdf',
      };

      const result = await BatchProcessorService.default.analyzeSinglePDF(pdfInfo, mockTenantId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout de análisis');
    }, 35000); // Timeout de 35 segundos para este test
  });

  describe('findClientInDatabase', () => {
    test('debe encontrar cliente por nombre exacto', async () => {
      const mockClient = {
        id: 1,
        legalName: 'Test Client',
        facturapiCustomerId: 'facturapi123',
      };

      mockPrisma.tenantCustomer.findFirst.mockResolvedValue(mockClient);

      const result = await BatchProcessorService.default.findClientInDatabase(
        'Test Client',
        mockTenantId
      );

      expect(result).toEqual(mockClient);
      expect(mockPrisma.tenantCustomer.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: mockTenantId,
          OR: [
            { legalName: { equals: 'Test Client', mode: 'insensitive' } },
            { legalName: { contains: 'Test Client', mode: 'insensitive' } },
          ],
        },
      });
    });

    test('debe retornar null si no encuentra cliente', async () => {
      mockPrisma.tenantCustomer.findFirst.mockResolvedValue(null);

      const result = await BatchProcessorService.default.findClientInDatabase(
        'Nonexistent Client',
        mockTenantId
      );

      expect(result).toBeNull();
    });

    test('debe manejar errores de base de datos', async () => {
      mockPrisma.tenantCustomer.findFirst.mockRejectedValue(new Error('DB Error'));

      const result = await BatchProcessorService.default.findClientInDatabase(
        'Test Client',
        mockTenantId
      );

      expect(result).toBeNull();
    });
  });

  describe('generateBatchInvoices', () => {
    test('debe generar facturas para análisis exitosos', async () => {
      const mockBatchResults = {
        batchId: 'batch-123',
        results: [
          {
            success: true,
            fileName: 'test1.pdf',
            analysis: {
              clientName: 'Test Client',
              orderNumber: '12345',
              totalAmount: 100,
            },
          },
          {
            success: false,
            fileName: 'test2.pdf',
            error: 'Analysis failed',
          },
        ],
        tenantId: mockTenantId,
      };

      const mockClient = {
        id: 1,
        legalName: 'Test Client',
        facturapiCustomerId: 'facturapi123',
      };

      const mockInvoice = {
        facturaId: 'invoice123',
        folio: '001',
        series: 'A',
      };

      mockPrisma.tenantCustomer.findFirst.mockResolvedValue(mockClient);
      mockFacturapiQueueService.enqueue.mockResolvedValue(mockInvoice);

      const result = await BatchProcessorService.default.generateBatchInvoices(
        mockBatchResults,
        mockCtx
      );

      expect(result).toEqual({
        batchId: 'batch-123',
        successful: [
          {
            fileName: 'test1.pdf',
            success: true,
            invoice: mockInvoice,
            client: mockClient,
            analysis: mockBatchResults.results[0].analysis,
          },
        ],
        failed: [],
        total: 1,
      });

      expect(mockFacturapiQueueService.enqueue).toHaveBeenCalledTimes(1);
    });

    test('debe manejar clientes no encontrados', async () => {
      const mockBatchResults = {
        batchId: 'batch-123',
        results: [
          {
            success: true,
            fileName: 'test1.pdf',
            analysis: {
              clientName: 'Nonexistent Client',
              orderNumber: '12345',
              totalAmount: 100,
            },
          },
        ],
        tenantId: mockTenantId,
      };

      mockPrisma.tenantCustomer.findFirst.mockResolvedValue(null);

      const result = await BatchProcessorService.default.generateBatchInvoices(
        mockBatchResults,
        mockCtx
      );

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toEqual({
        fileName: 'test1.pdf',
        success: false,
        error: 'Cliente no encontrado: Nonexistent Client',
      });

      expect(mockFacturapiQueueService.enqueue).not.toHaveBeenCalled();
    });

    test('debe lanzar error si no hay análisis exitosos', async () => {
      const mockBatchResults = {
        batchId: 'batch-123',
        results: [
          {
            success: false,
            fileName: 'test1.pdf',
            error: 'Analysis failed',
          },
        ],
        tenantId: mockTenantId,
      };

      await expect(
        BatchProcessorService.default.generateBatchInvoices(mockBatchResults, mockCtx)
      ).rejects.toThrow('No hay análisis exitosos para generar facturas');
    });
  });

  describe('storeBatchResults', () => {
    test('debe almacenar resultados en userState y session', async () => {
      const mockBatchResults = {
        batchId: 'batch-123',
        successful: 2,
        failed: 1,
      };

      const ctx = {
        userState: {},
        session: {},
        saveSession: jest.fn().mockResolvedValue(),
      };

      await BatchProcessorService.default.storeBatchResults(ctx, mockBatchResults);

      const expectedData = {
        batchId: 'batch-123',
        results: mockBatchResults,
        timestamp: expect.any(Number),
        status: 'completed',
      };

      expect(ctx.userState.batchProcessing).toEqual(expectedData);
      expect(ctx.session.batchProcessing).toEqual(expectedData);
      expect(ctx.saveSession).toHaveBeenCalled();
    });

    test('debe crear userState y session si no existen', async () => {
      const mockBatchResults = {
        batchId: 'batch-123',
        successful: 2,
        failed: 1,
      };

      const ctx = {
        saveSession: jest.fn().mockResolvedValue(),
      };

      await BatchProcessorService.default.storeBatchResults(ctx, mockBatchResults);

      expect(ctx.userState).toBeDefined();
      expect(ctx.session).toBeDefined();
      expect(ctx.userState.batchProcessing).toBeDefined();
      expect(ctx.session.batchProcessing).toBeDefined();
    });

    test('debe manejar error al guardar sesión', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const mockBatchResults = {
        batchId: 'batch-123',
        successful: 2,
        failed: 1,
      };

      const ctx = {
        userState: {},
        session: {},
        saveSession: jest.fn().mockRejectedValue(new Error('Redis error')),
      };

      await BatchProcessorService.default.storeBatchResults(ctx, mockBatchResults);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error guardando resultados en sesión Redis:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    test('debe funcionar sin saveSession', async () => {
      const mockBatchResults = {
        batchId: 'batch-123',
        successful: 2,
        failed: 1,
      };

      const ctx = {
        userState: {},
        session: {},
      };

      // No debería lanzar error
      await expect(
        BatchProcessorService.default.storeBatchResults(ctx, mockBatchResults)
      ).resolves.not.toThrow();
    });
  });
});
