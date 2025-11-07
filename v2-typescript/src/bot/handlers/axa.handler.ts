/**
 * AXA Handler - Versión TypeScript V2
 * Migrado completamente desde V1 (1383 líneas)
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
import { fileURLToPath } from 'url';

// Prisma
import { prisma } from '@config/database.js';

// Servicios
import FacturapiService from '@services/facturapi.service.js';
import TenantService from '@core/tenant/tenant.service.js';
import redisBatchStateService from '@services/redis-batch-state.service.js';

// Tipos
import type { AxaBatchData, AxaTipoServicio } from '@/types/axa.types.js';

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

// Logger
import { createModuleLogger } from '@core/utils/logger.js';
const logger = createModuleLogger('AxaHandler');

// Obtener __dirname en ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constantes específicas de AXA
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
 * Interface para mapeo de columnas Excel
 */
interface AxaColumnMapping {
  estatus?: string;
  factura: string;
  orden: string;
  folio: string;
  autorizacion: string;
  importe: string;
  iva?: string;
  neto?: string;
  fecha?: string;
}

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
    `${PROGRESS_FRAMES[frameIndex]} **Procesando archivo AXA**\n\n` +
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
 * Mapea los nombres de las columnas encontrados en el Excel AXA a nombres estandarizados
 */
function mapColumnNamesAxa(firstRow: Record<string, any>): AxaColumnMapping | null {
  if (!firstRow) return null;

  // Posibles nombres para cada columna requerida de AXA
  const posiblesColumnas: Record<string, string[]> = {
    estatus: ['ESTATUS', 'Estatus', 'Status', 'Estado'],
    factura: ['FACTURA', 'Factura', 'No. FACTURA', 'Numero Factura'],
    orden: ['No. ORDEN', 'ORDEN', 'Orden', 'Numero Orden', 'No ORDEN'],
    folio: ['No. FOLIO', 'FOLIO', 'Folio', 'Numero Folio', 'No FOLIO'],
    autorizacion: ['AUTORIZACION', 'Autorizacion', 'Autorización', 'Auth'],
    importe: ['IMPORTE', 'Importe', 'Monto', 'Valor', 'Total'],
    iva: ['I.V.A.', 'IVA', 'Iva', 'Impuesto'],
    neto: ['NETO', 'Neto', 'Net', 'Total Neto'],
    fecha: ['FECHA', 'Fecha', 'Date', 'Día'],
  };

  // Objeto para almacenar las columnas encontradas
  const columnMapping: Record<string, string> = {};

  // Buscar el mejor match para cada columna requerida
  Object.keys(posiblesColumnas).forEach((tipoColumna) => {
    // Buscar por nombre exacto primero
    const nombreEncontrado = posiblesColumnas[tipoColumna].find((posibleNombre) =>
      Object.keys(firstRow).includes(posibleNombre)
    );

    if (nombreEncontrado) {
      columnMapping[tipoColumna] = nombreEncontrado;
    }
    // Si no encontramos match exacto, buscar por coincidencia parcial (case insensitive)
    else {
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

  // Verificar que encontramos todas las columnas necesarias
  const requiredKeys: (keyof AxaColumnMapping)[] = [
    'factura',
    'orden',
    'folio',
    'autorizacion',
    'importe',
  ];
  const allRequiredFound = requiredKeys.every((key) => columnMapping[key]);

  if (
    allRequiredFound &&
    columnMapping.factura &&
    columnMapping.orden &&
    columnMapping.folio &&
    columnMapping.autorizacion &&
    columnMapping.importe
  ) {
    return {
      factura: columnMapping.factura,
      orden: columnMapping.orden,
      folio: columnMapping.folio,
      autorizacion: columnMapping.autorizacion,
      importe: columnMapping.importe,
      estatus: columnMapping.estatus,
      iva: columnMapping.iva,
      neto: columnMapping.neto,
      fecha: columnMapping.fecha,
    };
  }

  logger.warn({ columnMapping }, 'No se encontraron todas las columnas requeridas para AXA');
  return null;
}

/**
 * Procesa el archivo Excel de AXA y genera datos para facturas
 */
async function procesarArchivoAxa(
  ctx: Context,
  filePath: string,
  progressMessageId: number | undefined
): Promise<{ success: boolean; pendingConfirmation?: boolean; error?: string }> {
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

    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    const columnNames: (string | undefined)[] = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
      columnNames.push(cell ? String(cell.v) : undefined);
    }

    logger.info({ columnNames }, 'Columnas detectadas en el Excel AXA');

    // PASO 3: Convertir a JSON
    await updateProgressMessage(
      ctx,
      progressMessageId,
      3,
      6,
      'Procesando datos',
      'Convirtiendo a formato interno...'
    );

    const data = XLSX.utils.sheet_to_json(worksheet);

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

    // Mapear nombres de columnas que pueden variar
    const columnMappings = mapColumnNamesAxa(data[0] as Record<string, any>);

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
        '❌ El archivo Excel no tiene todas las columnas requeridas. Se necesitan columnas para: FACTURA, No. ORDEN, No. FOLIO, AUTORIZACION e IMPORTE.'
      );
      return { success: false, error: 'Estructura de Excel inválida' };
    }

    logger.info({ columnMappings, sampleRows: data.slice(0, 2) }, 'Mapeado de columnas AXA');

    // Verificar que los valores numéricos sean correctos
    const erroresNumericos: string[] = [];
    data.forEach((row: any, index: number) => {
      const importe = parseFloat(row[columnMappings.importe]);
      if (isNaN(importe) || importe <= 0) {
        erroresNumericos.push(`Fila ${index + 2}: El importe debe ser un número positivo.`);
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

    const montoTotal = data.reduce((total: number, item: any) => {
      return total + parseFloat(item[columnMappings.importe] || 0);
    }, 0);

    // Obtener tenantId y cliente AXA
    const tenantId = (ctx as any).getTenantId?.();
    if (!tenantId) {
      throw new Error('No se pudo obtener la información de tu empresa.');
    }

    const axaClient = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId,
        rfc: CLIENT_RFCS.AXA,
        isActive: true,
      },
    });

    if (!axaClient) {
      throw new Error('No se encontró el cliente AXA');
    }

    // PRECÁLCULO de ambas opciones (con/sin retención)
    logger.info('Iniciando precálculo de facturas con y sin retención...');
    const precalculoStartTime = Date.now();

    // Configuración de impuestos
    const baseTaxes = [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }];
    const taxesWithRetention = [
      ...baseTaxes,
      { type: 'IVA', rate: 0.04, factor: 'Tasa', withholding: true },
    ];

    // Precalcular items para ambas opciones
    const itemsConRetencion: any[] = [];
    const itemsSinRetencion: any[] = [];
    let subtotal = 0;

    for (const row of data as any[]) {
      const factura = row[columnMappings.factura] || '';
      const orden = row[columnMappings.orden] || '';
      const folio = row[columnMappings.folio] || '';
      const autorizacion = row[columnMappings.autorizacion] || '';
      const importe = parseFloat(row[columnMappings.importe]) || 0;

      subtotal += importe;

      // Item base
      const itemBase = {
        quantity: 1,
        product: {
          description: `ARRASTRE DE GRUA FACTURA ${factura} No. ORDEN ${orden} No. FOLIO ${folio} AUTORIZACION ${autorizacion}`,
          product_key: SAT_PRODUCT_KEYS.SERVICIOS_GRUA,
          unit_key: SAT_UNIT_KEYS.SERVICIO,
          unit_name: 'SERVICIO',
          price: importe,
          tax_included: false,
        },
      };

      // Item CON retención
      itemsConRetencion.push({
        ...itemBase,
        product: { ...itemBase.product, taxes: taxesWithRetention },
      });

      // Item SIN retención
      itemsSinRetencion.push({
        ...itemBase,
        product: { ...itemBase.product, taxes: baseTaxes },
      });
    }

    // Cálculo correcto de totales finales
    const iva16 = subtotal * 0.16;
    const retencion4 = subtotal * 0.04;

    const totalSinRetencion = subtotal + iva16;
    const totalConRetencion = subtotal + iva16 - retencion4;

    // Estructuras completas para FacturAPI
    const facturaBaseData = {
      customer: axaClient.facturapiCustomerId,
      use: CFDI_USE.GASTOS_GENERAL,
      payment_form: PAYMENT_FORM.POR_DEFINIR,
      payment_method: PAYMENT_METHOD.PAGO_DIFERIDO,
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
    logger.info(
      {
        duration: precalculoDuration,
        subtotal,
        totalConRetencion,
        totalSinRetencion,
        itemsConRetencion: itemsConRetencion.length,
        itemsSinRetencion: itemsSinRetencion.length,
      },
      'Precálculo completado'
    );

    // Generar ID único para este batch
    const batchId = redisBatchStateService.generateBatchId();
    const userId = ctx.from?.id;

    if (!userId) {
      throw new Error('No se pudo obtener el ID del usuario');
    }

    // Guardar en Redis
    const batchData: AxaBatchData = {
      batchId,
      userId,
      timestamp: Date.now(),
      clienteId: axaClient.id,
      clienteFacturapiId: axaClient.facturapiCustomerId,
      clienteName: axaClient.legalName,
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

    const saveResult = await redisBatchStateService.saveBatchData(userId, batchId, batchData);

    if (!saveResult.success) {
      throw new Error(`Error guardando datos en Redis: ${saveResult.error}`);
    }

    logger.info({ userId, batchId, totalRecords: data.length }, 'Batch AXA guardado en Redis');

    // Guardar batchId en userState para acceso posterior
    if ((ctx as any).userState) {
      (ctx as any).userState.axaBatchId = batchId;
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

    // Construir resumen de datos
    const infoResumen =
      `📊 Resumen de datos procesados:\n\n` +
      `• Servicios de Grúa AXA:\n  - ${data.length} registros\n  - Monto total: ${montoTotal.toFixed(2)} MXN\n\n`;

    // Preguntar sobre el tipo de servicios
    await ctx.reply(`${infoResumen}\n¿Qué tipo de servicios son?`, {
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '🚛 Servicios Realizados (con retención 4%)',
            `axa_servicios_realizados:${batchId}`
          ),
        ],
        [
          Markup.button.callback(
            '💀 Servicios Muertos (sin retención)',
            `axa_servicios_muertos:${batchId}`
          ),
        ],
        [Markup.button.callback('❌ Cancelar', BOT_ACTIONS.MENU_PRINCIPAL)],
      ]),
    });

    return { success: true, pendingConfirmation: true };
  } catch (error) {
    logger.error({ error }, 'Error al procesar archivo Excel AXA');
    await ctx.reply(
      `❌ Error al procesar el archivo Excel: ${error instanceof Error ? error.message : 'Error desconocido'}`
    );
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' };
  }
}

/**
 * Envía factura precalculada directamente a FacturAPI (SIN RECÁLCULOS)
 */
async function enviarFacturaDirectaAxa(
  facturaData: any,
  ctx: Context,
  progressMessageId: number | undefined,
  clienteId: number
): Promise<any> {
  try {
    logger.info({ items: facturaData.items.length }, 'Enviando factura precalculada a FacturAPI');

    // Obtener tenant y cliente FacturAPI
    const tenantId = (ctx as any).getTenantId?.();
    if (!tenantId) {
      throw new Error('No se pudo obtener el ID del tenant');
    }

    const facturapi = await FacturapiService.getFacturapiClient(tenantId);

    // Actualizar progreso
    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        progressMessageId,
        undefined,
        `🚀 Enviando a FacturAPI...\n📡 Conectando con servidor...`,
        { parse_mode: 'Markdown' }
      );
    }

    // Envío DIRECTO (datos ya preparados)
    logger.info('Enviando solicitud directa a FacturAPI...');
    const factura = await facturapi.invoices.create(facturaData);

    logger.info(
      { facturaId: factura.id, folio: factura.folio_number },
      'Factura creada exitosamente'
    );

    // Registrar factura en BD
    logger.info('Registrando factura en BD...');

    const userId = ctx.from?.id;
    await TenantService.registerInvoice(
      tenantId,
      factura.id,
      factura.series,
      typeof factura.folio_number === 'number'
        ? factura.folio_number
        : parseInt(factura.folio_number, 10),
      clienteId,
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
 * Registra los manejadores para la funcionalidad AXA
 */
export function registerAxaHandler(bot: any): void {
  logger.info('Registrando handler de AXA (V2 TypeScript)...');

  // 1. ACTION: Menú de AXA - Iniciar flujo
  bot.action(BOT_ACTIONS.MENU_AXA, async (ctx: Context) => {
    try {
      await ctx.answerCbQuery();

      const tenantId = (ctx as any).getTenantId?.();
      if (!tenantId) {
        await ctx.reply('❌ Error: No se pudo obtener la información de tu empresa.');
        return;
      }

      // Buscar cliente AXA por RFC único
      let axaClient = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          rfc: CLIENT_RFCS.AXA,
          isActive: true,
        },
      });

      // Fallback: Si no se encuentra por RFC, intentar por nombre exacto
      if (!axaClient) {
        axaClient = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId,
            legalName: 'AXA ASSISTANCE MEXICO',
            isActive: true,
          },
        });
      }

      // Si no existe, configurar cliente
      if (!axaClient) {
        await ctx.reply(
          '⚠️ No se encontró el cliente AXA. Intentando configurar clientes predefinidos...'
        );

        const { default: CustomerSetupService } = await import(
          '@services/customer-setup.service.js'
        );
        await CustomerSetupService.setupPredefinedCustomers(tenantId, false);

        // Buscar nuevamente el cliente AXA
        axaClient = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId,
            rfc: CLIENT_RFCS.AXA,
            isActive: true,
          },
        });

        if (!axaClient) {
          await ctx.reply(
            '❌ Error: No se pudo encontrar o configurar el cliente AXA. Por favor, contacta al administrador.',
            Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Volver al menú', BOT_ACTIONS.MENU_PRINCIPAL)],
            ])
          );
          return;
        }

        logger.info(
          { clientName: axaClient.legalName, clientId: axaClient.facturapiCustomerId },
          'Cliente AXA configurado y encontrado'
        );
      } else {
        logger.info(
          { clientName: axaClient.legalName, clientId: axaClient.facturapiCustomerId },
          'Cliente AXA cargado exitosamente'
        );
      }

      // Marcar que estamos esperando el archivo Excel de AXA
      if ((ctx as any).userState) {
        (ctx as any).userState.esperando = BOT_FLOWS.AXA_AWAIT_EXCEL;
        (ctx as any).userState.axaClientId = axaClient.facturapiCustomerId;
        (ctx as any).userState.clienteNombre = axaClient.legalName;
      }

      await ctx.reply(
        'Por favor, sube el archivo Excel con los datos de AXA para generar las facturas.'
      );
    } catch (error) {
      logger.error({ error }, 'Error al buscar cliente AXA');
      await ctx.reply(
        `❌ Error al buscar cliente AXA: ${error instanceof Error ? error.message : 'Error desconocido'}`
      );
    }
  });

  // 2. ACTION: Servicios realizados (con retención)
  bot.action(/^axa_servicios_realizados:(.+)$/, async (ctx: Context) => {
    const startTime = Date.now();
    try {
      await ctx.answerCbQuery();

      const match = (ctx as any).match;
      const batchId = match ? match[1] : null;

      if (!batchId) {
        await ctx.reply('❌ Error: No se pudo obtener el ID del lote.');
        return;
      }

      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply('❌ Error: No se pudo obtener el ID del usuario.');
        return;
      }

      // Obtener datos desde Redis
      const batchResult = await redisBatchStateService.getBatchData<AxaBatchData>(userId, batchId);

      if (!batchResult.success || !batchResult.data) {
        await ctx.reply('❌ Los datos han expirado. Por favor, suba nuevamente el archivo Excel.');
        return;
      }

      const tempData = batchResult.data;

      if (!tempData.facturaConRetencion || !tempData.facturaConRetencion.facturaData) {
        await ctx.reply(
          '❌ No hay datos de factura CON retención precalculados. Por favor, suba nuevamente el archivo Excel.'
        );
        return;
      }

      logger.info(
        { totalConRetencion: tempData.facturaConRetencion.total },
        'Usando datos precalculados CON retención'
      );

      // Actualizar selección en Redis
      tempData.seleccionUsuario = {
        tipoServicio: 'realizados',
        conRetencion: true,
        timestamp: Date.now(),
      };
      await redisBatchStateService.saveBatchData(userId, batchId, tempData);

      // Guardar en userState para compatibilidad
      if ((ctx as any).userState) {
        (ctx as any).userState.axaTipoServicio = 'realizados';
        (ctx as any).userState.axaConRetencion = true;
      }

      // Mostrar confirmación final CON DATOS PRECALCULADOS
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await ctx.reply(
        `🚛 *Servicios Realizados seleccionados*\n\n` +
          `• Se aplicará retención del 4%\n` +
          `• ${tempData.facturaConRetencion.items.length} registros\n` +
          `• **Total: $${tempData.facturaConRetencion.total.toFixed(2)}**\n\n` +
          `¿Confirma la generación de la factura?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Confirmar y Generar', `axa_confirmar_final:${batchId}`)],
            [Markup.button.callback('❌ Cancelar', BOT_ACTIONS.MENU_PRINCIPAL)],
          ]),
        }
      );

      const duration = Date.now() - startTime;
      logger.info({ duration }, 'Botón CON retención completado');
    } catch (error) {
      logger.error({ error }, 'Error en axa_servicios_realizados');
      await ctx.reply('❌ Error al procesar la selección.');
    }
  });

  // 3. ACTION: Servicios muertos (sin retención)
  bot.action(/^axa_servicios_muertos:(.+)$/, async (ctx: Context) => {
    const startTime = Date.now();
    try {
      await ctx.answerCbQuery();

      const match = (ctx as any).match;
      const batchId = match ? match[1] : null;

      if (!batchId) {
        await ctx.reply('❌ Error: No se pudo obtener el ID del lote.');
        return;
      }

      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply('❌ Error: No se pudo obtener el ID del usuario.');
        return;
      }

      // Obtener datos desde Redis
      const batchResult = await redisBatchStateService.getBatchData<AxaBatchData>(userId, batchId);

      if (!batchResult.success || !batchResult.data) {
        await ctx.reply('❌ Los datos han expirado. Por favor, suba nuevamente el archivo Excel.');
        return;
      }

      const tempData = batchResult.data;

      if (!tempData.facturaSinRetencion || !tempData.facturaSinRetencion.facturaData) {
        await ctx.reply(
          '❌ No hay datos de factura SIN retención precalculados. Por favor, suba nuevamente el archivo Excel.'
        );
        return;
      }

      logger.info(
        { totalSinRetencion: tempData.facturaSinRetencion.total },
        'Usando datos precalculados SIN retención'
      );

      // Actualizar selección en Redis
      tempData.seleccionUsuario = {
        tipoServicio: 'muertos',
        conRetencion: false,
        timestamp: Date.now(),
      };
      await redisBatchStateService.saveBatchData(userId, batchId, tempData);

      // Guardar en userState para compatibilidad
      if ((ctx as any).userState) {
        (ctx as any).userState.axaTipoServicio = 'muertos';
        (ctx as any).userState.axaConRetencion = false;
      }

      // Mostrar confirmación final CON DATOS PRECALCULADOS
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await ctx.reply(
        `💀 *Servicios Muertos seleccionados*\n\n` +
          `• Sin retención\n` +
          `• ${tempData.facturaSinRetencion.items.length} registros\n` +
          `• **Total: $${tempData.facturaSinRetencion.total.toFixed(2)}**\n\n` +
          `¿Confirma la generación de la factura?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Confirmar y Generar', `axa_confirmar_final:${batchId}`)],
            [Markup.button.callback('❌ Cancelar', BOT_ACTIONS.MENU_PRINCIPAL)],
          ]),
        }
      );

      const duration = Date.now() - startTime;
      logger.info({ duration }, 'Botón SIN retención completado');
    } catch (error) {
      logger.error({ error }, 'Error en axa_servicios_muertos');
      await ctx.reply('❌ Error al procesar la selección.');
    }
  });

  // 4. ACTION: Confirmar generación de factura
  bot.action(/^axa_confirmar_final:(.+)$/, async (ctx: Context) => {
    const startTime = Date.now();
    try {
      await ctx.answerCbQuery();

      const match = (ctx as any).match;
      const batchId = match ? match[1] : null;

      if (!batchId) {
        await ctx.reply('❌ Error: No se pudo obtener el ID del lote.');
        return;
      }

      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply('❌ Error: No se pudo obtener el ID del usuario.');
        return;
      }

      // Feedback inmediato
      const facturaProgressMsg = await ctx.reply(
        '⚡ Procesando factura AXA...\n⏳ Validando datos precalculados...'
      );

      // Obtener datos desde Redis
      const batchResult = await redisBatchStateService.getBatchData<AxaBatchData>(userId, batchId);

      if (!batchResult.success || !batchResult.data) {
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          facturaProgressMsg.message_id,
          undefined,
          '❌ No hay datos precalculados. Por favor, suba nuevamente el archivo Excel.'
        );
        return;
      }

      const tempData = batchResult.data;

      if (!tempData.facturaConRetencion || !tempData.facturaSinRetencion) {
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          facturaProgressMsg.message_id,
          undefined,
          '❌ Datos de facturación incompletos. Por favor, suba nuevamente el archivo Excel.'
        );
        return;
      }

      // Fallback entre userState y cache Redis
      let tipoServicio: AxaTipoServicio | undefined = (ctx as any).userState?.axaTipoServicio;
      let conRetencion: boolean | undefined = (ctx as any).userState?.axaConRetencion;

      // Si no está en userState, buscar en Redis
      if ((tipoServicio === undefined || conRetencion === undefined) && tempData.seleccionUsuario) {
        logger.info('Recuperando de cache Redis como fallback');
        tipoServicio = tempData.seleccionUsuario.tipoServicio;
        conRetencion = tempData.seleccionUsuario.conRetencion;
      }

      if (tipoServicio === undefined || conRetencion === undefined) {
        logger.warn(
          { tipoServicio, conRetencion },
          'No se encontró selección en userState ni Redis'
        );
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          facturaProgressMsg.message_id,
          undefined,
          '❌ Tipo de servicio no definido. Por favor, selecciona el tipo de servicio nuevamente.'
        );
        return;
      }

      logger.info('Todas las validaciones pasaron correctamente');

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

      // Seleccionar datos precalculados según tipo
      const facturaData = conRetencion
        ? tempData.facturaConRetencion
        : tempData.facturaSinRetencion;

      logger.info(
        {
          conRetencion,
          items: facturaData.items.length,
          total: facturaData.total,
        },
        'Usando factura precalculada'
      );

      // Actualizar mensaje con datos precisos
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        facturaProgressMsg.message_id,
        undefined,
        `⚡ Factura ${tipoServicio} ${conRetencion ? '(con retención 4%)' : '(sin retención)'}...\n` +
          `📊 ${facturaData.items.length} items, Total: $${facturaData.total.toFixed(2)}\n` +
          `🚀 Enviando a FacturAPI...`,
        { parse_mode: 'Markdown' }
      );

      // Envío DIRECTO a FacturAPI (sin recálculos)
      const factura = await enviarFacturaDirectaAxa(
        facturaData.facturaData,
        ctx,
        facturaProgressMsg.message_id,
        tempData.clienteId!
      );

      // Resultado final CON BOTONES DE DESCARGA
      if (factura) {
        await ctx.reply(
          `🎯 *Proceso AXA completado exitosamente*\n\n` +
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

      // Limpiar datos de Redis
      await redisBatchStateService.deleteBatchData(userId, batchId);

      // Limpiar userState
      if ((ctx as any).userState) {
        delete (ctx as any).userState.axaBatchId;
        delete (ctx as any).userState.axaTipoServicio;
        delete (ctx as any).userState.axaConRetencion;
        (ctx as any).userState.esperando = null;
      }

      const duration = Date.now() - startTime;
      logger.info({ duration }, 'Confirmación completada exitosamente');
    } catch (error) {
      logger.error({ error }, 'Error al confirmar factura');
      await ctx.reply(
        `❌ Error al generar factura: ${error instanceof Error ? error.message : 'Error desconocido'}`
      );

      if ((ctx as any).userState) {
        (ctx as any).userState.esperando = null;
      }
    }
  });

  // 5. HANDLER: Procesamiento de archivo Excel
  bot.on('document', async (ctx: Context, next: () => Promise<void>) => {
    try {
      // Verificar si debe detectar este archivo
      const userState = (ctx as any).userState;
      if (!userState || userState.esperando !== BOT_FLOWS.AXA_AWAIT_EXCEL) {
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
      const receivingMessage = await ctx.reply(
        '📥 Recibiendo archivo Excel de AXA...\n⏳ Validando archivo...'
      );
      const receivingMessageId = receivingMessage.message_id;

      // Actualizar que el archivo es válido
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

      const tempFileName = `axa_${ctx.from?.id}_${Date.now()}.xlsx`;
      const filePath = path.join(tempDir, tempFileName);
      await fs.writeFile(filePath, response.data);

      // Actualizar progreso
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        receivingMessageId,
        undefined,
        `✅ Archivo recibido: ${document.file_name}\n🔍 Validando estructura del Excel...\n⏳ Por favor espere...`
      );

      // Procesar el archivo Excel
      const result = await procesarArchivoAxa(ctx, filePath, receivingMessageId);

      // Eliminar archivo temporal (async)
      await fs.unlink(filePath);

      // Si no hay confirmación pendiente, resetear el estado
      if (!result || !result.pendingConfirmation) {
        if ((ctx as any).userState) {
          (ctx as any).userState.esperando = null;
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error al procesar el archivo Excel AXA');
      await ctx.reply(
        `❌ Error al procesar el archivo: ${error instanceof Error ? error.message : 'Error desconocido'}`
      );

      if ((ctx as any).userState) {
        (ctx as any).userState.esperando = null;
      }
    }
  });

  logger.info('✅ Handler de AXA (V2 TypeScript) registrado correctamente');
}

export default registerAxaHandler;
