// bot/handlers/pdf-invoice.handler.js (Versión Simplificada)
import { Markup } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFAnalysisService from '../../services/pdf-analysis.service.js';
import InvoiceService from '../../services/invoice.service.js';
import facturapIService from '../../services/facturapi.service.js';
import prisma from '../../lib/prisma.js';

// Importar utilidades de limpieza de estado
import { safeCleanupPdfAnalysis } from '../../core/utils/state-cleanup.utils.js';

// Importar handler simplificado para batch processing
import { handleMultiplePDFs, handleBatchGenerateInvoices } from './pdf-batch-simple.handler.js';

// 📱 UTILIDADES PARA PROGRESO VISUAL
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

/**
 * Actualiza el mensaje de progreso con animación
 */
async function updateProgressMessage(ctx, messageId, step, total, currentTask, details = '') {
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
    await ctx.telegram.editMessageText(ctx.chat.id, messageId, null, progressText, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    // Si no se puede editar el mensaje, crear uno nuevo
    console.log('No se pudo editar mensaje de progreso:', error.message);
  }
}

// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Exportar funciones necesarias para el handler simplificado
export { downloadTelegramFile, ensureTempDirExists };

/**
 * Registra el handler simplificado para análisis de PDFs
 */
export function registerPDFInvoiceHandler(bot) {
  // Handler principal para documentos PDF
  bot.on('document', async (ctx, next) => {
    console.log('========== HANDLER PDF SIMPLIFICADO ==========');

    const document = ctx.message.document;
    const fileName = document.file_name || '';

    // Solo procesar PDFs
    if (!fileName.match(/\.pdf$/i)) {
      console.log('No es PDF, pasando al siguiente handler');
      return next();
    }

    // Verificar que no esté en otro proceso
    if (
      ctx.userState?.esperando &&
      (ctx.userState.esperando === 'archivo_excel_chubb' || ctx.userState.productionSetup)
    ) {
      console.log('Usuario en otro proceso, saltando');
      return next();
    }

    // Verificar tenant
    if (!ctx.hasTenant()) {
      await ctx.reply('❌ Para procesar facturas, primero debes registrar tu empresa.');
      return;
    }

    // 🚀 NUEVA FUNCIONALIDAD: Detectar si es parte de un media group (batch processing)
    if (ctx.message.media_group_id) {
      console.log(`📊 Media group detectado: ${ctx.message.media_group_id}`);
      return handleMultiplePDFs(ctx, document);
    }

    // 🚀 OPTIMIZACIÓN: Limpiar pdfAnalysis anterior antes de procesar nuevo
    safeCleanupPdfAnalysis(ctx, 'new_pdf');

    // 📱 FEEDBACK INMEDIATO: Mostrar progreso tan pronto como se detecte el PDF
    const progressMessage = await ctx.reply('📥 Recibiendo PDF...\n⏳ Validando archivo...');

    try {
      // 📱 PASO 1: Descargando archivo
      await updateProgressMessage(
        ctx,
        progressMessage.message_id,
        1,
        4,
        'Descargando PDF',
        'Obteniendo archivo...'
      );

      // Descargar archivo
      const tempDir = ensureTempDirExists();
      const filePath = await downloadTelegramFile(ctx, document.file_id, fileName, tempDir);

      // 📱 PASO 2: Analizando contenido
      await updateProgressMessage(
        ctx,
        progressMessage.message_id,
        2,
        4,
        'Analizando PDF',
        'Extrayendo información...'
      );

      // Analizar PDF
      const analysisResult = await PDFAnalysisService.analyzePDF(filePath);

      // 📱 PASO 3: Validando datos
      await updateProgressMessage(
        ctx,
        progressMessage.message_id,
        3,
        4,
        'Validando datos',
        'Verificando información...'
      );

      // Validar datos extraídos
      const validation = PDFAnalysisService.validateExtractedData(analysisResult.analysis);

      // 📱 PASO 4: Completado
      await updateProgressMessage(
        ctx,
        progressMessage.message_id,
        4,
        4,
        'Análisis completado',
        'Datos extraídos exitosamente'
      );

      // Limpiar archivo temporal
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('Error limpiando archivo:', e);
      }

      if (!analysisResult.success) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMessage.message_id,
          null,
          `❌ Error al analizar el PDF: ${analysisResult.error}`
        );
        return;
      }

      // Mostrar resultados
      await showSimpleAnalysisResults(ctx, analysisResult.analysis, validation);
    } catch (error) {
      console.error('Error procesando PDF:', {
        error: error.message,
        stack: error.stack,
        userId: ctx.from.id,
        fileName: fileName,
        timestamp: new Date().toISOString(),
      });

      // Actualizar mensaje de progreso con error
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMessage.message_id,
          null,
          `❌ Error al procesar el PDF: ${error.message}`
        );
      } catch (editError) {
        await ctx.reply(`❌ Error al procesar el PDF: ${error.message}`);
      }
    }
  });

  // Handler para confirmar datos extraídos
  bot.action(/^confirm_simple_pdf_(.+)$/, async (ctx) => {
    const analysisId = ctx.match[1];

    // 📱 FEEDBACK INMEDIATO: Mostrar que se detectó el click del botón ANTES de validaciones
    const invoiceProgressMsg = await ctx.reply(
      '⚡ Procesando factura PDF...\n⏳ Validando datos...'
    );

    // CRÍTICO: Responder al callback query INMEDIATAMENTE después del feedback visual
    await ctx.answerCbQuery();

    // CRÍTICO: Reintentar si los datos no están listos
    let retries = 3;
    let analysisData = null;

    while (retries > 0) {
      analysisData = ctx.userState?.pdfAnalysis;

      if (analysisData && analysisData.id === analysisId) {
        break; // Datos encontrados
      }

      // Esperar un poco antes de reintentar
      await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms de espera

      // Forzar recarga de sesión (si la función existe)
      if (ctx.reloadSession) {
        try {
          await ctx.reloadSession();
        } catch (error) {
          console.error('Error recargando sesión:', error);
        }
      }

      retries--;
    }

    // Si después de los reintentos no hay datos, mostrar error
    if (!analysisData || analysisData.id !== analysisId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        invoiceProgressMsg.message_id,
        null,
        '❌ Los datos han expirado o no se encontraron. Sube el PDF nuevamente.'
      );
      return;
    }

    await generateSimpleInvoice(ctx, analysisData, invoiceProgressMsg.message_id);
  });

  // Handler para edición manual
  bot.action(/^edit_simple_pdf_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const analysisId = ctx.match[1];

    // CRÍTICO: Asegurar que userState y session estén inicializados
    if (!ctx.userState) {
      ctx.userState = {};
    }
    if (!ctx.session) {
      ctx.session = {};
    }

    // NUEVO: Buscar primero en userState, luego en session
    let analysisData = ctx.userState?.pdfAnalysis;

    if (!analysisData || analysisData.id !== analysisId) {
      // Intentar recuperar de session (puede estar en otro worker)
      analysisData = ctx.session?.pdfAnalysis;

      if (!analysisData || analysisData.id !== analysisId) {
        return ctx.reply('❌ Los datos han expirado. Sube el PDF nuevamente.');
      }

      // Restaurar en userState para uso local
      ctx.userState.pdfAnalysis = analysisData;
    }

    await startManualEditFlow(ctx, analysisData);
  });
}

/**
 * Muestra los resultados del análisis de forma simple
 */
async function showSimpleAnalysisResults(ctx, analysis, validation) {
  const analysisId = `simple_${Date.now()}_${ctx.from.id}`;

  // CRÍTICO: Asegurar que userState y session estén inicializados
  if (!ctx.userState) {
    ctx.userState = {};
  }
  if (!ctx.session) {
    ctx.session = {};
  }

  // NUEVO: Guardar en estado del usuario Y en sesión para persistencia entre workers
  const analysisData = {
    id: analysisId,
    analysis,
    validation,
    timestamp: Date.now(),
  };

  ctx.userState.pdfAnalysis = analysisData;

  // CRÍTICO: Persistir en sesión para compartir entre workers
  ctx.session.pdfAnalysis = analysisData;

  // Asegurar que se guarde inmediatamente (solo en contexto de API)
  try {
    if (ctx.saveSession && typeof ctx.saveSession === 'function') {
      await ctx.saveSession();
    }
  } catch (error) {
    console.error('Error guardando análisis PDF en sesión:', error);
  }

  let message = '🔍 **Análisis Completado**\n\n';

  // Mostrar confianza
  const confidenceEmoji =
    analysis.confidence >= 80 ? '🟢' : analysis.confidence >= 60 ? '🟡' : '🔴';
  message += `${confidenceEmoji} **Confianza:** ${analysis.confidence}%\n\n`;

  // Mostrar datos extraídos
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

  // Mostrar errores si los hay
  if (analysis.errors.length > 0) {
    message += `\n⚠️ **Problemas encontrados:**\n`;
    analysis.errors.forEach((error) => {
      message += `• ${error}\n`;
    });
  }

  // Crear botones según validación
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
    ...Markup.inlineKeyboard(buttons),
  });
}

/**
 * Genera factura con los datos extraídos
 */
async function generateSimpleInvoice(ctx, analysisData, progressMessageId = null) {
  const { analysis } = analysisData;

  // CRÍTICO: Asegurar que userState y session estén inicializados
  if (!ctx.userState) {
    ctx.userState = {};
  }
  if (!ctx.session) {
    ctx.session = {};
  }

  // 📱 Actualizar progreso - Preparando facturación
  if (progressMessageId) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      progressMessageId,
      null,
      '⚡ Preparando facturación...\n⏳ Validando tenant...',
      { parse_mode: 'Markdown' }
    );
  }

  try {
    // Obtener tenant ID
    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      const errorMsg = '❌ Error: No se encontró el ID del tenant';
      if (progressMessageId) {
        await ctx.telegram.editMessageText(ctx.chat.id, progressMessageId, null, errorMsg);
      } else {
        await ctx.reply(errorMsg);
      }
      return;
    }

    // 📱 Actualizar progreso - Buscando cliente
    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessageId,
        null,
        '🔍 Buscando cliente...\n⏳ Consultando base de datos...',
        { parse_mode: 'Markdown' }
      );
    }

    // ✅ OPTIMIZACIÓN: Buscar cliente primero en BD local, luego en FacturAPI
    let clienteId = null;
    let localCustomerDbId = null;
    let clienteNombre = null;
    try {
      // 1. Buscar primero en BD local (mucho más rápido)
      console.log(`🔍 Buscando cliente en BD local: "${analysis.clientName}"`);
      const localCustomer = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          legalName: { contains: analysis.clientName, mode: 'insensitive' },
        },
      });

      if (localCustomer) {
        // ✅ Encontrado en BD local (0.1 segundos)
        clienteId = localCustomer.facturapiCustomerId; // Para FacturAPI
        localCustomerDbId = localCustomer.id; // Para BD local (PostgreSQL FK)
        clienteNombre = localCustomer.legalName; // Para detección de retención
        console.log(
          `✅ Cliente encontrado en BD local: ${localCustomer.legalName} (FacturAPI ID: ${clienteId}, DB ID: ${localCustomerDbId})`
        );
      } else {
        // ⚠️ Solo como fallback, buscar en FacturAPI (30 segundos)
        console.log(
          `⚠️ Cliente no encontrado en BD local, buscando en FacturAPI: "${analysis.clientName}"`
        );

        // 📱 Actualizar progreso - Buscando en FacturAPI
        if (progressMessageId) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            progressMessageId,
            null,
            '🔍 Buscando cliente en FacturAPI...\n⏳ Consultando servicios externos...',
            { parse_mode: 'Markdown' }
          );
        }

        const facturapi = await facturapIService.getFacturapiClient(tenantId);
        const clientes = await facturapi.customers.list({
          q: analysis.clientName, // Usar el nombre completo para mayor precisión
        });

        if (clientes && clientes.data && clientes.data.length > 0) {
          // Usar el primer cliente que coincida
          clienteId = clientes.data[0].id;
          clienteNombre = clientes.data[0].legal_name; // Para detección de retención
          console.log(
            `Cliente encontrado en FacturAPI: ${clientes.data[0].legal_name} (ID: ${clienteId})`
          );
        } else {
          const errorMsg = `❌ No se encontró el cliente "${analysis.clientName}" ni en BD local ni en FacturAPI. Por favor, asegúrate de que esté registrado.`;
          if (progressMessageId) {
            await ctx.telegram.editMessageText(ctx.chat.id, progressMessageId, null, errorMsg);
          } else {
            await ctx.reply(errorMsg);
          }
          return;
        }
      }
    } catch (error) {
      console.error('Error buscando cliente:', error);
      const errorMsg = `❌ Error al buscar cliente: ${error.message}`;
      if (progressMessageId) {
        await ctx.telegram.editMessageText(ctx.chat.id, progressMessageId, null, errorMsg);
      } else {
        await ctx.reply(errorMsg);
      }
      return;
    }

    // Datos para la factura (usando siempre 78101803 como clave SAT)
    const facturaData = {
      clienteId: clienteId, // Para FacturAPI
      localCustomerDbId: localCustomerDbId, // Para BD PostgreSQL FK
      clienteNombre: clienteNombre, // Para detección de retención
      numeroPedido: analysis.orderNumber,
      claveProducto: '78101803', // Clave SAT fija para todos los clientes
      monto: analysis.totalAmount,
      userId: ctx.from.id,
    };

    console.log('Datos para factura:', facturaData);

    // 📱 Actualizar progreso - Generando factura
    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessageId,
        null,
        '🚀 Generando factura en FacturAPI...\n⏳ Enviando datos al servidor...',
        { parse_mode: 'Markdown' }
      );
    }

    // 🔍 MÉTRICAS: Medir tiempo total de generación
    const totalStartTime = Date.now();
    console.log(`[INVOICE_METRICS] Iniciando InvoiceService.generateInvoice()`);

    // Generar la factura real en FacturAPI
    const factura = await InvoiceService.generateInvoice(facturaData, tenantId);

    const totalDuration = Date.now() - totalStartTime;
    console.log(`[INVOICE_METRICS] InvoiceService.generateInvoice() TOTAL tomó ${totalDuration}ms`);
    console.log('Factura generada exitosamente:', factura.id, 'Folio:', factura.folio_number);

    // 📱 Finalizar progreso con éxito
    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessageId,
        null,
        '✅ Factura generada exitosamente\n📋 Preparando detalles...',
        { parse_mode: 'Markdown' }
      );
    }

    // Mostrar resultado al usuario de inmediato
    await ctx.reply(
      `✅ **Factura Generada Exitosamente**

` +
        `Serie-Folio: ${factura.series}-${factura.folio_number}
` +
        `Cliente: ${analysis.clientName}
` +
        `Pedido: ${analysis.orderNumber}
` +
        `Total: ${analysis.totalAmount.toFixed(2)} MXN

` +
        `_La factura se está registrando en segundo plano._`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('📄 Descargar PDF', `pdf_${factura.id}_${factura.folio_number}`),
            Markup.button.callback('📂 Descargar XML', `xml_${factura.id}_${factura.folio_number}`),
          ],
          [Markup.button.callback('⬅️ Volver al Menú', 'menu_principal')],
        ]),
      }
    );

    // Limpiar datos del análisis
    delete ctx.userState.pdfAnalysis;
  } catch (error) {
    console.error('Error generando factura:', {
      error: error.message,
      stack: error.stack,
      userId: ctx.from.id,
      tenantId: ctx.getTenantId(),
      analysisId: analysisData?.id,
      timestamp: new Date().toISOString(),
    });

    // Actualizar mensaje de error
    const errorMsg = `❌ Error al generar la factura: ${error.message}`;
    if (progressMessageId) {
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, progressMessageId, null, errorMsg);
      } catch (editError) {
        await ctx.reply(errorMsg);
      }
    } else {
      await ctx.reply(errorMsg);
    }
  }
}

/**
 * Inicia flujo de edición manual con datos prellenados
 */
async function startManualEditFlow(ctx, analysisData) {
  const { analysis } = analysisData;

  // CRÍTICO: Asegurar que userState esté inicializado
  if (!ctx.userState) {
    ctx.userState = {};
  }

  // Prellenar datos conocidos
  ctx.userState.clienteNombre = analysis.clientName || '';
  ctx.userState.clienteId = analysis.clientCode || '';
  ctx.userState.numeroPedido = analysis.orderNumber || '';
  ctx.userState.monto = analysis.totalAmount || 0;

  // Limpiar análisis
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

  // Iniciar flujo manual
  ctx.userState.esperando = 'numeroPedido';
}

/**
 * Asegura que existe el directorio temporal
 */
function ensureTempDirExists() {
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * Descarga archivo de Telegram
 */
async function downloadTelegramFile(ctx, fileId, fileName, tempDir) {
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const filePath = path.join(tempDir, `${Date.now()}_${fileName}`);

  const response = await axios({
    method: 'GET',
    url: fileLink.href,
    responseType: 'stream',
  });

  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(filePath));
    writer.on('error', reject);
  });
}

// ============================================================================
// 🚀 BATCH PROCESSING FUNCTIONS - Nueva funcionalidad para múltiples PDFs
// ============================================================================

// Map para almacenar media groups temporalmente
const mediaGroupBuffers = new Map();

/**
 * Maneja PDFs enviados como media group (batch processing)
 */
async function handleBatchPDFs(ctx, document) {
  const mediaGroupId = ctx.message.media_group_id;
  const tenantId = ctx.getTenantId();

  console.log(`📊 Procesando PDF en lote - Media Group ID: ${mediaGroupId}`);

  try {
    // Inicializar buffer para este media group si no existe
    if (!mediaGroupBuffers.has(mediaGroupId)) {
      mediaGroupBuffers.set(mediaGroupId, {
        documents: [],
        userId: ctx.from.id,
        tenantId: tenantId,
        createdAt: Date.now(),
        timeout: null
      });

      // Configurar timeout para procesar el lote automáticamente
      const timeoutId = setTimeout(async () => {
        console.log(`⏰ Timeout alcanzado para media group ${mediaGroupId}, procesando lote`);
        await processBatchFromBuffer(ctx, mediaGroupId);
      }, 3000); // 3 segundos de espera para recibir todos los archivos

      mediaGroupBuffers.get(mediaGroupId).timeout = timeoutId;
    }

    // Agregar documento al buffer
    const buffer = mediaGroupBuffers.get(mediaGroupId);
    buffer.documents.push(document);

    console.log(`📄 PDF agregado al lote: ${document.file_name} (${buffer.documents.length} archivos)`);

    // Si es el primer PDF del grupo, mostrar mensaje de recepción
    if (buffer.documents.length === 1) {
      await ctx.reply(
        `📥 **Recibiendo lote de PDFs...**\n\n` +
        `🆔 **ID del lote:** \`${mediaGroupId}\`\n` +
        `📄 **Archivos recibidos:** ${buffer.documents.length}\n\n` +
        `⏳ **Esperando más archivos...** (procesamiento automático en 3s)`
      );
    } else {
      // Editar mensaje existente con el conteo actualizado
      try {
        const chatId = ctx.chat.id;
        const messages = await ctx.telegram.getChat(chatId);
        // Buscar el último mensaje del bot y actualizarlo
        // Por simplicidad, enviaremos un nuevo mensaje
        await ctx.reply(
          `📥 **Lote actualizado**\n\n` +
          `📄 **Archivos recibidos:** ${buffer.documents.length}\n` +
          `⏳ **Procesando automáticamente...**`
        );
      } catch (error) {
        console.log('No se pudo actualizar mensaje de progreso:', error.message);
      }
    }

  } catch (error) {
    console.error(`❌ Error manejando PDF en lote:`, error.message);
    await ctx.reply(
      `❌ **Error procesando lote**\n\n` +
      `💬 ${error.message}\n\n` +
      `🔄 Por favor, intente enviando los PDFs nuevamente.`
    );
  }
}

/**
 * Procesa un lote desde el buffer cuando está completo
 */
async function processBatchFromBuffer(ctx, mediaGroupId) {
  const buffer = mediaGroupBuffers.get(mediaGroupId);
  
  if (!buffer) {
    console.warn(`⚠️ Buffer no encontrado para media group ${mediaGroupId}`);
    return;
  }

  // Limpiar timeout
  if (buffer.timeout) {
    clearTimeout(buffer.timeout);
  }

  const { documents, tenantId } = buffer;
  
  console.log(`🚀 Iniciando procesamiento de lote con ${documents.length} PDFs`);

  try {
    // Limpiar estado anterior si existe
    cleanupBatchProcessing(ctx);

    // Crear progress tracker
    const progressTracker = createBatchProgressTracker(ctx, mediaGroupId);
    await progressTracker.startProgress(documents.length);

    // Fase 1: Procesar lote (análisis)
    await progressTracker.updatePhase('download', 0, documents.length, 'Iniciando descarga de PDFs...');
    
    const batchResults = await BatchProcessorService.processBatch(ctx, documents, tenantId, mediaGroupId);
    
    // Almacenar resultados en sesión
    await BatchProcessorService.storeBatchResults(ctx, batchResults);

    // Mostrar resultados de análisis
    await progressTracker.showAnalysisResults(batchResults);

    console.log(`✅ Lote ${mediaGroupId} analizado: ${batchResults.successful} exitosos, ${batchResults.failed} fallidos`);

  } catch (error) {
    console.error(`❌ Error procesando lote ${mediaGroupId}:`, error.message);
    
    const progressTracker = createBatchProgressTracker(ctx, mediaGroupId);
    await progressTracker.showError(error);
  } finally {
    // Limpiar buffer
    mediaGroupBuffers.delete(mediaGroupId);
    console.log(`🧹 Buffer limpiado para media group ${mediaGroupId}`);
  }
}

/**
 * Registra los handlers para batch processing
 */
export function registerBatchHandlers(bot) {
  // Handler para confirmar generación de facturas por lotes
  bot.action(/^confirm_batch_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    
    const batchId = ctx.match[1];
    console.log(`✅ Confirmación recibida para lote ${batchId}`);

    try {
      // CRÍTICO: Buscar primero en userState, luego en session (Redis)
      let batchProcessing = ctx.userState?.batchProcessing;
      
      if (!batchProcessing || batchProcessing.batchId !== batchId) {
        // Intentar recuperar de session (Redis)
        batchProcessing = ctx.session?.batchProcessing;
        
        if (!batchProcessing || batchProcessing.batchId !== batchId) {
          console.error(`❌ Datos de lote no encontrados:`, {
            requestedBatchId: batchId,
            userStateBatchId: ctx.userState?.batchProcessing?.batchId,
            sessionBatchId: ctx.session?.batchProcessing?.batchId
          });
          return ctx.reply('❌ Sesión de lote expirada. Por favor, envíe los PDFs nuevamente.');
        }
        
        // Restaurar en userState para uso local
        if (!ctx.userState) ctx.userState = {};
        ctx.userState.batchProcessing = batchProcessing;
        console.log(`💾 Datos de lote recuperados desde Redis: ${batchId}`);
      }
      
      const batchResults = batchProcessing.results;

      const tenantId = ctx.getTenantId();
      const progressTracker = createBatchProgressTracker(ctx, batchId);

      // Fase 2: Generar facturas
      await progressTracker.updatePhase('invoice_generation', 0, batchResults.successful, 'Generando facturas...');
      
      const invoiceResults = await BatchProcessorService.generateBatchInvoices(batchResults, ctx);

      if (invoiceResults.successful.length === 0) {
        await progressTracker.showError(new Error('No se pudieron generar facturas'));
        return;
      }

      // Fase 3: Generar ZIPs
      await progressTracker.updatePhase('zip_creation', 0, 2, 'Creando archivos ZIP...');
      
      const zipInfo = await ZipGeneratorService.createInvoiceZips(invoiceResults, tenantId);
      
      // Almacenar info de ZIPs en sesión
      ctx.userState.batchProcessing.zipInfo = zipInfo;

      // Programar limpieza automática de ZIPs
      ZipGeneratorService.scheduleCleanup(zipInfo, 30);

      // Mostrar resultados finales
      await progressTracker.showFinalResults(invoiceResults, zipInfo);

      console.log(`🎉 Lote ${batchId} completado: ${invoiceResults.successful.length} facturas, ZIPs generados`);

    } catch (error) {
      console.error(`❌ Error procesando confirmación de lote ${batchId}:`, error.message);
      const progressTracker = createBatchProgressTracker(ctx, batchId);
      await progressTracker.showError(error);
    }
  });

  // Handler para cancelar procesamiento por lotes
  bot.action(/^cancel_batch_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    
    const batchId = ctx.match[1];
    console.log(`❌ Lote cancelado: ${batchId}`);

    cleanupBatchProcessing(ctx);
    
    await ctx.reply(
      '❌ **Procesamiento por lotes cancelado**\n\n' +
      'Puede enviar PDFs nuevamente cuando esté listo.',
      Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Menú Principal', 'menu_principal')]
      ])
    );
  });

  // Handler para descargar ZIP de PDFs
  bot.action(/^download_pdf_zip_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('📄 Preparando descarga de PDFs...');
    
    const batchId = ctx.match[1];
    await downloadZipFile(ctx, batchId, 'pdf');
  });

  // Handler para descargar ZIP de XMLs
  bot.action(/^download_xml_zip_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('🗂️ Preparando descarga de XMLs...');
    
    const batchId = ctx.match[1];
    await downloadZipFile(ctx, batchId, 'xml');
  });
}

/**
 * Maneja la descarga de archivos ZIP
 */
async function downloadZipFile(ctx, batchId, type) {
  try {
    // CRÍTICO: Buscar primero en userState, luego en session (Redis)
    let batchProcessing = ctx.userState?.batchProcessing;
    
    if (!batchProcessing || batchProcessing.batchId !== batchId) {
      batchProcessing = ctx.session?.batchProcessing;
      
      if (!batchProcessing || batchProcessing.batchId !== batchId) {
        return ctx.reply('❌ Archivos ZIP no disponibles. El lote puede haber expirado.');
      }
      
      // Restaurar en userState
      if (!ctx.userState) ctx.userState = {};
      ctx.userState.batchProcessing = batchProcessing;
    }
    
    const zipInfo = batchProcessing.zipInfo;
    
    if (!zipInfo) {
      return ctx.reply('❌ Archivos ZIP no disponibles. El lote puede haber expirado.');
    }

    const zipData = type === 'pdf' ? zipInfo.pdfZip : zipInfo.xmlZip;
    const filePath = zipData.filePath;

    if (!fs.existsSync(filePath)) {
      return ctx.reply('❌ El archivo ZIP ya no está disponible. Los archivos se eliminan automáticamente después de 30 minutos.');
    }

    console.log(`📤 Enviando ${type.toUpperCase()} ZIP: ${zipData.fileName}`);

    // Enviar archivo
    await ctx.replyWithDocument(
      { source: fs.createReadStream(filePath), filename: zipData.fileName },
      {
        caption: `📦 **${type.toUpperCase()} ZIP - Lote: \`${batchId}\`**\n\n` +
                `📄 **Archivos:** ${zipData.fileCount}\n` +
                `💾 **Tamaño:** ${zipData.fileSizeMB}MB\n` +
                `⏰ **Generado:** ${new Date(zipInfo.createdAt).toLocaleString('es-MX')}`,
        parse_mode: 'Markdown'
      }
    );

    console.log(`✅ ${type.toUpperCase()} ZIP enviado exitosamente: ${zipData.fileName}`);

  } catch (error) {
    console.error(`❌ Error enviando ${type} ZIP:`, error.message);
    ctx.reply(
      `❌ **Error enviando archivo ZIP**\n\n` +
      `💬 ${error.message}\n\n` +
      `🔄 Por favor, intente nuevamente.`
    );
  }
}

export default {
  registerPDFInvoiceHandler,
  registerBatchHandlers,
};
