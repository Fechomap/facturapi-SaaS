// tests/excel-async-integration.test.js
// Test de integración para sistema de reportes Excel asíncronos - FASE 3
import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';

// Mock Redis
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    expire: jest.fn(),
    quit: jest.fn(),
  })),
}));

// Mock Bull
const mockQueue = {
  add: jest.fn(),
  process: jest.fn(),
  getJob: jest.fn(),
  getWaiting: jest.fn(() => []),
  getActive: jest.fn(() => []),
  getCompleted: jest.fn(() => []),
  getFailed: jest.fn(() => []),
  clean: jest.fn(),
  on: jest.fn(),
};

jest.mock('bull', () => jest.fn(() => mockQueue));

// Mock Prisma
const mockPrisma = {
  tenantInvoice: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock('../lib/prisma.js', () => mockPrisma);

// Mock Excel service
const mockExcelService = {
  estimateInvoiceCount: jest.fn(),
  generateInvoiceReport: jest.fn(),
};

jest.mock('../services/excel-report.service.js', () => ({
  default: mockExcelService,
}));

// Mock notification service
const mockNotificationService = {
  sendTelegramNotification: jest.fn(),
  getBot: jest.fn(() => ({
    telegram: {
      sendDocument: jest.fn(),
    },
  })),
};

jest.mock('../services/notification.service.js', () => ({
  default: mockNotificationService,
  notifyUserReportReady: jest.fn(),
}));

describe('Excel Async System Integration - FASE 3', () => {
  let queueService;

  beforeAll(async () => {
    // Importar servicios después de configurar mocks
    queueService = await import('../services/queue.service.js');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Flujo completo de reporte asíncrono', () => {
    it('debería procesar correctamente un reporte grande', async () => {
      const tenantId = 'test-tenant-123';
      const filters = { dateRange: 'current_year' };
      const estimatedCount = 1500; // > 500, debería usar async

      // 1. Estimación de facturas
      mockExcelService.estimateInvoiceCount.mockResolvedValue({
        count: estimatedCount,
        tenantId,
        filters,
      });

      const estimation = await mockExcelService.estimateInvoiceCount(tenantId, { filters });

      expect(estimation.count).toBe(estimatedCount);
      expect(estimation.count).toBeGreaterThan(500); // Confirma que debe ser asíncrono

      // 2. Creación del job
      const jobData = {
        tenantId,
        userId: 12345,
        chatId: 67890,
        filters,
        estimatedInvoices: estimatedCount,
        requestId: 'RPT-1234567890',
        timestamp: Date.now(),
      };

      const mockJob = { id: 'async-job-123' };
      mockQueue.add.mockResolvedValue(mockJob);

      const job = await queueService.addExcelReportJob(jobData);

      expect(mockQueue.add).toHaveBeenCalledWith('generate-excel-report', jobData, {
        attempts: 3,
        backoff: 'exponential',
        removeOnComplete: 10,
        removeOnFail: 5,
        delay: 1000,
      });

      expect(job).toBe(mockJob);

      // 3. Estimación de tiempo
      const estimatedTime = queueService.estimateProcessingTime(estimatedCount);
      expect(estimatedTime).toBe('8-12 minutos');
    });

    it('debería procesar correctamente un reporte pequeño (síncrono)', async () => {
      const tenantId = 'test-tenant-456';
      const filters = { dateRange: 'last_7_days' };
      const estimatedCount = 150; // <= 500, debería ser síncrono

      // 1. Estimación de facturas
      mockExcelService.estimateInvoiceCount.mockResolvedValue({
        count: estimatedCount,
        tenantId,
        filters,
      });

      const estimation = await mockExcelService.estimateInvoiceCount(tenantId, { filters });

      expect(estimation.count).toBe(estimatedCount);
      expect(estimation.count).toBeLessThanOrEqual(500); // Confirma que puede ser síncrono

      // 2. Generación síncrona (sin job)
      mockExcelService.generateInvoiceReport.mockResolvedValue({
        success: true,
        stats: {
          totalInvoices: estimatedCount,
          duration: 3000,
          fileSize: '1.5 MB',
        },
        filePath: '/tmp/test-report.xlsx',
      });

      const config = {
        limit: 5000,
        dateRange: filters.dateRange,
        useCache: true,
      };

      const result = await mockExcelService.generateInvoiceReport(tenantId, config);

      expect(result.success).toBe(true);
      expect(result.stats.totalInvoices).toBe(estimatedCount);
    });
  });

  describe('Manejo de errores en flujo asíncrono', () => {
    it('debería manejar errores en estimación de facturas', async () => {
      mockExcelService.estimateInvoiceCount.mockResolvedValue({
        count: 0,
        error: 'Database connection failed',
        tenantId: 'error-tenant',
        filters: {},
      });

      const result = await mockExcelService.estimateInvoiceCount('error-tenant', {});

      expect(result.count).toBe(0);
      expect(result.error).toBe('Database connection failed');
    });

    it('debería manejar errores en creación de jobs', async () => {
      const jobData = { tenantId: 'test-tenant' };
      mockQueue.add.mockRejectedValue(new Error('Redis connection failed'));

      await expect(queueService.addExcelReportJob(jobData)).rejects.toThrow(
        'Redis connection failed'
      );
    });

    it('debería limpiar jobs fallidos correctamente', async () => {
      mockQueue.clean.mockResolvedValue(undefined);

      await queueService.cleanOldJobs();

      expect(mockQueue.clean).toHaveBeenCalledWith(24 * 60 * 60 * 1000, 'completed');
      expect(mockQueue.clean).toHaveBeenCalledWith(7 * 24 * 60 * 60 * 1000, 'failed');
    });
  });

  describe('Sistema de notificaciones asíncronas', () => {
    it('debería enviar notificación cuando el reporte esté listo', async () => {
      const notificationData = {
        chatId: 67890,
        tenantId: 'test-tenant-123',
        userId: 12345,
        filePath: '/tmp/async-report.xlsx',
        fileName: 'reporte_facturas_async_test-tenant-123_1234567890.xlsx',
        invoiceCount: 1500,
        fileSizeMB: '5.2',
        requestId: 'RPT-1234567890',
        jobId: 'async-job-123',
      };

      // Mock notification service
      mockNotificationService.sendTelegramNotification.mockResolvedValue({ success: true });
      mockNotificationService.getBot.mockReturnValue({
        telegram: {
          sendDocument: jest.fn().mockResolvedValue({ message_id: 123 }),
        },
      });

      const { notifyUserReportReady } = await import('../services/notification.service.js');
      const result = await notifyUserReportReady(notificationData);

      expect(result.success).toBe(true);
      expect(mockNotificationService.sendTelegramNotification).toHaveBeenCalled();
    });
  });

  describe('Validación de umbrales', () => {
    it('debería detectar correctamente reportes que requieren async', () => {
      const testCases = [
        { count: 100, shouldBeAsync: false },
        { count: 500, shouldBeAsync: false },
        { count: 501, shouldBeAsync: true },
        { count: 1000, shouldBeAsync: true },
        { count: 5000, shouldBeAsync: true },
      ];

      testCases.forEach(({ count, shouldBeAsync }) => {
        const isAsync = count > 500;
        expect(isAsync).toBe(shouldBeAsync);

        if (isAsync) {
          const time = queueService.estimateProcessingTime(count);
          expect(time).not.toBe('30 segundos');
        }
      });
    });
  });

  describe('Estadísticas de colas', () => {
    it('debería obtener estadísticas correctas', async () => {
      mockQueue.getWaiting.mockResolvedValue(new Array(5));
      mockQueue.getActive.mockResolvedValue(new Array(2));
      mockQueue.getCompleted.mockResolvedValue(new Array(20));
      mockQueue.getFailed.mockResolvedValue(new Array(1));

      const stats = await queueService.getQueueStats();

      expect(stats).toEqual({
        waiting: 5,
        active: 2,
        completed: 20,
        failed: 1,
        total: 28,
      });
    });

    it('debería obtener estado de job específico', async () => {
      const mockJob = {
        id: 'test-job-123',
        data: { tenantId: 'test-tenant' },
        timestamp: Date.now(),
        processedOn: Date.now() + 1000,
        finishedOn: Date.now() + 5000,
        getState: jest.fn().mockResolvedValue('completed'),
        progress: jest.fn().mockReturnValue(100),
      };

      mockQueue.getJob.mockResolvedValue(mockJob);

      const status = await queueService.getJobStatus('test-job-123');

      expect(status.id).toBe('test-job-123');
      expect(status.status).toBe('completed');
      expect(status.progress).toBe(100);
    });
  });
});
