/**
 * PDF Invoice handler for Telegram bot
 * Handles PDF analysis and automated invoice generation
 */

import { Markup } from 'telegraf';
import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { BotContext } from '@/types/bot.types.js';
import { createModuleLogger } from '@core/utils/logger.js';
import { prisma } from '@/config/database.js';

// Service imports
import PDFAnalysisService from '@services/pdf-analysis.service.js';
import InvoiceService from '@services/invoice.service.js';
import FacturapiService from '@services/facturapi.service.js';
import SessionService from '@/core/auth/session.service.js';

// Batch handler import
import { handlePdfBatch } from './pdf-batch.handler.js';

const logger = createModuleLogger('bot-pdf-invoice-handler');

// Progress visual utilities
const PROGRESS_FRAMES = ['⏳', '⌛', '⏳', '⌛'];
const PROGRESS_BARS = [
  '▱▱▱▱▱▱▱▱▱▱',
  '▰▱▱▱▱▱▱▱▱▱',
  '▰▰▱▱▱▱▱▱▱▱',
  '▰▰▰▱▱▱▱▱▱▱',
  '▰▰▰▰▱▱▱▱▱▱',
  '▰▰▰▰▰▱▱▱▱▱',
  '▰▰▰▰▰▰▱▱▱▱',
  '▰▰▰▰▰▰▰▱▱▱',
  '▰▰▰▰▰▰▰▰▱▱',
  '▰▰▰▰▰▰▰▰▰▱',
  '▰▰▰▰▰▰▰▰▰▰',
];

interface ProgressMessage {
  message_id: number;
}

interface PDFAnalysis {
  confidence: number;
  client: boolean;
  clientName: string;
  clientCode: string;
  orderNumber: string;
  totalAmount: number;
  errors: string[];
}

interface AnalysisData {
  id: string;
  analysis: PDFAnalysis;
  validation: {
    isValid: boolean;
    errors?: string[];
  };
  timestamp: number;
}

/**
 * Updates progress message with animation
 */
async function updateProgressMessage(
  ctx: BotContext,
  messageId: number | null,
  step: number,
  total: number,
  currentTask: string,
  details: string = ''
): Promise<void> {
  if (!messageId) return;

  const percentage = Math.round((step / total) * 100);
  const progressBarIndex = Math.min(Math.floor((step / total) * 10), 9);
  const frameIndex = step % PROGRESS_FRAMES.length;

  const progressText =
    `${PROGRESS_FRAMES[frameIndex]} **Procesando PDF**\n\n` +
    `📊 Progreso: ${percentage}% ${PROGRESS_BARS[progressBarIndex]}\n` +
    `🔄 ${currentTask}\n` +
    (details ? `📝 ${details}\n` : '') +
    `\n⏱️ Por favor espere...`;

  try {
    await ctx.telegram.editMessageText(ctx.chat?.id, messageId, undefined, progressText, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    logger.debug('No se pudo editar mensaje de progreso:', (error as Error).message);
  }
}

// Get current directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Ensures the temporary directory exists (async)
 */
export async function ensureTempDirExists(): Promise<string> {
  const tempDir = path.join(__dirname, '../../../temp');
  try {
    await fs.access(tempDir);
  } catch {
    await fs.mkdir(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * Downloads a Telegram file
 */
export async function downloadTelegramFile(
  ctx: BotContext,
  fileId: string,
  fileName: string,
  tempDir: string
): Promise<string> {
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const filePath = path.join(tempDir, `${Date.now()}_${fileName}`);

  const response = await axios({
    method: 'GET',
    url: fileLink.href,
    responseType: 'arraybuffer',
  });

  await fs.writeFile(filePath, response.data);
  return filePath;
}

/**
 * Registers the simplified PDF invoice handler
 */
export function registerPDFInvoiceHandler(bot: any): void {
  // Main handler for PDF documents
  bot.on('document', async (ctx: BotContext, next: () => Promise<void>) => {
    logger.info('========== HANDLER PDF SIMPLIFICADO ==========');

    if (!ctx.message || !('document' in ctx.message)) {
      return next();
    }

    const document = ctx.message.document;

    const fileName = document.file_name || '';

    // Only process PDFs
    if (!fileName.match(/\.pdf$/i)) {
      logger.info('No es PDF, pasando al siguiente handler');
      return next();
    }

    // Check not in another process
    if (
      ctx.userState?.esperando &&
      (ctx.userState.esperando === 'archivo_excel_chubb' || ctx.userState.productionSetup)
    ) {
      logger.info('Usuario en otro proceso, saltando');
      return next();
    }

    // Check tenant
    if (!ctx.hasTenant()) {
      await ctx.reply('❌ Para procesar facturas, primero debes registrar tu empresa.');
      return;
    }

    // Route to batch handler if it's part of a media group
    if (ctx.message.media_group_id) {
      handlePdfBatch(ctx);
      return; // CRÍTICO: Detener ejecución para que no se procese como PDF individual
    }

    // Immediate feedback: Show progress as soon as PDF is detected
    const progressMessage = await ctx.reply('📥 Recibiendo PDF...\n⏳ Validando archivo...');

    try {
      // STEP 1: Downloading file
      await updateProgressMessage(
        ctx,
        progressMessage.message_id,
        1,
        4,
        'Descargando PDF',
        'Obteniendo archivo...'
      );

      // Download file
      const tempDir = await ensureTempDirExists();
      const filePath = await downloadTelegramFile(ctx, document.file_id, fileName, tempDir);

      // STEP 2: Analyzing content
      await updateProgressMessage(
        ctx,
        progressMessage.message_id,
        2,
        4,
        'Analizando PDF',
        'Extrayendo información...'
      );

      // Analyze PDF
      const analysisResult = await PDFAnalysisService.analyzePDF(filePath);

      // STEP 3: Validating data
      await updateProgressMessage(
        ctx,
        progressMessage.message_id,
        3,
        4,
        'Validando datos',
        'Verificando información...'
      );

      // Validate extracted data
      const validation = analysisResult.analysis
        ? PDFAnalysisService.validateExtractedData(analysisResult.analysis)
        : { isValid: false, errors: ['No se pudo extraer información del PDF'] };

      // STEP 4: Completed
      await updateProgressMessage(
        ctx,
        progressMessage.message_id,
        4,
        4,
        'Análisis completado',
        'Datos extraídos exitosamente'
      );

      // Clean temporary file (async)
      try {
        await fs.unlink(filePath);
      } catch (e) {
        logger.error('Error limpiando archivo:', e);
      }

      if (!analysisResult.success) {
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          progressMessage.message_id,
          undefined,
          `❌ Error al analizar el PDF: ${analysisResult.error}`
        );
        return;
      }

      // Show results
      if (analysisResult.analysis) {
        await showSimpleAnalysisResults(
          ctx,
          {
            confidence: analysisResult.analysis.confidence,
            client:
              typeof analysisResult.analysis.client === 'boolean'
                ? analysisResult.analysis.client
                : analysisResult.analysis.client === 'true',
            clientName: analysisResult.analysis.clientName ?? '',
            clientCode: analysisResult.analysis.clientCode ?? '',
            orderNumber: analysisResult.analysis.orderNumber ?? '',
            totalAmount: analysisResult.analysis.totalAmount ?? 0,
            errors: analysisResult.analysis.errors,
          },
          validation
        );
      } else {
        await ctx.reply('❌ No se pudo extraer información del PDF.');
      }
    } catch (error) {
      logger.error('Error procesando PDF:', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        userId: ctx.from?.id,
        fileName: fileName,
        timestamp: new Date().toISOString(),
      });

      // Update progress message with error
      try {
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          progressMessage.message_id,
          undefined,
          `❌ Error al procesar el PDF: ${(error as Error).message}`
        );
      } catch (editError) {
        await ctx.reply(`❌ Error al procesar el PDF: ${(error as Error).message}`);
      }
    }
  });

  // Handler to confirm extracted data
  bot.action(/^confirm_simple_pdf_(.+)$/, async (ctx: BotContext): Promise<void> => {
    const analysisId = ctx.match?.[1];
    if (!analysisId) {
      await ctx.answerCbQuery('Error: ID de análisis no encontrado');
      return;
    }

    // Immediate feedback
    const invoiceProgressMsg = await ctx.reply(
      '⚡ Procesando factura PDF...\n⏳ Validando datos...'
    );

    // Answer callback query immediately
    await ctx.answerCbQuery();

    // REGLA DE ORO: Lectura simple y directa de ctx.userState
    const analysisData: AnalysisData | null = ctx.userState?.pdfAnalysis;

    if (!analysisData || analysisData.id !== analysisId) {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        invoiceProgressMsg.message_id,
        undefined,
        '❌ Los datos han expirado o no se encontraron. Sube el PDF nuevamente.'
      );
      return;
    }

    await generateSimpleInvoice(ctx, analysisData, invoiceProgressMsg.message_id);
  });

  // Handler for manual editing
  bot.action(/^edit_simple_pdf_(.+)$/, async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery();
    const analysisId = ctx.match?.[1];
    if (!analysisId) {
      await ctx.reply('❌ Error: ID de análisis no encontrado');
      return;
    }

    // REGLA DE ORO: Solo leer de ctx.userState
    const analysisData: AnalysisData | null = ctx.userState?.pdfAnalysis;

    if (!analysisData || analysisData.id !== analysisId) {
      await ctx.reply('❌ Los datos han expirado. Sube el PDF nuevamente.');
      return;
    }

    await startManualEditFlow(ctx, analysisData);
  });
}

/**
 * Shows analysis results in simple format
 */
async function showSimpleAnalysisResults(
  ctx: BotContext,
  analysis: PDFAnalysis,
  validation: { isValid: boolean; errors?: string[] }
): Promise<void> {
  const analysisId = `simple_${Date.now()}_${ctx.from?.id}`;

  if (!ctx.userState) {
    ctx.userState = {};
  }

  const analysisData: AnalysisData = {
    id: analysisId,
    analysis,
    validation,
    timestamp: Date.now(),
  };

  // REGLA DE ORO: Solo escribir en ctx.userState
  ctx.userState.pdfAnalysis = analysisData;

  // CRÍTICO: Forzar guardado inmediato del estado
  const userId = ctx.from?.id || ctx.callbackQuery?.from?.id;
  if (userId) {
    await SessionService.saveUserStateImmediate(userId, ctx.userState);
    logger.info({ userId }, 'Análisis de PDF individual guardado en userState.');
  }

  let message = '🔍 **Análisis Completado**\n\n';

  const confidenceEmoji =
    analysis.confidence >= 80 ? '🟢' : analysis.confidence >= 60 ? '🟡' : '🔴';
  message += `${confidenceEmoji} **Confianza:** ${analysis.confidence}%\n\n`;

  if (analysis.client) {
    message += `👤 **Cliente:** ${analysis.clientName}\n`;
    message += `🔑 **Código:** ${analysis.clientCode}\n`;
  } else {
    message += `❌ **Cliente:** No identificado\n`;
  }

  if (analysis.orderNumber) {
    message += `📄 **Pedido:** ${analysis.orderNumber}\n`;
  } else {
    message += `❌ **Pedido:** No encontrado\n`;
  }

  if (analysis.totalAmount) {
    message += `💰 **Importe:** $${analysis.totalAmount.toFixed(2)} MXN\n`;
  } else {
    message += `❌ **Importe:** No encontrado\n`;
  }

  if (analysis.errors.length > 0) {
    message += `\n⚠️ **Problemas encontrados:**\n`;
    analysis.errors.forEach((error) => {
      message += `• ${error}\n`;
    });
  }

  const buttons = [];

  if (validation.isValid && analysis.confidence >= 70) {
    buttons.push([
      Markup.button.callback('✅ Generar Factura', `confirm_simple_pdf_${analysisId}`),
    ]);
  }

  buttons.push([Markup.button.callback('✏️ Editar Manualmente', `edit_simple_pdf_${analysisId}`)]);
  buttons.push([Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]);

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
  });
}

/**
 * Generates invoice with extracted data
 */
async function generateSimpleInvoice(
  ctx: BotContext,
  analysisData: AnalysisData,
  progressMessageId: number | null = null
): Promise<void> {
  const { analysis } = analysisData;

  if (!ctx.userState) {
    ctx.userState = {};
  }
  if (!ctx.session) {
    ctx.session = {};
  }

  if (progressMessageId) {
    await ctx.telegram.editMessageText(
      ctx.chat?.id,
      progressMessageId,
      undefined,
      '⚡ Preparando facturación...\n⏳ Validando tenant...',
      { parse_mode: 'Markdown' }
    );
  }

  try {
    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      const errorMsg = '❌ Error: No se encontró el ID del tenant';
      if (progressMessageId) {
        await ctx.telegram.editMessageText(ctx.chat?.id, progressMessageId, undefined, errorMsg);
      } else {
        await ctx.reply(errorMsg);
      }
      return;
    }

    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        progressMessageId,
        undefined,
        '🔍 Buscando cliente...\n⏳ Consultando base de datos...',
        { parse_mode: 'Markdown' }
      );
    }

    // Search customer in local DB first, then in FacturAPI
    let clienteId: string | null = null;
    let localCustomerDbId: number | null = null;
    let clienteNombre: string | null = null;

    try {
      logger.info(`🔍 Buscando cliente en BD local: "${analysis.clientName}"`);
      const localCustomer = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          legalName: { contains: analysis.clientName, mode: 'insensitive' },
        },
      });

      if (localCustomer) {
        clienteId = localCustomer.facturapiCustomerId;
        localCustomerDbId = Number(localCustomer.id);
        clienteNombre = localCustomer.legalName;
        logger.info(
          `✅ Cliente encontrado en BD local: ${localCustomer.legalName} (FacturAPI ID: ${clienteId}, DB ID: ${localCustomerDbId})`
        );
      } else {
        logger.info(
          `⚠️ Cliente no encontrado en BD local, buscando en FacturAPI: "${analysis.clientName}"`
        );

        if (progressMessageId) {
          await ctx.telegram.editMessageText(
            ctx.chat?.id,
            progressMessageId,
            undefined,
            '🔍 Buscando cliente en FacturAPI...\n⏳ Consultando servicios externos...',
            { parse_mode: 'Markdown' }
          );
        }

        const facturapi = await FacturapiService.getFacturapiClient(tenantId);
        const clientes = await facturapi.customers.list({
          q: analysis.clientName,
        });

        if (clientes && clientes.data && clientes.data.length > 0) {
          clienteId = clientes.data[0].id;
          clienteNombre = clientes.data[0].legal_name;
          logger.info(
            `Cliente encontrado en FacturAPI: ${clientes.data[0].legal_name} (ID: ${clienteId})`
          );
        } else {
          const errorMsg = `❌ No se encontró el cliente "${analysis.clientName}" ni en BD local ni en FacturAPI. Por favor, asegúrate de que esté registrado.`;
          if (progressMessageId) {
            await ctx.telegram.editMessageText(
              ctx.chat?.id,
              progressMessageId,
              undefined,
              errorMsg
            );
          } else {
            await ctx.reply(errorMsg);
          }
          return;
        }
      }
    } catch (error) {
      logger.error('Error buscando cliente:', error);
      const errorMsg = `❌ Error al buscar cliente: ${(error as Error).message}`;
      if (progressMessageId) {
        await ctx.telegram.editMessageText(ctx.chat?.id, progressMessageId, undefined, errorMsg);
      } else {
        await ctx.reply(errorMsg);
      }
      return;
    }

    const facturaData = {
      clienteId: clienteId!,
      localCustomerDbId: localCustomerDbId ?? undefined,
      clienteNombre: clienteNombre!,
      numeroPedido: analysis.orderNumber,
      claveProducto: '78101803', // Fixed SAT key for all customers
      monto: analysis.totalAmount,
      userId: ctx.from?.id || 0,
    };

    logger.info('Datos para factura:', facturaData);

    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        progressMessageId,
        undefined,
        '🚀 Generando factura en FacturAPI...\n⏳ Enviando datos al servidor...',
        { parse_mode: 'Markdown' }
      );
    }

    const totalStartTime = Date.now();
    logger.info(`[INVOICE_METRICS] Iniciando InvoiceService.generateInvoice()`);

    const factura = await InvoiceService.generateInvoice(facturaData, tenantId);

    const totalDuration = Date.now() - totalStartTime;
    logger.info(`[INVOICE_METRICS] InvoiceService.generateInvoice() TOTAL tomó ${totalDuration}ms`);
    logger.info('Factura generada exitosamente:', factura.id, 'Folio:', factura.folio_number);

    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        progressMessageId,
        undefined,
        '✅ Factura generada exitosamente\n📋 Preparando detalles...',
        { parse_mode: 'Markdown' }
      );
    }

    await ctx.reply(
      `✅ **Factura Generada Exitosamente**\n\n` +
        `Serie-Folio: ${factura.series}-${factura.folio_number}\n` +
        `Cliente: ${analysis.clientName}\n` +
        `Pedido: ${analysis.orderNumber}\n` +
        `Total: ${analysis.totalAmount.toFixed(2)} MXN\n\n` +
        `_La factura se está registrando en segundo plano._`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback('📄 Descargar PDF', `pdf_${factura.id}_${factura.folio_number}`),
            Markup.button.callback('📂 Descargar XML', `xml_${factura.id}_${factura.folio_number}`),
          ],
          [Markup.button.callback('⬅️ Volver al Menú', 'menu_principal')],
        ]).reply_markup,
      }
    );

    delete ctx.userState.pdfAnalysis;
  } catch (error) {
    logger.error('Error generando factura:', {
      error: (error as Error).message,
      stack: (error as Error).stack,
      userId: ctx.from?.id,
      tenantId: ctx.getTenantId(),
      analysisId: analysisData?.id,
      timestamp: new Date().toISOString(),
    });

    const errorMsg = `❌ Error al generar la factura: ${(error as Error).message}`;
    if (progressMessageId) {
      try {
        await ctx.telegram.editMessageText(ctx.chat?.id, progressMessageId, undefined, errorMsg);
      } catch (editError) {
        await ctx.reply(errorMsg);
      }
    } else {
      await ctx.reply(errorMsg);
    }
  }
}

/**
 * Starts manual edit flow with prefilled data
 */
async function startManualEditFlow(ctx: BotContext, analysisData: AnalysisData): Promise<void> {
  const { analysis } = analysisData;

  if (!ctx.userState) {
    ctx.userState = {};
  }

  ctx.userState.clienteNombre = analysis.clientName || '';
  ctx.userState.clienteId = analysis.clientCode || '';
  ctx.userState.numeroPedido = analysis.orderNumber || '';
  ctx.userState.monto = analysis.totalAmount || 0;

  delete ctx.userState.pdfAnalysis;

  await ctx.reply(
    '✏️ **Modo Manual Activado**\n\n' +
      'He prellenado los datos detectados. Ahora puedes corregirlos:\n\n' +
      `Cliente: ${ctx.userState.clienteNombre || 'No detectado'}\n` +
      `Pedido: ${ctx.userState.numeroPedido || 'No detectado'}\n` +
      `Monto: $${ctx.userState.monto || '0.00'}\n\n` +
      'Por favor, confirma el **número de pedido**:',
    { parse_mode: 'Markdown' }
  );

  ctx.userState.esperando = 'numeroPedido';
}

export default {
  registerPDFInvoiceHandler,
};
