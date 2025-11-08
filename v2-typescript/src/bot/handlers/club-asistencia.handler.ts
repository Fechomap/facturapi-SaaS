/**
 * Club de Asistencia handler for Telegram bot
 * Handles Excel-based invoice generation for Club de Asistencia client
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
import type { ClubAsistenciaBatchData } from '@/types/club-asistencia.types.js';

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
import { validateInvoiceAmount } from '../utils/invoice-validation.utils.js';
import {
  calculateFinancialDataFromFacturaData,
  extractAdditionalDataFromFacturapiResponse,
} from '../utils/invoice-calculation.utils.js';

const logger = createModuleLogger('bot-club-asistencia-handler');

// Constantes específicas de Club de Asistencia
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
    `${PROGRESS_FRAMES[frameIndex]} **Procesando archivo Club de Asistencia**\n\n` +
    `📊 Progreso: ${percentage}% ${PROGRESS_BARS[progressBarIndex]}\n` +
    `🔄 ${currentTask}\n` +
    (details ? `📝 ${details}\n` : '') +
    `\n⏱️ Por favor espere...`;

  try {
    await ctx.telegram.editMessageText(ctx.chat?.id, messageId, undefined, progressText, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    logger.debug('No se pudo editar mensaje de progreso:', (error as Error).message);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Interface para mapeo de columnas Excel Club de Asistencia
 */
interface CASColumnMapping {
  fecha?: string;
  folioCas?: string;
  pedidoSap?: string;
  total: string;
  moneda?: string;
}

/**
 * Mapea los nombres de las columnas encontrados en el Excel Club de Asistencia
 * CORREGIDO: Ahora busca las mismas columnas que V1
 */
function mapColumnNamesCAS(firstRow: Record<string, any>): CASColumnMapping | null {
  if (!firstRow) return null;

  const excelKeys = Object.keys(firstRow);

  const posiblesColumnas: Record<string, string[]> = {
    fecha: ['Fecha', 'FECHA', 'Date'],
    folioCas: ['Folio CAS', 'FOLIO CAS', 'FolioCAS'],
    pedidoSap: ['PEDIDO SAP', 'Pedido SAP', 'PedidoSAP'],
    total: ['Total', 'TOTAL', 'Monto', 'Importe', 'IMPORTE'],
    moneda: ['Moneda', 'MONEDA', 'Currency'],
  };

  const columnMapping: Record<string, string> = {};

  Object.keys(posiblesColumnas).forEach((tipoColumna) => {
    // Búsqueda exacta
    const nombreEncontrado = posiblesColumnas[tipoColumna].find((posibleNombre) =>
      excelKeys.includes(posibleNombre)
    );

    if (nombreEncontrado) {
      columnMapping[tipoColumna] = nombreEncontrado;
    } else {
      // Búsqueda parcial (case-insensitive y sin espacios)
      const matchParcial = excelKeys.find((key) =>
        posiblesColumnas[tipoColumna].some((posibleNombre) => {
          const keyNormalized = key.toLowerCase().replace(/\s+/g, '');
          const possibleNormalized = posibleNombre.toLowerCase().replace(/\s+/g, '');
          return keyNormalized.includes(possibleNormalized);
        })
      );

      if (matchParcial) {
        columnMapping[tipoColumna] = matchParcial;
      }
    }
  });

  // Verificar columnas requeridas: fecha, folioCas, pedidoSap, total
  const requiredKeys = ['fecha', 'folioCas', 'pedidoSap', 'total'];
  if (requiredKeys.every((key) => columnMapping[key])) {
    return {
      total: columnMapping.total,
      fecha: columnMapping.fecha,
      folioCas: columnMapping.folioCas,
      pedidoSap: columnMapping.pedidoSap,
      moneda: columnMapping.moneda,
    };
  }

  logger.warn(
    { columnMapping, requiredKeys, excelKeys },
    'No se encontraron todas las columnas requeridas para Club de Asistencia'
  );
  return null;
}

/**
 * Procesa el archivo Excel de Club de Asistencia y genera datos para facturas
 */
async function procesarArchivoCAS(
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

    // IMPORTANTE: range: 1 salta la primera fila (que puede ser título) y usa fila 2 como headers
    const data = XLSX.utils.sheet_to_json(worksheet, { range: 1 });

    if (data.length === 0) {
      await ctx.reply('❌ El archivo Excel no contiene datos.');
      return { success: false, error: 'Excel sin datos' };
    }

    const columnMappings = mapColumnNamesCAS(data[0] as Record<string, any>);

    if (!columnMappings) {
      await ctx.reply(
        '❌ El archivo Excel no tiene todas las columnas requeridas.\n\nColumnas necesarias: Fecha, Folio CAS, PEDIDO SAP y Total.'
      );
      return { success: false, error: 'Estructura de Excel inválida' };
    }

    logger.info(
      { columnMappings, sampleRows: data.slice(0, 2) },
      'Mapeado de columnas Club de Asistencia'
    );

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
      const total = parseFloat(row[columnMappings.total]);
      if (isNaN(total) || total <= 0) {
        erroresNumericos.push(`Fila ${index + 2}: El total debe ser un número positivo.`);
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

    // IMPORTANTE: Los valores del Excel incluyen IVA, dividir entre 1.16 para obtener el precio base
    const montoTotal = data.reduce((total: number, item: any) => {
      const totalConIva = parseFloat(item[columnMappings.total] || 0);
      const precioBase = totalConIva / 1.16; // Remover IVA
      return total + precioBase;
    }, 0);

    validateInvoiceAmount(montoTotal, 'CLUB_ASISTENCIA', 'el monto total del archivo');

    // Obtener tenantId y cliente
    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      throw new Error('No se pudo obtener la información de tu empresa.');
    }

    const casClient = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId,
        rfc: 'CAS981016P46',
        isActive: true,
      },
    });

    if (!casClient) {
      throw new Error('No se encontró el cliente Club de Asistencia');
    }

    // Precálculo de ambas opciones
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
      const fecha = columnMappings.fecha ? row[columnMappings.fecha] || '' : '';
      const folioCas = columnMappings.folioCas ? row[columnMappings.folioCas] || '' : '';
      const pedidoSap = columnMappings.pedidoSap ? row[columnMappings.pedidoSap] || '' : '';
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
          product_key: SAT_PRODUCT_KEYS.SERVICIOS_GRUA,
          unit_key: SAT_UNIT_KEYS.SERVICIO,
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
      customer: casClient.facturapiCustomerId,
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

    const batchData: ClubAsistenciaBatchData = {
      batchId,
      userId,
      timestamp: Date.now(),
      clienteId: casClient.facturapiCustomerId,
      clienteName: casClient.legalName,
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

    logger.info(
      { userId, batchId, totalRecords: data.length },
      'Batch Club de Asistencia guardado en Redis'
    );

    if (ctx.userState) {
      ctx.userState.clubBatchId = batchId;
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
      `• Servicios de Club de Asistencia:\n  - ${data.length} registros\n  - Subtotal (sin IVA): ${montoTotal.toFixed(2)} MXN\n\n`;

    await ctx.reply(`${infoResumen}\n¿El servicio tiene retención del 4%?`, {
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Sí, con retención 4%',
            `cas_servicios_con_retencion:${batchId}`
          ),
        ],
        [Markup.button.callback('❌ No, sin retención', `cas_servicios_sin_retencion:${batchId}`)],
        [Markup.button.callback('🔙 Cancelar', BOT_ACTIONS.MENU_PRINCIPAL)],
      ]).reply_markup,
    });

    return { success: true, pendingConfirmation: true };
  } catch (error) {
    logger.error({ error }, 'Error al procesar archivo Excel Club de Asistencia');
    await ctx.reply(
      `❌ Error al procesar el archivo: ${error instanceof Error ? error.message : 'Error desconocido'}`
    );
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' };
  }
}

/**
 * Envía factura de Club de Asistencia a FacturAPI
 */
async function enviarFacturaDirectaCAS(
  facturaData: any,
  ctx: BotContext,
  progressMessageId: number | null,
  clienteId: string
): Promise<any> {
  try {
    logger.info(
      { items: facturaData.items.length },
      'Enviando factura Club de Asistencia a FacturAPI'
    );

    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      throw new Error('No se pudo obtener el ID del tenant');
    }

    const facturapi = await FacturapiService.getFacturapiClient(tenantId);

    // Calcular datos ANTES de enviar a FacturAPI
    const calculatedData = calculateFinancialDataFromFacturaData(facturaData);

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

    // Extraer datos de la respuesta
    const additionalData = extractAdditionalDataFromFacturapiResponse(factura);

    // Obtener el ID numérico del cliente desde BD
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
      userId && typeof userId === 'number' && userId <= 2147483647 ? userId : null,
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

    logger.info('Factura registrada en BD exitosamente');

    return factura;
  } catch (error) {
    logger.error({ error }, 'Error al enviar factura a FacturAPI');
    throw error;
  }
}

/**
 * Registers handlers for Club de Asistencia functionality
 */
export function registerClubAsistenciaHandler(bot: any): void {
  logger.info('🟢 Registrando handler Club de Asistencia...');

  bot.action('menu_club_asistencia', async (ctx: BotContext): Promise<void> => {
    logger.info('🟢 ACTION menu_club_asistencia EJECUTADA!');
    await ctx.answerCbQuery();

    try {
      // Clean previous state
      delete ctx.userState.casSummary;
      delete ctx.userState.casClientId;
      delete ctx.userState.clienteId;
      delete ctx.userState.clienteNombre;
      ctx.userState.esperando = null;

      const tenantId = ctx.getTenantId();

      if (!tenantId) {
        await ctx.reply('❌ Error: No se pudo obtener la información de tu empresa.');
        return;
      }

      logger.info('Buscando cliente Club de Asistencia para el tenant:', tenantId);

      const startTime = Date.now();

      // Search Club de Asistencia client by unique RFC
      const casClient = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId: tenantId,
          rfc: 'CAS981016P46',
          isActive: true,
        },
      });

      const searchDuration = Date.now() - startTime;
      logger.info(
        `✅ Cliente Club de Asistencia obtenido en ${searchDuration}ms ${casClient ? '(encontrado)' : '(no encontrado)'}`
      );

      // Fallback: If not found by RFC, try by exact name
      let casClientFallback = casClient;
      if (!casClientFallback) {
        logger.info('⚠️ RFC no encontrado, intentando por nombre exacto...');
        const fallbackStartTime = Date.now();

        casClientFallback = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId: tenantId,
            legalName: 'CLUB DE ASISTENCIA',
            isActive: true,
          },
        });

        const fallbackDuration = Date.now() - fallbackStartTime;
        logger.info(
          `✅ Fallback completado en ${fallbackDuration}ms ${casClientFallback ? '(encontrado)' : '(no encontrado)'}`
        );
      }

      if (!casClientFallback) {
        await ctx.reply(
          '⚠️ No se encontró el cliente Club de Asistencia. Intentando configurar clientes predefinidos...'
        );

        try {
          await CustomerSetupService.setupPredefinedCustomers(tenantId, false);

          const casClientAfterSetup = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId: tenantId,
              legalName: 'CLUB DE ASISTENCIA',
              isActive: true,
            },
          });

          if (!casClientAfterSetup) {
            await ctx.reply(
              '❌ Error: No se pudo encontrar o configurar el cliente Club de Asistencia. Por favor, contacta al administrador.'
            );
            return;
          }

          ctx.userState.casClientId = casClientAfterSetup.facturapiCustomerId;
          ctx.userState.clienteNombre = casClientAfterSetup.legalName;
          logger.info(
            `Cliente Club de Asistencia configurado y encontrado: ${casClientAfterSetup.legalName} (ID: ${casClientAfterSetup.facturapiCustomerId})`
          );
        } catch (setupError) {
          logger.error('Error al configurar clientes predefinidos:', setupError);
          await ctx.reply(
            '❌ Error: No se pudo configurar el cliente Club de Asistencia. Por favor, contacta al administrador.'
          );
          return;
        }
      } else {
        ctx.userState.casClientId = casClientFallback.facturapiCustomerId;
        ctx.userState.clienteNombre = casClientFallback.legalName;
        logger.info(
          `Cliente Club de Asistencia cargado exitosamente: ${casClientFallback.legalName} (ID: ${casClientFallback.facturapiCustomerId})`
        );
      }

      ctx.userState.esperando = 'archivo_excel_club_asistencia';

      await ctx.reply(
        'Por favor, sube el archivo Excel con los datos de Club de Asistencia para generar las facturas.'
      );
    } catch (error) {
      logger.error('Error al buscar cliente Club de Asistencia:', error);
      await ctx.reply('❌ Error al buscar cliente Club de Asistencia: ' + (error as Error).message);
    }
  });

  // Handler for services with retention
  bot.action(/^cas_servicios_con_retencion:(.+)$/, async (ctx: BotContext): Promise<void> => {
    const startTime = Date.now(); // ✅ FIX: Declarar startTime
    logger.info('BOTÓN CON RETENCIÓN: Iniciando...');

    await ctx.answerCbQuery();

    const match = (ctx as any).match;
    const batchId = match ? match[1] : null;

    if (!batchId || !ctx.from?.id) {
      await ctx.reply('❌ Error: No se pudo obtener el ID del lote.');
      return;
    }

    // ✅ FASE 1.5: Usar Redis
    const batchResult = await redisBatchStateService.getBatchData<ClubAsistenciaBatchData>(
      ctx.from.id,
      batchId
    );

    if (!batchResult.success || !batchResult.data?.facturaConRetencion) {
      logger.info('Datos no disponibles en Redis');
      await ctx.reply('❌ Los datos han expirado. Por favor, suba nuevamente el archivo Excel.');
      return;
    }

    const tempData = batchResult.data;
    logger.info('TempData recuperado de Redis OK');

    // Actualizar selección en Redis
    await redisBatchStateService.updateBatchData<ClubAsistenciaBatchData>(ctx.from.id, batchId, {
      seleccionUsuario: {
        conRetencion: true,
        timestamp: Date.now(),
      },
    });

    ctx.userState.casConRetencion = true;
    ctx.userState.clubBatchId = batchId;

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch((e) => {
      logger.debug('No se pudo editar mensaje:', (e as Error).message);
    });

    await ctx.reply(
      `✅ *Servicios con Retención seleccionados*\n\n` +
        `• Se aplicará retención del 4%\n` +
        `• ${tempData.facturaConRetencion?.items.length ?? 0} registros\n` +
        `• **Total: $${tempData.facturaConRetencion?.total.toFixed(2) ?? '0.00'}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', `cas_confirmar_final:${batchId}`)],
          [Markup.button.callback('❌ Cancelar', 'cas_cancelar')],
        ]).reply_markup,
      }
    );

    const duration = Date.now() - startTime;
    logger.info(`🔵 BOTÓN CON RETENCIÓN: Completado en ${duration}ms`);
  });

  // Handler for services without retention
  bot.action(/^cas_servicios_sin_retencion:(.+)$/, async (ctx: BotContext): Promise<void> => {
    const startTime = Date.now(); // ✅ FIX: Declarar startTime
    logger.info('BOTÓN SIN RETENCIÓN: Iniciando...');

    await ctx.answerCbQuery();

    const match = (ctx as any).match;
    const batchId = match ? match[1] : null;

    if (!batchId || !ctx.from?.id) {
      await ctx.reply('❌ Error: No se pudo obtener el ID del lote.');
      return;
    }

    // ✅ FASE 1.5: Usar Redis
    const batchResult = await redisBatchStateService.getBatchData<ClubAsistenciaBatchData>(
      ctx.from.id,
      batchId
    );

    if (!batchResult.success || !batchResult.data?.facturaSinRetencion) {
      logger.info('Datos no disponibles en Redis');
      await ctx.reply('❌ Los datos han expirado. Por favor, suba nuevamente el archivo Excel.');
      return;
    }

    const tempData = batchResult.data;
    logger.info('TempData recuperado de Redis OK');

    // Actualizar selección en Redis
    await redisBatchStateService.updateBatchData<ClubAsistenciaBatchData>(ctx.from.id, batchId, {
      seleccionUsuario: {
        conRetencion: false,
        timestamp: Date.now(),
      },
    });

    ctx.userState.casConRetencion = false;
    ctx.userState.clubBatchId = batchId;

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch((e) => {
      logger.debug('No se pudo editar mensaje:', (e as Error).message);
    });

    await ctx.reply(
      `✅ *Servicios sin Retención seleccionados*\n\n` +
        `• Sin retención\n` +
        `• ${tempData.facturaSinRetencion?.items.length ?? 0} registros\n` +
        `• **Total: $${tempData.facturaSinRetencion?.total.toFixed(2) ?? '0.00'}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', `cas_confirmar_final:${batchId}`)],
          [Markup.button.callback('❌ Cancelar', 'cas_cancelar')],
        ]).reply_markup,
      }
    );

    const duration = Date.now() - startTime;
    logger.info(`🟡 BOTÓN SIN RETENCIÓN: Completado en ${duration}ms`);
  });

  // Confirm generation
  bot.action(/^cas_confirmar_final:(.+)$/, async (ctx: BotContext) => {
    await ctx.answerCbQuery();

    const match = (ctx as any).match;
    const batchId = match ? match[1] : null;

    if (!batchId || !ctx.from?.id) {
      await ctx.reply('❌ Error: No se pudo obtener el ID del lote.');
      return;
    }

    const facturaProgressMsg = await ctx.reply(
      '⚡ Procesando factura Club de Asistencia...\n⏳ Validando datos...'
    );

    // ✅ FASE 1.5: Recuperar desde Redis
    const batchResult = await redisBatchStateService.getBatchData<ClubAsistenciaBatchData>(
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

    if (!tempData || !tempData.facturaConRetencion || !tempData.facturaSinRetencion) {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        facturaProgressMsg.message_id,
        undefined,
        '❌ Datos incompletos. Por favor, suba nuevamente el archivo Excel.'
      );
      return;
    }

    let conRetencion = ctx.userState.casConRetencion;

    if (conRetencion === undefined && tempData.seleccionUsuario) {
      conRetencion = tempData.seleccionUsuario.conRetencion;
      ctx.userState.casConRetencion = conRetencion;
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

      // Enviar factura a FacturAPI
      const factura = await enviarFacturaDirectaCAS(
        facturaData.facturaData,
        ctx,
        facturaProgressMsg.message_id,
        tempData.clienteId!
      );

      if (factura) {
        const folio = `${factura.series}-${factura.folio_number}`;

        let resumenText = `🎯 *Proceso Club de Asistencia completado*\n\n`;
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

      delete ctx.userState.casSummary;
      delete ctx.userState.casConRetencion;

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
  bot.action('cas_cancelar', async (ctx: BotContext) => {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await ctx.reply('❌ Operación cancelada.');

      delete ctx.userState.casSummary;
      delete ctx.userState.casConRetencion;

      // ✅ FASE 1.5: Limpiar datos en Redis si existen
      const batchId = ctx.userState.clubBatchId;
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
    logger.info('=========== INICIO HANDLER CLUB ASISTENCIA EXCEL ===========');

    // Check if it's for Club de Asistencia
    if (ctx.userState?.esperando !== 'archivo_excel_club_asistencia') {
      logger.info('No es para Club de Asistencia, pasando...');
      return next();
    }

    const receivingMessage = await ctx.reply(
      '📥 Recibiendo archivo Excel de Club de Asistencia...\n⏳ Validando archivo...'
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

      const tempFileName = `club_asistencia_${ctx.from?.id}_${Date.now()}.xlsx`;
      const filePath = path.join(tempDir, tempFileName);
      await fs.writeFile(filePath, response.data);

      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        receivingMessage.message_id,
        undefined,
        `✅ Archivo recibido: ${document.file_name}\n🔍 Procesando Excel...`
      );

      const result = await procesarArchivoCAS(ctx, filePath, receivingMessage.message_id);

      await fs.unlink(filePath);

      if (!result || !result.pendingConfirmation) {
        ctx.userState.esperando = null;
      }

      logger.info('=========== FIN HANDLER CLUB ASISTENCIA EXCEL ===========');
    } catch (error) {
      logger.error('Error al procesar Excel:', error);
      await ctx.reply(`❌ Error: ${(error as Error).message}`);
      ctx.userState.esperando = null;
    }
  });
}
