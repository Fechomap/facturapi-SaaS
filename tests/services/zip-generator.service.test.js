// tests/services/zip-generator.service.test.js
import { jest } from '@jest/globals';
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Mock de dependencias
const mockArchiver = jest.fn();
const mockFacturapIService = {
  getFacturapiClient: jest.fn(),
};

const mockFacturapiClient = {
  invoices: {
    pdf: jest.fn(),
    xml: jest.fn(),
  },
};

// Mock de módulos
jest.unstable_mockModule('archiver', () => ({
  default: mockArchiver,
}));

jest.unstable_mockModule('../../services/facturapi.service.js', () => ({
  default: mockFacturapIService,
}));

// Mock directo de funciones de fs
const mockFs = {
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
};

jest.unstable_mockModule('fs', () => ({
  default: mockFs,
}));

// Importar el servicio a testear
const ZipGeneratorService = await import('../../services/zip-generator.service.js');

describe('ZipGeneratorService', () => {
  const mockTenantId = 'test-tenant-123';
  const mockBatchId = 'batch-test-456';

  const mockInvoiceResults = {
    batchId: mockBatchId,
    successful: [
      {
        fileName: 'factura1.pdf',
        invoice: {
          facturaId: 'invoice-1',
          folio: '001',
          series: 'A',
        },
        client: {
          legalName: 'Cliente Test 1',
        },
        analysis: {
          orderNumber: 'ORD-001',
        },
      },
      {
        fileName: 'factura2.pdf',
        invoice: {
          facturaId: 'invoice-2',
          folio: '002',
          series: 'B',
        },
        client: {
          legalName: 'Cliente Test 2',
        },
        analysis: {
          orderNumber: 'ORD-002',
        },
      },
    ],
  };

  let mockArchiveInstance;
  let mockWriteStream;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock archiver instance
    mockArchiveInstance = {
      pipe: jest.fn(),
      append: jest.fn(),
      finalize: jest.fn().mockResolvedValue(),
    };

    mockArchiver.mockReturnValue(mockArchiveInstance);

    // Setup mock write stream
    mockWriteStream = {
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          // Simular que el stream se cierra exitosamente
          setTimeout(callback, 10);
        }
      }),
      write: jest.fn(),
      end: jest.fn(),
    };

    mockFs.createWriteStream.mockReturnValue(mockWriteStream);
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.statSync.mockReturnValue({
      size: 1024000, // 1MB
      birthtime: new Date(),
      mtime: new Date(),
    });

    // Setup FacturAPI mocks
    mockFacturapIService.getFacturapiClient.mockResolvedValue(mockFacturapiClient);
    mockFacturapiClient.invoices.pdf.mockResolvedValue(Buffer.from('mock-pdf-content'));
    mockFacturapiClient.invoices.xml.mockResolvedValue(Buffer.from('mock-xml-content'));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createInvoiceZips', () => {
    test('debe crear ZIPs de PDFs y XMLs exitosamente', async () => {
      const result = await ZipGeneratorService.default.createInvoiceZips(
        mockInvoiceResults,
        mockTenantId
      );

      expect(result).toEqual({
        batchId: mockBatchId,
        pdfZip: {
          filePath: expect.stringContaining(`facturas_pdf_${mockBatchId}`),
          fileName: expect.stringContaining(`facturas_pdf_${mockBatchId}`),
          fileCount: 2,
          fileSizeBytes: 1024000,
          fileSizeMB: expect.any(Number),
        },
        xmlZip: {
          filePath: expect.stringContaining(`facturas_xml_${mockBatchId}`),
          fileName: expect.stringContaining(`facturas_xml_${mockBatchId}`),
          fileCount: 2,
          fileSizeBytes: 1024000,
          fileSizeMB: expect.any(Number),
        },
        invoiceCount: 2,
        createdAt: expect.any(String),
      });

      expect(mockFacturapIService.getFacturapiClient).toHaveBeenCalledWith(mockTenantId);
      expect(mockArchiver).toHaveBeenCalledTimes(2); // Una vez para PDF, una para XML
    });

    test('debe fallar si no hay facturas exitosas', async () => {
      const emptyResults = {
        batchId: mockBatchId,
        successful: [],
      };

      await expect(
        ZipGeneratorService.default.createInvoiceZips(emptyResults, mockTenantId)
      ).rejects.toThrow('No hay facturas exitosas para crear ZIP');
    });

    test('debe crear directorio temporal si no existe', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await ZipGeneratorService.default.createInvoiceZips(mockInvoiceResults, mockTenantId);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('temp'), {
        recursive: true,
      });
    });

    test('debe limpiar archivos en caso de error', async () => {
      const cleanupSpy = jest.spyOn(ZipGeneratorService.default, 'cleanupZipFiles');
      mockArchiveInstance.finalize.mockRejectedValue(new Error('Archive error'));

      await expect(
        ZipGeneratorService.default.createInvoiceZips(mockInvoiceResults, mockTenantId)
      ).rejects.toThrow('Archive error');

      expect(cleanupSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('facturas_pdf_'),
          expect.stringContaining('facturas_xml_'),
        ])
      );
    });
  });

  describe('createPDFZip', () => {
    test('debe crear ZIP de PDFs exitosamente', async () => {
      const mockZipPath = '/temp/test.zip';

      const result = await ZipGeneratorService.default.createPDFZip(
        mockInvoiceResults.successful,
        mockZipPath,
        mockTenantId
      );

      expect(result).toEqual({
        filePath: mockZipPath,
        fileName: 'test.zip',
        fileCount: 2,
        fileSizeBytes: 1024000,
        fileSizeMB: expect.any(Number),
      });

      expect(mockFacturapiClient.invoices.pdf).toHaveBeenCalledTimes(2);
      expect(mockArchiveInstance.append).toHaveBeenCalledTimes(2);
      expect(mockArchiveInstance.finalize).toHaveBeenCalled();
    });

    test('debe continuar procesando aunque falle una factura', async () => {
      mockFacturapiClient.invoices.pdf
        .mockResolvedValueOnce(Buffer.from('pdf1'))
        .mockRejectedValueOnce(new Error('PDF error'))
        .mockResolvedValueOnce(Buffer.from('pdf2'));

      const invoicesWithError = [
        ...mockInvoiceResults.successful,
        {
          fileName: 'factura3.pdf',
          invoice: { facturaId: 'invoice-3' },
          client: { legalName: 'Cliente 3' },
          analysis: { orderNumber: 'ORD-003' },
        },
      ];

      const result = await ZipGeneratorService.default.createPDFZip(
        invoicesWithError,
        '/temp/test.zip',
        mockTenantId
      );

      // Solo debería agregar 2 archivos (el del medio falló)
      expect(result.fileCount).toBe(2);
      expect(mockArchiveInstance.append).toHaveBeenCalledTimes(2);
    });

    test('debe manejar timeout en descarga de PDF', async () => {
      // Mock que nunca resuelve para simular timeout
      mockFacturapiClient.invoices.pdf.mockImplementation(
        () => new Promise(() => {}) // Promise que nunca resuelve
      );

      const result = await ZipGeneratorService.default.createPDFZip(
        [mockInvoiceResults.successful[0]],
        '/temp/test.zip',
        mockTenantId
      );

      // Debería continuar pero no agregar archivos debido al timeout
      expect(result.fileCount).toBe(0);
    }, 35000);

    test('debe saltar facturas sin ID', async () => {
      const invoicesWithoutId = [
        {
          fileName: 'factura_sin_id.pdf',
          invoice: {}, // Sin facturaId
          client: { legalName: 'Cliente' },
          analysis: { orderNumber: 'ORD-001' },
        },
      ];

      const result = await ZipGeneratorService.default.createPDFZip(
        invoicesWithoutId,
        '/temp/test.zip',
        mockTenantId
      );

      expect(result.fileCount).toBe(0);
      expect(mockFacturapiClient.invoices.pdf).not.toHaveBeenCalled();
    });
  });

  describe('createXMLZip', () => {
    test('debe crear ZIP de XMLs exitosamente', async () => {
      const mockZipPath = '/temp/test.zip';

      const result = await ZipGeneratorService.default.createXMLZip(
        mockInvoiceResults.successful,
        mockZipPath,
        mockTenantId
      );

      expect(result).toEqual({
        filePath: mockZipPath,
        fileName: 'test.zip',
        fileCount: 2,
        fileSizeBytes: 1024000,
        fileSizeMB: expect.any(Number),
      });

      expect(mockFacturapiClient.invoices.xml).toHaveBeenCalledTimes(2);
      expect(mockArchiveInstance.append).toHaveBeenCalledTimes(2);
      expect(mockArchiveInstance.finalize).toHaveBeenCalled();
    });

    test('debe manejar errores de descarga XML', async () => {
      mockFacturapiClient.invoices.xml.mockRejectedValue(new Error('XML download error'));

      const result = await ZipGeneratorService.default.createXMLZip(
        mockInvoiceResults.successful,
        '/temp/test.zip',
        mockTenantId
      );

      // No debería agregar archivos debido a los errores
      expect(result.fileCount).toBe(0);
    });
  });

  describe('downloadInvoicePDF', () => {
    test('debe descargar PDF exitosamente', async () => {
      const mockBuffer = Buffer.from('pdf-content');
      mockFacturapiClient.invoices.pdf.mockResolvedValue(mockBuffer);

      const result = await ZipGeneratorService.default.downloadInvoicePDF(
        mockFacturapiClient,
        'invoice-123'
      );

      expect(result).toEqual(mockBuffer);
      expect(mockFacturapiClient.invoices.pdf).toHaveBeenCalledWith('invoice-123');
    });

    test('debe lanzar error si falla la descarga', async () => {
      mockFacturapiClient.invoices.pdf.mockRejectedValue(new Error('API Error'));

      await expect(
        ZipGeneratorService.default.downloadInvoicePDF(mockFacturapiClient, 'invoice-123')
      ).rejects.toThrow('No se pudo descargar PDF de factura invoice-123');
    });
  });

  describe('downloadInvoiceXML', () => {
    test('debe descargar XML exitosamente', async () => {
      const mockBuffer = Buffer.from('xml-content');
      mockFacturapiClient.invoices.xml.mockResolvedValue(mockBuffer);

      const result = await ZipGeneratorService.default.downloadInvoiceXML(
        mockFacturapiClient,
        'invoice-123'
      );

      expect(result).toEqual(mockBuffer);
      expect(mockFacturapiClient.invoices.xml).toHaveBeenCalledWith('invoice-123');
    });

    test('debe lanzar error si falla la descarga', async () => {
      mockFacturapiClient.invoices.xml.mockRejectedValue(new Error('API Error'));

      await expect(
        ZipGeneratorService.default.downloadInvoiceXML(mockFacturapiClient, 'invoice-123')
      ).rejects.toThrow('No se pudo descargar XML de factura invoice-123');
    });
  });

  describe('generateFileName', () => {
    test('debe generar nombre de archivo correctamente con formato serie+folio', () => {
      const invoiceResult = {
        analysis: { orderNumber: 'ORD-001' },
        client: { legalName: 'Empresa Test SA' },
      };

      const invoice = {
        folio: '123',
        series: 'A',
      };

      const fileName = ZipGeneratorService.default.generateFileName(invoiceResult, invoice, 'pdf');

      expect(fileName).toBe('A123.pdf');
    });

    test('debe manejar datos faltantes', () => {
      const invoiceResult = {
        analysis: {},
        client: {},
      };

      const invoice = {};

      const fileName = ZipGeneratorService.default.generateFileName(invoiceResult, invoice, 'xml');

      expect(fileName).toBe('ASIN_FOLIO.xml');
    });

    test('debe usar formato simple serie+folio incluso con datos complejos', () => {
      const invoiceResult = {
        analysis: { orderNumber: 'ORD/001-TEST#2024' },
        client: { legalName: 'Empresa & Cia. S.A. de C.V.' },
      };

      const invoice = {
        folio: '456',
        series: 'B',
      };

      const fileName = ZipGeneratorService.default.generateFileName(invoiceResult, invoice, 'pdf');

      expect(fileName).toBe('B456.pdf');
    });
  });

  describe('cleanupZipFiles', () => {
    test('debe eliminar archivos ZIP existentes', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockReturnValue(undefined);

      const zipPaths = ['/temp/file1.zip', '/temp/file2.zip'];

      ZipGeneratorService.default.cleanupZipFiles(zipPaths);

      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(2);
      expect(mockFs.unlinkSync).toHaveBeenCalledWith('/temp/file1.zip');
      expect(mockFs.unlinkSync).toHaveBeenCalledWith('/temp/file2.zip');
    });

    test('debe ignorar archivos que no existen', () => {
      mockFs.existsSync.mockReturnValue(false);

      const zipPaths = ['/temp/nonexistent.zip'];

      ZipGeneratorService.default.cleanupZipFiles(zipPaths);

      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    test('debe manejar errores de eliminación', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const zipPaths = ['/temp/protected.zip'];

      // No debería lanzar error
      expect(() => {
        ZipGeneratorService.default.cleanupZipFiles(zipPaths);
      }).not.toThrow();
    });
  });

  describe('scheduleCleanup', () => {
    test('debe programar limpieza automática', () => {
      jest.useFakeTimers();
      const cleanupSpy = jest.spyOn(ZipGeneratorService.default, 'cleanupZipFiles');

      const zipInfo = {
        batchId: 'test-batch',
        pdfZip: { filePath: '/temp/pdf.zip' },
        xmlZip: { filePath: '/temp/xml.zip' },
      };

      ZipGeneratorService.default.scheduleCleanup(zipInfo, 1); // 1 minuto

      // Avanzar el tiempo
      jest.advanceTimersByTime(60 * 1000); // 1 minuto

      expect(cleanupSpy).toHaveBeenCalledWith(['/temp/pdf.zip', '/temp/xml.zip']);

      jest.useRealTimers();
    });
  });

  describe('getZipInfo', () => {
    test('debe retornar información del ZIP', () => {
      const mockStats = {
        size: 2048000,
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-01-02'),
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue(mockStats);

      const result = ZipGeneratorService.default.getZipInfo('/temp/test.zip');

      expect(result).toEqual({
        filePath: '/temp/test.zip',
        fileName: 'test.zip',
        fileSizeBytes: 2048000,
        fileSizeMB: expect.any(Number),
        createdAt: mockStats.birthtime,
        modifiedAt: mockStats.mtime,
      });
    });

    test('debe retornar null si el archivo no existe', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = ZipGeneratorService.default.getZipInfo('/temp/nonexistent.zip');

      expect(result).toBeNull();
    });

    test('debe manejar errores de fs.statSync', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockImplementation(() => {
        throw new Error('File system error');
      });

      const result = ZipGeneratorService.default.getZipInfo('/temp/error.zip');

      expect(result).toBeNull();
    });
  });
});
