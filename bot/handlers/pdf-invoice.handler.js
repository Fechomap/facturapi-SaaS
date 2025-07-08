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
    
    await ctx.reply('📄 Analizando PDF para extracción automática...');
    
    try {
      // Descargar archivo
      const tempDir = ensureTempDirExists();
      const filePath = await downloadTelegramFile(ctx, document.file_id, fileName, tempDir);
      
      // Analizar PDF
      const analysisResult = await PDFAnalysisService.analyzePDF(filePath);
      
      // Limpiar archivo temporal
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('Error limpiando archivo:', e);
      }
      
      if (!analysisResult.success) {
        await ctx.reply(`❌ Error al analizar el PDF: ${analysisResult.error}`);
        return;
      }
      
      // Validar datos extraídos
      const validation = PDFAnalysisService.validateExtractedData(analysisResult.analysis);
      
      // Mostrar resultados
      await showSimpleAnalysisResults(ctx, analysisResult.analysis, validation);
      
    } catch (error) {
      console.error('Error procesando PDF:', error);
      await ctx.reply(`❌ Error al procesar el PDF: ${error.message}`);
    }
  });
  
  // Handler para confirmar datos extraídos
  bot.action(/^confirm_simple_pdf_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const analysisId = ctx.match[1];
    
    const analysisData = ctx.userState?.pdfAnalysis;
    if (!analysisData || analysisData.id !== analysisId) {
      return ctx.reply('❌ Los datos han expirado. Sube el PDF nuevamente.');
    }
    
    await generateSimpleInvoice(ctx, analysisData);
  });
  
  // Handler para edición manual
  bot.action(/^edit_simple_pdf_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const analysisId = ctx.match[1];
    
    const analysisData = ctx.userState?.pdfAnalysis;
    if (!analysisData || analysisData.id !== analysisId) {
      return ctx.reply('❌ Los datos han expirado. Sube el PDF nuevamente.');
    }
    
    await startManualEditFlow(ctx, analysisData);
  });
}

/**
 * Muestra los resultados del análisis de forma simple
 */
async function showSimpleAnalysisResults(ctx, analysis, validation) {
  const analysisId = `simple_${Date.now()}_${ctx.from.id}`;
  
  // Guardar en estado del usuario
  ctx.userState.pdfAnalysis = {
    id: analysisId,
    analysis,
    validation,
    timestamp: Date.now()
  };
  
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
async function generateSimpleInvoice(ctx, analysisData) {
  const { analysis } = analysisData;
  
  await ctx.reply('⏳ Preparando facturación...');
  
  try {
    // Obtener tenant ID
    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      return ctx.reply('❌ Error: No se encontró el ID del tenant');
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
        const facturapi = await facturapIService.getFacturapiClient(tenantId);
        const clientes = await facturapi.customers.list({
          q: analysis.clientName // Usar el nombre completo para mayor precisión
        });
        
        if (clientes && clientes.data && clientes.data.length > 0) {
          // Usar el primer cliente que coincida
          clienteId = clientes.data[0].id;
          console.log(`Cliente encontrado en FacturAPI: ${clientes.data[0].legal_name} (ID: ${clienteId})`);
        } else {
          return ctx.reply(`❌ No se encontró el cliente "${analysis.clientName}" ni en BD local ni en FacturAPI. Por favor, asegúrate de que esté registrado.`);
        }
      }
    } catch (error) {
      console.error('Error buscando cliente:', error);
      return ctx.reply(`❌ Error al buscar cliente: ${error.message}`);
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
    
    // Generar la factura real en FacturAPI
    const factura = await InvoiceService.generateInvoice(facturaData, tenantId);
    console.log('Factura generada exitosamente:', factura.id, 'Folio:', factura.folio_number);
    
    // Actualizar el estado con la información de la factura generada
    // El middleware de sesión guardará automáticamente estos cambios
    ctx.userState.facturaId = factura.id;
    ctx.userState.folioFactura = factura.folio_number;
    ctx.userState.series = factura.series || 'A';
    
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
    console.error('Error generando factura:', error);
    await ctx.reply(`❌ Error al generar la factura: ${error.message}`);
  }
}

/**
 * Inicia flujo de edición manual con datos prellenados
 */
async function startManualEditFlow(ctx, analysisData) {
  const { analysis } = analysisData;
  
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