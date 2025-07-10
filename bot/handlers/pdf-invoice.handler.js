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
  '▰▰▰▰▰▰▰▰▰▰'
];

/**
 * Actualiza el mensaje de progreso con animación
 */
async function updateProgressMessage(ctx, messageId, step, total, currentTask, details = '') {
  if (!messageId) return;
  
  const percentage = Math.round((step / total) * 100);
  const progressBarIndex = Math.min(Math.floor((step / total) * 10), 9);
  const frameIndex = step % PROGRESS_FRAMES.length;
  
  const progressText = `${PROGRESS_FRAMES[frameIndex]} **Procesando PDF**\n\n` +
                      `📊 Progreso: ${percentage}% ${PROGRESS_BARS[progressBarIndex]}\n` +
                      `🔄 ${currentTask}\n` +
                      (details ? `📝 ${details}\n` : '') +
                      `\n⏱️ Por favor espere...`;
  
  try {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      messageId,
      null,
      progressText,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    // Si no se puede editar el mensaje, crear uno nuevo
    console.log('No se pudo editar mensaje de progreso:', error.message);
  }
}

// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    if (ctx.userState?.esperando && 
        (ctx.userState.esperando === 'archivo_excel_chubb' || 
         ctx.userState.productionSetup)) {
      console.log('Usuario en otro proceso, saltando');
      return next();
    }
    
    // Verificar tenant
    if (!ctx.hasTenant()) {
      await ctx.reply('❌ Para procesar facturas, primero debes registrar tu empresa.');
      return;
    }
    
    // 🚀 OPTIMIZACIÓN: Limpiar pdfAnalysis anterior antes de procesar nuevo
    safeCleanupPdfAnalysis(ctx, 'new_pdf');
    
    // 📱 FEEDBACK INMEDIATO: Mostrar progreso tan pronto como se detecte el PDF
    const progressMessage = await ctx.reply('📥 Recibiendo PDF...\n⏳ Validando archivo...');
    
    try {
      // 📱 PASO 1: Descargando archivo
      await updateProgressMessage(ctx, progressMessage.message_id, 1, 4, 'Descargando PDF', 'Obteniendo archivo...');
      
      // Descargar archivo
      const tempDir = ensureTempDirExists();
      const filePath = await downloadTelegramFile(ctx, document.file_id, fileName, tempDir);
      
      // 📱 PASO 2: Analizando contenido
      await updateProgressMessage(ctx, progressMessage.message_id, 2, 4, 'Analizando PDF', 'Extrayendo información...');
      
      // Analizar PDF
      const analysisResult = await PDFAnalysisService.analyzePDF(filePath);
      
      // 📱 PASO 3: Validando datos
      await updateProgressMessage(ctx, progressMessage.message_id, 3, 4, 'Validando datos', 'Verificando información...');
      
      // Validar datos extraídos
      const validation = PDFAnalysisService.validateExtractedData(analysisResult.analysis);
      
      // 📱 PASO 4: Completado
      await updateProgressMessage(ctx, progressMessage.message_id, 4, 4, 'Análisis completado', 'Datos extraídos exitosamente');
      
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
        timestamp: new Date().toISOString()
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
    const invoiceProgressMsg = await ctx.reply('⚡ Procesando factura PDF...\n⏳ Validando datos...');
    
    // CRÍTICO: Responder al callback query INMEDIATAMENTE después del feedback visual
    await ctx.answerCbQuery();
    
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
        // Actualizar mensaje con error
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          invoiceProgressMsg.message_id,
          null,
          '❌ Los datos han expirado. Sube el PDF nuevamente.'
        );
        return;
      }
      
      // Restaurar en userState para uso local
      ctx.userState.pdfAnalysis = analysisData;
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
    timestamp: Date.now()
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
  const confidenceEmoji = analysis.confidence >= 80 ? '🟢' : 
                         analysis.confidence >= 60 ? '🟡' : '🔴';
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
    analysis.errors.forEach(error => {
      message += `• ${error}\n`;
    });
  }
  
  // Crear botones según validación
  const buttons = [];
  
  if (validation.isValid && analysis.confidence >= 70) {
    buttons.push([Markup.button.callback('✅ Generar Factura', `confirm_simple_pdf_${analysisId}`)]);
  }
  
  buttons.push([Markup.button.callback('✏️ Editar Manualmente', `edit_simple_pdf_${analysisId}`)]);
  buttons.push([Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]);
  
  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
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
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMessageId,
          null,
          errorMsg
        );
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
    try {
      // 1. Buscar primero en BD local (mucho más rápido)
      console.log(`🔍 Buscando cliente en BD local: "${analysis.clientName}"`);
      const localCustomer = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          legalName: { contains: analysis.clientName, mode: 'insensitive' }
        }
      });
      
      if (localCustomer) {
        // ✅ Encontrado en BD local (0.1 segundos)
        clienteId = localCustomer.facturapiCustomerId;
        console.log(`✅ Cliente encontrado en BD local: ${localCustomer.legalName} (ID: ${clienteId})`);
      } else {
        // ⚠️ Solo como fallback, buscar en FacturAPI (30 segundos)
        console.log(`⚠️ Cliente no encontrado en BD local, buscando en FacturAPI: "${analysis.clientName}"`);
        
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
          q: analysis.clientName // Usar el nombre completo para mayor precisión
        });
        
        if (clientes && clientes.data && clientes.data.length > 0) {
          // Usar el primer cliente que coincida
          clienteId = clientes.data[0].id;
          console.log(`Cliente encontrado en FacturAPI: ${clientes.data[0].legal_name} (ID: ${clienteId})`);
        } else {
          const errorMsg = `❌ No se encontró el cliente "${analysis.clientName}" ni en BD local ni en FacturAPI. Por favor, asegúrate de que esté registrado.`;
          if (progressMessageId) {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              progressMessageId,
              null,
              errorMsg
            );
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
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMessageId,
          null,
          errorMsg
        );
      } else {
        await ctx.reply(errorMsg);
      }
      return;
    }
    
    // Datos para la factura (usando siempre 78101803 como clave SAT)
    const facturaData = {
      clienteId: clienteId,
      numeroPedido: analysis.orderNumber,
      claveProducto: '78101803',  // Clave SAT fija para todos los clientes
      monto: analysis.totalAmount,
      userId: ctx.from.id
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
    
    // Generar la factura real en FacturAPI
    const factura = await InvoiceService.generateInvoice(facturaData, tenantId);
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
    
    // Actualizar el estado con la información de la factura generada
    // CRÍTICO: Guardar también en session para persistencia entre workers
    ctx.userState.facturaId = factura.id;
    ctx.userState.folioFactura = factura.folio_number;
    ctx.userState.series = factura.series || 'A';
    
    // Asegurar persistencia en sesión
    ctx.session.facturaId = factura.id;
    ctx.session.folioFactura = factura.folio_number;
    ctx.session.series = factura.series || 'A';
    ctx.session.facturaGenerada = true;
    
    // Mostrar resultado al usuario
    await ctx.reply(
      `✅ **Factura Generada Exitosamente**\n\n` +
      `Serie-Folio: ${ctx.userState.series}-${ctx.userState.folioFactura}\n` +
      `Cliente: ${analysis.clientName}\n` +
      `Pedido: ${analysis.orderNumber}\n` +
      `Total: $${analysis.totalAmount.toFixed(2)} MXN\n\n` +
      `_La factura ha sido procesada correctamente._`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📄 Descargar PDF', `pdf_${factura.id}_${factura.folio_number}`), 
           Markup.button.callback('📂 Descargar XML', `xml_${factura.id}_${factura.folio_number}`)],
          [Markup.button.callback('⬅️ Volver al Menú', 'menu_principal')]
        ])
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
      timestamp: new Date().toISOString()
    });
    
    // Actualizar mensaje de error
    const errorMsg = `❌ Error al generar la factura: ${error.message}`;
    if (progressMessageId) {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMessageId,
          null,
          errorMsg
        );
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
    responseType: 'stream'
  });
  
  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(filePath));
    writer.on('error', reject);
  });
}

export default {
  registerPDFInvoiceHandler
};