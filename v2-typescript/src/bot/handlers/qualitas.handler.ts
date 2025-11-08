/**
 * Qualitas handler for Telegram bot
 * Handles Excel-based invoice generation for Qualitas client
 */

import { Markup } from 'telegraf';
import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import type { BotContext } from '@/types/bot.types.js';
import { createModuleLogger } from '@core/utils/logger.js';
import { prisma } from '@/config/database.js';

// Service imports
import CustomerSetupService from '@services/customer-setup.service.js';
import FacturapiService from '@services/facturapi.service.js';
import TenantService from '@core/tenant/tenant.service.js';
import redisBatchStateService from '@services/redis-batch-state.service.js'; // ✅ FASE 1.5: Redis
import type { QualitasBatchData } from '@/types/qualitas.types.js';

// Constantes
import {
  SAT_PRODUCT_KEYS,
  SAT_UNIT_KEYS,
  CFDI_USE,
  PAYMENT_FORM,
  PAYMENT_METHOD,
} from '@/constants/clients.js';

// Utils
import { validateInvoiceAmount } from '../utils/invoice-validation.utils.js';
import { BOT_ACTIONS } from '@/constants/bot-flows.js';

const logger = createModuleLogger('bot-qualitas-handler');

// Constantes específicas de Qualitas
const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Progress visual utilities
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

interface QualitasData {
  facturaConRetencion?: {
    items: any[];
    total: number;
    facturaData: any;
  };
  facturaSinRetencion?: {
    items: any[];
    total: number;
    facturaData: any;
  };
  seleccionUsuario?: {
    conRetencion: boolean;
    timestamp: number;
  };
}

/**
 * Updates progress message with animation
 */
async function updateProgressMessage(
  ctx: BotContext,
  messageId: number | null,
  step: number,
  total: number,
  currentTask: string,
  details: string = ''
): Promise<void> {
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
    await ctx.telegram.editMessageText(ctx.chat?.id, messageId, undefined, progressText, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    // Ignore editing errors
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Interface para mapeo de columnas Excel Qualitas
 */
interface QualitasColumnMapping {
  orden?: string;
  folio?: string;
  servicio?: string;
  importe: string;
  descripcion?: string;
}

/**
 * Mapea los nombres de las columnas encontrados en el Excel Qualitas
 */
function mapColumnNamesQualitas(firstRow: Record<string, any>): QualitasColumnMapping | null {
  if (!firstRow) return null;

  const posiblesColumnas: Record<string, string[]> = {
    orden: ['ORDEN', 'Orden', 'No. ORDEN', 'Numero Orden', 'No ORDEN', 'Reporte'],
    folio: ['FOLIO', 'Folio', 'No. FOLIO', 'Numero Folio', 'No FOLIO'],
    servicio: ['SERVICIO', 'Servicio', 'Tipo Servicio', 'Tipo'],
    importe: ['IMPORTE', 'Importe', 'Monto', 'Valor', 'Total', 'Costo'],
    descripcion: ['DESCRIPCION', 'Descripcion', 'Descripción', 'Desc'],
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

  if (columnMapping.importe) {
    return {
      importe: columnMapping.importe,
      orden: columnMapping.orden,
      folio: columnMapping.folio,
      servicio: columnMapping.servicio,
      descripcion: columnMapping.descripcion,
    };
  }

  logger.warn({ columnMapping }, 'No se encontraron todas las columnas requeridas para Qualitas');
  return null;
}

/**
 * Procesa el archivo Excel de Qualitas y genera datos para facturas
 */
async function procesarArchivoQualitas(
  ctx: BotContext,
  filePath: string,
  progressMessageId: number | null
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

    const columnMappings = mapColumnNamesQualitas(data[0] as Record<string, any>);

    if (!columnMappings) {
      await ctx.reply('❌ El archivo Excel no tiene la columna de IMPORTE requerida.');
      return { success: false, error: 'Estructura de Excel inválida' };
    }

    logger.info({ columnMappings, sampleRows: data.slice(0, 2) }, 'Mapeado de columnas Qualitas');

    await updateProgressMessage(
      ctx,
      progressMessageId,
      3,
      6,
      'Validando datos',
      `Verificando ${data.length} registros...`
    );

    const erroresNumericos: string[] = [];
    data.forEach((row: any, index: number) => {
      const importe = parseFloat(row[columnMappings.importe]);
      if (isNaN(importe) || importe <= 0) {
        erroresNumericos.push(`Fila ${index + 2}: El importe debe ser un número positivo.`);
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
      'Calculando totales',
      `Procesando ${data.length} registros...`
    );

    const montoTotal = data.reduce((total: number, item: any) => {
      return total + parseFloat(item[columnMappings.importe] || 0);
    }, 0);

    validateInvoiceAmount(montoTotal, 'QUALITAS', 'el monto total del archivo');

    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      throw new Error('No se pudo obtener la información de tu empresa.');
    }

    const qualitasClient = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId,
        rfc: 'QCS931209G49',
        isActive: true,
      },
    });

    if (!qualitasClient) {
      throw new Error('No se encontró el cliente Qualitas');
    }

    logger.info('Iniciando precálculo de facturas con y sin retención...');

    const baseTaxes = [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }];
    const taxesWithRetention = [
      ...baseTaxes,
      { type: 'IVA', rate: 0.04, factor: 'Tasa', withholding: true },
    ];

    const itemsConRetencion: any[] = [];
    const itemsSinRetencion: any[] = [];
    let subtotal = 0;

    for (const row of data as any[]) {
      const orden = columnMappings.orden ? row[columnMappings.orden] || '' : '';
      const folio = columnMappings.folio ? row[columnMappings.folio] || '' : '';
      const servicio = columnMappings.servicio ? row[columnMappings.servicio] || '' : '';
      const importe = parseFloat(row[columnMappings.importe]) || 0;
      const descripcion = columnMappings.descripcion
        ? row[columnMappings.descripcion] || 'SERVICIO DE GRUA QUALITAS'
        : 'SERVICIO DE GRUA QUALITAS';

      subtotal += importe;

      const itemBase = {
        quantity: 1,
        product: {
          description: `${descripcion}${servicio ? ` ${servicio}` : ''}${orden ? ` REPORTE ${orden}` : ''}${folio ? ` FOLIO ${folio}` : ''}`,
          product_key: SAT_PRODUCT_KEYS.SERVICIOS_GRUA,
          unit_key: SAT_UNIT_KEYS.SERVICIO,
          unit_name: 'SERVICIO',
          price: importe,
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
      customer: qualitasClient.facturapiCustomerId,
      use: CFDI_USE.GASTOS_GENERAL,
      payment_form: PAYMENT_FORM.POR_DEFINIR,
      payment_method: PAYMENT_METHOD.PAGO_DIFERIDO,
      currency: 'MXN',
      exchange: 1,
    };

    const batchId = redisBatchStateService.generateBatchId();
    const userId = ctx.from?.id;

    if (!userId) {
      throw new Error('No se pudo obtener el ID del usuario');
    }

    const batchData: QualitasBatchData = {
      batchId,
      userId,
      timestamp: Date.now(),
      clienteId: qualitasClient.facturapiCustomerId,
      clienteName: qualitasClient.legalName,
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

    const saveResult = await redisBatchStateService.saveBatchData(userId, batchId, batchData);

    if (!saveResult.success) {
      throw new Error(`Error guardando datos en Redis: ${saveResult.error}`);
    }

    logger.info({ userId, batchId, totalRecords: data.length }, 'Batch Qualitas guardado en Redis');

    if (ctx.userState) {
      ctx.userState.qualitasBatchId = batchId;
    }

    await updateProgressMessage(
      ctx,
      progressMessageId,
      6,
      6,
      'Procesamiento completado',
      `${data.length} registros listos`
    );

    const infoResumen =
      `📊 Resumen de datos procesados:\n\n` +
      `• Servicios Qualitas:\n  - ${data.length} registros\n  - Monto total: ${montoTotal.toFixed(2)} MXN\n\n`;

    await ctx.reply(`${infoResumen}\n¿El servicio tiene retención del 4%?`, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('✅ Sí, con retención 4%', `qualitas_con_retencion:${batchId}`)],
        [Markup.button.callback('❌ No, sin retención', `qualitas_sin_retencion:${batchId}`)],
        [Markup.button.callback('🔙 Cancelar', BOT_ACTIONS.MENU_PRINCIPAL)],
      ]).reply_markup,
    });

    return { success: true, pendingConfirmation: true };
  } catch (error) {
    logger.error({ error }, 'Error al procesar archivo Excel Qualitas');
    await ctx.reply(
      `❌ Error al procesar el archivo: ${error instanceof Error ? error.message : 'Error desconocido'}`
    );
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' };
  }
}

/**
 * Envía factura de Qualitas a FacturAPI
 */
async function enviarFacturaDirectaQualitas(
  facturaData: any,
  ctx: BotContext,
  progressMessageId: number | null,
  clienteId: string
): Promise<any> {
  try {
    logger.info({ items: facturaData.items.length }, 'Enviando factura Qualitas a FacturAPI');

    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      throw new Error('No se pudo obtener el ID del tenant');
    }

    const facturapi = await FacturapiService.getFacturapiClient(tenantId);

    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        progressMessageId,
        undefined,
        `🚀 Enviando a FacturAPI...\n📡 Conectando con servidor...`
      );
    }

    const factura = await facturapi.invoices.create(facturaData);
    logger.info(
      { facturaId: factura.id, folio: factura.folio_number },
      'Factura creada exitosamente'
    );

    const cliente = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId,
        facturapiCustomerId: clienteId,
      },
    });

    if (!cliente) {
      throw new Error('No se pudo encontrar el cliente en la base de datos');
    }

    const userId = ctx.from?.id;
    await TenantService.registerInvoice(
      tenantId,
      factura.id,
      factura.series,
      typeof factura.folio_number === 'number'
        ? factura.folio_number
        : parseInt(factura.folio_number, 10),
      cliente.id,
      factura.total,
      userId && typeof userId === 'number' && userId <= 2147483647 ? userId : null
    );

    logger.info('Factura registrada en BD exitosamente');

    return factura;
  } catch (error) {
    logger.error({ error }, 'Error al enviar factura a FacturAPI');
    throw error;
  }
}

/**
 * Registers handlers for Qualitas
 */
export function registerQualitasHandler(bot: any): void {
  logger.info('🟢 Registrando handler Qualitas...');

  bot.action('menu_qualitas', async (ctx: BotContext): Promise<void> => {
    logger.info('🟢 ACTION menu_qualitas EJECUTADA!');
    await ctx.answerCbQuery();

    try {
      // Clean previous state
      delete ctx.userState.qualitasSummary;
      delete ctx.userState.qualitasClientId;
      delete ctx.userState.clienteId;
      delete ctx.userState.clienteNombre;
      ctx.userState.esperando = null;

      const tenantId = ctx.getTenantId();
      if (!tenantId) {
        await ctx.reply('❌ Error: No se pudo obtener la información de tu empresa.');
        return;
      }

      logger.info('Buscando cliente Qualitas para el tenant:', tenantId);

      const startTime = Date.now();

      // Search by RFC
      const qualitasClient = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId: tenantId,
          rfc: 'QCS931209G49',
          isActive: true,
        },
      });

      const searchDuration = Date.now() - startTime;
      logger.info(
        `✅ Cliente Qualitas obtenido en ${searchDuration}ms ${qualitasClient ? '(encontrado)' : '(no encontrado)'}`
      );

      // Fallback by name
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
          await CustomerSetupService.setupPredefinedCustomers(tenantId, false);

          const qualitasClientAfterSetup = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId: tenantId,
              rfc: 'QCS931209G49',
              isActive: true,
            },
          });

          if (!qualitasClientAfterSetup) {
            await ctx.reply(
              '❌ Error: No se pudo encontrar o configurar el cliente Qualitas. Por favor, contacta al administrador.'
            );
            return;
          }

          ctx.userState.qualitasClientId = qualitasClientAfterSetup.facturapiCustomerId;
          ctx.userState.clienteNombre = qualitasClientAfterSetup.legalName;
        } catch (setupError) {
          logger.error('Error al configurar clientes:', setupError);
          await ctx.reply('❌ Error: No se pudo configurar el cliente Qualitas.');
          return;
        }
      } else {
        ctx.userState.qualitasClientId = qualitasClientFallback.facturapiCustomerId;
        ctx.userState.clienteNombre = qualitasClientFallback.legalName;
        logger.info(
          `Cliente Qualitas cargado: ${qualitasClientFallback.legalName} (ID: ${qualitasClientFallback.facturapiCustomerId})`
        );
      }

      ctx.userState.esperando = 'archivo_excel_qualitas';

      await ctx.reply(
        'Por favor, sube el archivo Excel con los datos de Qualitas para generar las facturas.'
      );
    } catch (error) {
      logger.error('Error al buscar cliente Qualitas:', error);
      await ctx.reply('❌ Error al buscar cliente Qualitas: ' + (error as Error).message);
    }
  });

  // Button with retention
  bot.action(/^qualitas_con_retencion:(.+)$/, async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery();

    const match = (ctx as any).match;
    const batchId = match ? match[1] : null;

    if (!batchId || !ctx.from?.id) {
      await ctx.reply('❌ Error: No se pudo obtener el ID del lote.');
      return;
    }

    // ✅ FASE 1.5: Usar Redis en lugar de global cache
    const batchResult = await redisBatchStateService.getBatchData<QualitasBatchData>(
      ctx.from.id,
      batchId
    );

    if (!batchResult.success || !batchResult.data?.facturaConRetencion) {
      await ctx.reply('❌ Los datos han expirado. Por favor, suba nuevamente el archivo Excel.');
      return;
    }

    const tempData = batchResult.data;

    // Actualizar selección en Redis
    await redisBatchStateService.updateBatchData<QualitasBatchData>(ctx.from.id, batchId, {
      seleccionUsuario: {
        conRetencion: true,
        timestamp: Date.now(),
      },
    });

    ctx.userState.qualitasConRetencion = true;
    ctx.userState.qualitasBatchId = batchId;

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

    await ctx.reply(
      `✅ *Servicios con Retención seleccionados*\n\n` +
        `• Se aplicará retención del 4%\n` +
        `• ${tempData.facturaConRetencion?.items.length ?? 0} registros\n` +
        `• **Total: $${tempData.facturaConRetencion?.total.toFixed(2) ?? '0.00'}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', `qualitas_confirmar_final:${batchId}`)],
          [Markup.button.callback('❌ Cancelar', 'qualitas_cancelar')],
        ]).reply_markup,
      }
    );
  });

  // Button without retention
  bot.action(/^qualitas_sin_retencion:(.+)$/, async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery();

    const match = (ctx as any).match;
    const batchId = match ? match[1] : null;

    if (!batchId || !ctx.from?.id) {
      await ctx.reply('❌ Error: No se pudo obtener el ID del lote.');
      return;
    }

    // ✅ FASE 1.5: Usar Redis en lugar de global cache
    const batchResult = await redisBatchStateService.getBatchData<QualitasBatchData>(
      ctx.from.id,
      batchId
    );

    if (!batchResult.success || !batchResult.data?.facturaSinRetencion) {
      await ctx.reply('❌ Los datos han expirado. Por favor, suba nuevamente el archivo Excel.');
      return;
    }

    const tempData = batchResult.data;

    // Actualizar selección en Redis
    await redisBatchStateService.updateBatchData<QualitasBatchData>(ctx.from.id, batchId, {
      seleccionUsuario: {
        conRetencion: false,
        timestamp: Date.now(),
      },
    });

    ctx.userState.qualitasConRetencion = false;
    ctx.userState.qualitasBatchId = batchId;

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

    await ctx.reply(
      `✅ *Servicios sin Retención seleccionados*\n\n` +
        `• Sin retención\n` +
        `• ${tempData.facturaSinRetencion?.items.length ?? 0} registros\n` +
        `• **Total: $${tempData.facturaSinRetencion?.total.toFixed(2) ?? '0.00'}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', `qualitas_confirmar_final:${batchId}`)],
          [Markup.button.callback('❌ Cancelar', 'qualitas_cancelar')],
        ]).reply_markup,
      }
    );
  });

  // Confirm generation
  bot.action(/^qualitas_confirmar_final:(.+)$/, async (ctx: BotContext) => {
    await ctx.answerCbQuery();

    const match = (ctx as any).match;
    const batchId = match ? match[1] : null;

    if (!batchId || !ctx.from?.id) {
      await ctx.reply('❌ Error: No se pudo obtener el ID del lote.');
      return;
    }

    const facturaProgressMsg = await ctx.reply(
      '⚡ Procesando factura Qualitas...\n⏳ Validando datos...'
    );

    // ✅ FASE 1.5: Recuperar datos desde Redis
    const batchResult = await redisBatchStateService.getBatchData<QualitasBatchData>(
      ctx.from.id,
      batchId
    );

    if (!batchResult.success || !batchResult.data) {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        facturaProgressMsg.message_id,
        undefined,
        '❌ Los datos han expirado. Por favor, suba nuevamente el archivo Excel.'
      );
      return;
    }

    const tempData = batchResult.data;

    if (!tempData.facturaConRetencion || !tempData.facturaSinRetencion) {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        facturaProgressMsg.message_id,
        undefined,
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
        ctx.chat?.id,
        facturaProgressMsg.message_id,
        undefined,
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
        ctx.chat?.id,
        facturaProgressMsg.message_id,
        undefined,
        `⚡ Factura ${conRetencion ? '(con retención 4%)' : '(sin retención)'}...\n` +
          `📊 ${facturaData.items.length} items, Total: $${facturaData.total.toFixed(2)}\n` +
          `🚀 Enviando a FacturAPI...`,
        { parse_mode: 'Markdown' }
      );

      const factura = await enviarFacturaDirectaQualitas(
        facturaData.facturaData,
        ctx,
        facturaProgressMsg.message_id,
        tempData.clienteId!
      );

      if (factura) {
        const folio = `${factura.series}-${factura.folio_number}`;

        let resumenText = `🎯 *Proceso Qualitas completado*\n\n`;
        resumenText += `✅ Factura generada:\n\n`;
        resumenText += `📋 Factura: ${folio} ($${factura.total.toFixed(2)})\n`;
        resumenText += `📊 ${facturaData.items.length} servicios procesados\n`;
        resumenText += `💰 Total: $${facturaData.total.toFixed(2)}\n\n`;
        resumenText += `📥 Seleccione una opción para descargar:`;

        // Crear botones de descarga
        const botonesDescarga: any[] = [];

        // Par de botones PDF/XML
        botonesDescarga.push([
          Markup.button.callback(`📄 PDF ${folio}`, `pdf_${factura.id}_${factura.folio_number}`),
          Markup.button.callback(`🔠 XML ${folio}`, `xml_${factura.id}_${factura.folio_number}`),
        ]);

        // Botón de volver al menú
        botonesDescarga.push([
          Markup.button.callback('🔙 Volver al Menú', BOT_ACTIONS.MENU_PRINCIPAL),
        ]);

        await ctx.reply(resumenText, {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard(botonesDescarga).reply_markup,
        });
      } else {
        await ctx.reply('⚠️ No se generó la factura. Error en FacturAPI.');
      }

      delete ctx.userState.qualitasSummary;
      delete ctx.userState.qualitasConRetencion;

      // ✅ FASE 1.5: Limpiar datos en Redis
      if (ctx.from?.id && batchId) {
        await redisBatchStateService.deleteBatchData(ctx.from.id, batchId);
      }

      ctx.userState.esperando = null;
    } catch (error) {
      logger.error('Error al generar factura:', error);
      await ctx.reply(`❌ Error al generar factura: ${(error as Error).message}`);
      ctx.userState.esperando = null;
    }
  });

  // Cancel
  bot.action('qualitas_cancelar', async (ctx: BotContext) => {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await ctx.reply('❌ Operación cancelada.');

      delete ctx.userState.qualitasSummary;
      delete ctx.userState.qualitasConRetencion;

      // ✅ FASE 1.5: Limpiar datos en Redis si existen
      const batchId = ctx.userState.qualitasBatchId;
      if (ctx.from?.id && batchId) {
        await redisBatchStateService.deleteBatchData(ctx.from.id, batchId);
      }

      ctx.userState.esperando = null;
    } catch (error) {
      logger.error('Error al cancelar:', error);
      ctx.userState.esperando = null;
    }
  });

  // Excel document handler
  bot.on('document', async (ctx: BotContext, next: () => Promise<void>) => {
    logger.info('=========== INICIO HANDLER QUALITAS EXCEL ===========');

    // Check if it's for Qualitas
    if (ctx.userState?.esperando !== 'archivo_excel_qualitas') {
      logger.info('No es para Qualitas, pasando...');
      return next();
    }

    const receivingMessage = await ctx.reply(
      '📥 Recibiendo archivo Excel de Qualitas...\n⏳ Validando archivo...'
    );

    if (!ctx.message || !('document' in ctx.message)) {
      return next();
    }

    const document = ctx.message.document;

    // Validate Excel file
    if (
      !document.mime_type?.includes('spreadsheet') &&
      !document.file_name?.match(/\.(xlsx?|csv)$/i)
    ) {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        receivingMessage.message_id,
        undefined,
        '❌ El archivo debe ser de tipo Excel (.xlsx o .xls).'
      );
      return;
    }

    try {
      const fileLink = await ctx.telegram.getFileLink(document.file_id);
      const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });

      const tempDir = path.join(__dirname, '../../../temp');
      await fs.mkdir(tempDir, { recursive: true });

      const tempFileName = `qualitas_${ctx.from?.id}_${Date.now()}.xlsx`;
      const filePath = path.join(tempDir, tempFileName);
      await fs.writeFile(filePath, response.data);

      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        receivingMessage.message_id,
        undefined,
        `✅ Archivo recibido: ${document.file_name}\n🔍 Procesando Excel...`
      );

      const result = await procesarArchivoQualitas(ctx, filePath, receivingMessage.message_id);

      await fs.unlink(filePath);

      if (!result || !result.pendingConfirmation) {
        ctx.userState.esperando = null;
      }

      logger.info('=========== FIN HANDLER QUALITAS EXCEL ===========');
    } catch (error) {
      logger.error('Error al procesar Excel:', error);
      await ctx.reply(`❌ Error: ${(error as Error).message}`);
      ctx.userState.esperando = null;
    }
  });
}
