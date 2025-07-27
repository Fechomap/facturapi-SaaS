// tests/jobs/excel-report.job.test.js
// Tests para el job de reportes Excel asíncronos - FASE 3
import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';

// Mock file system
jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn(),
}));

// Mock para generateExcelReport
const mockGenerateExcelReport = jest.fn();
jest.mock('../../services/excel-report.service.js', () => ({
  generateExcelReport: mockGenerateExcelReport,
}));

// Mock para notifyUserReportReady
const mockNotifyUserReportReady = jest.fn();
jest.mock('../../services/notification.service.js', () => ({
  notifyUserReportReady: mockNotifyUserReportReady,
}));

// Mock logger
jest.mock('../../core/utils/logger.js', () => ({
  child: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

describe('Excel Report Job - FASE 3 Tests', () => {
  let processExcelReportJob;
  let processFileCleanupJob;
  let estimateProcessingTime;

  beforeAll(async () => {
    // Importar funciones después de configurar mocks
    const module = await import('../../jobs/excel-report.job.js');
    processExcelReportJob = module.processExcelReportJob;
    processFileCleanupJob = module.processFileCleanupJob;
    estimateProcessingTime = module.estimateProcessingTime;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processExcelReportJob', () => {
    const mockJobData = {
      tenantId: 'test-tenant-123',
      userId: 12345,
      chatId: 67890,
      filters: { dateRange: 'current_month' },
      estimatedInvoices: 250,
      requestId: 'RPT-1234567890',
    };

    const mockJob = {
      id: 'job-123',
      data: mockJobData,
      progress: jest.fn(),
    };

    it('debería procesar job de reporte Excel exitosamente', async () => {
      // Mock file system operations
      fs.mkdir.mockResolvedValue(undefined);
      fs.stat.mockResolvedValue({ size: 1024 * 1024 }); // 1MB

      // Mock Excel report generation
      mockGenerateExcelReport.mockResolvedValue({
        success: true,
        totalInvoices: 250,
        filePath: '/tmp/test-report.xlsx',
      });

      // Mock notification
      mockNotifyUserReportReady.mockResolvedValue({ success: true });

      const result = await processExcelReportJob(mockJob);

      expect(result).toEqual({
        success: true,
        filePath: expect.stringContaining('.xlsx'),
        fileName: expect.stringContaining('reporte_facturas_async'),
        invoiceCount: 250,
        fileSizeMB: '1.00',
        completedAt: expect.any(Date),
      });

      expect(mockJob.progress).toHaveBeenCalledWith(5);
      expect(mockJob.progress).toHaveBeenCalledWith(15);
      expect(mockJob.progress).toHaveBeenCalledWith(95);
      expect(mockJob.progress).toHaveBeenCalledWith(100);

      expect(mockNotifyUserReportReady).toHaveBeenCalledWith({
        chatId: mockJobData.chatId,
        tenantId: mockJobData.tenantId,
        userId: mockJobData.userId,
        filePath: expect.stringContaining('.xlsx'),
        fileName: expect.stringContaining('reporte_facturas_async'),
        invoiceCount: 250,
        fileSizeMB: '1.00',
        requestId: mockJobData.requestId,
        jobId: mockJob.id,
      });
    });

    it('debería manejar errores en generación de reporte', async () => {
      fs.mkdir.mockResolvedValue(undefined);
      mockGenerateExcelReport.mockRejectedValue(new Error('Excel generation failed'));

      await expect(processExcelReportJob(mockJob)).rejects.toThrow('Excel generation failed');

      expect(mockJob.progress).toHaveBeenCalledWith(5);
      expect(mockJob.progress).toHaveBeenCalledWith(15);
    });

    it('debería actualizar progreso durante la generación', async () => {
      fs.mkdir.mockResolvedValue(undefined);
      fs.stat.mockResolvedValue({ size: 2048 * 1024 }); // 2MB

      // Mock con callback de progreso
      mockGenerateExcelReport.mockImplementation(
        async (tenantId, filters, filePath, progressCallback) => {
          // Simular progreso
          await progressCallback(25);
          await progressCallback(50);
          await progressCallback(75);
          await progressCallback(100);

          return {
            success: true,
            totalInvoices: 500,
            filePath,
          };
        }
      );

      mockNotifyUserReportReady.mockResolvedValue({ success: true });

      const result = await processExcelReportJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.invoiceCount).toBe(500);
      expect(result.fileSizeMB).toBe('2.00');

      // Verificar que se llamó progress múltiples veces
      expect(mockJob.progress).toHaveBeenCalledTimes(7); // 5, 15, 32.5, 50, 67.5, 85, 95, 100
    });

    it('debería crear directorio si no existe', async () => {
      fs.mkdir.mockResolvedValue(undefined);
      fs.stat.mockResolvedValue({ size: 1024 });
      mockGenerateExcelReport.mockResolvedValue({
        success: true,
        totalInvoices: 100,
      });
      mockNotifyUserReportReady.mockResolvedValue({ success: true });

      await processExcelReportJob(mockJob);

      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('excel-reports'), {
        recursive: true,
      });
    });
  });

  describe('processFileCleanupJob', () => {
    const mockCleanupJob = {
      data: {
        filePath: '/tmp/test-report.xlsx',
        fileName: 'test-report.xlsx',
      },
    };

    it('debería limpiar archivo temporal exitosamente', async () => {
      fs.unlink.mockResolvedValue(undefined);

      const result = await processFileCleanupJob(mockCleanupJob);

      expect(result).toEqual({
        success: true,
        deletedFile: 'test-report.xlsx',
      });

      expect(fs.unlink).toHaveBeenCalledWith('/tmp/test-report.xlsx');
    });

    it('debería manejar archivo ya eliminado', async () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      fs.unlink.mockRejectedValue(error);

      const result = await processFileCleanupJob(mockCleanupJob);

      expect(result).toEqual({
        success: true,
        message: 'File already deleted',
      });
    });

    it('debería manejar errores de eliminación', async () => {
      fs.unlink.mockRejectedValue(new Error('Permission denied'));

      await expect(processFileCleanupJob(mockCleanupJob)).rejects.toThrow('Permission denied');
    });
  });

  describe('estimateProcessingTime', () => {
    it('debería estimar tiempo correctamente para diferentes volúmenes', () => {
      expect(estimateProcessingTime(50)).toBe('30 segundos');
      expect(estimateProcessingTime(100)).toBe('30 segundos');
      expect(estimateProcessingTime(300)).toBe('1-2 minutos');
      expect(estimateProcessingTime(800)).toBe('3-5 minutos');
      expect(estimateProcessingTime(1500)).toBe('8-12 minutos');
      expect(estimateProcessingTime(3000)).toBe('20-30 minutos');
      expect(estimateProcessingTime(8000)).toBe('30+ minutos');
    });
  });

  describe('File Operations', () => {
    it('debería generar nombre de archivo único', async () => {
      const mockJobData = {
        tenantId: 'test-tenant-123',
        userId: 12345,
        chatId: 67890,
        filters: {},
        estimatedInvoices: 100,
        requestId: 'RPT-1234567890',
      };

      const mockJob = {
        id: 'job-123',
        data: mockJobData,
        progress: jest.fn(),
      };

      fs.mkdir.mockResolvedValue(undefined);
      fs.stat.mockResolvedValue({ size: 1024 });
      mockGenerateExcelReport.mockResolvedValue({
        success: true,
        totalInvoices: 100,
      });
      mockNotifyUserReportReady.mockResolvedValue({ success: true });

      const result = await processExcelReportJob(mockJob);

      expect(result.fileName).toMatch(/^reporte_facturas_async_test-tenant-123_\d+\.xlsx$/);
      expect(result.filePath).toMatch(
        /excel-reports[/\\]reporte_facturas_async_test-tenant-123_\d+\.xlsx$/
      );
    });

    it('debería crear ruta completa correcta', async () => {
      const expectedBasePath = path.join(process.cwd(), 'temp', 'excel-reports');

      const mockJobData = {
        tenantId: 'test-tenant-123',
        userId: 12345,
        chatId: 67890,
        filters: {},
        estimatedInvoices: 100,
        requestId: 'RPT-1234567890',
      };

      const mockJob = {
        id: 'job-123',
        data: mockJobData,
        progress: jest.fn(),
      };

      fs.mkdir.mockResolvedValue(undefined);
      fs.stat.mockResolvedValue({ size: 1024 });
      mockGenerateExcelReport.mockResolvedValue({
        success: true,
        totalInvoices: 100,
      });
      mockNotifyUserReportReady.mockResolvedValue({ success: true });

      await processExcelReportJob(mockJob);

      expect(fs.mkdir).toHaveBeenCalledWith(expectedBasePath, { recursive: true });
    });
  });
});
