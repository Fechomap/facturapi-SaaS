/**
 * CHUBB Handler - Versión TypeScript V2
 * Migrado completamente de v1 con mejoras:
 * - ✅ TypeScript estricto
 * - ✅ Redis para estado (no global memory)
 * - ✅ Async I/O (fs.promises)
 * - ✅ Constantes centralizadas
 * - ✅ Tipos bien definidos
 */

import { Markup } from 'telegraf';
import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { createModuleLogger } from '@core/utils/logger.js';
import { prisma } from '@config/database.js';
import type { BotContext } from '@/types/bot.types.js';
import FacturapiService from '@services/facturapi.service.js';
import TenantService from '@core/tenant/tenant.service.js';
import redisBatchStateService from '@services/redis-batch-state.service.js';
import type { ChubbBatchData, ChubbGrupos } from '@/types/chubb.types.js';
import {
  CLIENT_RFCS,
  SAT_PRODUCT_KEYS,
  SAT_UNIT_KEYS,
  CFDI_USE,
  PAYMENT_FORM,
  PAYMENT_METHOD,
} from '@/constants/clients.js';
import { BOT_FLOWS, BOT_ACTIONS } from '@/constants/bot-flows.js';
import { validateInvoiceAmount } from '../utils/invoice-validation.utils.js';
import {
  calculateFinancialDataFromFacturaData,
  extractAdditionalDataFromFacturapiResponse,
} from '../utils/invoice-calculation.utils.js';

const logger = createModuleLogger('ChubbHandler');

// Constantes específicas de CHUBB
const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Obtener __dirname en ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  ctx: BotContext,
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
    `${PROGRESS_FRAMES[frameIndex]} **Procesando archivo CHUBB**\n\n` +
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
 * Interface para mapeo de columnas Excel CHUBB
 */
interface ChubbColumnMapping {
  numeroCaso: string;
  servicio: string;
  monto: string;
  retencion?: string;
}

/**
 * Mapea los nombres de las columnas encontrados en el Excel CHUBB
 */
function mapColumnNamesChubb(firstRow: Record<string, any>): ChubbColumnMapping | null {
  if (!firstRow) return null;

  const posiblesColumnas: Record<string, string[]> = {
    numeroCaso: ['NUMERO CASO', 'Numero Caso', 'No. CASO', 'Caso', 'CASO', 'Numero de Caso'],
    servicio: ['SERVICIO', 'Servicio', 'Tipo Servicio', 'Tipo', 'TIPO SERVICIO'],
    monto: ['MONTO', 'Monto', 'IMPORTE', 'Importe', 'Total', 'Valor', 'COSTO', 'Costo'],
    retencion: ['RETENCION', 'Retención', 'Retencion', 'RET'],
  };

  const columnMapping: Record<string, string> = {};

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

  // Verificar que encontramos las columnas necesarias
  if (columnMapping.numeroCaso && columnMapping.servicio && columnMapping.monto) {
    return {
      numeroCaso: columnMapping.numeroCaso,
      servicio: columnMapping.servicio,
      monto: columnMapping.monto,
      retencion: columnMapping.retencion,
    };
  }

  logger.warn({ columnMapping }, 'No se encontraron todas las columnas requeridas para CHUBB');
  return null;
}

/**
 * Procesa el archivo Excel de CHUBB y agrupa servicios
 */
async function procesarArchivoChubb(
  ctx: BotContext,
  filePath: string,
  progressMessageId: number | undefined
): Promise<{ success: boolean; pendingConfirmation?: boolean; error?: string }> {
  try {
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

    await updateProgressMessage(
      ctx,
      progressMessageId,
      2,
      6,
      'Detectando columnas',
      'Analizando estructura...'
    );

    const data = XLSX.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      await ctx.reply('❌ El archivo Excel no contiene datos.');
      return { success: false, error: 'Excel sin datos' };
    }

    const columnMappings = mapColumnNamesChubb(data[0] as Record<string, any>);

    if (!columnMappings) {
      await ctx.reply(
        '❌ El archivo Excel no tiene las columnas requeridas: NUMERO CASO, SERVICIO y MONTO.'
      );
      return { success: false, error: 'Estructura de Excel inválida' };
    }

    logger.info({ columnMappings, sampleRows: data.slice(0, 2) }, 'Mapeado de columnas CHUBB');

    await updateProgressMessage(
      ctx,
      progressMessageId,
      3,
      6,
      'Validando datos',
      `Verificando ${data.length} registros...`
    );

    // Validar datos numéricos
    const erroresNumericos: string[] = [];
    data.forEach((row: any, index: number) => {
      const monto = parseFloat(row[columnMappings.monto]);
      if (isNaN(monto) || monto <= 0) {
        erroresNumericos.push(`Fila ${index + 2}: El monto debe ser un número positivo.`);
      }
    });

    if (erroresNumericos.length > 0) {
      const erroresMostrados = erroresNumericos.slice(0, 5);
      await ctx.reply(
        `❌ Se encontraron errores:\n${erroresMostrados.join('\n')}\n${erroresNumericos.length > 5 ? `...y ${erroresNumericos.length - 5} más.` : ''}`
      );
      return { success: false, error: 'Datos numéricos inválidos' };
    }

    await updateProgressMessage(
      ctx,
      progressMessageId,
      4,
      6,
      'Agrupando servicios',
      `Clasificando ${data.length} registros...`
    );

    // Agrupar servicios según tipo
    const grupos: ChubbGrupos = {
      gruaConRetencion: [],
      gruaSinRetencion: [],
      otrosServicios: [],
    };

    for (const row of data as any[]) {
      const numeroCaso = String(row[columnMappings.numeroCaso] || '');
      const servicio = String(row[columnMappings.servicio] || '').toUpperCase();
      const monto = parseFloat(row[columnMappings.monto]) || 0;

      // Determinar si es servicio de grúa
      const esGrua =
        servicio.includes('GRUA') || servicio.includes('ARRASTRE') || servicio.includes('REMOLQUE');

      // Determinar si tiene retención (4%) - CORREGIDO para coincidir con V1
      // V1 usa valores numéricos negativos en la columna RETENCION para indicar retención del 4%
      let tieneRetencion = false;
      if (columnMappings.retencion) {
        let valorRetencion = row[columnMappings.retencion];
        // Si es string, intentar convertir a número
        if (typeof valorRetencion === 'string') {
          valorRetencion = parseFloat(valorRetencion.replace(/[^\d.-]/g, ''));
        }
        // Si el valor es negativo, tiene retención (mismo criterio que V1)
        tieneRetencion = valorRetencion < 0;
      }

      const item = {
        numeroCaso,
        servicio,
        monto,
        tieneRetencion,
      };

      if (esGrua) {
        if (tieneRetencion) {
          grupos.gruaConRetencion.push(item);
        } else {
          grupos.gruaSinRetencion.push(item);
        }
      } else {
        grupos.otrosServicios.push(item);
      }
    }

    logger.info(
      {
        gruaConRetencion: grupos.gruaConRetencion.length,
        gruaSinRetencion: grupos.gruaSinRetencion.length,
        otrosServicios: grupos.otrosServicios.length,
      },
      'Servicios agrupados'
    );

    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      throw new Error('No se pudo obtener la información de tu empresa.');
    }

    const chubbClient = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId,
        rfc: CLIENT_RFCS.CHUBB,
        isActive: true,
      },
    });

    if (!chubbClient) {
      throw new Error('No se encontró el cliente CHUBB');
    }

    await updateProgressMessage(
      ctx,
      progressMessageId,
      5,
      6,
      'Calculando totales',
      'Preparando facturas...'
    );

    // Calcular totales por grupo
    const montosPorGrupo = {
      gruaConRetencion: grupos.gruaConRetencion.reduce((sum, item) => sum + item.monto, 0),
      gruaSinRetencion: grupos.gruaSinRetencion.reduce((sum, item) => sum + item.monto, 0),
      otrosServicios: grupos.otrosServicios.reduce((sum, item) => sum + item.monto, 0),
    };

    // Circuit breaker: validar cada grupo
    for (const grupo in montosPorGrupo) {
      const monto = montosPorGrupo[grupo as keyof typeof montosPorGrupo];
      if (monto > 0) {
        // Solo validar si hay monto
        validateInvoiceAmount(monto, 'CHUBB', `el grupo '${grupo}'`);
      }
    }

    const batchId = redisBatchStateService.generateBatchId();
    const userId = ctx.from?.id;

    if (!userId) {
      throw new Error('No se pudo obtener el ID del usuario');
    }

    const batchData: ChubbBatchData = {
      batchId,
      userId,
      timestamp: Date.now(),
      grupos,
      columnMappings,
      montosPorGrupo,
      clienteId: chubbClient.id,
      clienteFacturapiId: chubbClient.facturapiCustomerId,
      clienteName: chubbClient.legalName,
    };

    const saveResult = await redisBatchStateService.saveBatchData(userId, batchId, batchData);

    if (!saveResult.success) {
      throw new Error(`Error guardando datos en Redis: ${saveResult.error}`);
    }

    logger.info({ userId, batchId, totalRecords: data.length }, 'Batch CHUBB guardado en Redis');

    if (ctx.userState) {
      ctx.userState.chubbBatchId = batchId;
    }

    await updateProgressMessage(
      ctx,
      progressMessageId,
      6,
      6,
      'Procesamiento completado',
      `${data.length} registros agrupados`
    );

    // Construir resumen
    let resumenText = `📊 **Resumen de servicios CHUBB agrupados:**\n\n`;

    if (grupos.gruaConRetencion.length > 0) {
      resumenText += `🚛 **Grúa con Retención (4%):**\n`;
      resumenText += `   • ${grupos.gruaConRetencion.length} servicios\n`;
      resumenText += `   • Monto: $${montosPorGrupo.gruaConRetencion.toFixed(2)}\n\n`;
    }

    if (grupos.gruaSinRetencion.length > 0) {
      resumenText += `🚗 **Grúa sin Retención:**\n`;
      resumenText += `   • ${grupos.gruaSinRetencion.length} servicios\n`;
      resumenText += `   • Monto: $${montosPorGrupo.gruaSinRetencion.toFixed(2)}\n\n`;
    }

    if (grupos.otrosServicios.length > 0) {
      resumenText += `🔧 **Otros Servicios:**\n`;
      resumenText += `   • ${grupos.otrosServicios.length} servicios\n`;
      resumenText += `   • Monto: $${montosPorGrupo.otrosServicios.toFixed(2)}\n\n`;
    }

    const totalFacturas =
      (grupos.gruaConRetencion.length > 0 ? 1 : 0) +
      (grupos.gruaSinRetencion.length > 0 ? 1 : 0) +
      (grupos.otrosServicios.length > 0 ? 1 : 0);

    resumenText += `📋 Se generarán **${totalFacturas} facturas** (una por grupo)\n\n`;
    resumenText += `¿Deseas generar las facturas?`;

    await ctx.reply(resumenText, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(
            `✅ Confirmar y Generar ${totalFacturas} Facturas`,
            `chubb_confirmar:${batchId}`
          ),
        ],
        [Markup.button.callback('❌ Cancelar', BOT_ACTIONS.MENU_PRINCIPAL)],
      ]).reply_markup,
    });

    return { success: true, pendingConfirmation: true };
  } catch (error) {
    logger.error({ error }, 'Error al procesar archivo Excel CHUBB');
    await ctx.reply(
      `❌ Error al procesar el archivo: ${error instanceof Error ? error.message : 'Error desconocido'}`
    );
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' };
  }
}

/**
 * Envía múltiples facturas a FacturAPI (una por grupo)
 */
async function enviarFacturasChubb(ctx: BotContext, batchId: string): Promise<void> {
  try {
    const userId = ctx.from?.id;
    if (!userId) {
      throw new Error('No se pudo obtener el ID del usuario');
    }

    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      throw new Error('No se pudo obtener el ID del tenant');
    }

    const batchResult = await redisBatchStateService.getBatchData<ChubbBatchData>(userId, batchId);

    if (!batchResult.success || !batchResult.data) {
      await ctx.reply('❌ Los datos han expirado. Por favor, suba nuevamente el archivo Excel.');
      return;
    }

    const chubbData = batchResult.data;
    const facturapi = await FacturapiService.getFacturapiClient(tenantId);

    const progressMsg = await ctx.reply('📤 Generando facturas CHUBB...\n⏱️ Por favor espere...');

    const facturasGeneradas: any[] = [];
    const errores: any[] = [];

    // Función auxiliar para crear items de factura
    const crearItems = (servicios: any[], conRetencion: boolean) => {
      const baseTaxes = [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }];
      const taxesWithRetention = [
        ...baseTaxes,
        { type: 'IVA', rate: 0.04, factor: 'Tasa', withholding: true },
      ];

      return servicios.map((servicio) => ({
        quantity: 1,
        product: {
          description: `SERVICIO DE ${servicio.servicio} - CASO ${servicio.numeroCaso}`,
          product_key: SAT_PRODUCT_KEYS.SERVICIOS_GRUA,
          unit_key: SAT_UNIT_KEYS.SERVICIO,
          unit_name: 'SERVICIO',
          price: servicio.monto,
          tax_included: false,
          taxes: conRetencion ? taxesWithRetention : baseTaxes,
        },
      }));
    };

    // Generar factura para Grúa con retención
    if (chubbData.grupos.gruaConRetencion.length > 0) {
      try {
        const items = crearItems(chubbData.grupos.gruaConRetencion, true);
        const facturaData = {
          customer: chubbData.clienteFacturapiId,
          items,
          use: CFDI_USE.GASTOS_GENERAL,
          payment_form: PAYMENT_FORM.POR_DEFINIR,
          payment_method: PAYMENT_METHOD.PAGO_DIFERIDO,
          currency: 'MXN',
          exchange: 1,
        };

        // Calcular datos ANTES de enviar a FacturAPI
        const calculatedData = calculateFinancialDataFromFacturaData(facturaData);

        const factura = await facturapi.invoices.create(facturaData);

        // Extraer datos de la respuesta
        const additionalData = extractAdditionalDataFromFacturapiResponse(factura);

        await TenantService.registerInvoice(
          tenantId,
          factura.id,
          factura.series,
          typeof factura.folio_number === 'number'
            ? factura.folio_number
            : parseInt(factura.folio_number, 10),
          chubbData.clienteId!,
          factura.total,
          typeof userId === 'number' && userId <= 2147483647 ? userId : null,
          factura.uuid,
          {
            subtotal: calculatedData.subtotal,
            ivaAmount: calculatedData.ivaAmount,
            retencionAmount: calculatedData.retencionAmount,
            discount: calculatedData.discount,
            currency: additionalData.currency,
            paymentForm: additionalData.paymentForm,
            paymentMethod: additionalData.paymentMethod,
            verificationUrl: additionalData.verificationUrl,
            satCertNumber: additionalData.satCertNumber,
            usoCfdi: additionalData.usoCfdi,
            tipoComprobante: additionalData.tipoComprobante,
            exportacion: additionalData.exportacion,
            items: additionalData.items,
          }
        );

        facturasGeneradas.push({
          tipo: 'Grúa con Retención (4%)',
          servicios: chubbData.grupos.gruaConRetencion.length,
          factura,
        });

        logger.info({ facturaId: factura.id, tipo: 'gruaConRetencion' }, 'Factura CHUBB generada');
      } catch (error) {
        logger.error({ error, tipo: 'gruaConRetencion' }, 'Error generando factura CHUBB');
        errores.push({
          tipo: 'Grúa con Retención',
          error: error instanceof Error ? error.message : 'Error desconocido',
        });
      }
    }

    // Generar factura para Grúa sin retención
    if (chubbData.grupos.gruaSinRetencion.length > 0) {
      try {
        const items = crearItems(chubbData.grupos.gruaSinRetencion, false);
        const facturaData = {
          customer: chubbData.clienteFacturapiId,
          items,
          use: CFDI_USE.GASTOS_GENERAL,
          payment_form: PAYMENT_FORM.POR_DEFINIR,
          payment_method: PAYMENT_METHOD.PAGO_DIFERIDO,
          currency: 'MXN',
          exchange: 1,
        };

        // Calcular datos ANTES de enviar a FacturAPI
        const calculatedData = calculateFinancialDataFromFacturaData(facturaData);

        const factura = await facturapi.invoices.create(facturaData);

        // Extraer datos de la respuesta
        const additionalData = extractAdditionalDataFromFacturapiResponse(factura);

        await TenantService.registerInvoice(
          tenantId,
          factura.id,
          factura.series,
          typeof factura.folio_number === 'number'
            ? factura.folio_number
            : parseInt(factura.folio_number, 10),
          chubbData.clienteId!,
          factura.total,
          typeof userId === 'number' && userId <= 2147483647 ? userId : null,
          factura.uuid,
          {
            subtotal: calculatedData.subtotal,
            ivaAmount: calculatedData.ivaAmount,
            retencionAmount: calculatedData.retencionAmount,
            discount: calculatedData.discount,
            currency: additionalData.currency,
            paymentForm: additionalData.paymentForm,
            paymentMethod: additionalData.paymentMethod,
            verificationUrl: additionalData.verificationUrl,
            satCertNumber: additionalData.satCertNumber,
            usoCfdi: additionalData.usoCfdi,
            tipoComprobante: additionalData.tipoComprobante,
            exportacion: additionalData.exportacion,
            items: additionalData.items,
          }
        );

        facturasGeneradas.push({
          tipo: 'Grúa sin Retención',
          servicios: chubbData.grupos.gruaSinRetencion.length,
          factura,
        });

        logger.info({ facturaId: factura.id, tipo: 'gruaSinRetencion' }, 'Factura CHUBB generada');
      } catch (error) {
        logger.error({ error, tipo: 'gruaSinRetencion' }, 'Error generando factura CHUBB');
        errores.push({
          tipo: 'Grúa sin Retención',
          error: error instanceof Error ? error.message : 'Error desconocido',
        });
      }
    }

    // Generar factura para Otros Servicios
    if (chubbData.grupos.otrosServicios.length > 0) {
      try {
        const items = crearItems(chubbData.grupos.otrosServicios, false);
        const facturaData = {
          customer: chubbData.clienteFacturapiId,
          items,
          use: CFDI_USE.GASTOS_GENERAL,
          payment_form: PAYMENT_FORM.POR_DEFINIR,
          payment_method: PAYMENT_METHOD.PAGO_DIFERIDO,
          currency: 'MXN',
          exchange: 1,
        };

        // Calcular datos ANTES de enviar a FacturAPI
        const calculatedData = calculateFinancialDataFromFacturaData(facturaData);

        const factura = await facturapi.invoices.create(facturaData);

        // Extraer datos de la respuesta
        const additionalData = extractAdditionalDataFromFacturapiResponse(factura);

        await TenantService.registerInvoice(
          tenantId,
          factura.id,
          factura.series,
          typeof factura.folio_number === 'number'
            ? factura.folio_number
            : parseInt(factura.folio_number, 10),
          chubbData.clienteId!,
          factura.total,
          typeof userId === 'number' && userId <= 2147483647 ? userId : null,
          factura.uuid,
          {
            subtotal: calculatedData.subtotal,
            ivaAmount: calculatedData.ivaAmount,
            retencionAmount: calculatedData.retencionAmount,
            discount: calculatedData.discount,
            currency: additionalData.currency,
            paymentForm: additionalData.paymentForm,
            paymentMethod: additionalData.paymentMethod,
            verificationUrl: additionalData.verificationUrl,
            satCertNumber: additionalData.satCertNumber,
            usoCfdi: additionalData.usoCfdi,
            tipoComprobante: additionalData.tipoComprobante,
            exportacion: additionalData.exportacion,
            items: additionalData.items,
          }
        );

        facturasGeneradas.push({
          tipo: 'Otros Servicios',
          servicios: chubbData.grupos.otrosServicios.length,
          factura,
        });

        logger.info({ facturaId: factura.id, tipo: 'otrosServicios' }, 'Factura CHUBB generada');
      } catch (error) {
        logger.error({ error, tipo: 'otrosServicios' }, 'Error generando factura CHUBB');
        errores.push({
          tipo: 'Otros Servicios',
          error: error instanceof Error ? error.message : 'Error desconocido',
        });
      }
    }

    // Eliminar mensaje de progreso
    try {
      await ctx.telegram.deleteMessage(ctx.chat?.id!, progressMsg.message_id);
    } catch (e) {
      logger.debug('No se pudo eliminar mensaje de progreso');
    }

    // Mostrar resultados CON BOTONES DE DESCARGA (como V1)
    if (facturasGeneradas.length > 0) {
      let resumenText = `🎉 **Facturas CHUBB generadas exitosamente**\n\n`;
      resumenText += `✅ Se generaron ${facturasGeneradas.length} facturas:\n\n`;

      // Crear botones para cada factura (como V1)
      const botonesDescarga: any[] = [];

      facturasGeneradas.forEach((f, idx) => {
        const folio = `${f.factura.series}-${f.factura.folio_number}`;
        resumenText += `📋 Factura ${idx + 1}: ${folio} ($${f.factura.total.toFixed(2)})\n`;

        // Agregar par de botones PDF/XML para esta factura
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

      if (errores.length > 0) {
        resumenText += `\n⚠️ ${errores.length} facturas con errores\n`;
      }

      resumenText += `\n📥 Seleccione una opción para descargar:`;

      // Agregar botón de volver al final
      botonesDescarga.push([
        Markup.button.callback('🔙 Volver al Menú', BOT_ACTIONS.MENU_PRINCIPAL),
      ]);

      await ctx.reply(resumenText, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(botonesDescarga).reply_markup,
      });
    }

    if (errores.length > 0) {
      let errorText = `❌ **Errores en ${errores.length} facturas:**\n\n`;
      errores.forEach((e) => {
        errorText += `• ${e.tipo}: ${e.error.substring(0, 50)}...\n`;
      });
      await ctx.reply(errorText, { parse_mode: 'Markdown' });
    }

    // Limpiar datos de Redis
    await redisBatchStateService.deleteBatchData(userId, batchId);

    if (ctx.userState) {
      ctx.userState.esperando = null;
      delete ctx.userState.chubbBatchId;
    }
  } catch (error) {
    logger.error({ error }, 'Error enviando facturas CHUBB');
    await ctx.reply(
      `❌ Error al generar las facturas: ${error instanceof Error ? error.message : 'Error desconocido'}`
    );
  }
}

/**
 * Registra los manejadores para CHUBB
 */
export function registerChubbHandler(bot: any): void {
  logger.info('Registrando handler de CHUBB (V2 TypeScript)...');

  // ACTION: Menú de CHUBB
  bot.action(BOT_ACTIONS.MENU_CHUBB, async (ctx: BotContext) => {
    try {
      await ctx.answerCbQuery();

      const tenantId = (ctx as any).getTenantId?.();
      if (!tenantId) {
        await ctx.reply('❌ Error: No se encontró tu tenant.');
        return;
      }

      // Buscar cliente CHUBB
      const chubbClient = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          rfc: CLIENT_RFCS.CHUBB,
          isActive: true,
        },
      });

      if (!chubbClient) {
        await ctx.reply('⚠️ Cliente CHUBB no encontrado. Configurando...');

        const { default: CustomerSetupService } = await import(
          '@services/customer-setup.service.js'
        );
        await CustomerSetupService.setupPredefinedCustomers(tenantId, false);

        const chubbClientRetry = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId,
            rfc: CLIENT_RFCS.CHUBB,
            isActive: true,
          },
        });

        if (!chubbClientRetry) {
          await ctx.reply(
            '❌ No se pudo configurar el cliente CHUBB.',
            Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Volver', BOT_ACTIONS.MENU_PRINCIPAL)],
            ])
          );
          return;
        }
      }

      // Marcar esperando archivo
      if (ctx.userState) {
        ctx.userState.esperando = BOT_FLOWS.CHUBB_AWAIT_EXCEL;
      }

      await ctx.reply(
        '📋 **Cliente CHUBB seleccionado**\n\n' +
          '📤 Por favor, envía el archivo Excel con los datos de CHUBB.\n\n' +
          '📝 **Formato esperado:**\n' +
          '• NUMERO CASO\n' +
          '• SERVICIO (tipo de servicio)\n' +
          '• MONTO\n' +
          '• RETENCION (opcional)\n\n' +
          '⏱️ Esperando archivo...',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancelar', BOT_ACTIONS.MENU_PRINCIPAL)],
          ]),
        }
      );
    } catch (error) {
      logger.error({ error }, 'Error en menu_chubb');
      await ctx.reply('❌ Ocurrió un error.');
    }
  });

  // ACTION: Confirmar generación de facturas
  bot.action(/^chubb_confirmar:(.+)$/, async (ctx: BotContext) => {
    try {
      await ctx.answerCbQuery();

      const match = (ctx as any).match;
      const batchId = match ? match[1] : null;

      if (!batchId) {
        await ctx.reply('❌ Error: No se pudo obtener el ID del lote.');
        return;
      }

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await enviarFacturasChubb(ctx, batchId);
    } catch (error) {
      logger.error({ error }, 'Error confirmando facturas CHUBB');
      await ctx.reply('❌ Ocurrió un error al generar las facturas.');
    }
  });

  // HANDLER: Procesamiento de archivo Excel
  bot.on('document', async (ctx: BotContext, next: () => Promise<void>) => {
    try {
      // Verificar si debe detectar este archivo
      const userState = ctx.userState;
      if (!userState || userState.esperando !== BOT_FLOWS.CHUBB_AWAIT_EXCEL) {
        return next();
      }

      if (!ctx.message || !('document' in ctx.message)) {
        return next();
      }

      const document = ctx.message.document;

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
      const receivingMessage = await ctx.reply(
        '📥 Recibiendo archivo Excel de CHUBB...\n⏳ Validando archivo...'
      );
      const receivingMessageId = receivingMessage.message_id;

      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        receivingMessageId,
        undefined,
        `✅ Archivo Excel válido: ${document.file_name}\n⏳ Descargando archivo...`
      );

      // Descargar el archivo
      const fileLink = await ctx.telegram.getFileLink(document.file_id);
      const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });

      // Guardar temporalmente (async)
      const tempDir = path.join(__dirname, '../../../temp');
      await fs.mkdir(tempDir, { recursive: true });

      const tempFileName = `chubb_${ctx.from?.id}_${Date.now()}.xlsx`;
      const filePath = path.join(tempDir, tempFileName);
      await fs.writeFile(filePath, response.data);

      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        receivingMessageId,
        undefined,
        `✅ Archivo recibido: ${document.file_name}\n🔍 Analizando y agrupando servicios...\n⏳ Por favor espere...`
      );

      // Procesar el archivo Excel
      const result = await procesarArchivoChubb(ctx, filePath, receivingMessageId);

      // Eliminar archivo temporal (async)
      await fs.unlink(filePath);

      // Si no hay confirmación pendiente, resetear el estado
      if (!result || !result.pendingConfirmation) {
        if (ctx.userState) {
          ctx.userState.esperando = null;
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error al procesar el archivo Excel CHUBB');
      await ctx.reply(
        `❌ Error al procesar el archivo: ${error instanceof Error ? error.message : 'Error desconocido'}`
      );

      if (ctx.userState) {
        ctx.userState.esperando = null;
      }
    }
  });

  logger.info('✅ Handler de CHUBB (V2 TypeScript) registrado correctamente');
}

export default registerChubbHandler;
