// tests/core/utils/batch-progress.utils.test.js
import { jest } from '@jest/globals';
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';

// Mock de dependencias
const mockMarkup = {
  button: {
    callback: jest.fn((text, data) => ({ text, callback_data: data })),
  },
  inlineKeyboard: jest.fn((buttons) => ({ inline_keyboard: buttons })),
};

// Mock de Telegraf
jest.unstable_mockModule('telegraf', () => ({
  Markup: mockMarkup,
}));

// Importar utilidades a testear
const { createBatchProgressTracker, cleanupBatchProcessing } = await import(
  '../../../core/utils/batch-progress.utils.js'
);

describe('BatchProgressTracker', () => {
  let mockCtx;
  let progressTracker;
  const testBatchId = 'batch-test-123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock context
    mockCtx = {
      chat: { id: 12345 },
      from: { id: 67890 },
      reply: jest.fn().mockResolvedValue({ message_id: 101 }),
      telegram: {
        editMessageText: jest.fn().mockResolvedValue({}),
      },
    };

    // Reset Markup mocks
    mockMarkup.button.callback.mockImplementation((text, data) => ({ text, callback_data: data }));
    mockMarkup.inlineKeyboard.mockImplementation((buttons) => ({ inline_keyboard: buttons }));

    progressTracker = createBatchProgressTracker(mockCtx, testBatchId);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createBatchProgressTracker', () => {
    test('debe crear una instancia de BatchProgressTracker', () => {
      expect(progressTracker).toBeDefined();
      expect(progressTracker.batchId).toBe(testBatchId);
      expect(progressTracker.ctx).toBe(mockCtx);
    });
  });

  describe('startProgress', () => {
    test('debe iniciar el progreso con mensaje inicial', async () => {
      const totalPDFs = 5;

      const messageId = await progressTracker.startProgress(totalPDFs);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('🚀 **Procesamiento por Lotes Iniciado**'),
        {
          parse_mode: 'Markdown',
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({
                text: '❌ Cancelar Proceso',
                callback_data: `cancel_batch_${testBatchId}`,
              }),
            ]),
          ]),
        }
      );

      expect(messageId).toBe(101);
      expect(progressTracker.progressMessageId).toBe(101);
    });

    test('debe manejar error al crear mensaje inicial', async () => {
      mockCtx.reply.mockRejectedValue(new Error('Network error'));

      const messageId = await progressTracker.startProgress(3);

      expect(messageId).toBeNull();
    });
  });

  describe('updatePhase', () => {
    beforeEach(async () => {
      await progressTracker.startProgress(5);
    });

    test('debe actualizar fase con progreso', async () => {
      await progressTracker.updatePhase('download', 2, 5, 'Descargando archivos...');

      expect(progressTracker.currentPhase).toBe('download');
      expect(progressTracker.currentStep).toBe(2);
      expect(progressTracker.totalSteps).toBe(5);

      expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
        mockCtx.chat.id,
        101,
        null,
        expect.stringContaining('📥 **Descargando PDFs**'),
        {
          parse_mode: 'Markdown',
          inline_keyboard: expect.any(Array),
        }
      );
    });

    test('debe ignorar errores de mensaje no modificado', async () => {
      const error = new Error('message is not modified');
      mockCtx.telegram.editMessageText.mockRejectedValue(error);

      // No debería lanzar error
      await expect(progressTracker.updatePhase('analysis', 1, 3)).resolves.not.toThrow();
    });

    test('debe manejar otros errores de edición', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockCtx.telegram.editMessageText.mockRejectedValue(new Error('Network error'));

      await progressTracker.updatePhase('analysis', 1, 3);

      expect(consoleSpy).toHaveBeenCalledWith('Error actualizando progreso:', 'Network error');

      consoleSpy.mockRestore();
    });
  });

  describe('incrementStep', () => {
    beforeEach(async () => {
      await progressTracker.startProgress(5);
      await progressTracker.updatePhase('download', 2, 5);
    });

    test('debe incrementar paso actual', async () => {
      await progressTracker.incrementStep('Procesando siguiente archivo...');

      expect(progressTracker.currentStep).toBe(3);
      expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
        mockCtx.chat.id,
        101,
        null,
        expect.stringContaining('Procesando siguiente archivo...'),
        expect.any(Object)
      );
    });

    test('no debe exceder el total de pasos', async () => {
      progressTracker.currentStep = 5; // Ya al máximo

      await progressTracker.incrementStep();

      expect(progressTracker.currentStep).toBe(5); // No debe incrementar más
    });
  });

  describe('showAnalysisResults', () => {
    const mockBatchResults = {
      batchId: testBatchId,
      successful: 3,
      failed: 1,
      total: 4,
      results: [
        {
          success: true,
          fileName: 'test1.pdf',
          analysis: {
            clientName: 'Cliente Test 1',
            orderNumber: 'ORD-001',
            totalAmount: 100.5,
          },
        },
        {
          success: true,
          fileName: 'test2.pdf',
          analysis: {
            clientName: 'Cliente Test 2',
            orderNumber: 'ORD-002',
            totalAmount: 250.75,
          },
        },
        {
          success: false,
          fileName: 'test3.pdf',
          error: 'Error de análisis',
        },
      ],
    };

    beforeEach(async () => {
      await progressTracker.startProgress(4);
    });

    test('debe mostrar resultados de análisis con botones', async () => {
      await progressTracker.showAnalysisResults(mockBatchResults);

      expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
        mockCtx.chat.id,
        101,
        null,
        expect.stringContaining('📊 **Análisis Completado**'),
        {
          parse_mode: 'Markdown',
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({
                text: '✅ Generar Facturas',
                callback_data: `confirm_batch_${testBatchId}`,
              }),
              expect.objectContaining({
                text: '❌ Cancelar',
                callback_data: `cancel_batch_${testBatchId}`,
              }),
            ]),
          ]),
        }
      );
    });

    test('debe incluir detalles de archivos exitosos', async () => {
      await progressTracker.showAnalysisResults(mockBatchResults);

      const call = mockCtx.telegram.editMessageText.mock.calls[0];
      const messageText = call[3];

      expect(messageText).toContain('✅ **Exitosos:** 3/4');
      expect(messageText).toContain('❌ **Fallidos:** 1/4');
      expect(messageText).toContain('Cliente Test 1');
      expect(messageText).toContain('ORD-001');
      expect(messageText).toContain('$100');
    });

    test('debe manejar errores de edición', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockCtx.telegram.editMessageText.mockRejectedValue(new Error('Edit error'));

      await progressTracker.showAnalysisResults(mockBatchResults);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error mostrando resultados de análisis:',
        'Edit error'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('showFinalResults', () => {
    const mockInvoiceResults = {
      successful: [
        {
          fileName: 'test1.pdf',
          invoice: {
            folio: '001',
            series: 'A',
          },
        },
        {
          fileName: 'test2.pdf',
          invoice: {
            folioNumber: '002',
            series: 'B',
          },
        },
      ],
      failed: [
        {
          fileName: 'test3.pdf',
          error: 'Cliente no encontrado',
        },
      ],
      total: 3,
    };

    const mockZipInfo = {
      batchId: testBatchId,
      pdfZip: {
        fileName: 'pdfs.zip',
        fileSizeMB: 2.5,
      },
      xmlZip: {
        fileName: 'xmls.zip',
        fileSizeMB: 1.2,
      },
    };

    beforeEach(async () => {
      await progressTracker.startProgress(3);
    });

    test('debe mostrar resultados finales con botones de descarga', async () => {
      await progressTracker.showFinalResults(mockInvoiceResults, mockZipInfo);

      expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
        mockCtx.chat.id,
        101,
        null,
        expect.stringContaining('🎉 **Procesamiento Completado**'),
        {
          parse_mode: 'Markdown',
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({
                text: '📄 Descargar PDFs',
                callback_data: `download_pdf_zip_${testBatchId}`,
              }),
              expect.objectContaining({
                text: '🗂️ Descargar XMLs',
                callback_data: `download_xml_zip_${testBatchId}`,
              }),
            ]),
            expect.arrayContaining([
              expect.objectContaining({
                text: '🏠 Menú Principal',
                callback_data: 'menu_principal',
              }),
            ]),
          ]),
        }
      );
    });

    test('debe mostrar resultados finales sin ZIPs si no hay facturas exitosas', async () => {
      const noSuccessResults = {
        successful: [],
        failed: [{ fileName: 'test.pdf', error: 'Error' }],
        total: 1,
      };

      await progressTracker.showFinalResults(noSuccessResults);

      const call = mockCtx.telegram.editMessageText.mock.calls[0];
      const buttons = call[4].inline_keyboard;

      // Solo debería tener botón de menú principal, no de descarga
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toEqual([
        expect.objectContaining({
          text: '🏠 Menú Principal',
        }),
      ]);
    });

    test('debe incluir resumen de facturas e info de ZIPs', async () => {
      await progressTracker.showFinalResults(mockInvoiceResults, mockZipInfo);

      const call = mockCtx.telegram.editMessageText.mock.calls[0];
      const messageText = call[3];

      expect(messageText).toContain('✅ Facturas generadas: 2');
      expect(messageText).toContain('❌ Errores: 1');
      expect(messageText).toContain('📝 Total procesado: 3');
      expect(messageText).toContain('📄 PDFs: pdfs.zip (2.5MB)');
      expect(messageText).toContain('🗂️ XMLs: xmls.zip (1.2MB)');
    });
  });

  describe('showError', () => {
    const testError = new Error('Procesamiento fallido');

    beforeEach(async () => {
      await progressTracker.startProgress(3);
    });

    test('debe mostrar mensaje de error', async () => {
      await progressTracker.showError(testError);

      expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
        mockCtx.chat.id,
        101,
        null,
        expect.stringContaining('❌ **Error en Procesamiento por Lotes**'),
        {
          parse_mode: 'Markdown',
          inline_keyboard: [
            [
              expect.objectContaining({
                text: '🏠 Menú Principal',
                callback_data: 'menu_principal',
              }),
            ],
          ],
        }
      );
    });

    test('debe incluir detalles del error', async () => {
      await progressTracker.showError(testError);

      const call = mockCtx.telegram.editMessageText.mock.calls[0];
      const messageText = call[3];

      expect(messageText).toContain('Procesamiento fallido');
      expect(messageText).toContain(`🆔 **Lote:** \`${testBatchId}\``);
    });

    test('debe manejar errores de edición', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockCtx.telegram.editMessageText.mockRejectedValue(new Error('Edit error'));

      await progressTracker.showError(testError);

      expect(consoleSpy).toHaveBeenCalledWith('Error mostrando mensaje de error:', 'Edit error');

      consoleSpy.mockRestore();
    });
  });

  describe('helper methods', () => {
    test('estimateProcessingTime debe calcular tiempo estimado', () => {
      expect(progressTracker.estimateProcessingTime(2)).toBe('~30s');
      expect(progressTracker.estimateProcessingTime(5)).toBe('~2m');
      expect(progressTracker.estimateProcessingTime(300)).toBe('~2h');
    });

    test('formatDuration debe formatear duración correctamente', () => {
      expect(progressTracker.formatDuration(5000)).toBe('5s');
      expect(progressTracker.formatDuration(65000)).toBe('1m 5s');
      expect(progressTracker.formatDuration(3665000)).toBe('1h 1m');
      expect(progressTracker.formatDuration(3600000)).toBe('1h');
    });

    test('getPhaseDisplayName debe retornar nombres de fase', () => {
      progressTracker.currentPhase = 'validation';
      expect(progressTracker.getPhaseDisplayName()).toBe('Validando archivos');

      progressTracker.currentPhase = 'download';
      expect(progressTracker.getPhaseDisplayName()).toBe('Descargando PDFs');

      progressTracker.currentPhase = 'unknown_phase';
      expect(progressTracker.getPhaseDisplayName()).toBe('Procesando');
    });
  });
});

describe('cleanupBatchProcessing', () => {
  test('debe limpiar estado de batch processing', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const mockCtx = {
      from: { id: 12345 },
      userState: {
        batchProcessing: {
          batchId: 'test-batch',
          results: {},
        },
        otherData: 'should remain',
      },
    };

    cleanupBatchProcessing(mockCtx);

    expect(mockCtx.userState.batchProcessing).toBeUndefined();
    expect(mockCtx.userState.otherData).toBe('should remain');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('🧹 Estado de batch processing limpiado para usuario 12345')
    );

    consoleSpy.mockRestore();
  });

  test('debe manejar contexto sin userState', () => {
    const mockCtx = { from: { id: 12345 } };

    // No debería lanzar error
    expect(() => {
      cleanupBatchProcessing(mockCtx);
    }).not.toThrow();
  });

  test('debe manejar contexto sin batchProcessing', () => {
    const mockCtx = {
      from: { id: 12345 },
      userState: {
        otherData: 'test',
      },
    };

    // No debería lanzar error
    expect(() => {
      cleanupBatchProcessing(mockCtx);
    }).not.toThrow();
  });
});
