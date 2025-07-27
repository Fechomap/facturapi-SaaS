// tests/services/queue.service.test.js
// Tests para el servicio de colas Bull - FASE 3
import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import Queue from 'bull';

// Mock Redis para testing
jest.unstable_mockModule('redis', () => ({
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

// Mock ExcelJS
jest.unstable_mockModule('exceljs', () => ({
  default: {
    Workbook: jest.fn(() => ({
      addWorksheet: jest.fn(() => ({
        addRows: jest.fn(),
        columns: [],
        getRow: jest.fn(() => ({
          font: {},
          fill: {},
        })),
        eachRow: jest.fn(),
      })),
      xlsx: {
        writeFile: jest.fn(),
      },
    })),
  },
}));

// Mock Bull Queue
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

jest.unstable_mockModule('bull', () => ({
  default: jest.fn(() => mockQueue),
}));

describe('Queue Service - FASE 3 Tests', () => {
  let addExcelReportJob;
  let getJobStatus;
  let cleanOldJobs;
  let getQueueStats;
  let estimateProcessingTime;

  beforeAll(async () => {
    // Importar el servicio después de configurar los mocks
    const module = await import('../../services/queue.service.js');
    addExcelReportJob = module.addExcelReportJob;
    getJobStatus = module.getJobStatus;
    cleanOldJobs = module.cleanOldJobs;
    getQueueStats = module.getQueueStats;
    estimateProcessingTime = module.estimateProcessingTime;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addExcelReportJob', () => {
    it('debería agregar un job de reporte Excel a la cola', async () => {
      const jobData = {
        tenantId: 'test-tenant-123',
        userId: 12345,
        chatId: 67890,
        filters: { dateRange: 'current_month' },
        estimatedInvoices: 250,
        requestId: 'RPT-1234567890',
        timestamp: Date.now(),
      };

      const mockJob = { id: 'job-123' };
      mockQueue.add.mockResolvedValue(mockJob);

      const result = await addExcelReportJob(jobData);

      expect(mockQueue.add).toHaveBeenCalledWith('generate-excel-report', jobData, {
        attempts: 3,
        backoff: 'exponential',
        removeOnComplete: 10,
        removeOnFail: 5,
        delay: 1000,
      });

      expect(result).toBe(mockJob);
    });

    it('debería manejar errores al agregar job', async () => {
      const jobData = { tenantId: 'test-tenant' };
      mockQueue.add.mockRejectedValue(new Error('Redis connection failed'));

      await expect(addExcelReportJob(jobData)).rejects.toThrow('Redis connection failed');
    });
  });

  describe('getJobStatus', () => {
    it('debería obtener el estado de un job existente', async () => {
      const jobId = 'job-123';
      const mockJob = {
        id: jobId,
        data: { tenantId: 'test-tenant' },
        timestamp: Date.now(),
        processedOn: Date.now() + 1000,
        finishedOn: Date.now() + 2000,
        getState: jest.fn().mockResolvedValue('completed'),
        progress: jest.fn().mockReturnValue(100),
      };

      mockQueue.getJob.mockResolvedValue(mockJob);

      const result = await getJobStatus(jobId);

      expect(result).toEqual({
        id: jobId,
        status: 'completed',
        progress: 100,
        data: { tenantId: 'test-tenant' },
        createdAt: new Date(mockJob.timestamp),
        processedOn: new Date(mockJob.processedOn),
        finishedOn: new Date(mockJob.finishedOn),
        failedReason: undefined,
      });
    });

    it('debería retornar not_found para job inexistente', async () => {
      mockQueue.getJob.mockResolvedValue(null);

      const result = await getJobStatus('nonexistent-job');

      expect(result).toEqual({ status: 'not_found' });
    });

    it('debería manejar errores al obtener estado de job', async () => {
      mockQueue.getJob.mockRejectedValue(new Error('Job not accessible'));

      await expect(getJobStatus('error-job')).rejects.toThrow('Job not accessible');
    });
  });

  describe('getQueueStats', () => {
    it('debería obtener estadísticas de la cola', async () => {
      mockQueue.getWaiting.mockResolvedValue(new Array(3));
      mockQueue.getActive.mockResolvedValue(new Array(2));
      mockQueue.getCompleted.mockResolvedValue(new Array(10));
      mockQueue.getFailed.mockResolvedValue(new Array(1));

      const result = await getQueueStats();

      expect(result).toEqual({
        waiting: 3,
        active: 2,
        completed: 10,
        failed: 1,
        total: 16,
      });
    });

    it('debería manejar errores al obtener estadísticas', async () => {
      mockQueue.getWaiting.mockRejectedValue(new Error('Queue not accessible'));

      const result = await getQueueStats();

      expect(result).toEqual({ error: 'Queue not accessible' });
    });
  });

  describe('cleanOldJobs', () => {
    it('debería limpiar jobs antiguos', async () => {
      mockQueue.clean.mockResolvedValue(undefined);

      await expect(cleanOldJobs()).resolves.not.toThrow();

      expect(mockQueue.clean).toHaveBeenCalledTimes(2);
      expect(mockQueue.clean).toHaveBeenCalledWith(24 * 60 * 60 * 1000, 'completed');
      expect(mockQueue.clean).toHaveBeenCalledWith(7 * 24 * 60 * 60 * 1000, 'failed');
    });

    it('debería manejar errores en limpieza', async () => {
      mockQueue.clean.mockRejectedValue(new Error('Cleanup failed'));

      // No debería arrojar error, solo loggearlo
      await expect(cleanOldJobs()).resolves.not.toThrow();
    });
  });

  describe('estimateProcessingTime', () => {
    it('debería estimar tiempo para diferentes cantidades de facturas', () => {
      expect(estimateProcessingTime(50)).toBe('30 segundos');
      expect(estimateProcessingTime(100)).toBe('30 segundos');
      expect(estimateProcessingTime(300)).toBe('1-2 minutos');
      expect(estimateProcessingTime(800)).toBe('3-5 minutos');
      expect(estimateProcessingTime(1500)).toBe('8-12 minutos');
      expect(estimateProcessingTime(3000)).toBe('20-30 minutos');
      expect(estimateProcessingTime(8000)).toBe('30+ minutos');
    });
  });

  describe('Bull Queue Configuration', () => {
    it('debería configurar la cola con opciones correctas', () => {
      expect(Queue).toHaveBeenCalledWith(
        'excel-report',
        expect.objectContaining({
          redis: expect.objectContaining({
            maxRetriesPerRequest: 3,
            retryDelayOnFailover: 100,
            lazyConnect: true,
          }),
        })
      );
    });

    it('debería configurar event listeners', () => {
      expect(mockQueue.on).toHaveBeenCalledWith('completed', expect.any(Function));
      expect(mockQueue.on).toHaveBeenCalledWith('failed', expect.any(Function));
      expect(mockQueue.on).toHaveBeenCalledWith('progress', expect.any(Function));
    });

    it('debería configurar procesador de jobs', () => {
      expect(mockQueue.process).toHaveBeenCalledWith(
        'generate-excel-report',
        3,
        expect.any(Function)
      );
    });
  });
});
