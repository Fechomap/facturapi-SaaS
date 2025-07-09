// bot/handlers/axa.handler.js
import { Markup } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';

// Importar prisma de manera segura
import { prisma as configPrisma } from '../../config/database.js';
// También intentar importar desde lib
import libPrisma from '../../lib/prisma.js';

// Usar la instancia que esté disponible
const prisma = libPrisma || configPrisma;

// Verificación de seguridad
if (!prisma) {
  console.error('ERROR CRÍTICO: No se pudo inicializar Prisma, ambas fuentes fallaron');
}

// Constante para la clave SAT de servicios de grúa
const CLAVE_SAT_SERVICIOS_GRUA = '78101803';

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
  
  const progressText = `${PROGRESS_FRAMES[frameIndex]} **Procesando archivo AXA**\n\n` +
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
 * Registra los manejadores para la funcionalidad AXA
 * @param {Object} bot - Instancia del bot de Telegram
 */
export function registerAxaHandler(bot) {
  console.log('🟢 Registrando handler AXA...');
  
  bot.action('menu_axa', async (ctx) => {
    console.log('🟢 ACTION menu_axa EJECUTADA!');
    await ctx.answerCbQuery();
    
    try {
      // Limpiar cualquier estado previo de otros clientes
      delete ctx.userState.chubbGrupos;
      delete ctx.userState.chubbColumnMappings;
      delete ctx.userState.chubbMontosPorGrupo;
      delete ctx.userState.chubbClientId;
      delete ctx.userState.axaSummary;
      delete ctx.userState.axaClientId;
      delete ctx.userState.clienteId;
      delete ctx.userState.clienteNombre;
      ctx.userState.esperando = null;
      
      // Obtener el ID del tenant actual
      const tenantId = ctx.getTenantId();
      
      if (!tenantId) {
        return ctx.reply('❌ Error: No se pudo obtener la información de tu empresa.');
      }
      
      // Obtener todos los clientes del tenant
      console.log('Buscando cliente AXA para el tenant:', tenantId);
      
      // OPTIMIZACIÓN: Cache de cliente AXA para evitar búsquedas repetitivas
      const cacheKey = `axa_client_${tenantId}`;
      let axaClient = global.clientCache && global.clientCache[cacheKey];
      
      if (!axaClient || Date.now() - (axaClient.cachedAt || 0) > 300000) { // Cache por 5 minutos
        // Buscar el cliente AXA por nombre en la base de datos
        axaClient = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId: tenantId,
            legalName: {
              contains: 'AXA'
            },
            isActive: true
          }
        });
        
        // Guardar en cache si se encontró
        if (axaClient) {
          global.clientCache = global.clientCache || {};
          global.clientCache[cacheKey] = { ...axaClient, cachedAt: Date.now() };
        }
      }
      
      if (!axaClient) {
        // Si no se encuentra, intentar configurar los clientes predefinidos
        await ctx.reply('⚠️ No se encontró el cliente AXA. Intentando configurar clientes predefinidos...');
        
        try {
          // Importar el servicio de configuración de clientes
          const CustomerSetupService = await import('../../services/customer-setup.service.js');
          
          // Configurar los clientes predefinidos
          await CustomerSetupService.default.setupPredefinedCustomers(tenantId, true);
          
          // Buscar nuevamente el cliente AXA
          const axaClientAfterSetup = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId: tenantId,
              legalName: {
                contains: 'AXA'
              },
              isActive: true
            }
          });
          
          if (!axaClientAfterSetup) {
            return ctx.reply('❌ Error: No se pudo encontrar o configurar el cliente AXA. Por favor, contacta al administrador.');
          }
          
          // Usar el cliente recién configurado
          ctx.userState.axaClientId = axaClientAfterSetup.facturapiCustomerId;
          ctx.userState.clienteNombre = axaClientAfterSetup.legalName;
          console.log(`Cliente AXA configurado y encontrado: ${axaClientAfterSetup.legalName} (ID: ${axaClientAfterSetup.facturapiCustomerId})`);
        } catch (setupError) {
          console.error('Error al configurar clientes predefinidos:', setupError);
          return ctx.reply('❌ Error: No se pudo configurar el cliente AXA. Por favor, contacta al administrador.');
        }
      } else {
        // Usar el cliente encontrado
        ctx.userState.axaClientId = axaClient.facturapiCustomerId;
        ctx.userState.clienteNombre = axaClient.legalName;
        console.log(`Cliente AXA encontrado: ${axaClient.legalName} (ID: ${axaClient.facturapiCustomerId})`);
      }
      
      // Continuar con el procesamiento normal
      ctx.userState.esperando = 'archivo_excel_axa';
      await ctx.reply('Por favor, sube el archivo Excel con los datos de AXA para generar las facturas.');
      
    } catch (error) {
      console.error('Error al buscar cliente AXA:', error);
      await ctx.reply('❌ Error al buscar cliente AXA: ' + error.message);
    }
  });
  
  // Manejador para servicios realizados (con retención)
  bot.action('axa_servicios_realizados', async (ctx) => {
    await ctx.answerCbQuery();
    
    // Verificar que tenemos datos para procesar
    const tempData = global.tempAxaData && global.tempAxaData[ctx.from.id];
    if (!tempData || !tempData.data || !tempData.columnMappings) {
      return ctx.reply('❌ No hay datos pendientes para generar facturas. Por favor, suba nuevamente el archivo Excel.');
    }
    
    // Guardar el tipo de servicio en el estado
    ctx.userState.axaTipoServicio = 'realizados';
    ctx.userState.axaConRetencion = true;
    
    // Mostrar confirmación final
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(e => console.log('No se pudo editar mensaje:', e.message));
    await ctx.reply(
      `🚛 *Servicios Realizados seleccionados*\n\n` +
      `• Se aplicará retención del 4%\n` +
      `• ${ctx.userState.axaSummary?.totalRecords || 0} registros\n\n` +
      `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', 'axa_confirmar_final')],
          [Markup.button.callback('❌ Cancelar', 'axa_cancelar')]
        ])
      }
    );
  });

  // Manejador para servicios muertos (sin retención)
  bot.action('axa_servicios_muertos', async (ctx) => {
    await ctx.answerCbQuery();
    
    // Verificar que tenemos datos para procesar
    const tempData = global.tempAxaData && global.tempAxaData[ctx.from.id];
    if (!tempData || !tempData.data || !tempData.columnMappings) {
      return ctx.reply('❌ No hay datos pendientes para generar facturas. Por favor, suba nuevamente el archivo Excel.');
    }
    
    // Guardar el tipo de servicio en el estado
    ctx.userState.axaTipoServicio = 'muertos';
    ctx.userState.axaConRetencion = false;
    
    // Mostrar confirmación final
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(e => console.log('No se pudo editar mensaje:', e.message));
    await ctx.reply(
      `💀 *Servicios Muertos seleccionados*\n\n` +
      `• Sin retención\n` +
      `• ${ctx.userState.axaSummary?.totalRecords || 0} registros\n\n` +
      `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', 'axa_confirmar_final')],
          [Markup.button.callback('❌ Cancelar', 'axa_cancelar')]
        ])
      }
    );
  });

  // Manejador para confirmar la generación de facturas AXA (después de seleccionar tipo)
  bot.action('axa_confirmar_final', async (ctx) => {
    await ctx.answerCbQuery();
    
    // 📱 FEEDBACK INMEDIATO: Mostrar que se detectó el click del botón ANTES de validaciones
    const facturaProgressMsg = await ctx.reply('⚡ Procesando factura AXA...\n⏳ Validando datos...');
    
    // Verificar que tenemos datos para procesar
    const tempData = global.tempAxaData && global.tempAxaData[ctx.from.id];
    if (!tempData || !tempData.data || !tempData.columnMappings || ctx.userState.axaTipoServicio === undefined) {
      // Actualizar mensaje con error
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        facturaProgressMsg.message_id,
        null,
        '❌ No hay datos pendientes para generar facturas. Por favor, suba nuevamente el archivo Excel.'
      );
      return;
    }
    
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(e => console.log('No se pudo editar mensaje:', e.message));
      
      const tipoServicio = ctx.userState.axaTipoServicio;
      const conRetencion = ctx.userState.axaConRetencion;
      
      // 📱 Actualizar mensaje con tipo de servicio
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        facturaProgressMsg.message_id,
        null,
        `⚡ Procesando factura para servicios ${tipoServicio} ${conRetencion ? '(con retención 4%)' : '(sin retención)'}...\n⏳ Preparando datos...`,
        { parse_mode: 'Markdown' }
      );
      
      // Los datos ya fueron verificados arriba, solo los asignamos
      const data = tempData.data;
      const columnMappings = tempData.columnMappings;
      
      // 📱 Actualizar progreso de facturación
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        facturaProgressMsg.message_id,
        null,
        `⚡ Generando factura para servicios AXA (${data.length} registros)...\n\n📊 Preparando datos para FacturAPI...`,
        { parse_mode: 'Markdown' }
      );
      
      const factura = await generarFacturaAxa(data, ctx, columnMappings, conRetencion, facturaProgressMsg.message_id);
      
      // 📱 Informar resultado final con indicador visual
      if (factura) {
        await ctx.reply(`🎯 *Proceso AXA completado exitosamente*\n\n✅ Factura generada correctamente\n📊 ${data.length} servicios procesados`, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply('⚠️ No se generó la factura. Por favor, verifica los datos del archivo Excel.');
      }
      
      // Limpiar el estado y datos temporales
      delete ctx.userState.axaSummary;
      delete ctx.userState.axaTipoServicio;
      delete ctx.userState.axaConRetencion;
      if (global.tempAxaData && global.tempAxaData[ctx.from.id]) {
        delete global.tempAxaData[ctx.from.id];
      }
      ctx.userState.esperando = null;
      
    } catch (error) {
      console.error('Error al procesar confirmación de factura AXA:', error);
      await ctx.reply(`❌ Error al generar factura: ${error.message}`);
      ctx.userState.esperando = null;
    }
  });
  
  // Manejador para cancelar la generación de facturas AXA
  bot.action('axa_cancelar', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(e => console.log('No se pudo editar mensaje:', e.message));
      await ctx.reply('❌ Operación cancelada. No se generó factura.');
      
      // Limpiar el estado y datos temporales
      delete ctx.userState.axaSummary;
      delete ctx.userState.axaTipoServicio;
      delete ctx.userState.axaConRetencion;
      if (global.tempAxaData && global.tempAxaData[ctx.from.id]) {
        delete global.tempAxaData[ctx.from.id];
      }
      ctx.userState.esperando = null;
    } catch (error) {
      console.error('Error al cancelar operación:', error);
      await ctx.reply('❌ Error al cancelar la operación.');
      ctx.userState.esperando = null;
    }
  });

  // Manejar la recepción del archivo Excel
  bot.on('document', async (ctx, next) => {
    console.log('=========== INICIO HANDLER AXA EXCEL ===========');
    console.log('Documento recibido:', ctx.message.document.file_name);
    console.log('Estado esperando:', ctx.userState?.esperando);
    
    // 📱 FEEDBACK INMEDIATO: Mostrar que se detectó el documento ANTES de validaciones
    let receivingMessage = null;
    
    // Solo procesar si estamos esperando un archivo Excel para AXA
    if (!ctx.userState || ctx.userState.esperando !== 'archivo_excel_axa') {
      console.log('No estamos esperando archivo Excel para AXA, pasando al siguiente handler');
      console.log('=========== FIN HANDLER AXA EXCEL (PASANDO) ===========');
      return next();
    }

    // 📱 FEEDBACK INMEDIATO: Mostrar procesamiento tan pronto como detectemos que es nuestro contexto
    receivingMessage = await ctx.reply('📥 Recibiendo archivo Excel de AXA...\n⏳ Validando archivo...');

    const document = ctx.message.document;
    
    // Verificar que sea un archivo Excel
    if (!document.file_name.match(/\.(xlsx|xls)$/i)) {
      console.log('Documento no es Excel, informando al usuario');
      // Actualizar el mensaje existente con el error
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        receivingMessage.message_id,
        null,
        '❌ El archivo debe ser de tipo Excel (.xlsx o .xls). Por favor, intenta de nuevo.'
      );
      console.log('=========== FIN HANDLER AXA EXCEL (NO ES EXCEL) ===========');
      return; // No pasamos al siguiente handler porque es nuestro contexto pero formato incorrecto
    }

    // 📱 MEJORA VISUAL: Actualizar que el archivo es válido
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      receivingMessage.message_id,
      null,
      `✅ Archivo Excel válido: ${document.file_name}\n⏳ Descargando archivo...`
    );

    try {
      // Descargar el archivo
      const fileLink = await ctx.telegram.getFileLink(document.file_id);
      const tempDir = ensureTempDirExists();
      const filePath = path.join(tempDir, document.file_name);
      
      await downloadFile(fileLink.href, filePath);
      
      // 📱 MEJORA VISUAL: Actualizar progreso con animación
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        receivingMessage.message_id,
        null,
        `✅ Archivo recibido: ${document.file_name}\n🔍 Validando estructura del Excel...\n⏳ Por favor espere...`
      );
      
      // Procesar el archivo Excel y generar facturas
      const result = await procesarArchivoAxa(ctx, filePath, receivingMessage.message_id);
      
      // Limpiar el archivo temporal
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('Error al eliminar archivo temporal:', e);
      }

      // Si no hay confirmación pendiente, reseteamos el estado
      if (!result || !result.pendingConfirmation) {
        ctx.userState.esperando = null;
      }
      
      console.log('=========== FIN HANDLER AXA EXCEL (PROCESADO) ===========');
      
    } catch (error) {
      console.error('Error al procesar el archivo Excel:', error);
      ctx.reply(`❌ Error al procesar el archivo: ${error.message}`);
      ctx.userState.esperando = null;
      console.log('=========== FIN HANDLER AXA EXCEL (ERROR) ===========');
    }
  });
}

/**
 * Asegura que existe el directorio temporal
 * @returns {string} - Ruta al directorio temporal
 */
function ensureTempDirExists() {
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * Descarga un archivo desde una URL
 * @param {string} url - URL del archivo para descargar
 * @param {string} outputPath - Ruta donde guardar el archivo
 * @returns {Promise} - Promesa que se resuelve cuando el archivo se descarga
 */
async function downloadFile(url, outputPath) {
  const writer = fs.createWriteStream(outputPath);
  
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });
  
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * Procesa el archivo Excel de AXA y genera facturas
 * @param {Object} ctx - Contexto de Telegram
 * @param {string} filePath - Ruta al archivo Excel
 * @returns {Promise} - Promesa que se resuelve cuando se procesan todas las facturas
 */
async function procesarArchivoAxa(ctx, filePath, progressMessageId = null) {
  try {
    // 📱 PASO 1: Leer archivo Excel
    await updateProgressMessage(ctx, progressMessageId, 1, 6, 'Leyendo archivo Excel', 'Cargando datos...');
    
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // 📱 PASO 2: Detectar columnas
    await updateProgressMessage(ctx, progressMessageId, 2, 6, 'Detectando columnas', 'Analizando estructura...');
    
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const columnNames = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell = worksheet[XLSX.utils.encode_cell({r:range.s.r, c:C})];
      columnNames.push(cell ? cell.v : undefined);
    }
    
    console.log('Columnas detectadas en el Excel AXA:', columnNames);
    
    // 📱 PASO 3: Convertir a JSON
    await updateProgressMessage(ctx, progressMessageId, 3, 6, 'Procesando datos', 'Convirtiendo a formato interno...');
    
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    if (data.length === 0) {
      await updateProgressMessage(ctx, progressMessageId, 6, 6, 'Error: Archivo vacío', '');
      await ctx.reply('❌ El archivo Excel no contiene datos. Por favor, revisa el archivo e intenta de nuevo.');
      return { success: false, error: 'Excel sin datos' };
    }

    // 📱 PASO 4: Validar estructura
    await updateProgressMessage(ctx, progressMessageId, 4, 6, 'Validando estructura', `Verificando ${data.length} registros...`);
    
    // Mapear nombres de columnas que pueden variar
    const columnMappings = mapColumnNamesAxa(data[0]);
    
    if (!columnMappings) {
      await updateProgressMessage(ctx, progressMessageId, 4, 6, 'Error: Estructura inválida', 'Columnas requeridas faltantes');
      await ctx.reply('❌ El archivo Excel no tiene todas las columnas requeridas. Se necesitan columnas para: FACTURA, No. ORDEN, No. FOLIO, AUTORIZACION e IMPORTE.');
      return { success: false, error: 'Estructura de Excel inválida' };
    }
    
    // Log para ver la estructura de los datos
    console.log('Mapeado de columnas AXA:', columnMappings);
    console.log('Primeras filas del Excel AXA:', data.slice(0, 2));
    
    // Verificar que los valores numéricos sean correctos
    const erroresNumericos = [];
    data.forEach((row, index) => {
      const importe = parseFloat(row[columnMappings.importe]);
      if (isNaN(importe) || importe <= 0) {
        erroresNumericos.push(`Fila ${index + 2}: El importe debe ser un número positivo.`);
      }
    });
    
    if (erroresNumericos.length > 0) {
      // Mostrar hasta 5 errores para no saturar el mensaje
      const erroresMostrados = erroresNumericos.slice(0, 5);
      await updateProgressMessage(ctx, progressMessageId, 4, 6, 'Error: Datos numéricos inválidos', `${erroresNumericos.length} errores encontrados`);
      await ctx.reply(`❌ Se encontraron errores en los datos numéricos:\n${erroresMostrados.join('\n')}\n${erroresNumericos.length > 5 ? `...y ${erroresNumericos.length - 5} más.` : ''}`);
      return { success: false, error: 'Datos numéricos inválidos' };
    }
    
    // 📱 PASO 5: Calcular totales
    await updateProgressMessage(ctx, progressMessageId, 5, 6, 'Calculando totales', `Procesando ${data.length} registros...`);
    
    // Calcular el monto total
    const montoTotal = data.reduce((total, item) => {
      return total + parseFloat(item[columnMappings.importe] || 0);
    }, 0);
    
    // Construir resumen de datos
    let infoResumen = `📊 Resumen de datos procesados:\n\n`;
    infoResumen += `• Servicios de Grúa AXA:\n  - ${data.length} registros\n  - Monto total: ${montoTotal.toFixed(2)} MXN\n\n`;
    
    // OPTIMIZACIÓN: Guardar SOLO números en el estado, sin objetos
    ctx.userState.axaSummary = {
      totalRecords: data.length,
      totalAmount: montoTotal
      // NO guardar firstRecord - innecesario y añade peso
    };
    
    // Guardar datos temporalmente en memoria del proceso (no en sesión)
    // Esto evita serializar/deserializar grandes cantidades de datos
    global.tempAxaData = global.tempAxaData || {};
    global.tempAxaData[ctx.from.id] = {
      data,
      columnMappings,
      timestamp: Date.now()
    };
    
    // Limpiar datos antiguos (más de 10 minutos)
    for (const userId in global.tempAxaData) {
      if (Date.now() - global.tempAxaData[userId].timestamp > 600000) {
        delete global.tempAxaData[userId];
      }
    }
    
    // 📱 PASO 6: Completado
    await updateProgressMessage(ctx, progressMessageId, 6, 6, 'Procesamiento completado', `${data.length} registros listos para facturar`);
    
    // Preguntar sobre el tipo de servicios antes de la confirmación final
    await ctx.reply(
      `${infoResumen}\n¿Qué tipo de servicios son?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🚛 Servicios Realizados (con retención 4%)', 'axa_servicios_realizados')],
        [Markup.button.callback('💀 Servicios Muertos (sin retención)', 'axa_servicios_muertos')],
        [Markup.button.callback('❌ Cancelar', 'axa_cancelar')]
      ])
    );
    
    return { success: true, pendingConfirmation: true };
    
  } catch (error) {
    console.error('Error al procesar archivo Excel AXA:', error);
    await ctx.reply(`❌ Error al procesar el archivo Excel: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Mapea los nombres de las columnas encontrados en el Excel AXA a nombres estandarizados
 * @param {Object} firstRow - Primera fila del Excel para detectar los nombres de columnas
 * @returns {Object|null} - Objeto con el mapeo de columnas o null si no se encuentran las columnas requeridas
 */
function mapColumnNamesAxa(firstRow) {
  if (!firstRow) return null;
  
  // Posibles nombres para cada columna requerida de AXA
  const posiblesColumnas = {
    estatus: ['ESTATUS', 'Estatus', 'Status', 'Estado'],
    factura: ['FACTURA', 'Factura', 'No. FACTURA', 'Numero Factura'],
    orden: ['No. ORDEN', 'ORDEN', 'Orden', 'Numero Orden', 'No ORDEN'],
    folio: ['No. FOLIO', 'FOLIO', 'Folio', 'Numero Folio', 'No FOLIO'],
    autorizacion: ['AUTORIZACION', 'Autorizacion', 'Autorización', 'Auth'],
    importe: ['IMPORTE', 'Importe', 'Monto', 'Valor', 'Total'],
    iva: ['I.V.A.', 'IVA', 'Iva', 'Impuesto'],
    neto: ['NETO', 'Neto', 'Net', 'Total Neto'],
    fecha: ['FECHA', 'Fecha', 'Date', 'Día']
  };
  
  // Objeto para almacenar las columnas encontradas
  const columnMapping = {};
  
  // Buscar el mejor match para cada columna requerida
  Object.keys(posiblesColumnas).forEach(tipoColumna => {
    // Buscar por nombre exacto primero
    const nombreEncontrado = posiblesColumnas[tipoColumna].find(posibleNombre => 
      Object.keys(firstRow).includes(posibleNombre)
    );
    
    if (nombreEncontrado) {
      columnMapping[tipoColumna] = nombreEncontrado;
    }
    // Si no encontramos match exacto, buscar por coincidencia parcial (case insensitive)
    else {
      const keys = Object.keys(firstRow);
      const matchParcial = keys.find(key => 
        posiblesColumnas[tipoColumna].some(posibleNombre => 
          key.toLowerCase().includes(posibleNombre.toLowerCase())
        )
      );
      
      if (matchParcial) {
        columnMapping[tipoColumna] = matchParcial;
      }
    }
  });
  
  // Verificar que encontramos todas las columnas necesarias
  const requiredKeys = ['factura', 'orden', 'folio', 'autorizacion', 'importe'];
  if (requiredKeys.every(key => columnMapping[key])) {
    return columnMapping;
  }
  
  console.log('No se encontraron todas las columnas requeridas para AXA:', columnMapping);
  return null;
}

/**
 * Genera una factura para AXA con todos los registros
 * @param {Array} items - Elementos a incluir en la factura
 * @param {Object} ctx - Contexto de Telegram
 * @param {Object} columnMappings - Mapeo de nombres de columnas
 * @param {boolean} conRetencion - Si aplica retención del 4%
 * @returns {Promise<Object>} - Factura generada
 */
async function generarFacturaAxa(items, ctx, columnMappings, conRetencion = false, progressMessageId = null) {
  if (items.length === 0) {
    console.log('No hay items para generar factura AXA');
    return null;
  }
  
  // Calcular el monto total de todos los servicios
  const montoTotal = items.reduce((total, item) => {
    const importe = parseFloat(item[columnMappings.importe]);
    return total + (isNaN(importe) ? 0 : importe);
  }, 0);
  
  if (montoTotal <= 0) {
    await ctx.reply(`⚠️ No se generó factura para AXA porque el monto total es 0.`);
    return null;
  }
  
  // OPTIMIZACIÓN: Construir array de ítems en chunks para mejor rendimiento
  const chunkSize = 10;
  const facturaItems = [];
  
  // Pre-definir estructura de impuestos para evitar recrearla
  const baseTaxes = [{ type: "IVA", rate: 0.16, factor: "Tasa" }];
  const taxesWithRetention = [
    ...baseTaxes,
    { type: "IVA", rate: 0.04, factor: "Tasa", withholding: true }
  ];
  
  // Procesar items en chunks
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, Math.min(i + chunkSize, items.length));
    
    chunk.forEach(item => {
      const factura = item[columnMappings.factura] || 'N/A';
      const orden = item[columnMappings.orden] || 'N/A';
      const folio = item[columnMappings.folio] || 'N/A';
      const autorizacion = item[columnMappings.autorizacion] || 'N/A';
      const importe = parseFloat(item[columnMappings.importe]);
      
      // Usar template literal optimizado
      const descripcion = `ARRASTRE DE GRUA FACTURA ${factura} No. ORDEN ${orden} No. FOLIO ${folio} AUTORIZACION ${autorizacion}`;
      
      facturaItems.push({
        quantity: 1,
        product: {
          description: descripcion,
          product_key: CLAVE_SAT_SERVICIOS_GRUA,
          unit_key: "E48",
          unit_name: "SERVICIO",
          price: importe,
          tax_included: false,
          taxes: conRetencion ? taxesWithRetention : baseTaxes
        }
      });
    });
    
    // Pequeña pausa para no bloquear el event loop en datasets grandes
    if (i + chunkSize < items.length && items.length > 50) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  
  // Construir los datos de la factura
  const facturaData = {
    customer: ctx.userState.axaClientId,
    items: facturaItems,
    use: "G03",  // Uso de CFDI
    payment_form: "99",  // Forma de pago
    payment_method: "PPD",  // Método de pago
    currency: "MXN",
    exchange: 1
  };
  
  // Mostrar resumen de la factura antes de generarla (formato estándar como CHUBB)
  await ctx.reply(
    `📋 *Vista previa de factura*\n\n` +
    `• Tipo: ${conRetencion ? 'Servicios de Grúa AXA Con Retención (4%)' : 'Servicios de Grúa AXA Sin Retención'}\n` +
    `• Cliente: AXA ASSISTANCE MEXICO\n` +
    `• Clave SAT: ${CLAVE_SAT_SERVICIOS_GRUA}\n` +
    `• Registros incluidos: ${items.length}\n` +
    `• Monto: $${montoTotal.toFixed(2)} MXN\n`,
    { parse_mode: 'Markdown' }
  );

  // Llamar directamente a FacturAPI para generar la factura
  try {
    // 📱 Actualizar progreso si se proporciona messageId
    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessageId,
        null,
        `🚀 Enviando factura a FacturAPI...\n\n📡 Conectando con el servidor...`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(`⏳ Generando factura para AXA...`);
    }
    
    // Obtener el ID del tenant actual
    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      throw new Error('No se pudo obtener el ID del tenant');
    }
    
    console.log(`Tenant ID obtenido: ${tenantId}`);
    
    // Importar facturapIService
    const facturapIService = await import('../../services/facturapi.service.js').then(m => m.default);
    
    // Obtener cliente de FacturAPI
    const facturapi = await facturapIService.getFacturapiClient(tenantId);
    console.log('Cliente FacturAPI obtenido correctamente');
    
    // 📱 Actualizar progreso - Preparando datos
    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessageId,
        null,
        `🔄 Enviando ${facturaItems.length} servicios a FacturAPI...\n\n⏳ Procesando datos...`,
        { parse_mode: 'Markdown' }
      );
    }
    
    // Obtenemos el TenantService pero NO solicitamos ni asignamos el folio
    const TenantService = await import('../../services/tenant.service.js').then(m => m.default);
    
    // OPTIMIZACIÓN: Log reducido para mejor rendimiento
    console.log(`Enviando solicitud a FacturAPI: ${facturaItems.length} items, cliente: ${ctx.userState.axaClientId}`);
    
    // 📱 Actualizar progreso - Enviando a FacturAPI
    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessageId,
        null,
        `🚀 Creando factura en FacturAPI...\n\n💫 Enviando datos al servidor...`,
        { parse_mode: 'Markdown' }
      );
    }
    
    // Crear la factura directamente en FacturAPI (sin enviar folio)
    const factura = await facturapi.invoices.create(facturaData);
    console.log('Factura AXA creada en FacturAPI, folio asignado automáticamente:', factura.folio_number);
    
    // 📱 Actualizar progreso - Factura creada
    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessageId,
        null,
        `✅ Factura creada exitosamente\n\n📋 Folio: ${factura.series}-${factura.folio_number}\n💰 Total: $${factura.total.toFixed(2)} MXN`,
        { parse_mode: 'Markdown' }
      );
    }
    
    // Registrar la factura en la base de datos con el folio devuelto por FacturAPI
    try {
      const registeredInvoice = await TenantService.registerInvoice(
        tenantId,
        factura.id,
        factura.series || 'A',
        factura.folio_number, // Usamos el folio que FacturAPI asignó
        null, // customerId, podríamos buscar el ID del cliente en la base de datos si es necesario
        factura.total,
        ctx.from?.id ? BigInt(ctx.from.id) : null // ID del usuario que creó la factura
      );
      
      console.log('Factura AXA registrada en la base de datos:', registeredInvoice);
    } catch (registerError) {
      // Si hay un error al registrar, lo registramos pero continuamos
      console.error('Error al registrar factura AXA en la base de datos:', registerError);
    }
    
    // Guardar el ID de la factura en el estado del usuario para usarlo posteriormente
    ctx.userState.facturaId = factura.id;
    ctx.userState.folioFactura = factura.folio_number;
    ctx.userState.facturaGenerada = true;
    
    // 📱 Mensaje final con opciones de descarga
    await ctx.reply(
      `🎉 *Factura AXA generada exitosamente*\n\n` +
      `• Cliente: AXA ASSISTANCE MEXICO\n` +
      `• Folio: ${factura.series}-${factura.folio_number}\n` +
      `• Clave SAT: ${CLAVE_SAT_SERVICIOS_GRUA}\n` +
      `• Total: $${factura.total.toFixed(2)} MXN\n\n` +
      `📥 Seleccione una opción para descargar:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📄 Descargar PDF', `pdf_${factura.id}_${factura.folio_number}`)],
          [Markup.button.callback('🔠 Descargar XML', `xml_${factura.id}_${factura.folio_number}`)]
        ])
      }
    );
    
    return factura;
    
  } catch (error) {
    console.error('Error al generar factura AXA:', error);
    let errorMsg = 'Error al generar la factura.';
    
    if (error.response && error.response.data) {
      console.log('Respuesta de error completa:', JSON.stringify(error.response.data, null, 2));
      if (typeof error.response.data.message === 'string') {
        errorMsg = `Error de FacturAPI: ${error.response.data.message}`;
      } else if (error.response.data.details) {
        errorMsg = `Error de validación: ${JSON.stringify(error.response.data.details)}`;
      }
    }
    
    await ctx.reply(`❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
}