// bot/handlers/qualitas.handler.js
import { Markup } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';

// Importar prisma de manera segura
import { prisma as configPrisma } from '../../config/database.js';
import libPrisma from '../../lib/prisma.js';

// Importar utilidades
import { debeDetectarExcel, esArchivoExcelValido } from '../../core/utils/excel-detection.utils.js';
import { cleanupFlowChange } from '../../core/utils/state-cleanup.utils.js';

const prisma = libPrisma || configPrisma;

if (!prisma) {
  console.error('ERROR CRÍTICO: No se pudo inicializar Prisma');
}

// Función helper para obtener customerId de Qualitas desde BD
async function getQualitasCustomerIdFromDB(tenantId, facturapiCustomerId) {
  try {
    const customer = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId,
        facturapiCustomerId,
        rfc: 'QCS931209G49',
      },
      select: { id: true },
    });
    return customer?.id || null;
  } catch (error) {
    console.error('Error obteniendo customerId Qualitas:', error);
    return null;
  }
}

const CLAVE_SAT_SERVICIOS_GRUA = '78101803';

// Utilidades de progreso
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

async function updateProgressMessage(ctx, messageId, step, total, currentTask, details = '') {
  if (!messageId) return;

  const percentage = Math.round((step / total) * 100);
  const progressBarIndex = Math.min(Math.floor((step / total) * 10), 9);
  const frameIndex = step % PROGRESS_FRAMES.length;

  const progressText =
    `${PROGRESS_FRAMES[frameIndex]} **Procesando archivo Qualitas**\n\n` +
    `📊 Progreso: ${percentage}% ${PROGRESS_BARS[progressBarIndex]}\n` +
    `🔄 ${currentTask}\n` +
    (details ? `📝 ${details}\n` : '') +
    `\n⏱️ Por favor espere...`;

  try {
    await ctx.telegram.editMessageText(ctx.chat.id, messageId, null, progressText, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    // Ignorar errores de edición
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Registra los manejadores para Qualitas
 */
export function registerQualitasHandler(bot) {
  console.log('🟢 Registrando handler Qualitas...');

  bot.action('menu_qualitas', async (ctx) => {
    console.log('🟢 ACTION menu_qualitas EJECUTADA!');
    await ctx.answerCbQuery();

    try {
      cleanupFlowChange(ctx, 'qualitas');

      delete ctx.userState.qualitasSummary;
      delete ctx.userState.qualitasClientId;
      delete ctx.userState.clienteId;
      delete ctx.userState.clienteNombre;
      ctx.userState.esperando = null;

      const tenantId = ctx.getTenantId();
      if (!tenantId) {
        return ctx.reply('❌ Error: No se pudo obtener la información de tu empresa.');
      }

      console.log('Buscando cliente Qualitas para el tenant:', tenantId);

      const startTime = Date.now();

      // Buscar por RFC
      const qualitasClient = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId: tenantId,
          rfc: 'QCS931209G49',
          isActive: true,
        },
      });

      const searchDuration = Date.now() - startTime;
      console.log(
        `✅ Cliente Qualitas obtenido en ${searchDuration}ms ${qualitasClient ? '(encontrado)' : '(no encontrado)'}`
      );

      // Fallback por nombre
      let qualitasClientFallback = qualitasClient;
      if (!qualitasClientFallback) {
        qualitasClientFallback = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId: tenantId,
            legalName: { contains: 'QUALITAS', mode: 'insensitive' },
            isActive: true,
          },
        });
      }

      if (!qualitasClientFallback) {
        await ctx.reply(
          '⚠️ No se encontró el cliente Qualitas. Intentando configurar clientes predefinidos...'
        );

        try {
          const CustomerSetupService = await import('../../services/customer-setup.service.js');
          await CustomerSetupService.default.setupPredefinedCustomers(tenantId, true);

          const qualitasClientAfterSetup = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId: tenantId,
              rfc: 'QCS931209G49',
              isActive: true,
            },
          });

          if (!qualitasClientAfterSetup) {
            return ctx.reply(
              '❌ Error: No se pudo encontrar o configurar el cliente Qualitas. Por favor, contacta al administrador.'
            );
          }

          ctx.userState.qualitasClientId = qualitasClientAfterSetup.facturapiCustomerId;
          ctx.userState.clienteNombre = qualitasClientAfterSetup.legalName;
        } catch (setupError) {
          console.error('Error al configurar clientes:', setupError);
          return ctx.reply('❌ Error: No se pudo configurar el cliente Qualitas.');
        }
      } else {
        ctx.userState.qualitasClientId = qualitasClientFallback.facturapiCustomerId;
        ctx.userState.clienteNombre = qualitasClientFallback.legalName;
        console.log(
          `Cliente Qualitas cargado: ${qualitasClientFallback.legalName} (ID: ${qualitasClientFallback.facturapiCustomerId})`
        );
      }

      ctx.userState.esperando = 'archivo_excel_qualitas';

      await ctx.reply(
        'Por favor, sube el archivo Excel con los datos de Qualitas para generar las facturas.'
      );
    } catch (error) {
      console.error('Error al buscar cliente Qualitas:', error);
      await ctx.reply('❌ Error al buscar cliente Qualitas: ' + error.message);
    }
  });

  // Botón con retención
  bot.action('qualitas_con_retencion', async (ctx) => {
    await ctx.answerCbQuery();

    const tempData = global.tempQualitasData && global.tempQualitasData[ctx.from.id];
    if (!tempData || !tempData.facturaConRetencion) {
      return ctx.reply('❌ No hay datos precalculados. Por favor, suba nuevamente el archivo Excel.');
    }

    if (global.tempQualitasData && global.tempQualitasData[ctx.from.id]) {
      global.tempQualitasData[ctx.from.id].seleccionUsuario = {
        conRetencion: true,
        timestamp: Date.now(),
      };
    }

    ctx.userState.qualitasConRetencion = true;

    await ctx
      .editMessageReplyMarkup({ inline_keyboard: [] })
      .catch(() => {});

    await ctx.reply(
      `✅ *Servicios con Retención seleccionados*\n\n` +
        `• Se aplicará retención del 4%\n` +
        `• ${tempData.facturaConRetencion.items.length} registros\n` +
        `• **Total: $${tempData.facturaConRetencion.total.toFixed(2)}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', 'qualitas_confirmar_final')],
          [Markup.button.callback('❌ Cancelar', 'qualitas_cancelar')],
        ]),
      }
    );
  });

  // Botón sin retención
  bot.action('qualitas_sin_retencion', async (ctx) => {
    await ctx.answerCbQuery();

    const tempData = global.tempQualitasData && global.tempQualitasData[ctx.from.id];
    if (!tempData || !tempData.facturaSinRetencion) {
      return ctx.reply('❌ No hay datos precalculados. Por favor, suba nuevamente el archivo Excel.');
    }

    if (global.tempQualitasData && global.tempQualitasData[ctx.from.id]) {
      global.tempQualitasData[ctx.from.id].seleccionUsuario = {
        conRetencion: false,
        timestamp: Date.now(),
      };
    }

    ctx.userState.qualitasConRetencion = false;

    await ctx
      .editMessageReplyMarkup({ inline_keyboard: [] })
      .catch(() => {});

    await ctx.reply(
      `✅ *Servicios sin Retención seleccionados*\n\n` +
        `• Sin retención\n` +
        `• ${tempData.facturaSinRetencion.items.length} registros\n` +
        `• **Total: $${tempData.facturaSinRetencion.total.toFixed(2)}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', 'qualitas_confirmar_final')],
          [Markup.button.callback('❌ Cancelar', 'qualitas_cancelar')],
        ]),
      }
    );
  });

  // Confirmar generación
  bot.action('qualitas_confirmar_final', async (ctx) => {
    await ctx.answerCbQuery();

    const facturaProgressMsg = await ctx.reply(
      '⚡ Procesando factura Qualitas...\n⏳ Validando datos...'
    );

    const tempData = global.tempQualitasData && global.tempQualitasData[ctx.from.id];

    if (!tempData || !tempData.facturaConRetencion || !tempData.facturaSinRetencion) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        facturaProgressMsg.message_id,
        null,
        '❌ Datos incompletos. Por favor, suba nuevamente el archivo Excel.'
      );
      return;
    }

    let conRetencion = ctx.userState.qualitasConRetencion;

    if (conRetencion === undefined && tempData.seleccionUsuario) {
      conRetencion = tempData.seleccionUsuario.conRetencion;
      ctx.userState.qualitasConRetencion = conRetencion;
    }

    if (conRetencion === undefined) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        facturaProgressMsg.message_id,
        null,
        '❌ Tipo de servicio no definido.'
      );
      return;
    }

    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

      const facturaData = conRetencion
        ? tempData.facturaConRetencion
        : tempData.facturaSinRetencion;

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        facturaProgressMsg.message_id,
        null,
        `⚡ Factura ${conRetencion ? '(con retención 4%)' : '(sin retención)'}...\n` +
          `📊 ${facturaData.items.length} items, Total: $${facturaData.total.toFixed(2)}\n` +
          `🚀 Enviando a FacturAPI...`,
        { parse_mode: 'Markdown' }
      );

      const factura = await enviarFacturaDirectaQualitas(
        facturaData.facturaData,
        ctx,
        facturaProgressMsg.message_id
      );

      if (factura) {
        await ctx.reply(
          `🎯 *Proceso Qualitas completado exitosamente*\n\n` +
            `✅ Factura generada: ${factura.id}\n` +
            `📊 ${facturaData.items.length} servicios procesados\n` +
            `💰 Total: $${facturaData.total.toFixed(2)}\n` +
            `📋 Folio: ${factura.folio_number}\n\n` +
            `📥 Seleccione una opción para descargar:`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📄 Descargar PDF', `pdf_${factura.id}_${factura.folio_number}`)],
              [Markup.button.callback('🔠 Descargar XML', `xml_${factura.id}_${factura.folio_number}`)],
            ]),
          }
        );
      } else {
        await ctx.reply('⚠️ No se generó la factura. Error en FacturAPI.');
      }

      delete ctx.userState.qualitasSummary;
      delete ctx.userState.qualitasConRetencion;
      if (global.tempQualitasData && global.tempQualitasData[ctx.from.id]) {
        delete global.tempQualitasData[ctx.from.id];
      }
      ctx.userState.esperando = null;
    } catch (error) {
      console.error('Error al generar factura:', error);
      await ctx.reply(`❌ Error al generar factura: ${error.message}`);
      ctx.userState.esperando = null;
    }
  });

  // Cancelar
  bot.action('qualitas_cancelar', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await ctx.reply('❌ Operación cancelada.');

      delete ctx.userState.qualitasSummary;
      delete ctx.userState.qualitasConRetencion;
      if (global.tempQualitasData && global.tempQualitasData[ctx.from.id]) {
        delete global.tempQualitasData[ctx.from.id];
      }
      ctx.userState.esperando = null;
    } catch (error) {
      console.error('Error al cancelar:', error);
      ctx.userState.esperando = null;
    }
  });

  // Handler de documento Excel
  bot.on('document', async (ctx, next) => {
    console.log('=========== INICIO HANDLER QUALITAS EXCEL ===========');

    if (!debeDetectarExcel(ctx, 'qualitas')) {
      console.log('No es para Qualitas, pasando...');
      return next();
    }

    const receivingMessage = await ctx.reply(
      '📥 Recibiendo archivo Excel de Qualitas...\n⏳ Validando archivo...'
    );

    const document = ctx.message.document;

    if (!esArchivoExcelValido(document)) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        receivingMessage.message_id,
        null,
        '❌ El archivo debe ser de tipo Excel (.xlsx o .xls).'
      );
      return;
    }

    try {
      const fileLink = await ctx.telegram.getFileLink(document.file_id);
      const tempDir = ensureTempDirExists();
      const filePath = path.join(tempDir, document.file_name);

      await downloadFile(fileLink.href, filePath);

      const result = await procesarArchivoQualitas(ctx, filePath, receivingMessage.message_id);

      fs.unlinkSync(filePath);

      if (!result || !result.pendingConfirmation) {
        ctx.userState.esperando = null;
      }

      console.log('=========== FIN HANDLER QUALITAS EXCEL ===========');
    } catch (error) {
      console.error('Error al procesar Excel:', error);
      ctx.reply(`❌ Error: ${error.message}`);
      ctx.userState.esperando = null;
    }
  });
}

function ensureTempDirExists() {
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

async function downloadFile(url, outputPath) {
  const writer = fs.createWriteStream(outputPath);
  const response = await axios({ url, method: 'GET', responseType: 'stream' });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * Procesa Excel de Qualitas con estructura de 3 líneas por servicio
 */
async function procesarArchivoQualitas(ctx, filePath, progressMessageId = null) {
  try {
    await updateProgressMessage(ctx, progressMessageId, 1, 6, 'Leyendo archivo Excel');

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    await updateProgressMessage(ctx, progressMessageId, 2, 6, 'Analizando estructura');

    // Leer TODO el contenido como array de arrays (no JSON)
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    console.log('Total de filas en Excel:', rawData.length);
    console.log('Primeras 10 filas:', rawData.slice(0, 10));

    await updateProgressMessage(ctx, progressMessageId, 3, 6, 'Agrupando servicios');

    // Agrupar en servicios de 3 líneas
    const servicios = [];

    for (let i = 0; i < rawData.length; i++) {
      const fila = rawData[i];
      const primeraCelda = String(fila[0] || '').trim();

      // Detectar inicio de servicio: empieza con 25GA o 25GB
      if (primeraCelda.startsWith('25GA') || primeraCelda.startsWith('25GB')) {
        const folio = primeraCelda;

        // Verificar que hay al menos 3 líneas más
        if (i + 2 >= rawData.length) {
          console.log(`⚠️ Servicio incompleto en fila ${i}, saltando`);
          continue;
        }

        const siniestro = String(rawData[i + 1][0] || '').trim();
        const lineaDatos = rawData[i + 2];

        // Parsear línea de datos (buscar el primer $ para separar)
        const lineaCompleta = lineaDatos.join(' '); // Unir todas las celdas
        const partes = lineaCompleta.split('$').filter(p => p.trim());

        if (partes.length < 2) {
          console.log(`⚠️ No se pudo parsear datos en fila ${i + 2}:`, lineaCompleta);
          continue;
        }

        const reporte = partes[0].trim();
        const subtotalStr = partes[1].trim().replace(/,/g, ''); // Remover comas
        const subtotal = parseFloat(subtotalStr);

        if (isNaN(subtotal) || subtotal <= 0) {
          console.log(`⚠️ Subtotal inválido: ${subtotalStr}`);
          continue;
        }

        servicios.push({
          folio,
          siniestro,
          reporte,
          subtotal,
        });

        console.log(`✅ Servicio ${servicios.length}: Folio ${folio}, Subtotal $${subtotal.toFixed(2)}`);

        // Saltar las 2 líneas siguientes (ya procesadas)
        i += 2;
      }
    }

    console.log(`📊 Total de servicios detectados: ${servicios.length}`);

    if (servicios.length === 0) {
      await ctx.reply('❌ No se encontraron servicios válidos en el Excel.');
      return { success: false, error: 'Sin servicios válidos' };
    }

    await updateProgressMessage(
      ctx,
      progressMessageId,
      4,
      6,
      'Validando datos',
      `${servicios.length} servicios encontrados`
    );

    // Calcular total
    const montoTotal = servicios.reduce((sum, s) => sum + s.subtotal, 0);

    let infoResumen = `📊 Resumen de datos procesados:\n\n`;
    infoResumen += `• Servicios de Qualitas:\n  - ${servicios.length} registros\n  - Subtotal: ${montoTotal.toFixed(2)} MXN\n\n`;

    ctx.userState.qualitasSummary = {
      totalRecords: servicios.length,
      totalAmount: montoTotal,
    };

    await updateProgressMessage(ctx, progressMessageId, 5, 6, 'Calculando totales');

    // Precalcular facturas
    const baseTaxes = [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }];
    const taxesWithRetention = [
      ...baseTaxes,
      { type: 'IVA', rate: 0.04, factor: 'Tasa', withholding: true },
    ];

    const itemsConRetencion = [];
    const itemsSinRetencion = [];
    let subtotal = 0;

    for (const servicio of servicios) {
      subtotal += servicio.subtotal;

      const itemBase = {
        quantity: 1,
        product: {
          description: `Folio ${servicio.folio} Siniestro ${servicio.siniestro} Reporte ${servicio.reporte}`,
          product_key: CLAVE_SAT_SERVICIOS_GRUA,
          unit_key: 'E48',
          unit_name: 'SERVICIO',
          price: servicio.subtotal,
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
      customer: ctx.userState.qualitasClientId,
      use: 'G03',
      payment_form: '99',
      payment_method: 'PPD',
      currency: 'MXN',
      exchange: 1,
    };

    // Guardar en cache global
    global.tempQualitasData = global.tempQualitasData || {};
    global.tempQualitasData[ctx.from.id] = {
      servicios,
      timestamp: Date.now(),
      clientId: ctx.userState.qualitasClientId,
      subtotal: subtotal,
      iva16: iva16,
      retencion4: retencion4,
      facturaConRetencion: {
        items: itemsConRetencion,
        total: totalConRetencion,
        facturaData: { ...facturaBaseData, items: itemsConRetencion },
      },
      facturaSinRetencion: {
        items: itemsSinRetencion,
        total: totalSinRetencion,
        facturaData: { ...facturaBaseData, items: itemsSinRetencion },
      },
    };

    // Limpiar cache antiguo
    for (const userId in global.tempQualitasData) {
      if (Date.now() - global.tempQualitasData[userId].timestamp > 600000) {
        delete global.tempQualitasData[userId];
      }
    }

    await updateProgressMessage(
      ctx,
      progressMessageId,
      6,
      6,
      'Procesamiento completado',
      `${servicios.length} registros listos`
    );

    console.log(`✅ Subtotal: $${subtotal.toFixed(2)}`);
    console.log(`✅ CON retención: $${totalConRetencion.toFixed(2)}`);
    console.log(`✅ SIN retención: $${totalSinRetencion.toFixed(2)}`);

    await ctx.reply(
      `${infoResumen}\n¿Qué tipo de servicios son?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Con Retención (4%)', 'qualitas_con_retencion')],
        [Markup.button.callback('❌ Sin Retención', 'qualitas_sin_retencion')],
        [Markup.button.callback('❌ Cancelar', 'qualitas_cancelar')],
      ])
    );

    return { success: true, pendingConfirmation: true };
  } catch (error) {
    console.error('Error al procesar Excel Qualitas:', error);
    await ctx.reply(`❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Envía factura a FacturAPI
 */
async function enviarFacturaDirectaQualitas(facturaData, ctx, progressMessageId = null) {
  try {
    console.log('🚀 Enviando factura Qualitas a FacturAPI');

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
        `🚀 Enviando a FacturAPI...\n📡 Conectando...`,
        { parse_mode: 'Markdown' }
      );
    }

    const factura = await facturapi.invoices.create(facturaData);

    console.log(`🚀 Factura creada: ${factura.id}`);
    console.log(`🚀 Folio: ${factura.folio_number}`);

    // Registrar en BD
    const qualitasCustomerId = await getQualitasCustomerIdFromDB(
      tenantId,
      ctx.userState.qualitasClientId
    );

    const TenantService = await import('../../services/tenant.service.js').then((m) => m.default);
    await TenantService.registerInvoice(
      tenantId,
      factura.id,
      factura.series,
      factura.folio_number,
      qualitasCustomerId,
      factura.total,
      parseInt(ctx.from.id) <= 2147483647 ? parseInt(ctx.from.id) : null
    );

    console.log('🚀 Factura registrada en BD');

    return factura;
  } catch (error) {
    console.error('🚨 Error al enviar factura:', error);
    throw error;
  }
}
