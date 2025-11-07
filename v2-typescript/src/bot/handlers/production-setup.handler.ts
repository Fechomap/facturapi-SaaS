/**
 * Production Setup Handler
 * Maneja el flujo completo de configuración para modo de producción
 * Incluye: upload de certificados SAT, validación, renovación de API keys, y configuración de clientes
 */

import { Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { fileURLToPath } from 'url';
import type { Bot, BotContext } from '@/types/bot.types.js';
import { createModuleLogger } from '@core/utils/logger.js';
import TenantService from '@services/tenant.service.js';
import CustomerSetupService from '@services/customer-setup.service.js';
import FacturapiService from '@services/facturapi.service.js';
import { prisma } from '@config/database.js';
import config from '@config/index.js';

const logger = createModuleLogger('production-setup-handler');

// Constantes
const ADMIN_CHAT_IDS: bigint[] = config.telegram.adminChatIds.map((id) => BigInt(id));
const FACTURAPI_USER_KEY = config.facturapi.userKey;

// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, '../../../temp');

// Estados del proceso de configuración productiva
enum ProductionSetupState {
  AWAITING_CER = 'awaiting_cer',
  AWAITING_KEY = 'awaiting_key',
  AWAITING_PASSWORD = 'awaiting_password',
  AWAITING_ADMIN_APPROVAL = 'awaiting_admin_approval',
  AWAITING_FINAL_CONFIRMATION = 'awaiting_final_confirmation',
}

// Comando para configuración de facturación real
const PRODUCTION_SETUP_COMMAND = 'registro_factura_real_completo';

/**
 * Interfaz para el estado de configuración productiva
 */
interface ProductionSetupData {
  state: ProductionSetupState;
  tenantId: string;
  orgId: string;
  businessName: string;
  rfc?: string;
  cerPath?: string;
  keyPath?: string;
  password?: string;
}

/**
 * Interfaz para el resultado de upload a FacturAPI
 */
interface UploadCertificateResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Interfaz para información de usuario
 */
interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

/**
 * Verifica si una fecha ha pasado
 */
function isDatePassed(date: Date): boolean {
  return date < new Date();
}

/**
 * Registra los manejadores para el proceso de configuración productiva
 */
export function registerProductionSetupHandler(bot: Bot): void {
  // ========================================
  // COMANDO: registro_factura_real_completo
  // ========================================
  bot.command(PRODUCTION_SETUP_COMMAND, async (ctx: BotContext): Promise<void> => {
    try {
      logger.info('Iniciando proceso de configuración productiva mediante comando');

      // Verificar que el usuario tiene un tenant asociado
      if (!ctx.hasTenant()) {
        await ctx.reply(
          '❌ Para configurar el modo de facturación real, primero debes registrar tu empresa.\n\n' +
            'Usa /registro para comenzar.'
        );
        return;
      }

      // Obtener información del tenant
      const tenantId = ctx.getTenantId();
      const tenant = await TenantService.findTenantWithSubscription(tenantId);

      if (!tenant) {
        await ctx.reply('❌ No se pudo obtener la información de tu empresa.');
        return;
      }

      // Verificar si ya tiene un certificado configurado
      try {
        const orgInfo = await FacturapiService.getOrganizationInfo(tenantId);

        if (
          orgInfo &&
          orgInfo.legal &&
          (orgInfo.legal as any).certificate &&
          (orgInfo.legal as any).certificate.expires_at
        ) {
          await ctx.reply(
            '✅ Tu cuenta ya tiene un certificado configurado.\n\n' +
              'Puedes generar facturas reales.'
          );
          return;
        }
      } catch (error) {
        logger.warn({ error }, 'Error al verificar certificado existente');
        // Continuamos con el proceso si hay error al verificar
      }

      // Verificar si tiene suscripción activa
      if (!tenant.subscriptions || tenant.subscriptions.length === 0) {
        await ctx.reply(
          '❌ No tienes una suscripción activa. Para usar facturación real necesitas una suscripción activa.'
        );
        return;
      }

      const subscription = tenant.subscriptions[0];
      if (
        subscription.status !== 'active' &&
        (subscription.status !== 'trial' ||
          (subscription.trialEndsAt && isDatePassed(subscription.trialEndsAt)))
      ) {
        await ctx.reply(
          '❌ Tu suscripción no está activa. Por favor, actualiza tu plan para usar facturación real.'
        );
        return;
      }

      // Iniciar el proceso de configuración
      ctx.userState = ctx.userState || {};
      ctx.userState.productionSetup = {
        state: ProductionSetupState.AWAITING_CER,
        tenantId: tenant.id,
        orgId: tenant.facturapiOrganizationId,
        businessName: tenant.businessName,
        rfc: tenant.rfc,
      } as ProductionSetupData;

      logger.info({ setup: ctx.userState.productionSetup }, 'Estado de configuración inicializado');

      await ctx.reply(
        '🔄 *Configuración de Facturación Real*\n\n' +
          'Para habilitar la facturación real, necesitamos que proporciones los siguientes archivos de tu CSD (Certificado de Sello Digital):\n\n' +
          '1. Archivo .cer\n' +
          '2. Archivo .key\n' +
          '3. Contraseña de tu certificado\n\n' +
          'Por favor, envía primero tu archivo .cer',
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error({ error }, 'Error al iniciar configuración productiva');
      await ctx.reply(
        '❌ Ocurrió un error al iniciar el proceso. Por favor, intenta nuevamente más tarde.'
      );
    }
  });

  // ========================================
  // ACTION: setup_production (desde botón)
  // ========================================
  bot.action('setup_production', async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery();

    try {
      logger.info('Iniciando proceso de configuración productiva desde botón');

      // Verificar que el usuario tiene un tenant asociado
      if (!ctx.hasTenant()) {
        await ctx.reply(
          '❌ Para configurar el modo de facturación real, primero debes registrar tu empresa.\n\n' +
            'Usa /registro para comenzar.'
        );
        return;
      }

      // Obtener información del tenant
      const tenantId = ctx.getTenantId();
      const tenant = await TenantService.findTenantWithSubscription(tenantId);

      if (!tenant) {
        await ctx.reply('❌ No se pudo obtener la información de tu empresa.');
        return;
      }

      // Verificar si ya tiene un certificado configurado
      try {
        const orgInfo = await FacturapiService.getOrganizationInfo(tenantId);

        if (
          orgInfo &&
          orgInfo.legal &&
          (orgInfo.legal as any).certificate &&
          (orgInfo.legal as any).certificate.expires_at
        ) {
          await ctx.reply(
            '✅ Tu cuenta ya tiene un certificado configurado.\n\n' +
              'Puedes generar facturas reales.'
          );
          return;
        }
      } catch (error) {
        logger.warn({ error }, 'Error al verificar certificado');
        // Continuamos con el proceso si hay error al verificar
      }

      // Iniciar el proceso de configuración
      ctx.userState = ctx.userState || {};
      ctx.userState.productionSetup = {
        state: ProductionSetupState.AWAITING_CER,
        tenantId: tenant.id,
        orgId: tenant.facturapiOrganizationId,
        businessName: tenant.businessName,
        rfc: tenant.rfc,
      } as ProductionSetupData;

      logger.info({ setup: ctx.userState.productionSetup }, 'Estado de configuración inicializado');

      await ctx.reply(
        '🔄 *Configuración de Facturación Real*\n\n' +
          'Para habilitar la facturación real, necesitamos que proporciones los siguientes archivos de tu CSD (Certificado de Sello Digital):\n\n' +
          '1. Archivo .cer\n' +
          '2. Archivo .key\n' +
          '3. Contraseña de tu certificado\n\n' +
          'Por favor, envía primero tu archivo .cer',
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error({ error }, 'Error al iniciar configuración productiva');
      await ctx.reply(
        '❌ Ocurrió un error al iniciar el proceso. Por favor, intenta nuevamente más tarde.'
      );
    }
  });

  // ========================================
  // HANDLER: Manejo de documentos (.cer y .key)
  // ========================================
  bot.on('document', async (ctx: BotContext, next) => {
    logger.debug('Documento recibido en production-setup handler');

    if (!ctx.message || !('document' in ctx.message)) {
      return next();
    }

    const document = ctx.message.document;
    const fileName = document.file_name || '';
    const isCertFile = fileName.endsWith('.cer') || fileName.endsWith('.key');

    // Si NO es un archivo de certificado O no hay configuración activa, pasar al siguiente handler
    if (!isCertFile || !ctx.userState?.productionSetup) {
      logger.debug('No es archivo de certificado o no hay config productiva, pasando');
      return next();
    }

    // A partir de aquí sabemos que ES un archivo .cer o .key y que SÍ hay estado de configuración
    const setup = ctx.userState.productionSetup as ProductionSetupData;
    logger.info({ state: setup.state, fileName }, 'Procesando archivo de certificado');

    try {
      // ========== PROCESAMIENTO DE ARCHIVO .CER ==========
      if (setup.state === ProductionSetupState.AWAITING_CER && fileName.endsWith('.cer')) {
        logger.info('Procesando archivo .cer');

        try {
          await ctx.reply('⏳ Recibiendo archivo .cer, procesando...');
          const cerPath = await downloadTelegramFile(ctx, document.file_id, fileName);

          // Guardar la ruta del archivo en el estado
          setup.cerPath = cerPath;
          setup.state = ProductionSetupState.AWAITING_KEY;

          logger.info({ cerPath, newState: setup.state }, 'Archivo .cer guardado');

          await ctx.reply(
            '✅ Archivo .cer recibido correctamente.\n\n' +
              'Por favor, envía ahora tu archivo .key',
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          logger.error({ error }, 'Error al procesar archivo .cer');
          await ctx.reply('❌ Error al procesar el archivo .cer. Por favor, intenta nuevamente.');
          delete ctx.userState.productionSetup;
        }
        return;
      }

      // ========== PROCESAMIENTO DE ARCHIVO .KEY ==========
      if (setup.state === ProductionSetupState.AWAITING_KEY && fileName.endsWith('.key')) {
        logger.info('Procesando archivo .key');

        try {
          await ctx.reply('⏳ Recibiendo archivo .key, procesando...');
          const keyPath = await downloadTelegramFile(ctx, document.file_id, fileName);

          // Guardar la ruta del archivo en el estado
          setup.keyPath = keyPath;
          setup.state = ProductionSetupState.AWAITING_PASSWORD;

          logger.info({ keyPath, newState: setup.state }, 'Archivo .key guardado');

          await ctx.reply(
            '✅ Archivo .key recibido correctamente.\n\n' +
              'Por favor, introduce la contraseña de tu certificado:',
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          logger.error({ error }, 'Error al procesar archivo .key');
          await ctx.reply('❌ Error al procesar el archivo .key. Por favor, intenta nuevamente.');

          // Limpiar archivos y estado
          if (setup.cerPath) {
            cleanupFiles([setup.cerPath]);
          }
          delete ctx.userState.productionSetup;
        }
        return;
      }

      // Archivo de certificado en estado incorrecto
      logger.warn({ state: setup.state, fileName }, 'Archivo recibido en estado incorrecto');
      await ctx.reply(
        '❌ Archivo recibido en un momento incorrecto del proceso. Por favor, sigue las instrucciones.'
      );
    } catch (error) {
      logger.error({ error }, 'Error al procesar archivo de certificado');
      await ctx.reply('❌ Error al procesar el archivo. Por favor, intenta nuevamente.');
    }
  });

  // ========================================
  // HANDLER: Recepción de contraseña
  // ========================================
  bot.on('text', async (ctx: BotContext, next) => {
    // Verificar si estamos esperando la contraseña
    if (
      !ctx.userState ||
      !ctx.userState.productionSetup ||
      ctx.userState.productionSetup.state !== ProductionSetupState.AWAITING_PASSWORD
    ) {
      return next();
    }

    const setup = ctx.userState.productionSetup as ProductionSetupData;
    logger.info({ tenantId: setup.tenantId }, 'Procesando contraseña del certificado');

    if (!ctx.message || !('text' in ctx.message)) {
      return next();
    }

    const password = ctx.message.text.trim();

    try {
      // Guardar la contraseña
      setup.password = password;

      await ctx.reply('⏳ Enviando información a FacturAPI. Por favor, espera...');

      // Enviar los archivos y la contraseña a FacturAPI
      const result = await uploadCertificateToFacturAPI(
        setup.orgId,
        setup.cerPath!,
        setup.keyPath!,
        setup.password
      );

      if (result.success) {
        // Actualizar estado a espera de aprobación admin
        setup.state = ProductionSetupState.AWAITING_ADMIN_APPROVAL;
        logger.info({ tenantId: setup.tenantId }, 'Certificado enviado, esperando aprobación');

        await ctx.reply(
          '✅ Certificado enviado correctamente a FacturAPI.\n\n' +
            'Un administrador verificará la información y habilitará la facturación real.\n\n' +
            'Te notificaremos cuando el proceso esté completado.'
        );

        // Notificar a los administradores
        await notifyAdmins(bot, setup, ctx.from as TelegramUser);
      } else {
        await ctx.reply(
          `❌ Error al enviar el certificado: ${result.error}\n\n` +
            'Por favor, verifica que los archivos y la contraseña sean correctos e intenta nuevamente.'
        );

        // Reiniciar el proceso
        delete ctx.userState.productionSetup;
        logger.warn({ error: result.error }, 'Error al enviar certificado, proceso reiniciado');
      }

      // Limpiar archivos temporales
      cleanupFiles([setup.cerPath!, setup.keyPath!]);
    } catch (error) {
      logger.error({ error }, 'Error al procesar contraseña');
      ctx.reply('❌ Ocurrió un error al procesar la información. Por favor, intenta nuevamente.');

      // Limpiar archivos temporales
      if (setup.cerPath && setup.keyPath) {
        cleanupFiles([setup.cerPath, setup.keyPath]);
      }

      // Reiniciar el proceso
      delete ctx.userState.productionSetup;
    }
  });

  // ========================================
  // ACTION: Aprobación por administrador
  // ========================================
  bot.action(/^approve_production_(.+)$/, async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery();

    const tenantId = ctx.match![1];

    try {
      // Verificar que el usuario es un administrador
      if (!ADMIN_CHAT_IDS.includes(BigInt(ctx.from!.id))) {
        await ctx.reply('❌ No tienes permisos para realizar esta acción.');
        return;
      }

      // Buscar el tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!tenant) {
        await ctx.reply(`❌ No se encontró el tenant con ID ${tenantId}`);
        return;
      }

      // Actualizar el mensaje con confirmación
      if (ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message) {
        const message = ctx.callbackQuery.message;
        if ('text' in message && message.text) {
          await ctx.editMessageText(message.text + '\n\n✅ Aprobado por ' + ctx.from!.username, {
            reply_markup: { inline_keyboard: [] },
          });
        }
      }

      // Encontrar el usuario del tenant para enviar notificación
      const tenantUser = await prisma.tenantUser.findFirst({
        where: {
          tenantId: tenantId,
          role: 'admin',
        },
      });

      if (tenantUser) {
        // Enviar mensaje al usuario
        await bot.telegram.sendMessage(
          tenantUser.telegramId.toString(),
          '✅ ¡Buenas noticias! Un administrador ha verificado tu certificado y ha habilitado la facturación real.\n\n' +
            'Por favor, presiona el botón para completar la configuración:',
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Completar Configuración', `complete_setup_${tenantId}`)],
          ])
        );

        logger.info(
          { tenantId, userId: tenantUser.telegramId },
          'Notificación de aprobación enviada'
        );
      }
    } catch (error) {
      logger.error({ error, tenantId }, 'Error al aprobar configuración');
      await ctx.reply('❌ Ocurrió un error al procesar la aprobación.');
    }
  });

  // ========================================
  // ACTION: Completar configuración
  // ========================================
  bot.action(/^complete_setup_(.+)$/, async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery();

    const tenantId = ctx.match![1];

    try {
      // Verificar que el usuario pertenece al tenant
      if (ctx.getTenantId() !== tenantId) {
        await ctx.reply('❌ No tienes permisos para realizar esta acción.');
        return;
      }

      await ctx.reply('⏳ Renovando y obteniendo API Key de producción...');

      // Obtener tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!tenant || !tenant.facturapiOrganizationId) {
        await ctx.reply('❌ No se encontró información de la organización.');
        return;
      }

      // Renovar API Key Live
      const apiKeyLive = await renewFacturapiLiveKey(tenant.facturapiOrganizationId);

      if (!apiKeyLive) {
        await ctx.reply(
          '❌ No se pudo obtener la API Key de producción.\n\n' +
            'Por favor, contacta a soporte técnico.'
        );
        return;
      }

      // Actualizar tenant en la base de datos
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          facturapiApiKey: apiKeyLive,
        },
      });

      // CRÍTICO: Limpiar cache de FacturAPI después de actualizar API key
      try {
        FacturapiService.clearClientCache(tenantId);
        logger.info({ tenantId }, 'Cache de FacturAPI limpiado después de actualizar API key');
      } catch (cacheError) {
        logger.warn({ cacheError }, 'Error al limpiar cache después de actualizar API key');
      }

      // Registrar en el log de auditoría
      await prisma.auditLog.create({
        data: {
          tenantId: tenantId,
          action: 'tenant:update:production',
          entityType: 'tenant',
          entityId: tenantId,
          details: {
            changedTo: 'production',
          },
        },
      });

      // ========== RECONFIGURACIÓN DE CLIENTES ==========
      await ctx.reply('⏳ Reconfigurando clientes con tu nueva API key de producción...');

      try {
        // 1. Eliminar todos los clientes actuales del tenant
        await prisma.tenantCustomer.deleteMany({
          where: { tenantId },
        });

        // 2. Eliminar facturas y documentos de prueba
        await ctx.reply('⏳ Eliminando facturas y documentos de prueba...');

        // Obtener IDs de todas las facturas del tenant
        const facturas = await prisma.tenantInvoice.findMany({
          where: { tenantId },
          select: { id: true },
        });

        const facturaIds = facturas.map((f) => f.id);

        // Eliminar documentos asociados a estas facturas
        if (facturaIds.length > 0) {
          await prisma.tenantDocument.deleteMany({
            where: {
              invoiceId: { in: facturaIds },
            },
          });
        }

        // Eliminar las facturas
        const deletedInvoices = await prisma.tenantInvoice.deleteMany({
          where: { tenantId },
        });

        // Resetear el contador de folios
        await prisma.tenantFolio.updateMany({
          where: { tenantId },
          data: { currentNumber: 800 },
        });

        // Resetear el contador de facturas usadas
        await prisma.tenantSubscription.updateMany({
          where: { tenantId },
          data: { invoicesUsed: 0 },
        });

        logger.info(
          { tenantId, deletedCount: deletedInvoices.count },
          'Facturas de prueba eliminadas'
        );

        // 3. Volver a configurar los clientes con la nueva API key
        const setupResults = await CustomerSetupService.setupPredefinedCustomers(tenantId, true);

        // 4. Contar éxitos para informar al usuario
        const successCount = setupResults.filter((r: any) => r.success).length;
        await ctx.reply(
          `✅ Se han configurado ${successCount} clientes con tu nueva API de producción.`
        );
      } catch (clientError) {
        logger.error({ error: clientError, tenantId }, 'Error al reconfigurar clientes');
        await ctx.reply(
          '⚠️ Se produjo un error al configurar los clientes. Por favor, configúralos manualmente desde el menú.'
        );
      }

      await ctx.reply(
        '🎉 *¡Felicidades!* Tu cuenta ha sido configurada correctamente para facturación real.\n\n' +
          'Ahora puedes emitir facturas válidas ante el SAT.\n\n' +
          'Recuerda que todas las facturas generadas a partir de este momento serán documentos fiscales oficiales.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🏠 Volver al Menú Principal', 'menu_principal')],
          ]),
        }
      );
    } catch (error) {
      logger.error({ error, tenantId }, 'Error al completar configuración');
      await ctx.reply(
        '❌ Ocurrió un error al completar la configuración.\n\n' +
          'Por favor, intenta nuevamente o contacta a soporte técnico.'
      );
    }
  });

  // ========================================
  // COMANDO ADMIN: Generar instrucciones
  // ========================================
  bot.command('generar_comando_produccion', async (ctx: BotContext): Promise<void> => {
    // Verificar que el usuario es un administrador
    if (!ADMIN_CHAT_IDS.includes(BigInt(ctx.from!.id))) {
      await ctx.reply('❌ Este comando es solo para administradores.');
      return;
    }

    await ctx.reply(
      '📋 *Instrucción para usuarios*\n\n' +
        'Comparte el siguiente mensaje con los usuarios que necesiten configurar la facturación real:\n\n' +
        '```\n' +
        'Para configurar el modo de facturación real, por favor ejecuta este comando:\n' +
        `/${PRODUCTION_SETUP_COMMAND}\n\n` +
        'Necesitarás tener a mano tus archivos .cer y .key del SAT, así como la contraseña de tu FIEL.\n' +
        '```',
      { parse_mode: 'Markdown' }
    );
  });
}

// ========================================
// FUNCIONES AUXILIARES
// ========================================

/**
 * Descarga un archivo de Telegram
 */
async function downloadTelegramFile(
  ctx: BotContext,
  fileId: string,
  fileName: string
): Promise<string> {
  logger.info({ fileId, fileName }, 'Descargando archivo de Telegram');

  // Asegurar que el directorio temporal existe
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    logger.debug({ tempDir: TEMP_DIR }, 'Directorio temporal creado');
  }

  try {
    // Obtener enlace de descarga
    const fileLink = await ctx.telegram.getFileLink(fileId);
    logger.debug({ fileLink: fileLink.href }, 'Enlace de descarga obtenido');

    // Ruta completa del archivo
    const filePath = path.join(TEMP_DIR, fileName);

    // Descargar el archivo usando axios
    const response = await axios({
      method: 'GET',
      url: fileLink.href,
      responseType: 'stream',
      timeout: 30000, // 30 segundos
    });

    // Escribir el archivo en disco
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        logger.info({ filePath }, 'Archivo guardado exitosamente');

        // Verificar que el archivo existe y tiene tamaño
        try {
          const stats = fs.statSync(filePath);
          logger.debug({ size: stats.size }, 'Tamaño del archivo verificado');

          if (stats.size === 0) {
            logger.error('Archivo vacío después de descarga');
            reject(new Error('El archivo descargado está vacío'));
            return;
          }
        } catch (err) {
          logger.error({ error: err }, 'Error al verificar archivo');
          reject(err);
          return;
        }

        resolve(filePath);
      });

      writer.on('error', (err) => {
        logger.error({ error: err }, 'Error al guardar archivo');
        reject(err);
      });
    });
  } catch (error) {
    logger.error({ error, fileId, fileName }, 'Error al descargar archivo de Telegram');
    throw error;
  }
}

/**
 * Sube los certificados a FacturAPI
 */
async function uploadCertificateToFacturAPI(
  organizationId: string,
  cerPath: string,
  keyPath: string,
  password: string
): Promise<UploadCertificateResult> {
  try {
    if (!FACTURAPI_USER_KEY) {
      throw new Error('FACTURAPI_USER_KEY no está configurada');
    }

    logger.info({ organizationId }, 'Iniciando envío de certificados a FacturAPI');

    // Verificar que los archivos existen
    if (!fs.existsSync(cerPath)) {
      throw new Error(`El archivo .cer no existe en la ruta: ${cerPath}`);
    }

    if (!fs.existsSync(keyPath)) {
      throw new Error(`El archivo .key no existe en la ruta: ${keyPath}`);
    }

    // Verificar tamaños de archivos
    const cerStats = fs.statSync(cerPath);
    const keyStats = fs.statSync(keyPath);
    logger.debug(
      { cerSize: cerStats.size, keySize: keyStats.size },
      'Tamaños de archivos verificados'
    );

    if (cerStats.size === 0 || keyStats.size === 0) {
      throw new Error('Uno o ambos archivos están vacíos');
    }

    // Crear FormData
    const formData = new FormData();
    formData.append('cer', fs.createReadStream(cerPath));
    formData.append('key', fs.createReadStream(keyPath));
    formData.append('password', password);

    logger.debug('FormData creado, enviando a FacturAPI');

    // Hacer la petición a FacturAPI
    const response = await axios({
      method: 'PUT',
      url: `https://www.facturapi.io/v2/organizations/${organizationId}/certificate`,
      headers: {
        Authorization: `Bearer ${FACTURAPI_USER_KEY}`,
        ...formData.getHeaders(),
      },
      data: formData,
      timeout: 30000, // 30 segundos
    });

    logger.info({ organizationId }, 'Certificados enviados correctamente a FacturAPI');

    return {
      success: true,
      data: response.data,
    };
  } catch (error: any) {
    logger.error({ error, organizationId }, 'Error al subir certificado a FacturAPI');

    let errorMessage = 'Error desconocido';
    if (error.response?.data) {
      errorMessage = error.response.data.message || JSON.stringify(error.response.data);
      logger.error(
        {
          status: error.response.status,
          data: error.response.data,
        },
        'Detalles del error de FacturAPI'
      );
    } else if (error.message) {
      errorMessage = error.message;
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Notifica a los administradores sobre la solicitud de configuración productiva
 */
async function notifyAdmins(
  bot: Bot,
  setup: ProductionSetupData,
  user: TelegramUser
): Promise<void> {
  // Sanitizar datos para evitar problemas con Markdown
  const sanitizeForMarkdown = (text: string | undefined): string => {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  };

  // Formatear username de manera segura
  const safeUsername = user.username ? `@${sanitizeForMarkdown(user.username)}` : 'sin\\_username';

  const message =
    '🔔 *Nueva solicitud de configuración productiva*\n\n' +
    `*Empresa:* ${sanitizeForMarkdown(setup.businessName)}\n` +
    `*RFC:* ${sanitizeForMarkdown(setup.rfc || 'No disponible')}\n` +
    `*ID Organización:* ${sanitizeForMarkdown(setup.orgId)}\n` +
    `*Usuario:* ${sanitizeForMarkdown(user.first_name)} ${sanitizeForMarkdown(user.last_name || '')} (${safeUsername})\n` +
    `*ID Telegram:* ${user.id}\n\n` +
    'Por favor, verifica los certificados en el dashboard de FacturAPI y genera la API Key Live.';

  // Enviar mensaje a todos los administradores
  for (const adminId of ADMIN_CHAT_IDS) {
    try {
      await bot.telegram.sendMessage(adminId.toString(), message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Aprobar', `approve_production_${setup.tenantId}`)],
        ]),
      });
      logger.info({ adminId: adminId.toString() }, 'Notificación enviada al administrador');
    } catch (error) {
      logger.error({ error, adminId: adminId.toString() }, 'Error al enviar notificación');

      // Intento alternativo sin formato Markdown
      try {
        await bot.telegram.sendMessage(
          adminId.toString(),
          `Nueva solicitud de configuración productiva para ${setup.businessName} (${setup.rfc}). Por favor verifica los certificados.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Aprobar', `approve_production_${setup.tenantId}`)],
          ])
        );
        logger.info({ adminId: adminId.toString() }, 'Notificación alternativa enviada');
      } catch (fallbackError) {
        logger.error({ error: fallbackError }, 'Error al enviar notificación alternativa');
      }
    }
  }
}

/**
 * Renueva y obtiene la API Key Live de FacturAPI
 */
async function renewFacturapiLiveKey(organizationId: string): Promise<string | null> {
  try {
    if (!FACTURAPI_USER_KEY) {
      throw new Error('FACTURAPI_USER_KEY no está configurada');
    }

    logger.info({ organizationId }, 'Renovando API Key Live');

    // Hacer la petición PUT a FacturAPI para renovar la API Key Live
    const response = await axios({
      method: 'PUT',
      url: `https://www.facturapi.io/v2/organizations/${organizationId}/apikeys/live`,
      headers: {
        Authorization: `Bearer ${FACTURAPI_USER_KEY}`,
      },
    });

    logger.info({ organizationId }, 'API Key Live renovada correctamente');

    // La respuesta debe ser directamente la API key renovada
    return response.data;
  } catch (error: any) {
    logger.error({ error, organizationId }, 'Error al renovar API Key Live');

    if (error.response) {
      logger.error(
        {
          status: error.response.status,
          data: error.response.data,
        },
        'Detalles del error al renovar API Key'
      );
    }

    return null;
  }
}

/**
 * Limpia archivos temporales
 */
function cleanupFiles(filePaths: string[]): void {
  for (const filePath of filePaths) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        logger.debug({ filePath }, 'Archivo temporal eliminado');
      } catch (error) {
        logger.error({ error, filePath }, 'Error al eliminar archivo temporal');
      }
    }
  }
}

export default registerProductionSetupHandler;
