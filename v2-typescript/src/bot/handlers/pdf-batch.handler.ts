// bot/handlers/pdf-batch.handler.ts
/**
 * Handler dedicado al procesamiento de lotes de PDFs (media groups).
 * Usa el middleware telegraf-media-group para recibir todos los PDFs juntos.
 */
import { Markup } from 'telegraf';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import archiver from 'archiver';
import type { BotContext } from '@/types/bot.types.js';
import { createModuleLogger } from '@core/utils/logger.js';
import { prisma } from '@/config/database.js';
import { downloadTelegramFile, ensureTempDirExists } from './pdf-invoice.handler.js';
import PDFAnalysisService from '@services/pdf-analysis.service.js';
import InvoiceService from '@services/invoice.service.js';
import FacturapiService from '@services/facturapi.service.js';

const logger = createModuleLogger('bot-pdf-batch-handler');

/**
 * Registra el handler que escucha el evento 'media_group' del middleware
 */
export function registerMediaGroupHandler(bot: any): void {
  logger.info('Registrando handler de media groups...');

  bot.on('media_group', async (ctx: BotContext) => {
    logger.info('========== MEDIA GROUP RECIBIDO ==========');

    // El middleware nos da todos los mensajes en ctx.mediaGroup
    const messages = ctx.mediaGroup;

    if (!messages || messages.length === 0) {
      logger.warn('Media group vacío recibido');
      return;
    }

    // Filtrar solo documentos PDF
    const pdfMessages = messages.filter((msg: any) => {
      const doc = msg.document;
      return doc && doc.file_name && doc.file_name.match(/\.pdf$/i);
    });

    if (pdfMessages.length === 0) {
      logger.info('Media group no contiene PDFs, ignorando');
      return;
    }

    logger.info(`📦 Lote de ${pdfMessages.length} PDFs recibido del middleware`);

    // Validar tenant
    if (!ctx.hasTenant || !ctx.hasTenant()) {
      await ctx.reply('❌ Para procesar lotes de PDFs, primero debes registrar tu empresa.');
      return;
    }

    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      logger.error('tenantId es undefined después de validación hasTenant()');
      await ctx.reply('❌ Error: No se pudo identificar tu empresa.');
      return;
    }

    logger.info(`✅ tenantId confirmado: ${tenantId}`);

    // Mensaje de progreso inicial
    const progressMsg = await ctx.reply(
      `📥 Lote de ${pdfMessages.length} PDFs recibido\n⏳ Iniciando análisis...`
    );

    try {
      await processPdfBatch(ctx, pdfMessages, tenantId, progressMsg.message_id);
    } catch (error: any) {
      logger.error({ error, tenantId }, 'Error procesando lote de PDFs');
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        undefined,
        `❌ Error procesando el lote: ${error.message}`
      );
    }
  });

  logger.info('✅ Handler de media groups registrado');
}

/**
 * Procesa un lote completo de PDFs
 */
async function processPdfBatch(
  ctx: BotContext,
  pdfMessages: any[],
  tenantId: string,
  progressMessageId: number
): Promise<void> {
  const chatId = ctx.chat!.id;
  const documents = pdfMessages.map((msg) => msg.document);

  logger.info({
    event: 'batch_processing_started',
    tenantId,
    totalPdfs: documents.length,
    userId: ctx.from?.id,
  });

  // Actualizar progreso
  await ctx.telegram.editMessageText(
    chatId,
    progressMessageId,
    undefined,
    `🔄 Analizando ${documents.length} PDFs...`
  );

  const analysisResults = [];
  const startTime = Date.now();

  // Procesar cada PDF secuencialmente
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];

    await ctx.telegram
      .editMessageText(
        chatId,
        progressMessageId,
        undefined,
        `🔄 Analizando PDF ${i + 1} de ${documents.length}: ${doc.file_name}`
      )
      .catch(() => {});

    try {
      const tempDir = await ensureTempDirExists();
      const filePath = await downloadTelegramFile(ctx, doc.file_id, doc.file_name, tempDir);
      const analysisResult = await PDFAnalysisService.analyzePDF(filePath);
      await fs.unlink(filePath);

      if (analysisResult.success) {
        analysisResults.push({
          fileName: doc.file_name,
          success: true,
          data: analysisResult.analysis,
        });
      } else {
        throw new Error(analysisResult.error || 'Análisis fallido');
      }
    } catch (error: any) {
      logger.error({ error, fileName: doc.file_name }, 'Error procesando un PDF del lote');
      analysisResults.push({
        fileName: doc.file_name,
        success: false,
        error: error.message,
      });
    }
  }

  // Guardar resultados en sesión
  const batchData = {
    results: analysisResults.filter((r) => r.success),
    failedCount: analysisResults.filter((r) => !r.success).length,
    totalProcessed: documents.length,
    timestamp: Date.now(),
  };

  if (!ctx.session) ctx.session = {};
  ctx.session.batchAnalysis = batchData;

  const processingTime = Date.now() - startTime;
  logger.info({
    event: 'batch_processing_completed',
    tenantId,
    totalPdfs: documents.length,
    successCount: batchData.results.length,
    failCount: batchData.failedCount,
    processingTimeMs: processingTime,
  });

  // Mostrar resumen
  let summaryText = `✅ *Análisis de Lote Completado*\\n\\n`;
  summaryText += `📊 Total de PDFs: ${batchData.totalProcessed}\\n`;
  summaryText += `✅ Exitosos: ${batchData.results.length}\\n`;
  if (batchData.failedCount > 0) {
    summaryText += `❌ Fallidos: ${batchData.failedCount}\\n`;
  }
  summaryText += `\\nAhora puedes generar las facturas para los PDFs exitosos\\.`;

  await ctx.telegram.editMessageText(chatId, progressMessageId, undefined, summaryText, {
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📄 Generar Facturas', callback_data: 'batch_generate_invoices' }],
        [{ text: '❌ Cancelar', callback_data: 'batch_cancel' }],
      ],
    },
  });
}

/**
 * Registra los handlers de acciones para lotes
 */
export function registerBatchActionHandlers(bot: any): void {
  logger.info('Registrando action handlers de lotes...');

  // Handler: Generar facturas desde el lote analizado
  bot.action('batch_generate_invoices', async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery('Iniciando generación de facturas...');

    const batchData = ctx.session?.batchAnalysis;
    if (!batchData || !batchData.results || batchData.results.length === 0) {
      await ctx.reply(
        '❌ No hay datos de análisis de lote disponibles. Por favor, envía los PDFs de nuevo.'
      );
      return;
    }

    const progressMsg = await ctx.reply(`🔄 Generando ${batchData.results.length} facturas...`);
    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        undefined,
        '❌ Error: No se pudo identificar tu empresa (tenant).'
      );
      return;
    }

    const invoiceResults: any[] = [];
    const startTime = Date.now();

    for (let i = 0; i < batchData.results.length; i++) {
      const result = batchData.results[i];
      await ctx.telegram
        .editMessageText(
          ctx.chat!.id,
          progressMsg.message_id,
          undefined,
          `🔄 Generando factura ${i + 1} de ${batchData.results.length}: ${result.fileName}`
        )
        .catch(() => {});

      try {
        const analysis = result.data;
        const customer = await prisma.tenantCustomer.findFirst({
          where: { tenantId, legalName: { equals: analysis.clientName, mode: 'insensitive' } },
        });

        if (!customer) {
          throw new Error(`Cliente no encontrado: ${analysis.clientName}`);
        }

        const invoice = await InvoiceService.generateInvoice(
          {
            clienteId: customer.facturapiCustomerId,
            localCustomerDbId: Number(customer.id),
            clienteNombre: customer.legalName,
            numeroPedido: analysis.orderNumber,
            claveProducto: '78101803',
            monto: analysis.totalAmount,
          },
          tenantId
        );

        invoiceResults.push({
          fileName: result.fileName,
          success: true,
          invoice,
        });
      } catch (error: any) {
        logger.error({ error, fileName: result.fileName }, 'Error generando factura');
        invoiceResults.push({ fileName: result.fileName, success: false, error: error.message });
      }
    }

    if (!ctx.session) ctx.session = {};
    ctx.session.invoiceResults = invoiceResults;

    const successCount = invoiceResults.filter((r) => r.success).length;
    const failCount = invoiceResults.filter((r) => !r.success).length;
    const totalTime = Date.now() - startTime;

    logger.info({
      event: 'batch_invoicing_completed',
      tenantId,
      successCount,
      failCount,
      totalTimeMs: totalTime,
    });

    let summaryText = `*Resumen de Facturación de Lote*\\n\\n`;
    summaryText += `✅ Facturas generadas: ${successCount}\\n`;
    summaryText += `❌ Errores: ${failCount}\\n`;

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      progressMsg.message_id,
      undefined,
      summaryText,
      {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📄 Descargar PDFs', callback_data: 'batch_download_pdfs' }],
            [{ text: '📂 Descargar XMLs', callback_data: 'batch_download_xmls' }],
            [{ text: '✅ Finalizar', callback_data: 'batch_finish' }],
          ],
        },
      }
    );
  });

  // Handler: Descargar PDFs en ZIP
  bot.action('batch_download_pdfs', async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery('Preparando ZIP de PDFs...');
    await downloadBatchZip(ctx, 'pdf');
  });

  // Handler: Descargar XMLs en ZIP
  bot.action('batch_download_xmls', async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery('Preparando ZIP de XMLs...');
    await downloadBatchZip(ctx, 'xml');
  });

  // Handler: Finalizar y limpiar sesión
  bot.action('batch_finish', async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery('Proceso finalizado.');
    await ctx.deleteMessage().catch(() => {});
    if (ctx.session) {
      delete ctx.session.batchAnalysis;
      delete ctx.session.invoiceResults;
    }
  });

  // Handler: Cancelar proceso
  bot.action('batch_cancel', async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery('Proceso cancelado.');
    await ctx.deleteMessage().catch(() => {});
    if (ctx.session) {
      delete ctx.session.batchAnalysis;
    }
  });

  logger.info('✅ Action handlers de lotes registrados');
}

/**
 * Descarga facturas del lote en formato ZIP
 */
async function downloadBatchZip(ctx: BotContext, type: 'pdf' | 'xml'): Promise<void> {
  const invoiceResults = ctx.session?.invoiceResults;
  if (!invoiceResults) {
    await ctx.reply('❌ No se encontraron resultados de facturación en la sesión.');
    return;
  }

  const successfulInvoices = invoiceResults.filter((r: any) => r.success);
  if (successfulInvoices.length === 0) {
    await ctx.reply('❌ No hay facturas exitosas para descargar.');
    return;
  }

  const progressMsg = await ctx.reply(
    `📦 Preparando ZIP con ${successfulInvoices.length} ${type.toUpperCase()}s...`
  );
  const tenantId = ctx.getTenantId();
  const facturapi = await FacturapiService.getFacturapiClient(tenantId!);

  try {
    const tempDir = await ensureTempDirExists();
    const zipPath = path.join(tempDir, `facturas_${type}_${Date.now()}.zip`);
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 8 } });

    archive.pipe(output);

    for (let i = 0; i < successfulInvoices.length; i++) {
      const result = successfulInvoices[i];
      await ctx.telegram
        .editMessageText(
          ctx.chat!.id,
          progressMsg.message_id,
          undefined,
          `📦 Descargando y comprimiendo ${i + 1} de ${successfulInvoices.length}...`
        )
        .catch(() => {});

      try {
        // Download individual file from FacturAPI
        const fileData =
          type === 'pdf'
            ? await facturapi.invoices.downloadPdf(result.invoice.id)
            : await facturapi.invoices.downloadXml(result.invoice.id);

        // Convert to Buffer if needed
        let fileBuffer: Buffer;
        if (fileData instanceof Blob) {
          const arrayBuffer = await fileData.arrayBuffer();
          fileBuffer = Buffer.from(arrayBuffer);
        } else if (fileData instanceof ReadableStream) {
          const reader = fileData.getReader();
          const chunks: Uint8Array[] = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          fileBuffer = Buffer.concat(chunks);
        } else {
          // Assume it's already a Buffer
          fileBuffer = fileData as unknown as Buffer;
        }

        const fileName = `${result.invoice.series || ''}${result.invoice.folio_number}.${type}`;
        archive.append(fileBuffer, { name: fileName });
      } catch (error: any) {
        logger.error(
          { error },
          `No se pudo descargar ${type} para la factura ${result.invoice.id}`
        );
      }
    }

    await archive.finalize();

    await new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', (err: any) => reject(err));
    });

    await ctx.replyWithDocument({ source: zipPath, filename: `facturas_${type}.zip` });
    await ctx.deleteMessage(progressMsg.message_id).catch(() => {});
    await fs.unlink(zipPath);
  } catch (error: any) {
    logger.error({ error }, `Fallo fatal al crear el ZIP de ${type}`);
    await ctx.telegram
      .editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        undefined,
        `❌ Error creando el archivo ZIP: ${error.message}`
      )
      .catch(() => {});
  }
}
