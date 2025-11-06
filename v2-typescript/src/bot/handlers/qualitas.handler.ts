/**
 * Qualitas handler for Telegram bot
 * Handles Excel-based invoice generation for Qualitas client
 */

import { Markup } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import type { BotContext } from '@/types/bot.types.js';
import { createModuleLogger } from '@core/utils/logger.js';
import { prisma } from '@/config/database.js';

// Service imports
import CustomerSetupService from '@services/customer-setup.service.js';

const logger = createModuleLogger('bot-qualitas-handler');

// SAT key for towing services
const CLAVE_SAT_SERVICIOS_GRUA = '78101803';

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
  bot.action('qualitas_con_retencion', async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery();

    const tempData = (global as any).tempQualitasData?.[ctx.from?.id];
    if (!tempData || !tempData.facturaConRetencion) {
      await ctx.reply(
        '❌ No hay datos precalculados. Por favor, suba nuevamente el archivo Excel.'
      );
      return;
    }

    if ((global as any).tempQualitasData?.[ctx.from?.id]) {
      (global as any).tempQualitasData[ctx.from?.id].seleccionUsuario = {
        conRetencion: true,
        timestamp: Date.now(),
      };
    }

    ctx.userState.qualitasConRetencion = true;

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

    await ctx.reply(
      `✅ *Servicios con Retención seleccionados*\n\n` +
        `• Se aplicará retención del 4%\n` +
        `• ${tempData.facturaConRetencion.items.length} registros\n` +
        `• **Total: $${tempData.facturaConRetencion.total.toFixed(2)}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', 'qualitas_confirmar_final')],
          [Markup.button.callback('❌ Cancelar', 'qualitas_cancelar')],
        ]).reply_markup,
      }
    );
  });

  // Button without retention
  bot.action('qualitas_sin_retencion', async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery();

    const tempData = (global as any).tempQualitasData?.[ctx.from?.id];
    if (!tempData || !tempData.facturaSinRetencion) {
      await ctx.reply(
        '❌ No hay datos precalculados. Por favor, suba nuevamente el archivo Excel.'
      );
      return;
    }

    if ((global as any).tempQualitasData?.[ctx.from?.id]) {
      (global as any).tempQualitasData[ctx.from?.id].seleccionUsuario = {
        conRetencion: false,
        timestamp: Date.now(),
      };
    }

    ctx.userState.qualitasConRetencion = false;

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

    await ctx.reply(
      `✅ *Servicios sin Retención seleccionados*\n\n` +
        `• Sin retención\n` +
        `• ${tempData.facturaSinRetencion.items.length} registros\n` +
        `• **Total: $${tempData.facturaSinRetencion.total.toFixed(2)}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', 'qualitas_confirmar_final')],
          [Markup.button.callback('❌ Cancelar', 'qualitas_cancelar')],
        ]).reply_markup,
      }
    );
  });

  // Confirm generation
  bot.action('qualitas_confirmar_final', async (ctx: BotContext) => {
    await ctx.answerCbQuery();

    const facturaProgressMsg = await ctx.reply(
      '⚡ Procesando factura Qualitas...\n⏳ Validando datos...'
    );

    const tempData = (global as any).tempQualitasData?.[ctx.from?.id];

    if (!tempData || !tempData.facturaConRetencion || !tempData.facturaSinRetencion) {
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

      // Note: enviarFacturaDirectaQualitas implementation would go here
      // For now, we'll show a placeholder message
      await ctx.reply(
        '⚠️ Generación de factura Qualitas en desarrollo. La funcionalidad completa estará disponible pronto.',
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
          ]).reply_markup,
        }
      );

      delete ctx.userState.qualitasSummary;
      delete ctx.userState.qualitasConRetencion;
      if ((global as any).tempQualitasData?.[ctx.from?.id]) {
        delete (global as any).tempQualitasData[ctx.from?.id];
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
      if ((global as any).tempQualitasData?.[ctx.from?.id]) {
        delete (global as any).tempQualitasData[ctx.from?.id];
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

    if (!('document' in ctx.message)) {
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
      const tempDir = ensureTempDirExists();
      const filePath = path.join(tempDir, document.file_name || 'qualitas.xlsx');

      await downloadFile(fileLink.href, filePath);

      // Note: procesarArchivoQualitas implementation would go here
      // For now, we'll show a placeholder message
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        receivingMessage.message_id,
        undefined,
        '⚠️ Procesamiento de archivo Qualitas en desarrollo. La funcionalidad completa estará disponible pronto.'
      );

      fs.unlinkSync(filePath);

      ctx.userState.esperando = null;

      logger.info('=========== FIN HANDLER QUALITAS EXCEL ===========');
    } catch (error) {
      logger.error('Error al procesar Excel:', error);
      ctx.reply(`❌ Error: ${(error as Error).message}`);
      ctx.userState.esperando = null;
    }
  });
}

/**
 * Ensures temp directory exists
 */
function ensureTempDirExists(): string {
  const tempDir = path.join(__dirname, '../../../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * Downloads a file from URL
 */
async function downloadFile(url: string, outputPath: string): Promise<void> {
  const writer = fs.createWriteStream(outputPath);
  const response = await axios({ url, method: 'GET', responseType: 'stream' });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}
