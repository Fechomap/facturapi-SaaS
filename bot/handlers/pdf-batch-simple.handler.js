// bot/handlers/pdf-batch-simple.handler.js
// Handler simplificado para procesamiento de múltiples PDFs

import { Markup } from 'telegraf';
import PDFAnalysisService from '../../services/pdf-analysis.service.js';
import { downloadTelegramFile, ensureTempDirExists } from './pdf-invoice.handler.js';
import InvoiceService from '../../services/invoice.service.js';
import facturapIService from '../../services/facturapi.service.js';
import prisma from '../../lib/prisma.js';
import fs from 'fs';
import archiver from 'archiver';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Buffer temporal para agrupar PDFs
const pdfGroups = new Map();

/**
 * Maneja múltiples PDFs de forma simple y secuencial
 */
export async function handleMultiplePDFs(ctx, document) {
  const mediaGroupId = ctx.message.media_group_id;
  const userId = ctx.from.id;

  // Inicializar grupo si no existe
  if (!pdfGroups.has(mediaGroupId)) {
    pdfGroups.set(mediaGroupId, {
      documents: [],
      messageId: null,
      userId: userId,
    });

    // Mostrar mensaje inicial
    const msg = await ctx.reply('📥 Recibiendo PDFs...');
    pdfGroups.get(mediaGroupId).messageId = msg.message_id;

    // Procesar después de 2 segundos
    setTimeout(() => processGroup(ctx, mediaGroupId), 2000);
  }

  // Agregar documento al grupo
  pdfGroups.get(mediaGroupId).documents.push(document);
}

/**
 * Procesa un grupo de PDFs secuencialmente
 */
async function processGroup(ctx, mediaGroupId) {
  const group = pdfGroups.get(mediaGroupId);
  if (!group) return;

  const { documents, messageId } = group;
  const results = [];

  try {
    // Actualizar mensaje
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      messageId,
      null,
      `🔄 Procesando ${documents.length} PDFs...`
    );

    // Procesar cada PDF secuencialmente
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];

      // Actualizar progreso
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        messageId,
        null,
        `🔄 Procesando PDF ${i + 1} de ${documents.length}...\n📄 ${doc.file_name}`
      );

      try {
        // Descargar y analizar
        const tempDir = ensureTempDirExists();
        const filePath = await downloadTelegramFile(ctx, doc.file_id, doc.file_name, tempDir);
        const analysisResult = await PDFAnalysisService.analyzePDF(filePath);

        // Debug: Ver qué devuelve el análisis
        console.log(`📝 Análisis de ${doc.file_name}:`, JSON.stringify(analysisResult, null, 2));

        // Limpiar archivo
        fs.unlinkSync(filePath);

        // Extraer datos del análisis
        const analysisData = analysisResult.analysis || analysisResult;
        results.push({
          fileName: doc.file_name,
          success: true,
          data: analysisData,
        });

        console.log(`📊 Datos guardados para ${doc.file_name}:`, analysisData);
      } catch (error) {
        results.push({
          fileName: doc.file_name,
          success: false,
          error: error.message,
        });
      }
    }

    // Mostrar resumen final
    await showBatchSummary(ctx, messageId, results);
  } catch (error) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      messageId,
      null,
      `❌ Error procesando PDFs: ${error.message}`
    );
  } finally {
    // Limpiar grupo
    pdfGroups.delete(mediaGroupId);
  }
}

/**
 * Muestra un resumen limpio de los resultados
 */
async function showBatchSummary(ctx, messageId, results) {
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  let summaryText = `📊 **Resumen de Procesamiento**\n\n`;
  summaryText += `✅ Exitosos: ${successful.length}\n`;
  summaryText += `❌ Fallidos: ${failed.length}\n`;
  summaryText += `📄 Total: ${results.length}\n\n`;

  // Detalles de exitosos
  if (successful.length > 0) {
    summaryText += `**✅ PDFs Procesados:**\n`;
    successful.forEach((r, i) => {
      const data = r.data;
      summaryText += `\n${i + 1}. **${r.fileName}**\n`;
      summaryText += `   • Cliente: ${data.clientName || 'N/A'}\n`;
      summaryText += `   • Pedido: ${data.orderNumber || 'N/A'}\n`;
      summaryText += `   • Monto: $${(data.totalAmount || 0).toLocaleString()}\n`;
    });
  }

  // Detalles de fallidos
  if (failed.length > 0) {
    summaryText += `\n**❌ PDFs con Error:**\n`;
    failed.forEach((r, i) => {
      summaryText += `${i + 1}. ${r.fileName}: ${r.error}\n`;
    });
  }

  // Total general
  if (successful.length > 0) {
    const totalAmount = successful.reduce((sum, r) => sum + (r.data.totalAmount || 0), 0);
    summaryText += `\n💰 **Total General: $${totalAmount.toLocaleString()}**`;
  }

  // Guardar resultados en userState y session para generación de facturas
  if (successful.length > 0) {
    // Asegurar que userState existe
    if (!ctx.userState) {
      ctx.userState = {};
    }
    // Asegurar que session existe
    if (!ctx.session) {
      ctx.session = {};
    }

    const batchData = {
      results: successful,
      timestamp: Date.now(),
    };

    // Guardar en ambos lugares para asegurar persistencia
    ctx.userState.batchAnalysis = batchData;
    ctx.session.batchAnalysis = batchData;

    // Forzar guardado en Redis
    try {
      // Usar el servicio de sesión directamente para asegurar persistencia
      const SessionService = (await import('../../core/auth/session.service.js')).default;
      await SessionService.saveUserState(ctx.from.id, {
        ...ctx.userState,
        ...ctx.session,
        batchAnalysis: batchData,
      });
      console.log('💾 Datos guardados en Redis exitosamente');
    } catch (error) {
      console.error('Error guardando en Redis:', error);
    }

    console.log('💾 Datos de análisis guardados para persistencia');
    console.log('📊 Cantidad de resultados exitosos:', successful.length);
  }

  // Botones de acción
  const buttons = [];
  if (successful.length > 0) {
    buttons.push(Markup.button.callback('📄 Generar Facturas', 'batch_generate_invoices'));
  }
  buttons.push(Markup.button.callback('❌ Cancelar', 'batch_cancel'));

  await ctx.telegram.editMessageText(ctx.chat.id, messageId, null, summaryText, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([buttons]),
  });
}

/**
 * Handler para generar facturas del batch
 */
export function handleBatchGenerateInvoices(bot) {
  bot.action('batch_generate_invoices', async (ctx) => {
    await ctx.answerCbQuery();

    console.log('🔍 Buscando datos de análisis...');
    console.log('UserState exists:', !!ctx.userState);
    console.log('Session exists:', !!ctx.session);

    // Buscar primero en session (Redis) y luego en userState
    let batchData = ctx.session?.batchAnalysis || ctx.userState?.batchAnalysis;

    // Si no se encuentra, intentar cargar desde Redis directamente
    if (!batchData) {
      try {
        const SessionService = (await import('../../core/auth/session.service.js')).default;
        const userState = await SessionService.getUserState(ctx.from.id);
        batchData = userState?.batchAnalysis;
        console.log('BatchAnalysis recuperado de Redis:', !!batchData);
      } catch (error) {
        console.error('Error recuperando de Redis:', error);
      }
    }

    console.log('BatchAnalysis found:', !!batchData);

    if (batchData) {
      console.log('📊 Cantidad de resultados encontrados:', batchData.results?.length || 0);
      console.log('⏰ Timestamp del análisis:', new Date(batchData.timestamp).toLocaleString());
    }

    if (!batchData || !batchData.results || batchData.results.length === 0) {
      return ctx.reply(
        '❌ No hay datos de análisis disponibles. Por favor, procese los PDFs nuevamente.'
      );
    }

    const progressMsg = await ctx.reply('🔄 Generando facturas...');

    try {
      // Generar facturas para cada resultado exitoso
      const invoiceResults = [];

      for (let i = 0; i < batchData.results.length; i++) {
        const result = batchData.results[i];

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMsg.message_id,
          null,
          `🔄 Generando factura ${i + 1} de ${batchData.results.length}...\n📄 ${result.fileName}`
        );

        try {
          const analysis = result.data;

          // Buscar cliente en BD
          const cliente = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId: ctx.getTenantId(),
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
              localCustomerDbId: cliente.id,
              clienteNombre: cliente.legalName,
              numeroPedido: analysis.orderNumber,
              claveProducto: '78101803',
              monto: analysis.totalAmount,
              userId: ctx.from.id,
            },
            ctx.getTenantId()
          );

          invoiceResults.push({
            fileName: result.fileName,
            success: true,
            invoice: invoice,
            client: cliente,
          });
        } catch (error) {
          invoiceResults.push({
            fileName: result.fileName,
            success: false,
            error: error.message,
          });
        }
      }

      // Guardar resultados en sesión y userState
      if (!ctx.session) {
        ctx.session = {};
      }
      if (!ctx.userState) {
        ctx.userState = {};
      }

      ctx.session.invoiceResults = invoiceResults;
      ctx.userState.invoiceResults = invoiceResults;

      // Forzar guardado en Redis
      try {
        const SessionService = (await import('../../core/auth/session.service.js')).default;
        await SessionService.saveUserState(ctx.from.id, {
          ...ctx.userState,
          ...ctx.session,
          invoiceResults: invoiceResults,
        });
        console.log('💾 Resultados de facturas guardados en Redis');
      } catch (error) {
        console.error('Error guardando resultados de facturas:', error);
      }

      // Mostrar resumen de facturas
      const successCount = invoiceResults.filter((r) => r.success).length;
      const failCount = invoiceResults.filter((r) => !r.success).length;

      let invoiceSummary = `📊 **Resumen de Facturación**\n\n`;
      invoiceSummary += `✅ Facturas generadas: ${successCount}\n`;
      if (failCount > 0) {
        invoiceSummary += `❌ Errores: ${failCount}\n`;
      }
      invoiceSummary += `\n**Detalles:**\n`;

      invoiceResults.forEach((inv, i) => {
        if (inv.success) {
          invoiceSummary += `\n${i + 1}. ✅ ${inv.fileName}\n`;
          invoiceSummary += `   → Factura: ${inv.invoice.series}${inv.invoice.folio}\n`;
        } else {
          invoiceSummary += `\n${i + 1}. ❌ ${inv.fileName}\n`;
          invoiceSummary += `   → Error: ${inv.error}\n`;
        }
      });

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        null,
        invoiceSummary,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('📄 Descargar PDFs', 'batch_download_pdfs'),
              Markup.button.callback('📋 Descargar XMLs', 'batch_download_xmls'),
            ],
            [Markup.button.callback('✅ Finalizar', 'batch_finish')],
          ]),
        }
      );
    } catch (error) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        null,
        `❌ Error generando facturas: ${error.message}`
      );
    }
  });

  bot.action('batch_cancel', async (ctx) => {
    await ctx.answerCbQuery('Procesamiento cancelado');
    await ctx.deleteMessage();
    if (ctx.session) {
      delete ctx.session.batchAnalysis;
    }
    if (ctx.userState) {
      delete ctx.userState.batchAnalysis;
    }
  });

  bot.action('batch_finish', async (ctx) => {
    await ctx.answerCbQuery('✅ Proceso completado');
    await ctx.deleteMessage();
    if (ctx.session) {
      delete ctx.session.batchAnalysis;
      delete ctx.session.invoiceResults;
    }
    if (ctx.userState) {
      delete ctx.userState.batchAnalysis;
    }
  });

  // Handler para descargar PDFs
  bot.action('batch_download_pdfs', async (ctx) => {
    await ctx.answerCbQuery('Preparando ZIP de PDFs...');
    await downloadBatchZip(ctx, 'pdf');
  });

  // Handler para descargar XMLs
  bot.action('batch_download_xmls', async (ctx) => {
    await ctx.answerCbQuery('Preparando ZIP de XMLs...');
    await downloadBatchZip(ctx, 'xml');
  });
}

/**
 * Descarga un ZIP con las facturas
 */
async function downloadBatchZip(ctx, type) {
  // Buscar primero en session y luego en userState
  let invoiceResults = ctx.session?.invoiceResults || ctx.userState?.invoiceResults;

  // Si no se encuentra, intentar cargar desde Redis
  if (!invoiceResults) {
    try {
      const SessionService = (await import('../../core/auth/session.service.js')).default;
      const userState = await SessionService.getUserState(ctx.from.id);
      invoiceResults = userState?.invoiceResults;
      console.log('InvoiceResults recuperado de Redis:', !!invoiceResults);
    } catch (error) {
      console.error('Error recuperando invoiceResults de Redis:', error);
    }
  }

  if (!invoiceResults) {
    return ctx.reply('❌ No hay facturas disponibles para descargar.');
  }

  const successfulInvoices = invoiceResults.filter((r) => r.success);
  if (successfulInvoices.length === 0) {
    return ctx.reply('❌ No hay facturas exitosas para descargar.');
  }

  const progressMsg = await ctx.reply(`📦 Preparando ${type.toUpperCase()}s...`);

  try {
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const zipPath = path.join(tempDir, `facturas_${Date.now()}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.pipe(output);

    // Descargar y agregar cada factura al ZIP
    let filesAdded = 0;
    console.log(`📦 Iniciando descarga de ${successfulInvoices.length} ${type}s para ZIP...`);

    for (let i = 0; i < successfulInvoices.length; i++) {
      const inv = successfulInvoices[i];

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        null,
        `📦 Agregando ${i + 1} de ${successfulInvoices.length} ${type.toUpperCase()}s...`
      );

      try {
        // Obtener el tenant para acceder a la API key
        const prisma = (await import('../../lib/prisma.js')).default;
        const tenant = await prisma.tenant.findUnique({
          where: { id: ctx.getTenantId() },
        });

        if (!tenant || !tenant.facturapiApiKey) {
          throw new Error('No se pudo obtener la API key del tenant');
        }

        const facturaId = inv.invoice.facturaId || inv.invoice.id;
        const folio =
          inv.invoice.folio_number || inv.invoice.folio || inv.invoice.folioNumber || 'SIN_FOLIO';
        const series = inv.invoice.series || inv.invoice.serie || 'F'; // Tomar serie de FacturAPI

        console.log(`📥 Descargando ${type} - Factura: ${series}${folio}, ID: ${facturaId}`);

        // Descargar usando axios directamente
        const axios = (await import('axios')).default;
        const apiUrl = `https://www.facturapi.io/v2/invoices/${facturaId}/${type}`;

        const response = await axios({
          method: 'GET',
          url: apiUrl,
          responseType: 'arraybuffer',
          headers: {
            Authorization: `Bearer ${tenant.facturapiApiKey}`,
          },
          timeout: 30000, // 30 segundos timeout
        });

        const fileData = Buffer.from(response.data);
        console.log(`✅ Descargado ${type} - Tamaño: ${fileData.length} bytes`);

        const fileName = `${series}${folio}_${inv.client.legalName.replace(/[^a-zA-Z0-9]/g, '_')}.${type}`;
        archive.append(fileData, { name: fileName });
        filesAdded++;
        console.log(`✅ Agregado al ZIP: ${fileName}`);
      } catch (error) {
        console.error(
          `❌ Error descargando ${type} para factura ${inv.invoice.series}${inv.invoice.folio_number}:`,
          error.message
        );
        if (error.response) {
          console.error(`   Status: ${error.response.status}`);
          console.error(`   Data: ${JSON.stringify(error.response.data)}`);
        }
      }
    }

    console.log(
      `📊 Total de archivos agregados al ZIP: ${filesAdded} de ${successfulInvoices.length}`
    );

    if (filesAdded === 0) {
      throw new Error(`No se pudo agregar ningún archivo ${type} al ZIP`);
    }

    await archive.finalize();

    // Esperar a que se complete el ZIP
    await new Promise((resolve) => output.on('close', resolve));

    // Enviar archivo
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      progressMsg.message_id,
      null,
      `✅ ZIP preparado, enviando...`
    );

    await ctx.replyWithDocument({
      source: zipPath,
      filename: `facturas_${type}_${new Date().toISOString().split('T')[0]}.zip`,
    });

    // Limpiar archivo temporal
    setTimeout(() => {
      try {
        fs.unlinkSync(zipPath);
      } catch (error) {
        console.error('Error eliminando ZIP temporal:', error);
      }
    }, 5000);

    await ctx.deleteMessage(progressMsg.message_id);
  } catch (error) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      progressMsg.message_id,
      null,
      `❌ Error generando ZIP: ${error.message}`
    );
  }
}
