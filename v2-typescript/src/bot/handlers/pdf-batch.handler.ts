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
import SessionService from '@/core/auth/session.service.js';

const logger = createModuleLogger('bot-pdf-batch-handler');

// Map para agrupar PDFs por media_group_id
const pdfGroups = new Map<
  string,
  {
    documents: any[];
    messageId: number;
    chatId: number;
    timeout: NodeJS.Timeout;
  }
>();

/**
 * Maneja PDFs que son parte de un media group (lote)
 * Esta función se llama desde pdf-invoice.handler cuando detecta media_group_id
 */
export async function handlePdfBatch(ctx: BotContext) {
  if (!ctx.message || !('media_group_id' in ctx.message) || !ctx.message.media_group_id) return;
  if (!('document' in ctx.message) || !ctx.message.document) return;

  const mediaGroupId = ctx.message.media_group_id;
  const document = ctx.message.document;

  logger.info(`📊 PDF agregado al lote ${mediaGroupId}`);

  // Inicialización atómica del grupo
  if (!pdfGroups.has(mediaGroupId)) {
    // Crear grupo INMEDIATAMENTE antes de cualquier operación async
    pdfGroups.set(mediaGroupId, {
      documents: [],
      messageId: 0, // Temporal, se actualizará después
      chatId: ctx.chat!.id,
      timeout: null as any,
    });

    // DESPUÉS de crear el grupo, hacer la operación async
    const msg = await ctx.reply('📥 Recibiendo lote de PDFs...');
    const group = pdfGroups.get(mediaGroupId)!;
    group.messageId = msg.message_id;

    // Configurar timeout SOLO en la primera llamada
    group.timeout = setTimeout(() => {
      processPdfGroup(mediaGroupId, ctx).catch((err) => {
        logger.error({ err, mediaGroupId }, 'Error procesando lote');
      });
    }, 2500);
  }

  // Obtener grupo (ya existe garantizado)
  const group = pdfGroups.get(mediaGroupId)!;

  // Limpiar timeout anterior y crear uno nuevo
  if (group.timeout) {
    clearTimeout(group.timeout);
  }

  // Agregar documento
  group.documents.push(document);

  // Actualizar progreso solo si ya tenemos messageId
  if (group.messageId > 0) {
    await ctx.telegram
      .editMessageText(
        group.chatId,
        group.messageId,
        undefined,
        `📥 Recibiendo PDFs... (${group.documents.length} archivos)`
      )
      .catch(() => {});
  }

  // Recrear timeout
  group.timeout = setTimeout(() => {
    processPdfGroup(mediaGroupId, ctx).catch((err) => {
      logger.error({ err, mediaGroupId }, 'Error procesando lote');
    });
  }, 2500);
}

/**
 * Procesa el grupo completo de PDFs después del timeout
 */
async function processPdfGroup(mediaGroupId: string, ctx: BotContext) {
  const group = pdfGroups.get(mediaGroupId);
  if (!group) return;

  // Extraer y eliminar grupo inmediatamente
  const { documents, messageId, chatId } = group;
  pdfGroups.delete(mediaGroupId);

  logger.info(`🚀 Procesando lote ${mediaGroupId} con ${documents.length} PDFs`);

  try {
    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      await ctx.telegram.sendMessage(chatId, '❌ Error: No se pudo identificar tu empresa.');
      return;
    }

    await processPdfBatch(ctx, documents, tenantId, messageId, chatId);
  } catch (error: any) {
    logger.error({ error, mediaGroupId }, 'Error fatal procesando lote');
    await ctx.telegram
      .sendMessage(chatId, `❌ Error procesando el lote: ${error.message}`)
      .catch(() => {});
  }
}

/**
 * Procesa un lote completo de PDFs
 */
async function processPdfBatch(
  ctx: BotContext,
  documents: any[],
  tenantId: string,
  progressMessageId: number,
  chatId: number
): Promise<void> {
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

  // Definir los frames de la barra de progreso
  const PROGRESS_BARS = [
    '▱▱▱▱▱▱▱▱▱▱',
    '▰▱▱▱▱▱▱▱▱▱',
    '▰▰▰▱▱▱▱▱▱▱',
    '▰▰▰▰▰▱▱▱▱▱',
    '▰▰▰▰▰▰▰▱▱▱',
    '▰▰▰▰▰▰▰▰▰▱',
    '▰▰▰▰▰▰▰▰▰▰',
  ];

  // Procesar cada PDF secuencialmente
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];

    // Barra de progreso simplificada (sin mostrar nombre de archivo)
    const progress = (i + 1) / documents.length;
    const barIndex = Math.min(
      Math.floor(progress * (PROGRESS_BARS.length - 1)),
      PROGRESS_BARS.length - 1
    );
    await ctx.telegram
      .editMessageText(
        chatId,
        progressMessageId,
        undefined,
        `🔄 Analizando lote... ${PROGRESS_BARS[barIndex]} (${i + 1}/${documents.length})`
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

  // REGLA DE ORO: ctx.userState es la única fuente de verdad
  if (!ctx.userState) ctx.userState = {};

  // Guardar resultados en userState (única fuente de verdad)
  ctx.userState.batchAnalysis = batchData;

  const userId = ctx.from?.id || ctx.callbackQuery?.from?.id;
  if (userId) {
    // Guardar userState completo INMEDIATAMENTE en BD
    await SessionService.saveUserStateImmediate(userId, ctx.userState);
    logger.info(
      { tenantId, userId },
      'Sesión del lote de análisis guardada en BD (solo userState según POST_MORTEM).'
    );
  }

  const processingTime = Date.now() - startTime;
  logger.info({
    event: 'batch_processing_completed',
    tenantId,
    totalPdfs: documents.length,
    successCount: batchData.results.length,
    failCount: batchData.failedCount,
    processingTimeMs: processingTime,
  });

  // Mostrar resumen simplificado
  const successfulCount = batchData.results.length;
  let summaryText = `✅ *Análisis completado*\\n\\n`;
  summaryText += `Se procesaron ${batchData.totalProcessed} PDFs\\. De ellos, ${successfulCount} están listos para facturar\\.`;

  if (batchData.failedCount > 0) {
    summaryText += `\\n\\n⚠️ ${batchData.failedCount} archivos no pudieron ser analizados\\.`;
  }

  // Botones simplificados y más informativos
  const buttons = [
    [{ text: `📄 Generar ${successfulCount} Facturas`, callback_data: 'batch_generate_invoices' }],
  ];
  if (successfulCount > 0) {
    buttons.push([{ text: '❌ Cancelar', callback_data: 'batch_cancel' }]);
  }

  await ctx.telegram.editMessageText(chatId, progressMessageId, undefined, summaryText, {
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: buttons,
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

    // REGLA DE ORO: solo leer de ctx.userState
    const batchData = ctx.userState?.batchAnalysis;
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

    // Barra de progreso para generación
    const PROGRESS_BARS = [
      '▱▱▱▱▱▱▱▱▱▱',
      '▰▱▱▱▱▱▱▱▱▱',
      '▰▰▰▱▱▱▱▱▱▱',
      '▰▰▰▰▰▱▱▱▱▱',
      '▰▰▰▰▰▰▰▱▱▱',
      '▰▰▰▰▰▰▰▰▰▱',
      '▰▰▰▰▰▰▰▰▰▰',
    ];

    for (let i = 0; i < batchData.results.length; i++) {
      const result = batchData.results[i];

      // Barra de progreso simplificada
      const progress = (i + 1) / batchData.results.length;
      const barIndex = Math.min(
        Math.floor(progress * (PROGRESS_BARS.length - 1)),
        PROGRESS_BARS.length - 1
      );
      await ctx.telegram
        .editMessageText(
          ctx.chat!.id,
          progressMsg.message_id,
          undefined,
          `🔄 Generando facturas... ${PROGRESS_BARS[barIndex]} (${i + 1}/${batchData.results.length})`
        )
        .catch(() => {});

      try {
        const analysis = result.data;

        // ESTRATEGIA HÍBRIDA DE V1: BD local + fallback a FacturAPI
        let clienteId: string;
        let localCustomerDbId: number | null = null;
        let clienteNombre: string;

        // 1. Buscar en BD local con 'contains' (más flexible que 'equals')
        const localCustomer = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId,
            legalName: { contains: analysis.clientName, mode: 'insensitive' },
          },
        });

        if (localCustomer) {
          // Cliente encontrado localmente
          clienteId = localCustomer.facturapiCustomerId;
          localCustomerDbId = Number(localCustomer.id);
          clienteNombre = localCustomer.legalName;
          logger.info(
            { customerName: localCustomer.legalName, fileName: result.fileName },
            'Cliente encontrado en BD local.'
          );
        } else {
          // 2. Fallback: Buscar en FacturAPI
          logger.warn(
            { customerName: analysis.clientName, fileName: result.fileName },
            'Cliente no encontrado en BD local, buscando en FacturAPI como fallback.'
          );
          const facturapi = await FacturapiService.getFacturapiClient(tenantId);
          const clientes = await facturapi.customers.list({ q: analysis.clientName });

          if (clientes?.data?.length > 0) {
            // Cliente encontrado en FacturAPI
            clienteId = clientes.data[0].id;
            clienteNombre = clientes.data[0].legal_name;
            logger.info(
              { customerName: clientes.data[0].legal_name, fileName: result.fileName },
              'Cliente encontrado en FacturAPI.'
            );
            // localCustomerDbId se mantiene como null
          } else {
            // Si no se encuentra en ningún lado, lanzar error
            throw new Error(`Cliente no encontrado: ${analysis.clientName}`);
          }
        }

        // Proceder a generar la factura con el clienteId encontrado
        const invoice = await InvoiceService.generateInvoice(
          {
            clienteId: clienteId,
            localCustomerDbId: localCustomerDbId ?? undefined,
            clienteNombre: clienteNombre,
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
        // Logging detallado del error
        logger.error(
          {
            error: error,
            errorMessage: error?.message,
            errorStack: error?.stack,
            errorName: error?.name,
            fileName: result.fileName,
            analysisData: result.data,
          },
          'Error generando factura del lote'
        );
        invoiceResults.push({
          fileName: result.fileName,
          success: false,
          error: error?.message || error?.toString() || 'Error desconocido',
        });
      }
    }

    // REGLA DE ORO: ctx.userState es la única fuente de verdad
    if (!ctx.userState) ctx.userState = {};

    // Guardar resultados en userState (única fuente de verdad)
    ctx.userState.invoiceResults = invoiceResults;

    const userId = ctx.from?.id || ctx.callbackQuery?.from?.id;
    if (userId) {
      // Guardar userState completo INMEDIATAMENTE en BD
      await SessionService.saveUserStateImmediate(userId, ctx.userState);
      logger.info(
        { tenantId, userId },
        'Sesión de resultados de facturación guardada en BD (solo userState según POST_MORTEM).'
      );
    }

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

    // Resumen simplificado
    let summaryText = `✅ *Facturación completada*\\n\\n`;
    summaryText += `Se generaron ${successCount} facturas exitosamente\\.`;

    if (failCount > 0) {
      summaryText += `\\n\\n⚠️ ${failCount} facturas no pudieron generarse\\.`;
    }

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
    // REGLA DE ORO: limpiar solo userState
    if (ctx.userState) {
      delete ctx.userState.batchAnalysis;
      delete ctx.userState.invoiceResults;
    }
  });

  // Handler: Cancelar proceso
  bot.action('batch_cancel', async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery('Proceso cancelado.');
    await ctx.deleteMessage().catch(() => {});
    // REGLA DE ORO: limpiar solo userState
    if (ctx.userState) {
      delete ctx.userState.batchAnalysis;
    }
  });

  logger.info('✅ Action handlers de lotes registrados');
}

/**
 * Descarga facturas del lote en formato ZIP
 */
async function downloadBatchZip(ctx: BotContext, type: 'pdf' | 'xml'): Promise<void> {
  const invoiceResults = (ctx.userState as any)?.invoiceResults;
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
    `📦 Preparando ZIP con ${successfulInvoices.length} ${type.toUpperCase()}s... (Esto puede tardar un momento)`
  );
  const tenantId = ctx.getTenantId();
  const facturapi = await FacturapiService.getFacturapiClient(tenantId!);

  try {
    const tempDir = await ensureTempDirExists();
    const zipPath = path.join(tempDir, `facturas_${type}_${Date.now()}.zip`);
    const output = createWriteStream(zipPath);

    // Optimización: Reducir compresión para PDFs (ya están comprimidos)
    const compressionLevel = type === 'pdf' ? 1 : 8;
    const archive = archiver('zip', { zlib: { level: compressionLevel } });

    archive.pipe(output);

    // --- INICIO DE LA OPTIMIZACIÓN CLAVE: DESCARGAS EN PARALELO ---
    logger.info(
      `Iniciando descarga paralela de ${successfulInvoices.length} archivos de tipo ${type}.`
    );

    const downloadPromises = successfulInvoices.map((result: any) => {
      const downloadAction =
        type === 'pdf'
          ? facturapi.invoices.downloadPdf(result.invoice.id)
          : facturapi.invoices.downloadXml(result.invoice.id);

      return downloadAction
        .then(async (fileData: any) => {
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
            fileBuffer = fileData as unknown as Buffer;
          }

          const fileName = `${result.invoice.series || ''}${result.invoice.folio_number}.${type}`;
          return { fileName, fileBuffer };
        })
        .catch((error) => {
          logger.error(
            { error },
            `No se pudo descargar ${type} para la factura ${result.invoice.id}`
          );
          return null; // Retornar null si una descarga falla
        });
    });

    // Ejecutar todas las promesas de descarga en paralelo
    const downloadedFiles = await Promise.all(downloadPromises);

    // --- FIN DE LA OPTIMIZACIÓN CLAVE ---

    // Añadir los archivos descargados al ZIP
    let filesAdded = 0;
    for (const file of downloadedFiles) {
      if (file) {
        archive.append(file.fileBuffer, { name: file.fileName });
        filesAdded++;
      }
    }

    logger.info(`${filesAdded} de ${successfulInvoices.length} archivos añadidos al ZIP.`);

    await archive.finalize();

    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
    });

    await ctx.deleteMessage(progressMsg.message_id).catch(() => {});
    await ctx.replyWithDocument({ source: zipPath, filename: `facturas_${type}.zip` });

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
