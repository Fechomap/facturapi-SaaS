// bot/handlers/escotel.handler.js
import { Markup } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import archiver from 'archiver';
import { fileURLToPath } from 'url';

// Importar prisma de manera segura
import { prisma as configPrisma } from '../../config/database.js';
import libPrisma from '../../lib/prisma.js';

// Importar utilidades
import { debeDetectarExcel, esArchivoExcelValido } from '../../core/utils/excel-detection.utils.js';
import { cleanupFlowChange } from '../../core/utils/state-cleanup.utils.js';

// Importar servicios
import FacturapiService from '../../services/facturapi.service.js';
import TenantService from '../../core/tenant/tenant.service.js';

// Usar la instancia que esté disponible
const prisma = libPrisma || configPrisma;

if (!prisma) {
  console.error('ERROR CRÍTICO: No se pudo inicializar Prisma');
}

// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constantes
const CLAVE_SAT_SERVICIOS_GRUA = '78101803';
const RFC_ESCOTEL = 'EEC081222FH8';

// Cache global para datos temporales de ESCOTEL
global.tempEscotelData = global.tempEscotelData || {};

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
    `${PROGRESS_FRAMES[frameIndex]} **Procesando archivo ESCOTEL**\n\n` +
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

/**
 * Procesa una hoja específica del Excel de ESCOTEL
 * @returns {Object} - { servicios: [], totales: {}, totalEsperado } o null si no hay servicios
 */
function procesarHojaEscotel(worksheet, sheetName) {
  // Convertir a array de arrays (toda la columna A)
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  // CRÍTICO: Extraer el total esperado de la fila 20 (índice 19)
  const totalEsperadoExcel = data[19] && data[19][0] ? parseFloat(data[19][0]) : null;

  // Buscar todos los servicios (cualquier patrón: LETRAS/NUMEROS_NUMEROS)
  const idPattern = /^[A-Z0-9]+_\d+$/i;
  const servicios = [];

  for (let index = 0; index < data.length; index++) {
    const cellValue = String(data[index][0] || '').trim();

    if (idPattern.test(cellValue)) {
      // Extraer datos del servicio (siguiente 8 filas)
      const servicio = {
        id: data[index][0],
        claveSat: data[index + 1] ? data[index + 1][0] : null,
        descripcion: data[index + 2] ? data[index + 2][0] : null,
        ubicacion: data[index + 3] ? data[index + 3][0] : null,
        subtotal: data[index + 4] ? parseFloat(data[index + 4][0]) : 0,
        iva: data[index + 5] ? parseFloat(data[index + 5][0]) : 0,
        retencion: data[index + 6] ? parseFloat(data[index + 6][0]) : 0,
        total: data[index + 8] ? parseFloat(data[index + 8][0]) : 0,
      };

      // Validar que tenga datos válidos
      if (servicio.subtotal > 0) {
        servicios.push(servicio);
      }
    }
  }

  // Si no hay servicios en esta hoja, retornar null
  if (servicios.length === 0) {
    return null;
  }

  // Calcular totales de esta hoja
  const subtotalTotal = servicios.reduce((sum, s) => sum + s.subtotal, 0);
  const ivaTotal = servicios.reduce((sum, s) => sum + s.iva, 0);
  const retencionTotal = servicios.reduce((sum, s) => sum + s.retencion, 0);
  const totalFinal = subtotalTotal + ivaTotal - retencionTotal;

  // Calcular discrepancia
  const discrepancia = totalEsperadoExcel ? totalFinal - totalEsperadoExcel : 0;
  const tieneDiscrepancia = totalEsperadoExcel && Math.abs(discrepancia) > 0.01; // Tolerancia de 1 centavo

  return {
    nombreHoja: sheetName,
    servicios,
    totales: {
      subtotal: subtotalTotal,
      iva: ivaTotal,
      retencion: retencionTotal,
      total: totalFinal,
    },
    totalEsperadoExcel: totalEsperadoExcel,
    discrepancia: discrepancia,
    tieneDiscrepancia: tieneDiscrepancia,
  };
}

/**
 * Parsea el archivo Excel de ESCOTEL con múltiples hojas
 * Cada hoja representa una factura independiente
 */
async function procesarArchivoEscotel(ctx, filePath, progressMessageId) {
  try {
    await updateProgressMessage(ctx, progressMessageId, 1, 6, 'Leyendo archivo Excel...');

    // Leer el archivo Excel
    const workbook = XLSX.readFile(filePath);
    const totalHojas = workbook.SheetNames.length;

    await updateProgressMessage(
      ctx,
      progressMessageId,
      2,
      6,
      'Analizando estructura del archivo...',
      `${totalHojas} hojas detectadas`
    );

    // Procesar todas las hojas
    const hojasConDatos = [];
    const hojasVacias = [];

    for (let i = 0; i < workbook.SheetNames.length; i++) {
      const sheetName = workbook.SheetNames[i];
      const worksheet = workbook.Sheets[sheetName];
      const hojaData = procesarHojaEscotel(worksheet, sheetName);

      if (hojaData) {
        hojasConDatos.push(hojaData);
      } else {
        hojasVacias.push(sheetName);
      }
    }

    if (hojasConDatos.length === 0) {
      throw new Error('No se encontraron servicios válidos en ninguna hoja del Excel');
    }

    const totalServicios = hojasConDatos.reduce((sum, hoja) => sum + hoja.servicios.length, 0);

    await updateProgressMessage(
      ctx,
      progressMessageId,
      3,
      6,
      'Procesando hojas...',
      `${hojasConDatos.length} hojas con datos | ${totalServicios} servicios totales`
    );

    // Buscar el cliente ESCOTEL en la base de datos
    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      throw new Error('No se encontró el tenant asociado');
    }

    let clienteFallback = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId,
        rfc: RFC_ESCOTEL,
        isActive: true,
      },
    });

    // Si no existe, configurar cliente
    if (!clienteFallback) {
      await ctx.reply('⚠️ Cliente ESCOTEL no encontrado. Configurando automáticamente...');

      const CustomerSetupService = await import('../../services/customer-setup.service.js');
      await CustomerSetupService.default.setupPredefinedCustomers(tenantId, false);

      clienteFallback = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          rfc: RFC_ESCOTEL,
          isActive: true,
        },
      });

      if (!clienteFallback) {
        throw new Error(
          'No se pudo configurar el cliente ESCOTEL. Por favor, configúralo manualmente.'
        );
      }
    }

    await updateProgressMessage(
      ctx,
      progressMessageId,
      4,
      6,
      'Preparando facturas...',
      `Cliente: ${clienteFallback.legalName} | ${hojasConDatos.length} facturas`
    );

    // Preparar una factura por cada hoja
    const facturasData = hojasConDatos.map((hoja) => {
      // Crear items para esta factura
      const items = hoja.servicios.map((servicio) => {
        // Determinar si tiene retención
        const tieneRetencion = servicio.retencion > 0;

        // Construir descripción detallada
        const descripcion = `AMPARA ID: ${servicio.id} - ${servicio.descripcion} - ${servicio.ubicacion}`;

        // Construir taxes
        const taxes = [
          {
            type: 'IVA',
            rate: 0.16,
            factor: 'Tasa',
            withholding: false,
          },
        ];

        // Agregar retención si existe
        if (tieneRetencion) {
          taxes.push({
            type: 'IVA',
            rate: 0.04,
            factor: 'Tasa',
            withholding: true,
          });
        }

        return {
          quantity: 1,
          product: {
            description: descripcion,
            product_key: CLAVE_SAT_SERVICIOS_GRUA,
            unit_key: 'E48',
            unit_name: 'SERVICIO',
            price: servicio.subtotal,
            tax_included: false,
            taxes: taxes,
          },
        };
      });

      // Preparar datos de la factura
      return {
        nombreHoja: hoja.nombreHoja,
        facturaData: {
          customer: clienteFallback.facturapiCustomerId,
          items: items,
          use: 'G03',
          payment_form: '99',
          payment_method: 'PPD',
          currency: 'MXN',
          exchange: 1,
        },
        servicios: hoja.servicios,
        totales: hoja.totales,
        totalEsperadoExcel: hoja.totalEsperadoExcel,
        discrepancia: hoja.discrepancia,
        tieneDiscrepancia: hoja.tieneDiscrepancia,
      };
    });

    await updateProgressMessage(
      ctx,
      progressMessageId,
      5,
      6,
      'Finalizando...',
      'Preparando confirmación'
    );

    // Guardar en cache global
    global.tempEscotelData[ctx.from.id] = {
      facturas: facturasData,
      clienteId: clienteFallback.id,
      clienteFacturapiId: clienteFallback.facturapiCustomerId,
      clienteName: clienteFallback.legalName,
      totalHojas: hojasConDatos.length,
      totalHojasExcel: workbook.SheetNames.length,
      totalHojasVacias: hojasVacias.length,
      totalServicios: totalServicios,
      hojasConDiscrepancia: facturasData.filter((f) => f.tieneDiscrepancia),
      timestamp: Date.now(),
    };

    // Limpiar datos antiguos del cache (más de 10 minutos)
    for (const userId in global.tempEscotelData) {
      if (Date.now() - global.tempEscotelData[userId].timestamp > 600000) {
        delete global.tempEscotelData[userId];
      }
    }

    return { success: true, hojas: hojasConDatos.length, servicios: totalServicios };
  } catch (error) {
    console.error('Error procesando archivo ESCOTEL:', error);
    throw error;
  }
}

/**
 * Genera un Excel de reporte con el mapeo pedido-factura
 * @param {Array} facturasGeneradas - Array de facturas generadas
 * @param {string} clienteName - Nombre del cliente
 * @returns {Buffer} - Buffer del archivo Excel
 */
function generarReporteExcel(facturasGeneradas, clienteName) {
  // Crear un nuevo workbook
  const wb = XLSX.utils.book_new();

  // Preparar los datos para el Excel
  const data = [
    // Encabezados
    [
      'No.',
      'Número de Pedido',
      'Serie',
      'Folio',
      'Total Facturado',
      'Servicios',
      'Total Excel',
      'Discrepancia',
      'Estado',
    ],
  ];

  // Agregar cada factura
  facturasGeneradas.forEach((f, index) => {
    const estado = f.tieneDiscrepancia ? 'ALERTA' : 'OK';
    const discrepanciaTexto = f.tieneDiscrepancia
      ? `$${f.discrepancia.toFixed(2)}`
      : 'Sin diferencia';

    data.push([
      index + 1, // No.
      f.nombreHoja, // Número de Pedido (nombre de la hoja)
      f.factura.series, // Serie
      f.factura.folio_number, // Folio
      f.totales.total, // Total Facturado
      f.servicios, // Cantidad de servicios
      f.totalEsperadoExcel || f.totales.total, // Total Excel
      discrepanciaTexto, // Discrepancia
      estado, // Estado
    ]);
  });

  // Agregar totales al final
  const totalGeneral = facturasGeneradas.reduce((sum, f) => sum + f.totales.total, 0);
  const totalServicios = facturasGeneradas.reduce((sum, f) => sum + f.servicios, 0);
  const totalDiscrepancias = facturasGeneradas.filter((f) => f.tieneDiscrepancia).length;

  data.push([]);
  data.push([
    'TOTALES',
    '',
    '',
    `${facturasGeneradas.length} facturas`,
    totalGeneral,
    totalServicios,
    '',
    `${totalDiscrepancias} con diferencias`,
    '',
  ]);

  // Crear la hoja
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Configurar anchos de columna
  ws['!cols'] = [
    { wch: 5 }, // No.
    { wch: 18 }, // Número de Pedido
    { wch: 8 }, // Serie
    { wch: 10 }, // Folio
    { wch: 15 }, // Total Facturado
    { wch: 10 }, // Servicios
    { wch: 15 }, // Total Excel
    { wch: 18 }, // Discrepancia
    { wch: 10 }, // Estado
  ];

  // Agregar la hoja al workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte Facturas');

  // Agregar metadatos
  wb.Props = {
    Title: `Reporte Facturas ESCOTEL - ${clienteName}`,
    Subject: 'Mapeo de pedidos y facturas',
    Author: 'Sistema de Facturación',
    CreatedDate: new Date(),
  };

  // Generar el buffer
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Envía múltiples facturas a FacturAPI (una por hoja)
 */
async function enviarFacturasEscotel(ctx) {
  try {
    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      throw new Error('No se encontró el tenant asociado');
    }

    const escotelData = global.tempEscotelData[ctx.from.id];
    if (!escotelData) {
      throw new Error('No se encontraron datos de ESCOTEL en cache');
    }

    // Obtener cliente de FacturAPI
    const facturapi = await FacturapiService.getFacturapiClient(tenantId);

    await ctx.reply(
      `📤 Generando ${escotelData.totalHojas} facturas en FacturAPI...\n⏱️ Por favor espere...`
    );

    const facturasGeneradas = [];
    const errores = [];

    // Generar cada factura
    for (let i = 0; i < escotelData.facturas.length; i++) {
      const facturaInfo = escotelData.facturas[i];

      try {
        // Crear la factura
        const factura = await FacturapiService.createInvoiceQueued(
          facturapi,
          facturaInfo.facturaData,
          tenantId
        );

        // Registrar en BD
        await TenantService.registerInvoice(
          tenantId,
          factura.id,
          factura.series,
          factura.folio_number,
          escotelData.clienteId,
          factura.total,
          parseInt(ctx.from.id) <= 2147483647 ? parseInt(ctx.from.id) : null
        );

        facturasGeneradas.push({
          nombreHoja: facturaInfo.nombreHoja,
          factura: factura,
          servicios: facturaInfo.servicios.length,
          totales: facturaInfo.totales,
          totalEsperadoExcel: facturaInfo.totalEsperadoExcel,
          discrepancia: facturaInfo.discrepancia,
          tieneDiscrepancia: facturaInfo.tieneDiscrepancia,
        });

        // Actualizar progreso cada 5 facturas
        if ((i + 1) % 5 === 0 || i + 1 === escotelData.facturas.length) {
          await ctx.reply(
            `⏳ Progreso: ${i + 1}/${escotelData.facturas.length} facturas generadas...`
          );
        }
      } catch (error) {
        console.error(`Error al generar factura para hoja ${facturaInfo.nombreHoja}:`, error);
        errores.push({
          nombreHoja: facturaInfo.nombreHoja,
          error: error.message,
        });
      }
    }

    // Limpiar datos del cache
    delete global.tempEscotelData[ctx.from.id];

    // Mostrar resumen
    if (facturasGeneradas.length > 0) {
      let resumenText =
        `✅ **Facturas ESCOTEL generadas exitosamente**\n\n` +
        `🏢 Cliente: ${escotelData.clienteName}\n` +
        `📊 Total: ${facturasGeneradas.length} facturas generadas\n` +
        `📦 Servicios totales: ${escotelData.totalServicios}\n\n`;

      if (errores.length > 0) {
        resumenText += `⚠️ ${errores.length} facturas con errores en generación\n\n`;
      }

      // Detectar discrepancias en facturas generadas
      const facturasConDiscrepancia = facturasGeneradas.filter((f) => f.tieneDiscrepancia);

      if (facturasConDiscrepancia.length > 0) {
        resumenText += `⚠️ **DISCREPANCIAS DETECTADAS: ${facturasConDiscrepancia.length} facturas**\n\n`;
        resumenText += `📋 **Facturas con diferencias (Excel vs Facturado):**\n`;

        facturasConDiscrepancia.forEach((f, idx) => {
          const signo = f.discrepancia > 0 ? '+' : '';
          resumenText += `${idx + 1}. Hoja ${f.nombreHoja} (Folio ${f.factura.folio_number}): Excel $${f.totalEsperadoExcel.toFixed(2)} vs Facturado $${f.totales.total.toFixed(2)} = ${signo}$${f.discrepancia.toFixed(2)}\n`;
        });

        resumenText += `\n✅ Facturas sin discrepancias: ${facturasGeneradas.length - facturasConDiscrepancia.length}\n`;
      } else {
        resumenText += `✅ **Sin discrepancias**\n\nTodas las facturas generadas coinciden con los totales del Excel.\n`;
      }

      await ctx.reply(resumenText, { parse_mode: 'Markdown' });

      // Crear botones de descarga para las primeras 5 facturas
      const downloadButtons = [];
      const facturasConBotones = facturasGeneradas.slice(0, 5);

      facturasConBotones.forEach((f) => {
        downloadButtons.push([
          Markup.button.callback(
            `📄 PDF Hoja ${f.nombreHoja}`,
            `pdf_${f.factura.id}_${f.factura.folio_number}`
          ),
          Markup.button.callback(
            `🔠 XML Hoja ${f.nombreHoja}`,
            `xml_${f.factura.id}_${f.factura.folio_number}`
          ),
        ]);
      });

      downloadButtons.push([Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]);

      // Agregar botones de descarga masiva en ZIP
      const botonesZip = [
        [
          Markup.button.callback('📦 Descargar Todos los PDFs (ZIP)', 'escotel_download_pdfs_zip'),
          Markup.button.callback('🗂️ Descargar Todos los XMLs (ZIP)', 'escotel_download_xmls_zip'),
        ],
        [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
      ];

      await ctx.reply(
        `📥 **Opciones de descarga:**\n\n` +
          `💡 Los ZIPs incluyen automáticamente el reporte Excel con el mapeo:\n` +
          `   • Número de Pedido → Serie/Folio\n` +
          `   • Totales y discrepancias`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(botonesZip),
        }
      );

      // Guardar facturas en userState para descarga posterior
      ctx.userState.escotelInvoiceResults = facturasGeneradas.map((f) => ({
        nombreHoja: f.nombreHoja,
        invoice: {
          id: f.factura.id,
          series: f.factura.series,
          folio_number: f.factura.folio_number,
          total: f.factura.total,
        },
        servicios: f.servicios,
        totales: f.totales,
        totalEsperadoExcel: f.totalEsperadoExcel,
        discrepancia: f.discrepancia,
        tieneDiscrepancia: f.tieneDiscrepancia,
      }));

      // Generar y enviar el reporte Excel
      try {
        const reporteBuffer = generarReporteExcel(facturasGeneradas, escotelData.clienteName);
        const timestamp = Date.now();
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        const reportePath = path.join(tempDir, `reporte_escotel_${timestamp}.xlsx`);
        fs.writeFileSync(reportePath, reporteBuffer);

        await ctx.replyWithDocument(
          {
            source: reportePath,
            filename: `REPORTE_FACTURAS_ESCOTEL_${timestamp}.xlsx`,
          },
          {
            caption:
              `📊 **Reporte de Facturas ESCOTEL**\n\n` +
              `📋 ${facturasGeneradas.length} facturas generadas\n` +
              `✅ Este archivo contiene el mapeo completo:\n` +
              `   • Número de Pedido → Serie/Folio\n` +
              `   • Totales facturados\n` +
              `   • Discrepancias detectadas`,
            parse_mode: 'Markdown',
          }
        );

        // Limpiar archivo temporal después de 2 minutos
        setTimeout(
          () => {
            try {
              if (fs.existsSync(reportePath)) {
                fs.unlinkSync(reportePath);
                console.log(`🗑️ Reporte Excel temporal eliminado: ${path.basename(reportePath)}`);
              }
            } catch (error) {
              console.error(`Error eliminando reporte ${reportePath}:`, error.message);
            }
          },
          2 * 60 * 1000
        );
      } catch (error) {
        console.error('Error generando reporte Excel:', error);
        await ctx.reply('⚠️ Las facturas se generaron correctamente, pero hubo un error al crear el reporte Excel.');
      }
    }

    if (errores.length > 0) {
      let errorText = `⚠️ **Errores en ${errores.length} facturas:**\n\n`;
      errores.slice(0, 5).forEach((e) => {
        errorText += `• Hoja ${e.nombreHoja}: ${e.error.substring(0, 50)}...\n`;
      });

      await ctx.reply(errorText, { parse_mode: 'Markdown' });
    }

    return { success: true, generadas: facturasGeneradas.length, errores: errores.length };
  } catch (error) {
    console.error('Error al enviar facturas ESCOTEL:', error);

    const errorMsg = error.response?.data?.message || error.message || 'Error desconocido';
    const shortError = errorMsg.length > 200 ? errorMsg.substring(0, 200) + '...' : errorMsg;

    await ctx.reply(
      `❌ **Error al generar las facturas**\n\n` +
        `${shortError}\n\n` +
        `Por favor, verifica los datos e inténtalo nuevamente.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al menú', 'menu_principal')]]),
      }
    );

    throw error;
  }
}

/**
 * Registra los manejadores para la funcionalidad ESCOTEL
 * @param {Object} bot - Instancia del bot de Telegram
 */
export function registerEscotelHandler(bot) {
  console.log('📝 Registrando handler de ESCOTEL...');

  // 1. ACTION: Menú de ESCOTEL - Iniciar flujo
  bot.action('menu_escotel', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      // Limpiar estado anterior
      cleanupFlowChange(ctx, 'escotel');

      const tenantId = ctx.getTenantId();
      if (!tenantId) {
        return ctx.reply('❌ Error: No se encontró tu tenant. Por favor, contacta al soporte.');
      }

      // Buscar el cliente ESCOTEL
      let clienteFallback = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          rfc: RFC_ESCOTEL,
          isActive: true,
        },
      });

      // Si no existe, configurar cliente
      if (!clienteFallback) {
        await ctx.reply('⚠️ Cliente ESCOTEL no encontrado. Configurando automáticamente...');

        const CustomerSetupService = await import('../../services/customer-setup.service.js');
        await CustomerSetupService.default.setupPredefinedCustomers(tenantId, false);

        clienteFallback = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId,
            rfc: RFC_ESCOTEL,
            isActive: true,
          },
        });

        if (clienteFallback) {
          await ctx.reply('✅ Cliente ESCOTEL configurado correctamente');
        } else {
          return ctx.reply(
            '❌ No se pudo configurar el cliente ESCOTEL. Por favor, usa el comando /configure_clients para configurar los clientes predefinidos.',
            Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al menú', 'menu_principal')]])
          );
        }
      }

      // Marcar que estamos esperando el archivo Excel de ESCOTEL
      ctx.userState = ctx.userState || {};
      ctx.userState.esperando = 'archivo_excel_escotel';

      await ctx.reply(
        `📋 **Cliente ESCOTEL seleccionado**\n\n` +
          `🏢 ${clienteFallback.legalName}\n` +
          `🆔 RFC: ${clienteFallback.rfc}\n\n` +
          `📤 Por favor, envía el archivo Excel con los datos de los servicios.\n\n` +
          `📝 **Formato esperado:**\n` +
          `• Columna A con datos de servicios\n` +
          `• Cada servicio debe incluir: ID, descripción, ubicación, costos e impuestos\n` +
          `• Los valores de IVA y retención deben estar precalculados\n\n` +
          `⏱️ Esperando archivo...`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'menu_principal')]]),
        }
      );
    } catch (error) {
      console.error('Error en menu_escotel:', error);
      await ctx.reply('❌ Ocurrió un error. Por favor, intenta nuevamente.');
    }
  });

  // 2. ACTION: Confirmar facturas
  bot.action('escotel_confirmar_facturas', async (ctx) => {
    try {
      await ctx.answerCbQuery();

      const userId = ctx.from.id;
      const escotelData = global.tempEscotelData[userId];

      if (!escotelData) {
        return ctx.reply(
          '❌ Los datos han expirado. Por favor, sube el archivo nuevamente.',
          Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al menú', 'menu_principal')]])
        );
      }

      // Enviar todas las facturas
      await enviarFacturasEscotel(ctx);
    } catch (error) {
      console.error('Error al confirmar facturas ESCOTEL:', error);
      await ctx.reply(
        '❌ Ocurrió un error al generar las facturas. Por favor, intenta nuevamente.',
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al menú', 'menu_principal')]])
      );
    }
  });

  // 3. HANDLER: Procesamiento de archivo Excel
  bot.on('document', async (ctx, next) => {
    try {
      // Verificar si debe detectar este archivo
      if (!debeDetectarExcel(ctx, 'escotel')) {
        return next();
      }

      const document = ctx.message.document;

      // Validar que sea un archivo Excel
      if (!esArchivoExcelValido(document)) {
        await ctx.reply(
          '❌ El archivo debe ser un Excel (.xlsx o .xls)',
          Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al menú', 'menu_principal')]])
        );
        return;
      }

      // Mensaje de progreso inicial
      const progressMessage = await ctx.reply('⏳ Descargando archivo...');
      const progressMessageId = progressMessage.message_id;

      // Descargar el archivo
      const fileLink = await ctx.telegram.getFileLink(document.file_id);
      const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });

      // Guardar temporalmente
      const tempDir = path.join(__dirname, '../../temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const fileName = `escotel_${ctx.from.id}_${Date.now()}.xlsx`;
      const filePath = path.join(tempDir, fileName);
      fs.writeFileSync(filePath, response.data);

      // Procesar el archivo
      const result = await procesarArchivoEscotel(ctx, filePath, progressMessageId);

      // Eliminar archivo temporal
      fs.unlinkSync(filePath);

      // Eliminar mensaje de progreso
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, progressMessageId);
      } catch (e) {
        console.log('No se pudo eliminar mensaje de progreso');
      }

      if (result.success) {
        const escotelData = global.tempEscotelData[ctx.from.id];

        // Calcular totales generales
        const totalGeneral = escotelData.facturas.reduce((sum, f) => sum + f.totales.total, 0);
        const subtotalGeneral = escotelData.facturas.reduce(
          (sum, f) => sum + f.totales.subtotal,
          0
        );
        const ivaGeneral = escotelData.facturas.reduce((sum, f) => sum + f.totales.iva, 0);
        const retencionGeneral = escotelData.facturas.reduce(
          (sum, f) => sum + f.totales.retencion,
          0
        );

        // Mostrar resumen y botón de confirmación
        let resumenText =
          `✅ **Archivo procesado correctamente**\n\n` +
          `🏢 Cliente: ${escotelData.clienteName}\n\n` +
          `📊 **Resumen del archivo:**\n` +
          `   • Total de hojas en Excel: ${escotelData.totalHojasExcel}\n` +
          `   • Hojas con datos para facturar: ${escotelData.totalHojas}\n` +
          `   • Hojas vacías (sin datos): ${escotelData.totalHojasVacias}\n` +
          `   • Servicios totales: ${escotelData.totalServicios}\n\n`;

        // Mostrar discrepancias si existen
        if (escotelData.hojasConDiscrepancia && escotelData.hojasConDiscrepancia.length > 0) {
          resumenText += `⚠️ **DISCREPANCIAS DETECTADAS: ${escotelData.hojasConDiscrepancia.length} hojas**\n\n`;
          resumenText += `📋 **Hojas con diferencias (Excel vs Calculado):**\n`;

          escotelData.hojasConDiscrepancia.forEach((h, idx) => {
            const signo = h.discrepancia > 0 ? '+' : '';
            resumenText += `${idx + 1}. Hoja ${h.nombreHoja}: Excel $${h.totalEsperadoExcel.toFixed(2)} vs Calculado $${h.totales.total.toFixed(2)} = ${signo}$${h.discrepancia.toFixed(2)}\n`;
          });

          resumenText += `\n✅ Hojas sin discrepancias: ${escotelData.totalHojas - escotelData.hojasConDiscrepancia.length}\n`;
        } else {
          resumenText += `✅ **Sin discrepancias detectadas**\n\n`;
          resumenText += `Todas las hojas tienen totales correctos.\n`;
        }

        resumenText +=
          `\n💰 **Totales Generales:**\n` +
          `   Subtotal: $${subtotalGeneral.toFixed(2)}\n` +
          `   IVA (16%): $${ivaGeneral.toFixed(2)}\n` +
          `   Retención (4%): -$${retencionGeneral.toFixed(2)}\n` +
          `   **Total: $${totalGeneral.toFixed(2)}**\n\n` +
          `¿Deseas generar las ${escotelData.totalHojas} facturas?`;

        await ctx.reply(resumenText, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                `✅ Confirmar y Generar ${escotelData.totalHojas} Facturas`,
                'escotel_confirmar_facturas'
              ),
            ],
            [Markup.button.callback('❌ Cancelar', 'menu_principal')],
          ]),
        });

        // Limpiar estado
        if (ctx.userState) {
          ctx.userState.esperando = null;
        }
      }
    } catch (error) {
      console.error('Error procesando archivo ESCOTEL:', error);
      await ctx.reply(
        `❌ Error al procesar el archivo:\n\n${error.message}`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al menú', 'menu_principal')]])
      );

      // Limpiar estado
      if (ctx.userState) {
        ctx.userState.esperando = null;
      }
    }
  });

  // 4. ACTION: Descargar PDFs en ZIP
  bot.action('escotel_download_pdfs_zip', async (ctx) => {
    await ctx.answerCbQuery('Preparando ZIP de PDFs...');
    await descargarZipEscotel(ctx, 'pdf');
  });

  // 5. ACTION: Descargar XMLs en ZIP
  bot.action('escotel_download_xmls_zip', async (ctx) => {
    await ctx.answerCbQuery('Preparando ZIP de XMLs...');
    await descargarZipEscotel(ctx, 'xml');
  });

  console.log('✅ Handler de ESCOTEL registrado correctamente');
}

/**
 * Descarga un ZIP con todas las facturas de ESCOTEL (PDFs o XMLs)
 */
async function descargarZipEscotel(ctx, type) {
  try {
    // Obtener facturas guardadas
    const facturasGuardadas = ctx.userState?.escotelInvoiceResults;

    if (!facturasGuardadas || facturasGuardadas.length === 0) {
      return ctx.reply(
        '❌ No hay facturas disponibles para descargar. Por favor, genera las facturas primero.'
      );
    }

    const progressMsg = await ctx.reply(
      `📦 Preparando ZIP con ${facturasGuardadas.length} ${type.toUpperCase()}s...\n⏱️ Esto puede tomar unos minutos...`
    );

    // Obtener tenantId y API key
    const tenantId = ctx.getTenantId();
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { facturapiApiKey: true },
    });

    if (!tenant || !tenant.facturapiApiKey) {
      return ctx.reply('❌ No se pudo obtener la API key del tenant');
    }

    // Crear directorio temporal
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const timestamp = Date.now();
    const zipPath = path.join(tempDir, `escotel_${type}_${timestamp}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.pipe(output);

    let filesAdded = 0;
    let errores = 0;

    // Descargar y agregar cada factura al ZIP
    for (let i = 0; i < facturasGuardadas.length; i++) {
      const factura = facturasGuardadas[i];

      // Actualizar progreso cada 5 facturas
      if (i % 5 === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMsg.message_id,
          null,
          `📦 Descargando ${i + 1}/${facturasGuardadas.length} ${type.toUpperCase()}s...\n⏱️ Por favor espere...`
        );
      }

      try {
        const facturaId = factura.invoice.id;
        const apiUrl = `https://www.facturapi.io/v2/invoices/${facturaId}/${type}`;

        const response = await axios({
          method: 'GET',
          url: apiUrl,
          responseType: 'arraybuffer',
          headers: {
            Authorization: `Bearer ${tenant.facturapiApiKey}`,
          },
          timeout: 30000,
        });

        const fileData = Buffer.from(response.data);
        const fileName = `${factura.invoice.series}${factura.invoice.folio_number}.${type}`;
        archive.append(fileData, { name: fileName });
        filesAdded++;
      } catch (error) {
        console.error(`Error descargando ${type} para hoja ${factura.nombreHoja}:`, error.message);
        errores++;
      }
    }

    // Agregar el reporte Excel al ZIP
    try {
      const reporteBuffer = generarReporteExcel(
        facturasGuardadas.map((f) => ({
          nombreHoja: f.nombreHoja,
          factura: f.invoice,
          servicios: f.servicios,
          totales: f.totales,
          totalEsperadoExcel: f.totalEsperadoExcel,
          discrepancia: f.discrepancia,
          tieneDiscrepancia: f.tieneDiscrepancia,
        })),
        'ESCOTEL'
      );
      archive.append(reporteBuffer, { name: `REPORTE_FACTURAS_ESCOTEL.xlsx` });
      console.log('✅ Reporte Excel agregado al ZIP');
    } catch (error) {
      console.error('Error agregando reporte al ZIP:', error);
    }

    // Finalizar el ZIP
    await archive.finalize();
    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
    });

    const stats = fs.statSync(zipPath);
    const sizeMB = Math.round((stats.size / (1024 * 1024)) * 100) / 100;

    // Actualizar mensaje
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      progressMsg.message_id,
      null,
      `✅ ZIP generado exitosamente\n\n📦 Archivos incluidos: ${filesAdded}\n📁 Tamaño: ${sizeMB} MB\n\n⬇️ Descargando...`
    );

    // Enviar el archivo ZIP
    await ctx.replyWithDocument(
      { source: zipPath, filename: `ESCOTEL_${type.toUpperCase()}S_${timestamp}.zip` },
      {
        caption:
          `📦 **ZIP de ${type.toUpperCase()}s ESCOTEL**\n\n` +
          `✅ ${filesAdded} archivos ${type.toUpperCase()}\n` +
          `📊 Incluye: REPORTE_FACTURAS_ESCOTEL.xlsx\n` +
          `${errores > 0 ? `⚠️ ${errores} archivos con errores\n` : ''}` +
          `\n💡 El reporte contiene el mapeo completo:\n` +
          `   Número de Pedido → Serie/Folio`,
        parse_mode: 'Markdown',
      }
    );

    // Eliminar mensaje de progreso
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, progressMsg.message_id);
    } catch (e) {
      console.log('No se pudo eliminar mensaje de progreso');
    }

    // Limpiar archivo ZIP después de 2 minutos
    setTimeout(
      () => {
        try {
          if (fs.existsSync(zipPath)) {
            fs.unlinkSync(zipPath);
            console.log(`🗑️ ZIP temporal eliminado: ${path.basename(zipPath)}`);
          }
        } catch (error) {
          console.error(`Error eliminando ZIP ${zipPath}:`, error.message);
        }
      },
      2 * 60 * 1000
    );
  } catch (error) {
    console.error('Error generando ZIP:', error);
    await ctx.reply(`❌ Error al generar el ZIP: ${error.message}`);
  }
}

export default registerEscotelHandler;
