// bot/handlers/club-asistencia.handler.js
import { Markup } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';

// Importar prisma de manera segura
import { prisma as configPrisma } from '../../config/database.js';
import libPrisma from '../../lib/prisma.js';

// Importar utilidades de detección Excel
import { debeDetectarExcel, esArchivoExcelValido } from '../../core/utils/excel-detection.utils.js';

// Importar utilidades de limpieza de estado
import { cleanupFlowChange } from '../../core/utils/state-cleanup.utils.js';

// Usar la instancia que esté disponible
const prisma = libPrisma || configPrisma;

// Verificación de seguridad
if (!prisma) {
  console.error('ERROR CRÍTICO: No se pudo inicializar Prisma, ambas fuentes fallaron');
}

// Función helper para obtener customerId del cliente Club de Asistencia desde BD
async function getCasCustomerIdFromDB(tenantId, facturapiCustomerId) {
  try {
    const customer = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId,
        facturapiCustomerId,
        rfc: 'CAS981016P46',
      },
      select: { id: true },
    });

    return customer?.id || null;
  } catch (error) {
    console.error('Error obteniendo customerId Club de Asistencia:', error);
    return null;
  }
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
    `${PROGRESS_FRAMES[frameIndex]} **Procesando archivo Club de Asistencia**\n\n` +
    `📊 Progreso: ${percentage}% ${PROGRESS_BARS[progressBarIndex]}\n` +
    `🔄 ${currentTask}\n` +
    (details ? `📝 ${details}\n` : '') +
    `\n⏱️ Por favor espere...`;

  try {
    await ctx.telegram.editMessageText(ctx.chat.id, messageId, null, progressText, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    console.log('No se pudo editar mensaje de progreso:', error.message);
  }
}

// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Registra los manejadores para la funcionalidad Club de Asistencia
 * @param {Object} bot - Instancia del bot de Telegram
 */
export function registerClubAsistenciaHandler(bot) {
  console.log('🟢 Registrando handler Club de Asistencia...');

  bot.action('menu_club_asistencia', async (ctx) => {
    console.log('🟢 ACTION menu_club_asistencia EJECUTADA!');
    await ctx.answerCbQuery();

    try {
      // Limpieza segura y eficiente de estado
      cleanupFlowChange(ctx, 'club_asistencia');

      // Limpiar estado específico anterior
      delete ctx.userState.casSummary;
      delete ctx.userState.casClientId;
      delete ctx.userState.clienteId;
      delete ctx.userState.clienteNombre;
      ctx.userState.esperando = null;

      // Obtener el ID del tenant actual
      const tenantId = ctx.getTenantId();

      if (!tenantId) {
        return ctx.reply('❌ Error: No se pudo obtener la información de tu empresa.');
      }

      console.log('Buscando cliente Club de Asistencia para el tenant:', tenantId);

      const startTime = Date.now();

      // Buscar cliente Club de Asistencia por RFC único
      const casClient = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId: tenantId,
          rfc: 'CAS981016P46',
          isActive: true,
        },
      });

      const searchDuration = Date.now() - startTime;
      console.log(
        `✅ Cliente Club de Asistencia obtenido en ${searchDuration}ms ${casClient ? '(encontrado)' : '(no encontrado)'}`
      );

      // Fallback: Si no se encuentra por RFC, intentar por nombre exacto
      let casClientFallback = casClient;
      if (!casClientFallback) {
        console.log('⚠️ RFC no encontrado, intentando por nombre exacto...');
        const fallbackStartTime = Date.now();

        casClientFallback = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId: tenantId,
            legalName: 'CLUB DE ASISTENCIA',
            isActive: true,
          },
        });

        const fallbackDuration = Date.now() - fallbackStartTime;
        console.log(
          `✅ Fallback completado en ${fallbackDuration}ms ${casClientFallback ? '(encontrado)' : '(no encontrado)'}`
        );
      }

      if (!casClientFallback) {
        // Si no se encuentra, intentar configurar los clientes predefinidos
        await ctx.reply(
          '⚠️ No se encontró el cliente Club de Asistencia. Intentando configurar clientes predefinidos...'
        );

        try {
          // Importar el servicio de configuración de clientes
          const CustomerSetupService = await import('../../services/customer-setup.service.js');

          // Configurar los clientes predefinidos
          await CustomerSetupService.default.setupPredefinedCustomers(tenantId, true);

          // Buscar nuevamente el cliente
          const casClientAfterSetup = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId: tenantId,
              legalName: 'CLUB DE ASISTENCIA',
              isActive: true,
            },
          });

          if (!casClientAfterSetup) {
            return ctx.reply(
              '❌ Error: No se pudo encontrar o configurar el cliente Club de Asistencia. Por favor, contacta al administrador.'
            );
          }

          // Usar el cliente recién configurado
          ctx.userState.casClientId = casClientAfterSetup.facturapiCustomerId;
          ctx.userState.clienteNombre = casClientAfterSetup.legalName;
          console.log(
            `Cliente Club de Asistencia configurado y encontrado: ${casClientAfterSetup.legalName} (ID: ${casClientAfterSetup.facturapiCustomerId})`
          );
        } catch (setupError) {
          console.error('Error al configurar clientes predefinidos:', setupError);
          return ctx.reply(
            '❌ Error: No se pudo configurar el cliente Club de Asistencia. Por favor, contacta al administrador.'
          );
        }
      } else {
        // Usar el cliente encontrado
        ctx.userState.casClientId = casClientFallback.facturapiCustomerId;
        ctx.userState.clienteNombre = casClientFallback.legalName;
        console.log(
          `Cliente Club de Asistencia cargado exitosamente: ${casClientFallback.legalName} (ID: ${casClientFallback.facturapiCustomerId})`
        );
      }

      // Continuar con el procesamiento normal
      ctx.userState.esperando = 'archivo_excel_club_asistencia';

      await ctx.reply(
        'Por favor, sube el archivo Excel con los datos de Club de Asistencia para generar las facturas.'
      );
    } catch (error) {
      console.error('Error al buscar cliente Club de Asistencia:', error);
      await ctx.reply('❌ Error al buscar cliente Club de Asistencia: ' + error.message);
    }
  });

  // Manejador para servicios con retención
  bot.action('cas_servicios_con_retencion', async (ctx) => {
    const startTime = Date.now();
    console.log('🔵 BOTÓN CON RETENCIÓN: Iniciando...');

    await ctx.answerCbQuery();

    const tempData = global.tempCasData && global.tempCasData[ctx.from.id];
    if (!tempData || !tempData.facturaConRetencion || !tempData.facturaConRetencion.facturaData) {
      console.log('🚨 BOTÓN CON RETENCIÓN: Datos no disponibles');
      return ctx.reply(
        '❌ No hay datos precalculados para generar facturas. Por favor, suba nuevamente el archivo Excel.'
      );
    }

    console.log('🔵 BOTÓN CON RETENCIÓN: TempData OK, preparando respuesta...');

    // Guardar selección en cache global
    if (global.tempCasData && global.tempCasData[ctx.from.id]) {
      global.tempCasData[ctx.from.id].seleccionUsuario = {
        conRetencion: true,
        timestamp: Date.now(),
      };
    }

    // Guardar en userState
    ctx.userState.casConRetencion = true;

    await ctx
      .editMessageReplyMarkup({ inline_keyboard: [] })
      .catch((e) => console.log('No se pudo editar mensaje:', e.message));

    await ctx.reply(
      `✅ *Servicios con Retención seleccionados*\n\n` +
        `• Se aplicará retención del 4%\n` +
        `• ${tempData.facturaConRetencion.items.length} registros\n` +
        `• **Total: $${tempData.facturaConRetencion.total.toFixed(2)}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', 'cas_confirmar_final')],
          [Markup.button.callback('❌ Cancelar', 'cas_cancelar')],
        ]),
      }
    );

    const duration = Date.now() - startTime;
    console.log(`🔵 BOTÓN CON RETENCIÓN: Completado en ${duration}ms`);
  });

  // Manejador para servicios sin retención
  bot.action('cas_servicios_sin_retencion', async (ctx) => {
    const startTime = Date.now();
    console.log('🟡 BOTÓN SIN RETENCIÓN: Iniciando...');

    await ctx.answerCbQuery();

    const tempData = global.tempCasData && global.tempCasData[ctx.from.id];
    if (!tempData || !tempData.facturaSinRetencion || !tempData.facturaSinRetencion.facturaData) {
      console.log('🚨 BOTÓN SIN RETENCIÓN: Datos no disponibles');
      return ctx.reply(
        '❌ No hay datos precalculados para generar facturas. Por favor, suba nuevamente el archivo Excel.'
      );
    }

    console.log('🟡 BOTÓN SIN RETENCIÓN: TempData OK, preparando respuesta...');

    // Guardar selección en cache global
    if (global.tempCasData && global.tempCasData[ctx.from.id]) {
      global.tempCasData[ctx.from.id].seleccionUsuario = {
        conRetencion: false,
        timestamp: Date.now(),
      };
    }

    // Guardar en userState
    ctx.userState.casConRetencion = false;

    await ctx
      .editMessageReplyMarkup({ inline_keyboard: [] })
      .catch((e) => console.log('No se pudo editar mensaje:', e.message));

    await ctx.reply(
      `✅ *Servicios sin Retención seleccionados*\n\n` +
        `• Sin retención\n` +
        `• ${tempData.facturaSinRetencion.items.length} registros\n` +
        `• **Total: $${tempData.facturaSinRetencion.total.toFixed(2)}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', 'cas_confirmar_final')],
          [Markup.button.callback('❌ Cancelar', 'cas_cancelar')],
        ]),
      }
    );

    const duration = Date.now() - startTime;
    console.log(`🟡 BOTÓN SIN RETENCIÓN: Completado en ${duration}ms`);
  });

  // Manejador para confirmar generación
  bot.action('cas_confirmar_final', async (ctx) => {
    const startTime = Date.now();
    console.log('🟢 BOTÓN CONFIRMAR: Iniciando...');

    await ctx.answerCbQuery();

    const facturaProgressMsg = await ctx.reply(
      '⚡ Procesando factura Club de Asistencia...\n⏳ Validando datos precalculados...'
    );

    const tempData = global.tempCasData && global.tempCasData[ctx.from.id];

    if (!tempData || !tempData.facturaConRetencion || !tempData.facturaSinRetencion) {
      console.log('🚨 BOTÓN CONFIRMAR: Datos incompletos');
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        facturaProgressMsg.message_id,
        null,
        '❌ Datos de facturación incompletos. Por favor, suba nuevamente el archivo Excel.'
      );
      return;
    }

    // Obtener selección
    let conRetencion = ctx.userState.casConRetencion;

    if (conRetencion === undefined && tempData.seleccionUsuario) {
      console.log('🟢 BOTÓN CONFIRMAR: Recuperando de cache global');
      conRetencion = tempData.seleccionUsuario.conRetencion;
      ctx.userState.casConRetencion = conRetencion;
    }

    if (conRetencion === undefined) {
      console.log('🚨 BOTÓN CONFIRMAR: No se encontró selección');
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        facturaProgressMsg.message_id,
        null,
        '❌ Tipo de servicio no definido. Por favor, selecciona el tipo de servicio nuevamente.'
      );
      return;
    }

    console.log('🟢 BOTÓN CONFIRMAR: Todas las validaciones pasaron');

    try {
      await ctx
        .editMessageReplyMarkup({ inline_keyboard: [] })
        .catch((e) => console.log('No se pudo editar mensaje:', e.message));

      const facturaData = conRetencion
        ? tempData.facturaConRetencion
        : tempData.facturaSinRetencion;

      console.log(
        `🚀 Usando factura precalculada ${conRetencion ? 'CON' : 'SIN'} retención`
      );

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        facturaProgressMsg.message_id,
        null,
        `⚡ Factura ${conRetencion ? '(con retención 4%)' : '(sin retención)'}...\n` +
          `📊 ${facturaData.items.length} items, Total: $${facturaData.total.toFixed(2)}\n` +
          `🚀 Enviando a FacturAPI...`,
        { parse_mode: 'Markdown' }
      );

      // Envío directo a FacturAPI
      const factura = await enviarFacturaDirectaCas(
        facturaData.facturaData,
        ctx,
        facturaProgressMsg.message_id
      );

      // Resultado final con botones de descarga
      if (factura) {
        await ctx.reply(
          `🎯 *Proceso Club de Asistencia completado exitosamente*\n\n` +
            `✅ Factura generada: ${factura.id}\n` +
            `📊 ${facturaData.items.length} servicios procesados\n` +
            `💰 Total: $${facturaData.total.toFixed(2)}\n` +
            `📋 Folio: ${factura.folio_number}\n\n` +
            `📥 Seleccione una opción para descargar:`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  '📄 Descargar PDF',
                  `pdf_${factura.id}_${factura.folio_number}`
                ),
              ],
              [
                Markup.button.callback(
                  '🔠 Descargar XML',
                  `xml_${factura.id}_${factura.folio_number}`
                ),
              ],
            ]),
          }
        );
      } else {
        await ctx.reply('⚠️ No se generó la factura. Error en FacturAPI.');
      }

      // Limpiar datos temporales
      delete ctx.userState.casSummary;
      delete ctx.userState.casConRetencion;
      if (global.tempCasData && global.tempCasData[ctx.from.id]) {
        delete global.tempCasData[ctx.from.id];
      }
      ctx.userState.esperando = null;

      const duration = Date.now() - startTime;
      console.log(`🟢 BOTÓN CONFIRMAR: Completado en ${duration}ms`);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`🚨 BOTÓN CONFIRMAR: Error después de ${duration}ms:`, error);
      await ctx.reply(`❌ Error al generar factura: ${error.message}`);
      ctx.userState.esperando = null;
    }
  });

  // Manejador para cancelar
  bot.action('cas_cancelar', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx
        .editMessageReplyMarkup({ inline_keyboard: [] })
        .catch((e) => console.log('No se pudo editar mensaje:', e.message));
      await ctx.reply('❌ Operación cancelada. No se generó factura.');

      delete ctx.userState.casSummary;
      delete ctx.userState.casConRetencion;
      if (global.tempCasData && global.tempCasData[ctx.from.id]) {
        delete global.tempCasData[ctx.from.id];
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
    console.log('=========== INICIO HANDLER CLUB ASISTENCIA EXCEL ===========');
    console.log('Documento recibido:', ctx.message.document.file_name);
    console.log('Estado esperando:', ctx.userState?.esperando);

    let receivingMessage = null;

    if (!debeDetectarExcel(ctx, 'club_asistencia')) {
      console.log('No estamos esperando archivo Excel para Club de Asistencia, pasando al siguiente handler');
      console.log('=========== FIN HANDLER CLUB ASISTENCIA EXCEL (PASANDO) ===========');
      return next();
    }

    receivingMessage = await ctx.reply(
      '📥 Recibiendo archivo Excel de Club de Asistencia...\n⏳ Validando archivo...'
    );

    const document = ctx.message.document;

    if (!esArchivoExcelValido(document)) {
      console.log('Documento no es Excel, informando al usuario');
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        receivingMessage.message_id,
        null,
        '❌ El archivo debe ser de tipo Excel (.xlsx o .xls). Por favor, intenta de nuevo.'
      );
      console.log('=========== FIN HANDLER CLUB ASISTENCIA EXCEL (NO ES EXCEL) ===========');
      return;
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      receivingMessage.message_id,
      null,
      `✅ Archivo Excel válido: ${document.file_name}\n⏳ Descargando archivo...`
    );

    try {
      const fileLink = await ctx.telegram.getFileLink(document.file_id);
      const tempDir = ensureTempDirExists();
      const filePath = path.join(tempDir, document.file_name);

      await downloadFile(fileLink.href, filePath);

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        receivingMessage.message_id,
        null,
        `✅ Archivo recibido: ${document.file_name}\n🔍 Validando estructura del Excel...\n⏳ Por favor espere...`
      );

      const result = await procesarArchivoCas(ctx, filePath, receivingMessage.message_id);

      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('Error al eliminar archivo temporal:', e);
      }

      if (!result || !result.pendingConfirmation) {
        ctx.userState.esperando = null;
      }

      console.log('=========== FIN HANDLER CLUB ASISTENCIA EXCEL (PROCESADO) ===========');
    } catch (error) {
      console.error('Error al procesar el archivo Excel:', error);
      ctx.reply(`❌ Error al procesar el archivo: ${error.message}`);
      ctx.userState.esperando = null;
      console.log('=========== FIN HANDLER CLUB ASISTENCIA EXCEL (ERROR) ===========');
    }
  });
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
 * Descarga un archivo desde una URL
 */
async function downloadFile(url, outputPath) {
  const writer = fs.createWriteStream(outputPath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * Procesa el archivo Excel de Club de Asistencia
 */
async function procesarArchivoCas(ctx, filePath, progressMessageId = null) {
  try {
    // PASO 1: Leer archivo Excel
    await updateProgressMessage(
      ctx,
      progressMessageId,
      1,
      6,
      'Leyendo archivo Excel',
      'Cargando datos...'
    );

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // PASO 2: Detectar columnas
    await updateProgressMessage(
      ctx,
      progressMessageId,
      2,
      6,
      'Detectando columnas',
      'Analizando estructura...'
    );

    // PASO 3: Convertir a JSON - IMPORTANTE: empezar desde fila 3 (range: 2)
    await updateProgressMessage(
      ctx,
      progressMessageId,
      3,
      6,
      'Procesando datos',
      'Convirtiendo a formato interno...'
    );

    const data = XLSX.utils.sheet_to_json(worksheet, { range: 1 }); // Fila 2 son encabezados (index 1)

    if (data.length === 0) {
      await updateProgressMessage(ctx, progressMessageId, 6, 6, 'Error: Archivo vacío', '');
      await ctx.reply(
        '❌ El archivo Excel no contiene datos. Por favor, revisa el archivo e intenta de nuevo.'
      );
      return { success: false, error: 'Excel sin datos' };
    }

    // PASO 4: Validar estructura
    await updateProgressMessage(
      ctx,
      progressMessageId,
      4,
      6,
      'Validando estructura',
      `Verificando ${data.length} registros...`
    );

    // Mapear nombres de columnas
    const columnMappings = mapColumnNamesCas(data[0]);

    if (!columnMappings) {
      await updateProgressMessage(
        ctx,
        progressMessageId,
        4,
        6,
        'Error: Estructura inválida',
        'Columnas requeridas faltantes'
      );
      await ctx.reply(
        '❌ El archivo Excel no tiene todas las columnas requeridas. Se necesitan columnas para: Fecha, Folio CAS, PEDIDO SAP y Total.'
      );
      return { success: false, error: 'Estructura de Excel inválida' };
    }

    console.log('Mapeado de columnas Club de Asistencia:', columnMappings);
    console.log('Primeras filas del Excel:', data.slice(0, 2));

    // Verificar valores numéricos
    const erroresNumericos = [];
    data.forEach((row, index) => {
      const total = parseFloat(row[columnMappings.total]);
      if (isNaN(total) || total <= 0) {
        erroresNumericos.push(`Fila ${index + 3}: El total debe ser un número positivo.`);
      }
    });

    if (erroresNumericos.length > 0) {
      const erroresMostrados = erroresNumericos.slice(0, 5);
      await updateProgressMessage(
        ctx,
        progressMessageId,
        4,
        6,
        'Error: Datos numéricos inválidos',
        `${erroresNumericos.length} errores encontrados`
      );
      await ctx.reply(
        `❌ Se encontraron errores en los datos numéricos:\n${erroresMostrados.join('\n')}\n${erroresNumericos.length > 5 ? `...y ${erroresNumericos.length - 5} más.` : ''}`
      );
      return { success: false, error: 'Datos numéricos inválidos' };
    }

    // PASO 5: Calcular totales
    await updateProgressMessage(
      ctx,
      progressMessageId,
      5,
      6,
      'Calculando totales',
      `Procesando ${data.length} registros...`
    );

    // IMPORTANTE: Los valores del Excel incluyen IVA, dividir entre 1.16 para obtener el precio base
    const montoTotal = data.reduce((total, item) => {
      const totalConIva = parseFloat(item[columnMappings.total] || 0);
      const precioBase = totalConIva / 1.16; // Remover IVA
      return total + precioBase;
    }, 0);

    let infoResumen = `📊 Resumen de datos procesados:\n\n`;
    infoResumen += `• Servicios de Club de Asistencia:\n  - ${data.length} registros\n  - Subtotal (sin IVA): ${montoTotal.toFixed(2)} MXN\n\n`;

    ctx.userState.casSummary = {
      totalRecords: data.length,
      totalAmount: montoTotal,
    };

    // PRECÁLCULO de ambas opciones (con/sin retención)
    console.log('🔄 Iniciando precálculo de facturas con y sin retención...');
    const precalculoStartTime = Date.now();

    const baseTaxes = [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }];
    const taxesWithRetention = [
      ...baseTaxes,
      { type: 'IVA', rate: 0.04, factor: 'Tasa', withholding: true },
    ];

    const itemsConRetencion = [];
    const itemsSinRetencion = [];
    let subtotal = 0;

    for (const row of data) {
      const fecha = row[columnMappings.fecha] || '';
      const folioCas = row[columnMappings.folioCas] || '';
      const pedidoSap = row[columnMappings.pedidoSap] || '';
      const totalConIva = parseFloat(row[columnMappings.total]) || 0;

      // IMPORTANTE: Dividir entre 1.16 para obtener el precio base (sin IVA)
      const precioBase = totalConIva / 1.16;

      subtotal += precioBase;

      // Formatear fecha si es necesario
      let fechaFormateada = fecha;
      if (fecha && typeof fecha === 'number') {
        // Excel date serial number
        const date = new Date((fecha - 25569) * 86400 * 1000);
        fechaFormateada = date.toISOString().split('T')[0];
      }

      const itemBase = {
        quantity: 1,
        product: {
          description: `Fecha ${fechaFormateada} Folio CAS ${folioCas} PEDIDO SAP ${pedidoSap}`,
          product_key: CLAVE_SAT_SERVICIOS_GRUA,
          unit_key: 'E48',
          unit_name: 'SERVICIO',
          price: precioBase,
          tax_included: false,
        },
      };

      itemsConRetencion.push({
        ...itemBase,
        product: { ...itemBase.product, taxes: taxesWithRetention },
      });

      itemsSinRetencion.push({
        ...itemBase,
        product: { ...itemBase.product, taxes: baseTaxes },
      });
    }

    const iva16 = subtotal * 0.16;
    const retencion4 = subtotal * 0.04;

    const totalSinRetencion = subtotal + iva16;
    const totalConRetencion = subtotal + iva16 - retencion4;

    const facturaBaseData = {
      customer: ctx.userState.casClientId,
      use: 'G03',
      payment_form: '99',
      payment_method: 'PPD',
      currency: 'MXN',
      exchange: 1,
    };

    const facturaConRetencionData = {
      ...facturaBaseData,
      items: itemsConRetencion,
    };

    const facturaSinRetencionData = {
      ...facturaBaseData,
      items: itemsSinRetencion,
    };

    const precalculoDuration = Date.now() - precalculoStartTime;
    console.log(`✅ Precálculo completado en ${precalculoDuration}ms`);
    console.log(`📊 Subtotal base: $${subtotal.toFixed(2)}`);
    console.log(
      `📊 CON retención: ${itemsConRetencion.length} items, Total: $${totalConRetencion.toFixed(2)}`
    );
    console.log(
      `📊 SIN retención: ${itemsSinRetencion.length} items, Total: $${totalSinRetencion.toFixed(2)}`
    );

    // Guardar datos precalculados en memoria
    global.tempCasData = global.tempCasData || {};
    global.tempCasData[ctx.from.id] = {
      data,
      columnMappings,
      timestamp: Date.now(),
      clientId: ctx.userState.casClientId,
      subtotal: subtotal,
      iva16: iva16,
      retencion4: retencion4,
      facturaConRetencion: {
        items: itemsConRetencion,
        total: totalConRetencion,
        facturaData: facturaConRetencionData,
      },
      facturaSinRetencion: {
        items: itemsSinRetencion,
        total: totalSinRetencion,
        facturaData: facturaSinRetencionData,
      },
    };

    // Limpiar datos antiguos (más de 10 minutos)
    for (const userId in global.tempCasData) {
      if (Date.now() - global.tempCasData[userId].timestamp > 600000) {
        delete global.tempCasData[userId];
      }
    }

    // PASO 6: Completado
    await updateProgressMessage(
      ctx,
      progressMessageId,
      6,
      6,
      'Procesamiento completado',
      `${data.length} registros listos para facturar`
    );

    // Verificar que cache esté listo
    const tempDataCheck = global.tempCasData && global.tempCasData[ctx.from.id];
    if (
      !tempDataCheck ||
      !tempDataCheck.facturaConRetencion ||
      !tempDataCheck.facturaSinRetencion
    ) {
      console.log('🚨 ERROR: Cache global no está listo');
      await ctx.reply(
        '❌ Error interno: Los cálculos no están listos. Por favor, intenta subir el archivo nuevamente.'
      );
      return { success: false, error: 'Cache no listo' };
    }

    console.log('✅ Cache global verificado, mostrando botones');

    await ctx.reply(
      `${infoResumen}\n¿Qué tipo de servicios son?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Con Retención (4%)',
            'cas_servicios_con_retencion'
          ),
        ],
        [
          Markup.button.callback(
            '❌ Sin Retención',
            'cas_servicios_sin_retencion'
          ),
        ],
        [Markup.button.callback('❌ Cancelar', 'cas_cancelar')],
      ])
    );

    return { success: true, pendingConfirmation: true };
  } catch (error) {
    console.error('Error al procesar archivo Excel Club de Asistencia:', error);
    await ctx.reply(`❌ Error al procesar el archivo Excel: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Mapea los nombres de las columnas del Excel de Club de Asistencia
 */
function mapColumnNamesCas(firstRow) {
  if (!firstRow) return null;

  const posiblesColumnas = {
    fecha: ['Fecha', 'FECHA', 'Date'],
    folioCas: ['Folio CAS', 'FOLIO CAS', 'FolioCAS'],
    pedidoSap: ['PEDIDO SAP', 'Pedido SAP', 'PedidoSAP'],
    total: ['Total', 'TOTAL', 'Monto', 'Importe'],
    moneda: ['Moneda', 'MONEDA', 'Currency'],
  };

  const columnMapping = {};

  Object.keys(posiblesColumnas).forEach((tipoColumna) => {
    const nombreEncontrado = posiblesColumnas[tipoColumna].find((posibleNombre) =>
      Object.keys(firstRow).includes(posibleNombre)
    );

    if (nombreEncontrado) {
      columnMapping[tipoColumna] = nombreEncontrado;
    } else {
      const keys = Object.keys(firstRow);
      const matchParcial = keys.find((key) =>
        posiblesColumnas[tipoColumna].some((posibleNombre) =>
          key.toLowerCase().includes(posibleNombre.toLowerCase())
        )
      );

      if (matchParcial) {
        columnMapping[tipoColumna] = matchParcial;
      }
    }
  });

  // Verificar columnas requeridas
  const requiredKeys = ['fecha', 'folioCas', 'pedidoSap', 'total'];
  if (requiredKeys.every((key) => columnMapping[key])) {
    return columnMapping;
  }

  console.log('No se encontraron todas las columnas requeridas:', columnMapping);
  return null;
}

/**
 * Envía factura precalculada directamente a FacturAPI
 */
async function enviarFacturaDirectaCas(facturaData, ctx, progressMessageId = null) {
  try {
    console.log('🚀 Enviando factura precalculada a FacturAPI');
    console.log(`🚀 Items en factura: ${facturaData.items.length}`);

    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      throw new Error('No se pudo obtener el ID del tenant');
    }

    const facturapIService = await import('../../services/facturapi.service.js').then(
      (m) => m.default
    );
    const facturapi = await facturapIService.getFacturapiClient(tenantId);

    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessageId,
        null,
        `🚀 Enviando a FacturAPI...\n📡 Conectando con servidor...`,
        { parse_mode: 'Markdown' }
      );
    }

    console.log('🚀 Enviando solicitud a FacturAPI...');
    const factura = await facturapi.invoices.create(facturaData);

    console.log(`🚀 Factura creada: ${factura.id}`);
    console.log(`🚀 Folio asignado: ${factura.folio_number}`);

    // Registrar factura en BD
    const casCustomerId = await getCasCustomerIdFromDB(tenantId, ctx.userState.casClientId);

    const TenantService = await import('../../services/tenant.service.js').then((m) => m.default);
    await TenantService.registerInvoice(
      tenantId,
      factura.id,
      factura.series,
      factura.folio_number,
      casCustomerId,
      factura.total,
      parseInt(ctx.from.id) <= 2147483647 ? parseInt(ctx.from.id) : null
    );
    console.log('🚀 Factura registrada en BD');

    return factura;
  } catch (error) {
    console.error('🚨 Error al enviar factura a FacturAPI:', error);
    throw error;
  }
}
