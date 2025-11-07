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

// Batch processing storage
const pdfGroups = new Map<
  string,
  {
    documents: any[];
    messageId: number;
    chatId: number; // Guardar el ID del chat para respuestas correctas
    timeout: NodeJS.Timeout;
  }
>();

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
 * Processes a batch of PDFs from a media group
 */
async function processBatchPDFs(mediaGroupId: string, ctx: BotContext): Promise<void> {
  const group = pdfGroups.get(mediaGroupId);
  if (!group) return;

  // Extraer chatId del grupo para enviar mensajes de forma fiable
  const { documents, messageId, chatId } = group;
  pdfGroups.delete(mediaGroupId); // Limpiar inmediatamente para evitar doble procesamiento

  const results: any[] = [];

  try {
    await ctx.telegram.editMessageText(
      chatId,
      messageId,
      undefined,
      `🔄 Procesando ${documents.length} PDFs...`
    );

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];

      await ctx.telegram
        .editMessageText(
          chatId,
          messageId,
          undefined,
          `🔄 Procesando PDF ${i + 1} de ${documents.length}...\n📄 ${doc.file_name || 'documento.pdf'}`
        )
        .catch(() => {});

      try {
        const tempDir = await ensureTempDirExists();
        const filePath = await downloadTelegramFile(
          ctx,
          doc.file_id,
          doc.file_name || 'documento.pdf',
          tempDir
        );
        const analysisResult = await PDFAnalysisService.analyzePDF(filePath);

        await fs.unlink(filePath);

        const analysisData = analysisResult.analysis || analysisResult;
        results.push({
          fileName: doc.file_name || 'documento.pdf',
          success: true,
          data: analysisData,
        });
      } catch (error) {
        logger.error({ error, fileName: doc.file_name }, 'Error procesando PDF del lote');
        results.push({
          fileName: doc.file_name || 'documento.pdf',
          success: false,
          error: error instanceof Error ? error.message : 'Error desconocido',
        });
      }
    }

    // Guardar resultados en userState y session
    const batchData = {
      results: results.filter((r) => r.success),
      timestamp: Date.now(),
      totalProcessed: documents.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };

    ctx.userState = ctx.userState || {};
    ctx.userState.batchAnalysis = batchData;
    if (ctx.session) {
      ctx.session.pdfAnalysis = batchData;
    }

    // Mostrar resumen con MarkdownV2 (escape de caracteres especiales)
    let summaryText = `✅ *Lote procesado*\n\n`;
    summaryText += `📊 Total\\: ${documents.length} PDFs\n`;
    summaryText += `✅ Exitosos\\: ${batchData.successful}\n`;
    if (batchData.failed > 0) {
      summaryText += `❌ Fallidos\\: ${batchData.failed}\n`;
    }
    summaryText += `\n📋 Selecciona una opción\\:`;

    // Enviar mensaje usando el chatId guardado con botón para generar facturas
    await ctx.telegram.sendMessage(chatId, summaryText, {
      parse_mode: 'MarkdownV2',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('📄 Generar Facturas', 'batch_generate_invoices')],
        [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
      ]).reply_markup,
    });
  } catch (error) {
    logger.error({ error, mediaGroupId }, 'Error procesando lote');
    await ctx.telegram.sendMessage(chatId, '❌ Error procesando el lote de PDFs').catch(() => {});
  }
  // Nota: Ya NO eliminamos el grupo aquí porque lo eliminamos al inicio
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

    // Detect if it's part of a media group (batch processing)
    if ('media_group_id' in ctx.message && ctx.message.media_group_id) {
      const mediaGroupId = ctx.message.media_group_id;

      logger.info(`📊 Media group detectado: ${mediaGroupId}, agregando PDF al lote`);

      // Obtener el grupo actual o crear uno nuevo si es el primer archivo
      let group = pdfGroups.get(mediaGroupId);
      if (!group) {
        const msg = await ctx.reply('📥 Recibiendo lote de PDFs...');
        group = {
          documents: [],
          messageId: msg.message_id,
          chatId: ctx.chat!.id,
          timeout: null as any,
        };
        pdfGroups.set(mediaGroupId, group);
      }

      // Limpiar el temporizador anterior para reiniciarlo
      if (group.timeout) {
        clearTimeout(group.timeout);
      }

      // Agregar el documento y actualizar el mensaje de progreso
      group.documents.push(document);
      await ctx.telegram
        .editMessageText(
          group.chatId,
          group.messageId,
          undefined,
          `📥 Recibiendo PDFs... (${group.documents.length} archivos)`
        )
        .catch(() => {}); // El catch vacío previene crashes si el mensaje no se modifica

      // Crear un nuevo temporizador que se reiniciará con cada archivo
      group.timeout = setTimeout(() => {
        // Pasamos el ID del grupo y el contexto original
        processBatchPDFs(mediaGroupId, ctx).catch((err) => {
          logger.error({ error: err, mediaGroupId }, 'Error procesando lote de PDFs');
        });
      }, 2000); // Esperar 2 segundos después del último archivo

      return; // Detener para no procesar el archivo individualmente
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

    // Retry if data not ready
    let retries = 3;
    let analysisData: AnalysisData | null = null;

    while (retries > 0) {
      analysisData = ctx.userState?.pdfAnalysis;

      if (analysisData && analysisData.id === analysisId) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));

      if (ctx.reloadSession) {
        try {
          await ctx.reloadSession();
        } catch (error) {
          logger.error('Error recargando sesión:', error);
        }
      }

      retries--;
    }

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

    if (!ctx.userState) {
      ctx.userState = {};
    }
    if (!ctx.session) {
      ctx.session = {};
    }

    let analysisData: AnalysisData | null = ctx.userState?.pdfAnalysis;

    if (!analysisData || analysisData.id !== analysisId) {
      analysisData = ctx.session?.pdfAnalysis;

      if (!analysisData || analysisData.id !== analysisId) {
        await ctx.reply('❌ Los datos han expirado. Sube el PDF nuevamente.');
        return;
      }

      ctx.userState.pdfAnalysis = analysisData;
    }

    await startManualEditFlow(ctx, analysisData);
  });

  // Handler for batch invoice generation
  bot.action('batch_generate_invoices', async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery();

    logger.info('Generando facturas desde batch de PDFs...');

    // Recuperar datos del batch desde session o userState
    let batchData = ctx.session?.pdfAnalysis || ctx.userState?.batchAnalysis;

    if (!batchData || !batchData.results || batchData.results.length === 0) {
      await ctx.reply(
        '❌ No hay datos de análisis disponibles. Por favor, procese los PDFs nuevamente.'
      );
      return;
    }

    const progressMsg = await ctx.reply('🔄 Generando facturas...');

    try {
      const tenantId = ctx.getTenantId();
      if (!tenantId) {
        throw new Error('No se pudo obtener el ID del tenant');
      }

      const invoiceResults: any[] = [];

      for (let i = 0; i < batchData.results.length; i++) {
        const result = batchData.results[i];

        await ctx.telegram
          .editMessageText(
            ctx.chat?.id,
            progressMsg.message_id,
            undefined,
            `🔄 Generando factura ${i + 1} de ${batchData.results.length}...\n📄 ${result.fileName}`
          )
          .catch(() => {});

        try {
          const analysis = result.data;

          // Buscar cliente en BD local primero
          const cliente = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId,
              OR: [
                { legalName: { equals: analysis.clientName, mode: 'insensitive' } },
                { legalName: { contains: analysis.clientName, mode: 'insensitive' } },
              ],
            },
          });

          if (!cliente) {
            invoiceResults.push({
              fileName: result.fileName,
              success: false,
              error: `Cliente no encontrado: ${analysis.clientName}`,
            });
            continue;
          }

          // Generar factura
          const invoice = await InvoiceService.generateInvoice(
            {
              clienteId: cliente.facturapiCustomerId,
              localCustomerDbId: Number(cliente.id),
              clienteNombre: cliente.legalName,
              numeroPedido: analysis.orderNumber,
              claveProducto: '78101803',
              monto: analysis.totalAmount,
            },
            tenantId
          );

          invoiceResults.push({
            fileName: result.fileName,
            success: true,
            invoice: invoice,
            folio: `${invoice.series}-${invoice.folio_number}`,
          });
        } catch (error) {
          logger.error({ error, fileName: result.fileName }, 'Error generando factura del batch');
          invoiceResults.push({
            fileName: result.fileName,
            success: false,
            error: (error as Error).message,
          });
        }
      }

      // Mostrar resumen
      const successCount = invoiceResults.filter((r) => r.success).length;
      const failCount = invoiceResults.filter((r) => !r.success).length;

      let invoiceSummary = `📊 *Resumen de Facturación*\n\n`;
      invoiceSummary += `✅ Facturas generadas: ${successCount}\n`;
      invoiceSummary += `❌ Errores: ${failCount}\n\n`;

      if (successCount > 0) {
        invoiceSummary += `*Facturas exitosas:*\n`;
        invoiceResults
          .filter((r) => r.success)
          .slice(0, 10) // Limitar a 10 para evitar mensajes muy largos
          .forEach((r, i) => {
            invoiceSummary += `${i + 1}. ${r.folio}\n`;
          });
        if (successCount > 10) {
          invoiceSummary += `\n_...y ${successCount - 10} más_\n`;
        }
      }

      if (failCount > 0) {
        invoiceSummary += `\n*Errores:*\n`;
        invoiceResults
          .filter((r) => !r.success)
          .slice(0, 5) // Limitar a 5 errores
          .forEach((r, i) => {
            invoiceSummary += `${i + 1}. ${r.fileName}: ${r.error}\n`;
          });
        if (failCount > 5) {
          invoiceSummary += `\n_...y ${failCount - 5} más_\n`;
        }
      }

      await ctx.reply(invoiceSummary, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
        ]).reply_markup,
      });

      // Limpiar datos del batch
      delete ctx.userState?.batchAnalysis;
      if (ctx.session) {
        delete ctx.session.pdfAnalysis;
      }
    } catch (error) {
      logger.error({ error }, 'Error en batch_generate_invoices');
      await ctx.reply(`❌ Error: ${(error as Error).message}`);
    }
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
  if (!ctx.session) {
    ctx.session = {};
  }

  const analysisData: AnalysisData = {
    id: analysisId,
    analysis,
    validation,
    timestamp: Date.now(),
  };

  ctx.userState.pdfAnalysis = analysisData;
  ctx.session.pdfAnalysis = analysisData;

  try {
    if (ctx.saveSession && typeof ctx.saveSession === 'function') {
      await ctx.saveSession();
    }
  } catch (error) {
    logger.error('Error guardando análisis PDF en sesión:', error);
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
