/**
 * Club de Asistencia handler for Telegram bot
 * Handles Excel-based invoice generation for Club de Asistencia client
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

const logger = createModuleLogger('bot-club-asistencia-handler');

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
  bot.action('cas_servicios_con_retencion', async (ctx: BotContext): Promise<void> => {
    const startTime = Date.now();
    logger.info('🔵 BOTÓN CON RETENCIÓN: Iniciando...');

    await ctx.answerCbQuery();

    const tempData = (global as any).tempCasData?.[ctx.from?.id];
    if (!tempData || !tempData.facturaConRetencion || !tempData.facturaConRetencion.facturaData) {
      logger.info('🚨 BOTÓN CON RETENCIÓN: Datos no disponibles');
      await ctx.reply(
        '❌ No hay datos precalculados para generar facturas. Por favor, suba nuevamente el archivo Excel.'
      );
      return;
    }

    logger.info('🔵 BOTÓN CON RETENCIÓN: TempData OK, preparando respuesta...');

    // Save selection in global cache
    if ((global as any).tempCasData?.[ctx.from?.id]) {
      (global as any).tempCasData[ctx.from?.id].seleccionUsuario = {
        conRetencion: true,
        timestamp: Date.now(),
      };
    }

    ctx.userState.casConRetencion = true;

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch((e) => {
      logger.debug('No se pudo editar mensaje:', (e as Error).message);
    });

    await ctx.reply(
      `✅ *Servicios con Retención seleccionados*\n\n` +
        `• Se aplicará retención del 4%\n` +
        `• ${tempData.facturaConRetencion.items.length} registros\n` +
        `• **Total: $${tempData.facturaConRetencion.total.toFixed(2)}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', 'cas_confirmar_final')],
          [Markup.button.callback('❌ Cancelar', 'cas_cancelar')],
        ]).reply_markup,
      }
    );

    const duration = Date.now() - startTime;
    logger.info(`🔵 BOTÓN CON RETENCIÓN: Completado en ${duration}ms`);
  });

  // Handler for services without retention
  bot.action('cas_servicios_sin_retencion', async (ctx: BotContext): Promise<void> => {
    const startTime = Date.now();
    logger.info('🟡 BOTÓN SIN RETENCIÓN: Iniciando...');

    await ctx.answerCbQuery();

    const tempData = (global as any).tempCasData?.[ctx.from?.id];
    if (!tempData || !tempData.facturaSinRetencion || !tempData.facturaSinRetencion.facturaData) {
      logger.info('🚨 BOTÓN SIN RETENCIÓN: Datos no disponibles');
      await ctx.reply(
        '❌ No hay datos precalculados para generar facturas. Por favor, suba nuevamente el archivo Excel.'
      );
      return;
    }

    logger.info('🟡 BOTÓN SIN RETENCIÓN: TempData OK, preparando respuesta...');

    // Save selection in global cache
    if ((global as any).tempCasData?.[ctx.from?.id]) {
      (global as any).tempCasData[ctx.from?.id].seleccionUsuario = {
        conRetencion: false,
        timestamp: Date.now(),
      };
    }

    ctx.userState.casConRetencion = false;

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch((e) => {
      logger.debug('No se pudo editar mensaje:', (e as Error).message);
    });

    await ctx.reply(
      `✅ *Servicios sin Retención seleccionados*\n\n` +
        `• Sin retención\n` +
        `• ${tempData.facturaSinRetencion.items.length} registros\n` +
        `• **Total: $${tempData.facturaSinRetencion.total.toFixed(2)}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', 'cas_confirmar_final')],
          [Markup.button.callback('❌ Cancelar', 'cas_cancelar')],
        ]).reply_markup,
      }
    );

    const duration = Date.now() - startTime;
    logger.info(`🟡 BOTÓN SIN RETENCIÓN: Completado en ${duration}ms`);
  });

  // Confirm generation
  bot.action('cas_confirmar_final', async (ctx: BotContext) => {
    await ctx.answerCbQuery();

    const facturaProgressMsg = await ctx.reply(
      '⚡ Procesando factura Club de Asistencia...\n⏳ Validando datos...'
    );

    const tempData = (global as any).tempCasData?.[ctx.from?.id];

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

      // Note: enviarFacturaDirectaCAS implementation would go here
      // For now, we'll show a placeholder message
      await ctx.reply(
        '⚠️ Generación de factura Club de Asistencia en desarrollo. La funcionalidad completa estará disponible pronto.',
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
          ]).reply_markup,
        }
      );

      delete ctx.userState.casSummary;
      delete ctx.userState.casConRetencion;
      if ((global as any).tempCasData?.[ctx.from?.id]) {
        delete (global as any).tempCasData[ctx.from?.id];
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
      if ((global as any).tempCasData?.[ctx.from?.id]) {
        delete (global as any).tempCasData[ctx.from?.id];
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
      const filePath = path.join(tempDir, document.file_name || 'club-asistencia.xlsx');

      await downloadFile(fileLink.href, filePath);

      // Note: procesarArchivoCAS implementation would go here
      // For now, we'll show a placeholder message
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        receivingMessage.message_id,
        undefined,
        '⚠️ Procesamiento de archivo Club de Asistencia en desarrollo. La funcionalidad completa estará disponible pronto.'
      );

      fs.unlinkSync(filePath);

      ctx.userState.esperando = null;

      logger.info('=========== FIN HANDLER CLUB ASISTENCIA EXCEL ===========');
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
