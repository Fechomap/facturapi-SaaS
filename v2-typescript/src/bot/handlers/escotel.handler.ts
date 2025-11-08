/**
 * ESCOTEL Handler - Versión TypeScript V2
 * Migrado con mejores prácticas:
 * - ✅ TypeScript estricto
 * - ✅ Redis para estado (no global memory)
 * - ✅ Async I/O (fs.promises)
 * - ✅ Sin logs de claves API
 * - ✅ Tipos bien definidos
 * - ✅ Constantes (no magic strings)
 * - ✅ Validación de tamaño de archivo (anti-DoS)
 */

import { Markup, Context } from 'telegraf';
import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import archiver from 'archiver';
import { fileURLToPath } from 'url';

// Prisma
import { prisma } from '@config/database.js';

// Servicios
import FacturapiService from '@services/facturapi.service.js';
import TenantService from '@core/tenant/tenant.service.js';
import redisBatchStateService from '@services/redis-batch-state.service.js';

// Tipos
import type {
  EscotelServicio,
  EscotelHojaData,
  EscotelFacturaInfo,
  EscotelBatchData,
  EscotelFacturaGenerada,
  EscotelFacturaError,
  EscotelProcessResult,
  EscotelEnvioResult,
  FacturapiTax,
  FacturapiItem,
} from '../../types/escotel.types.js';

// Constantes
import {
  CLIENT_RFCS,
  SAT_PRODUCT_KEYS,
  SAT_UNIT_KEYS,
  CFDI_USE,
  PAYMENT_FORM,
  PAYMENT_METHOD,
} from '@/constants/clients.js';
import { BOT_FLOWS, BOT_ACTIONS } from '@/constants/bot-flows.js';

// Utils
import { validateInvoiceAmount } from '../utils/invoice-validation.utils.js';

// Logger
import { createModuleLogger } from '@core/utils/logger.js';
const logger = createModuleLogger('EscotelHandler');

// Obtener __dirname en ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constantes específicas de ESCOTEL
const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Utilidades para progreso visual
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
async function updateProgressMessage(
  ctx: Context,
  messageId: number | undefined,
  step: number,
  total: number,
  currentTask: string,
  details = ''
): Promise<void> {
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
    await ctx.telegram.editMessageText(ctx.chat?.id, messageId, undefined, progressText, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    logger.debug('No se pudo editar mensaje de progreso');
  }
}

/**
 * Procesa una hoja específica del Excel de ESCOTEL
 */
function procesarHojaEscotel(worksheet: XLSX.WorkSheet, sheetName: string): EscotelHojaData | null {
  // Convertir a array de arrays
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as unknown[][];

  // Extraer el total esperado de la fila 20 (índice 19)
  const totalEsperadoExcel =
    data[19] && Array.isArray(data[19]) && data[19][0] ? parseFloat(String(data[19][0])) : null;

  // Buscar todos los servicios (patrón: LETRAS/NUMEROS_NUMEROS)
  const idPattern = /^[A-Z0-9]+_\d+$/i;
  const servicios: EscotelServicio[] = [];

  for (let index = 0; index < data.length; index++) {
    const row = data[index];
    if (!Array.isArray(row)) continue;

    const cellValue = String(row[0] || '').trim();

    if (idPattern.test(cellValue)) {
      // Extraer datos del servicio (siguiente 8 filas)
      const servicio: EscotelServicio = {
        id: String(row[0]),
        claveSat:
          data[index + 1] && Array.isArray(data[index + 1])
            ? String(data[index + 1][0] || '')
            : null,
        descripcion:
          data[index + 2] && Array.isArray(data[index + 2])
            ? String(data[index + 2][0] || '')
            : null,
        ubicacion:
          data[index + 3] && Array.isArray(data[index + 3])
            ? String(data[index + 3][0] || '')
            : null,
        subtotal:
          data[index + 4] && Array.isArray(data[index + 4])
            ? parseFloat(String(data[index + 4][0] || '0'))
            : 0,
        iva:
          data[index + 5] && Array.isArray(data[index + 5])
            ? parseFloat(String(data[index + 5][0] || '0'))
            : 0,
        retencion:
          data[index + 6] && Array.isArray(data[index + 6])
            ? parseFloat(String(data[index + 6][0] || '0'))
            : 0,
        total:
          data[index + 8] && Array.isArray(data[index + 8])
            ? parseFloat(String(data[index + 8][0] || '0'))
            : 0,
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

  // Circuit breaker: validar monto por hoja
  validateInvoiceAmount(totalFinal, 'ESCOTEL', `el total de la hoja '${sheetName}'`);

  // Calcular discrepancia
  const discrepancia = totalEsperadoExcel ? totalFinal - totalEsperadoExcel : 0;
  const tieneDiscrepancia = totalEsperadoExcel ? Math.abs(discrepancia) > 0.01 : false; // Tolerancia de 1 centavo

  return {
    nombreHoja: sheetName,
    servicios,
    totales: {
      subtotal: subtotalTotal,
      iva: ivaTotal,
      retencion: retencionTotal,
      total: totalFinal,
    },
    totalEsperadoExcel,
    discrepancia,
    tieneDiscrepancia,
  };
}

/**
 * Parsea el archivo Excel de ESCOTEL con múltiples hojas
 */
async function procesarArchivoEscotel(
  ctx: Context,
  filePath: string,
  progressMessageId: number | undefined
): Promise<EscotelProcessResult> {
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
    const hojasConDatos: EscotelHojaData[] = [];
    const hojasVacias: string[] = [];

    for (const sheetName of workbook.SheetNames) {
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

    // Obtener tenantId
    const tenantId = (ctx as any).getTenantId?.();
    if (!tenantId) {
      throw new Error('No se encontró el tenant asociado');
    }

    // Buscar el cliente ESCOTEL
    let clienteFallback = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId,
        rfc: CLIENT_RFCS.ESCOTEL,
        isActive: true,
      },
    });

    // Si no existe, configurar cliente
    if (!clienteFallback) {
      await ctx.reply('⚠️ Cliente ESCOTEL no encontrado. Configurando automáticamente...');

      const { default: CustomerSetupService } = await import('@services/customer-setup.service.js');
      await CustomerSetupService.setupPredefinedCustomers(tenantId, false);

      clienteFallback = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          rfc: CLIENT_RFCS.ESCOTEL,
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
    const facturasData: EscotelFacturaInfo[] = hojasConDatos.map((hoja) => {
      // Crear items para esta factura
      const items: FacturapiItem[] = hoja.servicios.map((servicio: EscotelServicio) => {
        const tieneRetencion = servicio.retencion > 0;
        const descripcion = `AMPARA ID: ${servicio.id} - ${servicio.descripcion} - ${servicio.ubicacion}`;

        const taxes: FacturapiTax[] = [
          {
            type: 'IVA',
            rate: 0.16,
            factor: 'Tasa',
            withholding: false,
          },
        ];

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
            product_key: SAT_PRODUCT_KEYS.SERVICIOS_GRUA,
            unit_key: SAT_UNIT_KEYS.SERVICIO,
            unit_name: 'SERVICIO',
            price: servicio.subtotal,
            tax_included: false,
            taxes,
          },
        };
      });

      return {
        nombreHoja: hoja.nombreHoja,
        facturaData: {
          customer: clienteFallback!.facturapiCustomerId,
          items,
          use: CFDI_USE.GASTOS_GENERAL,
          payment_form: PAYMENT_FORM.POR_DEFINIR,
          payment_method: PAYMENT_METHOD.PAGO_DIFERIDO,
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

    // Generar ID único para este batch
    const batchId = redisBatchStateService.generateBatchId();
    const userId = ctx.from?.id;

    if (!userId) {
      throw new Error('No se pudo obtener el ID del usuario');
    }

    // Guardar en Redis
    const batchData: EscotelBatchData = {
      batchId,
      userId,
      timestamp: Date.now(),
      facturas: facturasData,
      clienteId: clienteFallback.id,
      clienteFacturapiId: clienteFallback.facturapiCustomerId,
      clienteName: clienteFallback.legalName,
      totalHojas: hojasConDatos.length,
      totalHojasExcel: workbook.SheetNames.length,
      totalHojasVacias: hojasVacias.length,
      totalServicios,
      hojasConDiscrepancia: facturasData.filter((f) => f.tieneDiscrepancia),
    };

    const saveResult = await redisBatchStateService.saveBatchData(userId, batchId, batchData);

    if (!saveResult.success) {
      throw new Error(`Error guardando datos en Redis: ${saveResult.error}`);
    }

    logger.info(
      { userId, batchId, totalHojas: hojasConDatos.length },
      'Batch ESCOTEL guardado en Redis'
    );

    // Guardar batchId en userState para acceso posterior
    if ((ctx as any).userState) {
      (ctx as any).userState.escotelBatchId = batchId;
    }

    return { success: true, hojas: hojasConDatos.length, servicios: totalServicios };
  } catch (error) {
    logger.error({ error }, 'Error procesando archivo ESCOTEL');
    throw error;
  }
}

/**
 * Genera un Excel de reporte con el mapeo pedido-factura
 */
function generarReporteExcel(
  facturasGeneradas: EscotelFacturaGenerada[],
  clienteName: string
): Buffer {
  const wb = XLSX.utils.book_new();

  // Preparar los datos
  const data: unknown[][] = [
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

  facturasGeneradas.forEach((f, index) => {
    const estado = f.tieneDiscrepancia ? 'ALERTA' : 'OK';
    const discrepanciaTexto = f.tieneDiscrepancia
      ? `$${f.discrepancia.toFixed(2)}`
      : 'Sin diferencia';

    data.push([
      index + 1,
      f.nombreHoja,
      f.factura.series,
      f.factura.folio_number,
      f.totales.total,
      f.servicios,
      f.totalEsperadoExcel || f.totales.total,
      discrepanciaTexto,
      estado,
    ]);
  });

  // Totales
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

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Configurar anchos de columna
  ws['!cols'] = [
    { wch: 5 },
    { wch: 18 },
    { wch: 8 },
    { wch: 10 },
    { wch: 15 },
    { wch: 10 },
    { wch: 15 },
    { wch: 18 },
    { wch: 10 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Reporte Facturas');

  wb.Props = {
    Title: `Reporte Facturas ESCOTEL - ${clienteName}`,
    Subject: 'Mapeo de pedidos y facturas',
    Author: 'Sistema de Facturación',
    CreatedDate: new Date(),
  };

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * Envía múltiples facturas a FacturAPI (una por hoja)
 */
async function enviarFacturasEscotel(ctx: Context, batchId: string): Promise<EscotelEnvioResult> {
  try {
    const tenantId = (ctx as any).getTenantId?.();
    if (!tenantId) {
      throw new Error('No se encontró el tenant asociado');
    }

    const userId = ctx.from?.id;
    if (!userId) {
      throw new Error('No se pudo obtener el ID del usuario');
    }

    // Obtener datos del batch desde Redis
    const batchResult = await redisBatchStateService.getBatchData<EscotelBatchData>(
      userId,
      batchId
    );

    if (!batchResult.success || !batchResult.data) {
      throw new Error('Los datos han expirado. Por favor, sube el archivo nuevamente.');
    }

    const escotelData = batchResult.data;

    // Obtener cliente de FacturAPI
    const facturapi = await FacturapiService.getFacturapiClient(tenantId);

    const progressMsg = await ctx.reply(
      `📤 Generando ${escotelData.totalHojas} facturas en FacturAPI...\n⏱️ Por favor espere...`
    );

    const facturasGeneradas: EscotelFacturaGenerada[] = [];
    const errores: EscotelFacturaError[] = [];

    // Generar cada factura
    for (let i = 0; i < escotelData.facturas.length; i++) {
      const facturaInfo = escotelData.facturas[i];

      try {
        // Crear factura directamente (sin queue por ahora, se puede agregar después)
        const factura = await facturapi.invoices.create(facturaInfo.facturaData);

        // Registrar en BD
        await TenantService.registerInvoice(
          tenantId,
          factura.id,
          factura.series,
          typeof factura.folio_number === 'number'
            ? factura.folio_number
            : parseInt(factura.folio_number, 10),
          escotelData.clienteId,
          factura.total,
          typeof userId === 'number' && userId <= 2147483647 ? userId : null
        );

        facturasGeneradas.push({
          nombreHoja: facturaInfo.nombreHoja,
          factura: {
            id: factura.id,
            series: factura.series,
            folio_number:
              typeof factura.folio_number === 'number'
                ? factura.folio_number
                : parseInt(factura.folio_number, 10),
            total: factura.total,
          },
          servicios: facturaInfo.servicios.length,
          totales: facturaInfo.totales,
          totalEsperadoExcel: facturaInfo.totalEsperadoExcel,
          discrepancia: facturaInfo.discrepancia,
          tieneDiscrepancia: facturaInfo.tieneDiscrepancia,
        });

        // Actualizar progreso cada 5 facturas (editar el MISMO mensaje)
        if ((i + 1) % 5 === 0 || i + 1 === escotelData.facturas.length) {
          await ctx.telegram
            .editMessageText(
              ctx.chat!.id,
              progressMsg.message_id,
              undefined,
              `⏳ Progreso: ${i + 1}/${escotelData.facturas.length} facturas generadas...`
            )
            .catch(() => {}); // Ignorar errores si el mensaje no cambió
        }
      } catch (error) {
        logger.error(
          { nombreHoja: facturaInfo.nombreHoja, error },
          'Error generando factura ESCOTEL'
        );
        errores.push({
          nombreHoja: facturaInfo.nombreHoja,
          error: error instanceof Error ? error.message : 'Error desconocido',
        });
      }
    }

    // Limpiar datos del batch en Redis
    await redisBatchStateService.deleteBatchData(userId, batchId);

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

      const facturasConDiscrepancia = facturasGeneradas.filter((f) => f.tieneDiscrepancia);

      if (facturasConDiscrepancia.length > 0) {
        resumenText += `⚠️ **DISCREPANCIAS DETECTADAS: ${facturasConDiscrepancia.length} facturas**\n\n`;
        resumenText += `📋 **Facturas con diferencias (Excel vs Facturado):**\n`;

        facturasConDiscrepancia.forEach((f, idx) => {
          const signo = f.discrepancia > 0 ? '+' : '';
          resumenText += `${idx + 1}. Hoja ${f.nombreHoja} (Folio ${f.factura.folio_number}): Excel $${f.totalEsperadoExcel?.toFixed(2)} vs Facturado $${f.totales.total.toFixed(2)} = ${signo}$${f.discrepancia.toFixed(2)}\n`;
        });

        resumenText += `\n✅ Facturas sin discrepancias: ${facturasGeneradas.length - facturasConDiscrepancia.length}\n`;
      } else {
        resumenText += `✅ **Sin discrepancias**\n\nTodas las facturas generadas coinciden con los totales del Excel.\n`;
      }

      await ctx.reply(resumenText, { parse_mode: 'Markdown' });

      // Crear botones de descarga individuales para cada factura
      const botonesDescarga: any[] = [];

      facturasGeneradas.forEach((f, idx) => {
        const folio = `${f.factura.series}-${f.factura.folio_number}`;

        // Par de botones PDF/XML por cada factura
        botonesDescarga.push([
          Markup.button.callback(
            `📄 PDF ${folio}`,
            `pdf_${f.factura.id}_${f.factura.folio_number}`
          ),
          Markup.button.callback(
            `🔠 XML ${folio}`,
            `xml_${f.factura.id}_${f.factura.folio_number}`
          ),
        ]);
      });

      // Agregar botón de volver al final
      botonesDescarga.push([
        Markup.button.callback('🔙 Volver al Menú', BOT_ACTIONS.MENU_PRINCIPAL),
      ]);

      await ctx.reply(`📥 **Descargas Individuales:**\n\nSeleccione PDF o XML de cada factura:`, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(botonesDescarga).reply_markup,
      });

      // Botones de descarga masiva en ZIP
      const botonesZip = [
        [
          Markup.button.callback(
            '📦 Descargar Todos los PDFs (ZIP)',
            BOT_ACTIONS.ESCOTEL_DOWNLOAD_PDFS_ZIP
          ),
          Markup.button.callback(
            '🗂️ Descargar Todos los XMLs (ZIP)',
            BOT_ACTIONS.ESCOTEL_DOWNLOAD_XMLS_ZIP
          ),
        ],
        [Markup.button.callback('🔙 Volver al Menú', BOT_ACTIONS.MENU_PRINCIPAL)],
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
      if ((ctx as any).userState) {
        (ctx as any).userState.escotelInvoiceResults = facturasGeneradas;
      }

      // Generar y enviar el reporte Excel
      try {
        const reporteBuffer = generarReporteExcel(facturasGeneradas, escotelData.clienteName);
        const timestamp = Date.now();
        const tempDir = path.join(__dirname, '../../../temp');

        // Crear directorio si no existe (async)
        await fs.mkdir(tempDir, { recursive: true });

        const reportePath = path.join(tempDir, `reporte_escotel_${timestamp}.xlsx`);
        await fs.writeFile(reportePath, reporteBuffer);

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

        // Limpiar archivo temporal después de 2 minutos (async cleanup)
        setTimeout(
          async () => {
            try {
              await fs.unlink(reportePath);
              logger.info({ file: path.basename(reportePath) }, 'Reporte Excel temporal eliminado');
            } catch (error) {
              logger.error({ file: reportePath, error }, 'Error eliminando reporte temporal');
            }
          },
          2 * 60 * 1000
        );
      } catch (error) {
        logger.error({ error }, 'Error generando reporte Excel');
        await ctx.reply(
          '⚠️ Las facturas se generaron correctamente, pero hubo un error al crear el reporte Excel.'
        );
      }
    }

    if (errores.length > 0) {
      let errorText = `⚠️ **Errores en ${errores.length} facturas:**\n\n`;
      errores.slice(0, 5).forEach((e) => {
        errorText += `• Hoja ${e.nombreHoja}: ${e.error.substring(0, 50)}...\n`;
      });

      await ctx.reply(errorText, { parse_mode: 'Markdown' });
    }

    return {
      success: true,
      generadas: facturasGeneradas.length,
      errores: errores.length,
      facturasGeneradas,
      facturasError: errores,
    };
  } catch (error) {
    logger.error({ error }, 'Error enviando facturas ESCOTEL');

    const errorMsg =
      error instanceof Error &&
      'response' in error &&
      typeof error.response === 'object' &&
      error.response !== null &&
      'data' in error.response &&
      typeof error.response.data === 'object' &&
      error.response.data !== null &&
      'message' in error.response.data
        ? String(error.response.data.message)
        : error instanceof Error
          ? error.message
          : 'Error desconocido';

    const shortError = errorMsg.length > 200 ? errorMsg.substring(0, 200) + '...' : errorMsg;

    await ctx.reply(
      `❌ **Error al generar las facturas**\n\n` +
        `${shortError}\n\n` +
        `Por favor, verifica los datos e inténtalo nuevamente.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Volver al menú', BOT_ACTIONS.MENU_PRINCIPAL)],
        ]),
      }
    );

    throw error;
  }
}

/**
 * Descarga un ZIP con todas las facturas de ESCOTEL (PDFs o XMLs)
 */
async function descargarZipEscotel(ctx: Context, type: 'pdf' | 'xml'): Promise<void> {
  try {
    const facturasGuardadas = (ctx as any).userState?.escotelInvoiceResults as
      | EscotelFacturaGenerada[]
      | undefined;

    if (!facturasGuardadas || facturasGuardadas.length === 0) {
      await ctx.reply(
        '❌ No hay facturas disponibles para descargar. Por favor, genera las facturas primero.'
      );
      return;
    }

    const progressMsg = await ctx.reply(
      `📦 Preparando ZIP con ${facturasGuardadas.length} ${type.toUpperCase()}s...\n⏱️ Esto puede tomar unos minutos...`
    );

    const tenantId = (ctx as any).getTenantId?.();
    // REFACTOR: Obtener el cliente de FacturAPI una sola vez usando el servicio
    const facturapi = await FacturapiService.getFacturapiClient(tenantId);

    // Crear directorio temporal (async)
    const tempDir = path.join(__dirname, '../../../temp');
    await fs.mkdir(tempDir, { recursive: true });

    const timestamp = Date.now();
    const zipPath = path.join(tempDir, `escotel_${type}_${timestamp}.zip`);
    const output = (await import('fs')).createWriteStream(zipPath);

    // SOLUCIÓN DEFINITIVA: No comprimir PDFs (0), sí comprimir XMLs (8)
    const compressionLevel = type === 'pdf' ? 0 : 8;
    logger.info(
      `Creando ZIP para ${type.toUpperCase()}s con nivel de compresión: ${compressionLevel}`
    );
    const archive = archiver('zip', { zlib: { level: compressionLevel } });

    archive.pipe(output);

    const BATCH_SIZE = 10;
    let filesAdded = 0;
    let errores = 0;

    for (let i = 0; i < facturasGuardadas.length; i += BATCH_SIZE) {
      const batch = facturasGuardadas.slice(i, i + BATCH_SIZE);
      await ctx.telegram
        .editMessageText(
          ctx.chat!.id,
          progressMsg.message_id,
          undefined,
          `📦 Procesando lote... (${i + batch.length}/${facturasGuardadas.length})`
        )
        .catch(() => {});

      const downloadPromises = batch.map((factura: any) => {
        const facturaId = factura.factura.id;

        // REFACTORIZACIÓN A SDK: Usar el método oficial
        const downloadAction =
          type === 'pdf'
            ? facturapi.invoices.downloadPdf(facturaId)
            : facturapi.invoices.downloadXml(facturaId);

        return downloadAction
          .then(async (fileData: any) => {
            let fileBuffer: Buffer;
            if (fileData instanceof Blob) {
              fileBuffer = Buffer.from(await fileData.arrayBuffer());
            } else if (fileData instanceof ReadableStream) {
              const chunks: Uint8Array[] = [];
              for await (const chunk of fileData) {
                chunks.push(chunk);
              }
              fileBuffer = Buffer.concat(chunks);
            } else {
              fileBuffer = fileData as unknown as Buffer;
            }
            const fileName = `${factura.factura.series}${factura.factura.folio_number}.${type}`;
            return { fileName, fileBuffer };
          })
          .catch((error: any) => {
            logger.error(
              { nombreHoja: factura.nombreHoja, type, error: error.message },
              'Error descargando archivo vía SDK'
            );
            errores++;
            return null;
          });
      });

      const downloadedFiles = await Promise.all(downloadPromises);

      for (const file of downloadedFiles) {
        if (file) {
          archive.append(file.fileBuffer, { name: file.fileName });
          filesAdded++;
        }
      }
    }

    if (filesAdded > 0) {
      // Agregar el reporte Excel al ZIP
      try {
        const reporteBuffer = generarReporteExcel(facturasGuardadas, 'ESCOTEL');
        archive.append(reporteBuffer, { name: `REPORTE_FACTURAS_ESCOTEL.xlsx` });
        logger.info('Reporte Excel agregado al ZIP');
      } catch (error) {
        logger.error({ error }, 'Error agregando reporte al ZIP');
      }
    }

    // Finalizar el ZIP
    await archive.finalize();
    await new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', reject);
    });

    const stats = await fs.stat(zipPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    await ctx.telegram
      .editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        undefined,
        `✅ ZIP generado (${sizeMB} MB). Enviando...`
      )
      .catch(() => {});

    await ctx.replyWithDocument(
      { source: zipPath, filename: `ESCOTEL_${type.toUpperCase()}S_${timestamp}.zip` },
      {
        caption: `📦 ZIP con ${filesAdded} archivos ${type.toUpperCase()}.\n${errores > 0 ? `⚠️ ${errores} archivos con errores.` : ''}`,
      }
    );

    await ctx.telegram.deleteMessage(ctx.chat!.id, progressMsg.message_id).catch(() => {});

    setTimeout(
      () =>
        fs
          .unlink(zipPath)
          .catch((e) => logger.error({ error: e }, 'Error eliminando ZIP temporal')),
      2 * 60 * 1000
    );
  } catch (error) {
    logger.error({ error }, 'Error generando ZIP ESCOTEL');
    await ctx.reply(
      `❌ Error al generar el ZIP: ${error instanceof Error ? error.message : 'Error desconocido'}`
    );
  }
}

/**
 * Registra los manejadores para la funcionalidad ESCOTEL
 */
export function registerEscotelHandler(bot: any): void {
  logger.info('Registrando handler de ESCOTEL (V2 TypeScript)...');

  // 1. ACTION: Menú de ESCOTEL - Iniciar flujo
  bot.action(BOT_ACTIONS.MENU_ESCOTEL, async (ctx: Context) => {
    try {
      await ctx.answerCbQuery();

      const tenantId = (ctx as any).getTenantId?.();
      if (!tenantId) {
        await ctx.reply('❌ Error: No se encontró tu tenant. Por favor, contacta al soporte.');
        return;
      }

      // Buscar el cliente ESCOTEL
      let clienteFallback = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          rfc: CLIENT_RFCS.ESCOTEL,
          isActive: true,
        },
      });

      // Si no existe, configurar cliente
      if (!clienteFallback) {
        await ctx.reply('⚠️ Cliente ESCOTEL no encontrado. Configurando automáticamente...');

        const { default: CustomerSetupService } = await import(
          '@services/customer-setup.service.js'
        );
        await CustomerSetupService.setupPredefinedCustomers(tenantId, false);

        clienteFallback = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId,
            rfc: CLIENT_RFCS.ESCOTEL,
            isActive: true,
          },
        });

        if (clienteFallback) {
          await ctx.reply('✅ Cliente ESCOTEL configurado correctamente');
        } else {
          await ctx.reply(
            '❌ No se pudo configurar el cliente ESCOTEL. Por favor, usa el comando /configure_clients para configurar los clientes predefinidos.',
            Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Volver al menú', BOT_ACTIONS.MENU_PRINCIPAL)],
            ])
          );
          return;
        }
      }

      // Marcar que estamos esperando el archivo Excel de ESCOTEL
      if ((ctx as any).userState) {
        (ctx as any).userState.esperando = BOT_FLOWS.ESCOTEL_AWAIT_EXCEL;
      }

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
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancelar', BOT_ACTIONS.MENU_PRINCIPAL)],
          ]),
        }
      );
    } catch (error) {
      logger.error({ error }, 'Error en menu_escotel');
      await ctx.reply('❌ Ocurrió un error. Por favor, intenta nuevamente.');
    }
  });

  // 2. ACTION: Confirmar facturas
  bot.action(/^escotel_confirmar_facturas:(.+)$/, async (ctx: Context) => {
    try {
      await ctx.answerCbQuery();

      const match = (ctx as any).match;
      const batchId = match ? match[1] : null;

      if (!batchId) {
        await ctx.reply(
          '❌ Error: No se pudo obtener el ID del lote.',
          Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Volver al menú', BOT_ACTIONS.MENU_PRINCIPAL)],
          ])
        );
        return;
      }

      await enviarFacturasEscotel(ctx, batchId);
    } catch (error) {
      logger.error({ error }, 'Error confirmando facturas ESCOTEL');
      await ctx.reply(
        '❌ Ocurrió un error al generar las facturas. Por favor, intenta nuevamente.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Volver al menú', BOT_ACTIONS.MENU_PRINCIPAL)],
        ])
      );
    }
  });

  // 3. HANDLER: Procesamiento de archivo Excel
  bot.on('document', async (ctx: Context, next: () => Promise<void>) => {
    try {
      // Verificar si debe detectar este archivo
      const userState = (ctx as any).userState;
      if (!userState || userState.esperando !== BOT_FLOWS.ESCOTEL_AWAIT_EXCEL) {
        return next();
      }

      const document = (ctx.message as any)?.document;
      if (!document) {
        return next();
      }

      // Validación de tamaño de archivo (anti-DoS)
      if (document.file_size && document.file_size > MAX_FILE_SIZE_BYTES) {
        await ctx.reply(
          `❌ El archivo es demasiado grande (${Math.round(document.file_size / (1024 * 1024))} MB).\n` +
            `El tamaño máximo permitido es ${MAX_FILE_SIZE_MB} MB.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Volver al menú', BOT_ACTIONS.MENU_PRINCIPAL)],
          ])
        );
        return;
      }

      // Validar que sea un archivo Excel
      const fileName = document.file_name || '';
      const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

      if (!isExcel) {
        await ctx.reply(
          '❌ El archivo debe ser un Excel (.xlsx o .xls)',
          Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Volver al menú', BOT_ACTIONS.MENU_PRINCIPAL)],
          ])
        );
        return;
      }

      // Mensaje de progreso inicial
      const progressMessage = await ctx.reply('⏳ Descargando archivo...');
      const progressMessageId = progressMessage.message_id;

      // Descargar el archivo
      const fileLink = await ctx.telegram.getFileLink(document.file_id);
      const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });

      // Guardar temporalmente (async)
      const tempDir = path.join(__dirname, '../../../temp');
      await fs.mkdir(tempDir, { recursive: true });

      const tempFileName = `escotel_${ctx.from?.id}_${Date.now()}.xlsx`;
      const filePath = path.join(tempDir, tempFileName);
      await fs.writeFile(filePath, response.data);

      // Procesar el archivo
      const result = await procesarArchivoEscotel(ctx, filePath, progressMessageId);

      // Eliminar archivo temporal (async)
      await fs.unlink(filePath);

      // Eliminar mensaje de progreso
      try {
        if (ctx.chat?.id) {
          await ctx.telegram.deleteMessage(ctx.chat.id, progressMessageId);
        }
      } catch (e) {
        logger.debug('No se pudo eliminar mensaje de progreso');
      }

      if (result.success) {
        const userId = ctx.from?.id;
        const batchId = (ctx as any).userState?.escotelBatchId;

        if (!userId || !batchId) {
          throw new Error('No se pudo obtener userId o batchId');
        }

        const batchResult = await redisBatchStateService.getBatchData<EscotelBatchData>(
          userId,
          batchId
        );

        if (!batchResult.success || !batchResult.data) {
          throw new Error('Error recuperando datos del batch');
        }

        const escotelData = batchResult.data;

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
            resumenText += `${idx + 1}. Hoja ${h.nombreHoja}: Excel $${h.totalEsperadoExcel?.toFixed(2)} vs Calculado $${h.totales.total.toFixed(2)} = ${signo}$${h.discrepancia.toFixed(2)}\n`;
          });

          resumenText += `\n✅ Hojas sin discrepancias: ${escotelData.totalHojas - escotelData.hojasConDiscrepancia.length}\n`;
        } else {
          resumenText += `✅ **Sin discrepancias detectadas**\n\nTodas las hojas tienen totales correctos.\n`;
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
                `escotel_confirmar_facturas:${batchId}`
              ),
            ],
            [Markup.button.callback('❌ Cancelar', BOT_ACTIONS.MENU_PRINCIPAL)],
          ]),
        });

        // Limpiar estado
        if ((ctx as any).userState) {
          (ctx as any).userState.esperando = null;
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error procesando archivo ESCOTEL');
      await ctx.reply(
        `❌ Error al procesar el archivo:\n\n${error instanceof Error ? error.message : 'Error desconocido'}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Volver al menú', BOT_ACTIONS.MENU_PRINCIPAL)],
        ])
      );

      // Limpiar estado
      if ((ctx as any).userState) {
        (ctx as any).userState.esperando = null;
      }
    }
  });

  // 4. ACTION: Descargar PDFs en ZIP
  bot.action(BOT_ACTIONS.ESCOTEL_DOWNLOAD_PDFS_ZIP, async (ctx: Context) => {
    await ctx.answerCbQuery('Preparando ZIP de PDFs...');
    await descargarZipEscotel(ctx, 'pdf');
  });

  // 5. ACTION: Descargar XMLs en ZIP
  bot.action(BOT_ACTIONS.ESCOTEL_DOWNLOAD_XMLS_ZIP, async (ctx: Context) => {
    await ctx.answerCbQuery('Preparando ZIP de XMLs...');
    await descargarZipEscotel(ctx, 'xml');
  });

  logger.info('✅ Handler de ESCOTEL (V2 TypeScript) registrado correctamente');
}

export default registerEscotelHandler;
