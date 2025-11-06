/**
 * Invoice handler for Telegram bot
 * Handles invoice generation, consultation, and cancellation
 */

import { Markup } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { BotContext } from '@/types/bot.types.js';
import { createModuleLogger } from '@core/utils/logger.js';
import { prisma } from '@/config/database.js';
import { CancellationMotive } from 'facturapi';

// Service imports
import TenantService from '@services/tenant.service.js';
import InvoiceService from '@services/invoice.service.js';
import SafeOperationsService from '@services/safe-operations.service.js';
import CustomerSetupService from '@services/customer-setup.service.js';
import FacturapiService from '@services/facturapi.service.js';

const logger = createModuleLogger('bot-invoice-handler');

// SAT cancellation reasons for reference
const MOTIVOS_CANCELACION: Record<string, string> = {
  '01': 'Comprobante emitido con errores con relación',
  '02': 'Comprobante emitido con errores sin relación',
  '03': 'No se llevó a cabo la operación',
  '04': 'Operación nominativa relacionada en la factura global',
};

// Recreate __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Ensures the temporary directory exists
 */
function ensureTempDirExists(): string {
  const tempDir = path.join(__dirname, '../../../temp');
  if (!fs.existsSync(tempDir)) {
    try {
      fs.mkdirSync(tempDir, { recursive: true });
      logger.debug({ tempDir }, 'Directorio temporal creado');
    } catch (err) {
      logger.error(
        { tempDir, error: (err as Error).message },
        'Error al crear directorio temporal'
      );
    }
  }
  return tempDir;
}

/**
 * Downloads an invoice file (PDF/XML) directly from FacturAPI
 */
export async function descargarFactura(
  facturaId: string,
  formato: 'pdf' | 'xml',
  folio: string | number,
  clienteNombre: string,
  ctx: BotContext
): Promise<string> {
  logger.info(`Descargando factura ${facturaId} en formato ${formato}`);

  const tempDir = ensureTempDirExists();
  const folioStr = folio?.toString() || 'unknown';

  try {
    // Get tenant ID from user context
    const tenantId = ctx.userState?.tenantId;
    if (!tenantId) {
      throw new Error('No se encontró el tenant ID en el estado del usuario');
    }

    // Get FacturAPI client for this tenant
    const facturapi = await FacturapiService.getFacturapiClient(tenantId);

    // Try to get series from different sources
    let series = ctx.userState?.series || ctx.session?.series;

    // If we don't have the series, get it directly from the invoice in FacturAPI
    if (!series) {
      try {
        logger.info(`Obteniendo información de la factura ${facturaId} de FacturAPI...`);
        const invoice = await facturapi.invoices.retrieve(facturaId);
        series = invoice.series || 'F';
        logger.info(`Serie obtenida de FacturAPI: ${series}`);
      } catch (error: any) {
        // CORRECCIÓN: Enriquecer el log y relanzar el error para detener el flujo.
        logger.error(
          {
            message: 'Error al intentar obtener los detalles de la factura desde FacturAPI.',
            facturaId,
            // Si el error es de la API, incluir el mensaje específico
            apiError: error?.response?.data?.message,
          },
          'Fallo en facturapi.invoices.retrieve(facturaId)'
        );
        // Relanzar el error detiene la función aquí mismo.
        throw new Error(`La factura con ID ${facturaId} no se pudo obtener de FacturAPI.`);
      }
    }

    logger.info(`Serie utilizada para el archivo: ${series}`);

    // Build filename with correct series
    const filePath = `${tempDir}/${series}${folioStr}.${formato}`;
    logger.info('Creando archivo temporal en:', filePath);

    fs.createWriteStream(filePath);

    logger.info(`Cliente FacturAPI obtenido para tenant ${tenantId}, descargando ${formato}...`);

    // Use axios to download directly from FacturAPI API
    if (formato === 'pdf' || formato === 'xml') {
      // Get API key directly from tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!tenant || !tenant.facturapiApiKey) {
        throw new Error('No se pudo obtener la API key del tenant');
      }

      // Build FacturAPI API URL
      const apiUrl = `https://www.facturapi.io/v2/invoices/${facturaId}/${formato}`;

      console.log('🔍 DEBUG - Antes de descargar de FacturAPI');
      console.log('URL:', apiUrl);
      console.log('API Key (primeros 20 chars):', tenant.facturapiApiKey?.substring(0, 20));
      logger.info(`Descargando desde URL de FacturAPI: ${apiUrl}`);

      // Make request with axios
      const response = await axios({
        method: 'GET',
        url: apiUrl,
        responseType: 'arraybuffer', // Important: use arraybuffer for binary files
        headers: {
          Authorization: `Bearer ${tenant.facturapiApiKey}`, // Use tenant's API key
        },
      });

      console.log('✅ Respuesta recibida de FacturAPI, status:', response.status);

      // Write file
      fs.writeFileSync(filePath, response.data);
      logger.info('Archivo descargado exitosamente:', filePath);
      return filePath;
    } else {
      throw new Error(`Formato no soportado: ${formato}`);
    }
  } catch (error: any) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`❌ ERROR AL DESCARGAR ${formato.toUpperCase()}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Factura ID:', facturaId);
    console.log('Tenant ID:', tenantId);
    console.log('Formato:', formato);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Tipo de Error:', error?.constructor?.name);
    console.log('Error Message:', error?.message);
    console.log('Error Code:', error?.code);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Tiene Response?:', !!error?.response);
    if (error?.response) {
      console.log('HTTP Status:', error.response.status);
      console.log('HTTP Status Text:', error.response.statusText);
      console.log('Response Data:', error.response.data);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Stack Trace:');
    console.log(error?.stack);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const filePath = `${tempDir}/${folio}.${formato}`;
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      // Silenciar
    }

    throw error;
  }
}

/**
 * Registers invoice-related handlers
 */
export function registerInvoiceHandler(bot: any): void {
  // Generate invoice menu
  bot.action('menu_generar', async (ctx: BotContext): Promise<void> => {
    await ctx.answerCbQuery('✓ Seleccionado');

    try {
      // Show loading state while checking customers
      await ctx.editMessageText('📝 *Cargando clientes para facturación...*', {
        parse_mode: 'Markdown',
      });

      // Check if tenant has configured customers
      const hasCustomers = await CustomerSetupService.hasConfiguredCustomers(ctx.getTenantId());

      if (!hasCustomers) {
        // If no configured customers, try to set them up automatically
        await ctx.editMessageText(
          '🏠 Menú Principal → 📝 **Generar Factura**\n\n⚠️ No tienes clientes configurados en tu cuenta. Vamos a intentar configurarlos automáticamente.',
          {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('Configurar Clientes', 'configure_clients')],
              [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
            ]).reply_markup,
          }
        );
        return;
      }

      // Get available customers for this tenant
      const availableCustomers = await prisma.tenantCustomer.findMany({
        where: {
          tenantId: ctx.getTenantId(),
          isActive: true,
        },
        select: {
          id: true,
          legalName: true,
          facturapiCustomerId: true,
        },
      });

      // If no customers available
      if (availableCustomers.length === 0) {
        await ctx.editMessageText(
          '🏠 Menú Principal → 📝 **Generar Factura**\n\n⚠️ No hay clientes disponibles para facturar. Por favor, contacta a soporte.',
          {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
            ]).reply_markup,
          }
        );
        return;
      }

      // Function to shorten long names
      const shortenName = (name: string): string => {
        const maxClienteLength = 30;

        if (!name || name.length <= maxClienteLength) return name;

        const words = name.split(' ');
        let shortened = words[0];
        let i = 1;

        while (i < words.length && shortened.length + words[i].length + 1 <= maxClienteLength - 3) {
          shortened += ' ' + words[i];
          i++;
        }

        return shortened + '...';
      };

      // Map short names to full names
      const shortToFullNameMap: Record<string, string> = {};

      // Build buttons for available customers
      availableCustomers.forEach((customer) => {
        const shortName = shortenName(customer.legalName);
        shortToFullNameMap[shortName] = customer.legalName;

        // Save FacturAPI ID in global state for later use
        if (!ctx.clientIds) ctx.clientIds = {};
        ctx.clientIds[customer.legalName] = customer.facturapiCustomerId;
      });

      // Save name map in context state
      ctx.clientNameMap = shortToFullNameMap;

      // Mostrar TODOS los clientes disponibles (sin filtrar)
      const clientsForMenu = availableCustomers.map((customer) => ({
        id: customer.facturapiCustomerId,
        name: shortenName(customer.legalName),
      }));

      // Build inline keyboard
      const keyboard = Markup.inlineKeyboard([
        ...clientsForMenu.map((client) => [
          Markup.button.callback(client.name, `cliente_${client.id}`),
        ]),
        [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
      ]);

      await ctx.editMessageText(
        '🏠 Menú Principal → 📝 **Generar Factura**\n\nSeleccione el cliente para generar la factura:',
        {
          parse_mode: 'Markdown',
          reply_markup: keyboard.reply_markup,
        }
      );
    } catch (error) {
      logger.error('Error al verificar clientes:', error);

      await ctx.editMessageText(
        '🏠 Menú Principal → 📝 **Generar Factura**\n\n❌ Ocurrió un error al obtener los clientes disponibles. Por favor, intente nuevamente más tarde.',
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Reintentar', 'menu_generar')],
            [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
          ]).reply_markup,
        }
      );
    }
  });

  // Handle invoice consultation
  bot.action('menu_consultar', async (ctx: BotContext) => {
    await ctx.answerCbQuery('✓ Seleccionado');

    // Start query flow
    ctx.userState.esperando = 'folioConsulta';

    await ctx.editMessageText(
      '🏠 Menú Principal → 🔍 **Consultar Factura**\n\nPor favor, ingrese el número de folio de la factura que desea consultar:',
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('❌ Cancelar', 'menu_principal')],
        ]).reply_markup,
      }
    );
  });

  // Handler for invoice confirmation
  bot.action(/^confirmar_(?!cancelacion_)(.+)/, async (ctx: BotContext): Promise<void> => {
    logger.info(`[DEBUG] Entering confirmar_ action handler for transactionId: ${ctx.match?.[1]}`);

    try {
      const transactionId = ctx.match?.[1];
      if (!transactionId) {
        logger.error('[ERROR] Transaction ID not found in ctx.match for confirmar_ action.');
        await ctx.answerCbQuery('Error interno: ID de transacción no encontrado.');
        await ctx.reply(
          '❌ Ocurrió un error interno (ID no encontrado). Por favor, intente generar la factura de nuevo.'
        );
        return;
      }

      // Check if there's an active session
      if (!ctx.userState) {
        await ctx.reply('La sesión ha expirado. Por favor, comience de nuevo.', {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('Volver al Menú', 'menu_principal')],
          ]).reply_markup,
        });
        return;
      }

      // Check if user belongs to a tenant
      if (!ctx.hasTenant()) {
        await ctx.reply(
          'No tienes una empresa registrada. Por favor, usa /registro para crear una.',
          {
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('📝 Registrarme', 'start_registration')],
            ]).reply_markup,
          }
        );
        return;
      }

      // Check subscription status
      logger.info(
        `[CHECK_SUBS] Verificando capacidad para generar factura para tenant ${ctx.getTenantId()}...`
      );
      const canGenerateResult = await TenantService.canGenerateInvoice(ctx.getTenantId());
      logger.info(
        `[CHECK_SUBS] Resultado de verificación de capacidad para tenant ${ctx.getTenantId()}:`,
        canGenerateResult
      );

      if (!canGenerateResult.canGenerate) {
        logger.warn(
          `[CHECK_SUBS] Generación de factura NO permitida para tenant ${ctx.getTenantId()}. Resultado:`,
          canGenerateResult
        );

        const inactiveStates = ['pending_payment', 'expired', 'canceled', 'none'];
        if (
          canGenerateResult.subscriptionStatus &&
          inactiveStates.includes(canGenerateResult.subscriptionStatus)
        ) {
          logger.warn(
            `[CHECK_SUBS] Razón: Suscripción inactiva (${canGenerateResult.subscriptionStatus}) para tenant ${ctx.getTenantId()}. Enviando alerta...`
          );

          const statusText =
            canGenerateResult.subscriptionStatus === 'pending_payment'
              ? 'Pago pendiente'
              : 'Vencida';
          const paymentLink =
            canGenerateResult.paymentLink ||
            'https://mock-stripe-payment-link.com/pricemockdefault/1745906401125';
          const planName = 'Basic Plan';

          await ctx.reply(
            `🚨 Suscripción Vencida\n\n` +
              `Tu período de prueba o suscripción para Pego ha vencido.\n\n` +
              `Plan: ${planName}\n` +
              `Estado: ${statusText}\n\n` +
              `Para reactivar tu servicio y continuar usándolo, por favor realiza tu pago a través del siguiente enlace:\n\n` +
              `${paymentLink}\n\n` +
              `Si tienes alguna duda, contáctanos.`,
            {
              reply_markup: Markup.inlineKeyboard([
                [Markup.button.url('Realizar Pago', paymentLink)],
                [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
              ]).reply_markup,
            }
          );
          return;
        } else {
          logger.warn(
            `[CHECK_SUBS] Razón: Otra (${canGenerateResult.reason}) para tenant ${ctx.getTenantId()}. Enviando alerta genérica...`
          );

          await ctx.reply(
            `❌ No puedes generar más facturas: ${canGenerateResult.reason}\n\n` +
              `Contacta al administrador o revisa tu plan.`,
            {
              reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')],
              ]).reply_markup,
            }
          );
          return;
        }
      } else {
        logger.info(
          `[CHECK_SUBS] Generación de factura PERMITIDA para tenant ${ctx.getTenantId()}. Continuando flujo...`
        );
      }

      // Only check transaction ID if invoice was already generated
      if (ctx.userState.facturaGenerada && ctx.userState.transactionId !== transactionId) {
        await ctx.reply('Esta solicitud ya no es válida. Por favor, genere una nueva factura.', {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('Volver al Menú', 'menu_principal')],
          ]).reply_markup,
        });
        return;
      }

      // Check if this process is already running
      if (ctx.isProcessActive(transactionId)) {
        await ctx.answerCbQuery('Esta factura ya está siendo procesada, por favor espere.');
        return;
      }

      // Mark this process as active
      ctx.markProcessActive(transactionId);

      try {
        // Try to remove buttons to avoid additional clicks
        try {
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch (error: any) {
          if (!error.description || !error.description.includes('message is not modified')) {
            throw error;
          }
        }

        await ctx.reply('⏳ Generando factura, por favor espere...');

        // Implement retries to avoid random failures
        const maxRetries = 3;
        let factura: any = null;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            logger.info(`Intento ${attempt}/${maxRetries} de generar factura`, {
              transactionId,
              tenantId: ctx.getTenantId(),
              userId: ctx.from?.id,
            });

            // Generate invoice in a thread-safe way
            factura = await SafeOperationsService.generateInvoiceSafe(
              {
                ...ctx.userState,
                userId: ctx.from?.id,
              },
              ctx.getTenantId(),
              ctx.from?.id
            );

            logger.info(`Factura generada exitosamente en intento ${attempt}`, {
              facturaId: factura.id,
              folio: factura.folio_number,
            });
            break;
          } catch (attemptError) {
            lastError = attemptError as Error;
            logger.warn(`Intento ${attempt}/${maxRetries} falló`, {
              error: (attemptError as Error).message,
              transactionId,
            });

            if (attempt < maxRetries) {
              const delay = attempt * 2000;
              logger.info(`Esperando ${delay}ms antes del siguiente intento`);
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }

        if (!factura) {
          throw lastError || new Error('Error desconocido al generar factura');
        }

        // Save generated invoice data
        ctx.userState.facturaId = factura.id;
        ctx.userState.series = factura.series;
        ctx.userState.folioFactura = factura.folio_number;
        ctx.userState.facturaGenerada = true;

        // CRITICAL: Also save in session for persistence between workers
        ctx.session.facturaId = factura.id;
        ctx.session.series = factura.series;
        ctx.session.folioFactura = factura.folio_number;
        ctx.session.facturaGenerada = true;

        // Show created invoice
        await ctx.reply(
          `✅ **Factura Generada Exitosamente**\n\n` +
            `Serie-Folio: ${factura.series}-${factura.folio_number}\n` +
            `Total: $${factura.total.toFixed(2)} MXN`,
          {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  '📄 Descargar PDF',
                  `pdf_${factura.id}_${factura.folio_number}`
                ),
                Markup.button.callback(
                  '📂 Descargar XML',
                  `xml_${factura.id}_${factura.folio_number}`
                ),
              ],
              [Markup.button.callback('⬅️ Volver al Menú', 'menu_principal')],
            ]).reply_markup,
          }
        );
      } catch (error: any) {
        logger.error('Error al generar factura:', error);
        let errorMsg = 'Ocurrió un error al generar la factura.';

        if (axios.isAxiosError(error) && error.response?.data) {
          const errorData = error.response.data;
          if (typeof errorData.error === 'string') {
            if (errorData.error.includes("Couldn't find product_key")) {
              errorMsg = `❌ La clave de producto "${ctx.userState.claveProducto}" no es válida o no existe en el catálogo de FacturAPI.`;
            } else if (errorData.error.includes("Couldn't find customer")) {
              errorMsg = `❌ No se pudo encontrar el cliente seleccionado. Puede que haya sido eliminado.`;
            } else if (errorData.error.includes('connect')) {
              errorMsg = `❌ Error de conexión con el servicio de FacturAPI. Verifique la conexión.`;
            } else {
              errorMsg = `❌ Error: ${errorData.error}`;
            }
          } else if (errorData.details) {
            errorMsg = `❌ Error de validación en los datos: ${JSON.stringify(errorData.details)}`;
          }
        } else if ((error as any).code === 'ECONNREFUSED') {
          errorMsg = `❌ No se pudo conectar con el servidor de facturación.`;
        }

        ctx.reply(errorMsg, {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('Volver al Menú', 'menu_principal')],
          ]).reply_markup,
        });
      } finally {
        ctx.markProcessInactive(transactionId);
        await ctx.answerCbQuery();
      }
    } catch (err) {
      logger.error('[ERROR] Uncaught error within confirmar_ handler:', err);

      try {
        const userMessage =
          (err as Error).message && typeof (err as Error).message === 'string'
            ? `❌ Error: ${(err as Error).message}`
            : '❌ Ocurrió un error inesperado al procesar tu solicitud. Por favor, intenta de nuevo o contacta a soporte.';
        await ctx.reply(userMessage);
      } catch (replyError) {
        logger.error('[ERROR] Failed to send error reply to user:', replyError);
      }

      try {
        await ctx.answerCbQuery('Error procesando la solicitud.');
      } catch (answerError) {
        logger.error('[ERROR] Failed to answer callback query on error:', answerError);
      }
    }
  });

  // Handler for cancel operation
  bot.action(/cancelar_(.+)/, async (ctx: BotContext) => {
    const transactionId = ctx.match?.[1];
    if (!transactionId) return;

    if (ctx.isProcessActive(transactionId)) {
      await ctx.answerCbQuery('Esta solicitud ya está siendo procesada.');
      return;
    }

    ctx.markProcessActive(transactionId);

    try {
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (error: any) {
        if (!error.description || !error.description.includes('message is not modified')) {
          throw error;
        }
      }

      ctx.resetState();
      ctx.reply('Operación cancelada. Puede iniciar nuevamente cuando desee.', {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('Volver al Menú', 'menu_principal')],
        ]).reply_markup,
      });
    } finally {
      ctx.markProcessInactive(transactionId);
      await ctx.answerCbQuery();
    }
  });

  // Handler for PDF download
  bot.action(/pdf_(.+)_(\d+)/, async (ctx: BotContext) => {
    const facturaId = ctx.match?.[1];
    const folioNumero = ctx.match?.[2];
    if (!facturaId || !folioNumero) return;

    // Try to get series from userState or session
    let series = ctx.userState?.series;
    if (!series && ctx.session?.series) {
      series = ctx.session.series;
      ctx.userState.series = series;
    }

    logger.info('Estado del usuario al descargar PDF:', ctx.userState);
    logger.info('ID de factura solicitado:', facturaId);
    logger.info('Serie encontrada:', series || 'No disponible');

    const processId = `pdf_${facturaId}`;
    if (ctx.isProcessActive(processId)) {
      await ctx.answerCbQuery('Ya se está descargando el PDF, por favor espere.');
      return;
    }

    ctx.markProcessActive(processId);

    try {
      await ctx.reply('⏳ Descargando PDF, por favor espere...');

      const clienteStr = ctx.userState?.clienteNombre || 'Cliente';
      const filePath = await descargarFactura(facturaId, 'pdf', folioNumero, clienteStr, ctx);

      if (fs.existsSync(filePath)) {
        await ctx.replyWithDocument({ source: filePath });
        fs.unlinkSync(filePath);
      } else {
        throw new Error('No se pudo generar el archivo PDF');
      }
    } catch (error) {
      logger.error('Error al descargar PDF:', error);

      let errorMsg = '❌ Ocurrió un error al descargar el PDF.';
      if (axios.isAxiosError(error) && error.response) {
        logger.info('Respuesta de error:', error.response.status, error.response.data);
        errorMsg = `❌ Error al descargar (${error.response.status}): ${error.message}`;
      }

      ctx.reply(errorMsg, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('Volver al Menú', 'menu_principal')],
        ]).reply_markup,
      });
    } finally {
      ctx.markProcessInactive(processId);
      await ctx.answerCbQuery();
    }
  });

  // Handler for XML download
  bot.action(/xml_(.+)_(\d+)/, async (ctx: BotContext) => {
    const facturaId = ctx.match?.[1];
    const folioNumero = ctx.match?.[2];
    if (!facturaId || !folioNumero) return;

    let series = ctx.userState?.series;
    if (!series && ctx.session?.series) {
      series = ctx.session.series;
      ctx.userState.series = series;
    }

    logger.info('Estado del usuario al descargar XML:', ctx.userState);
    logger.info('ID de factura solicitado:', facturaId);
    logger.info('Serie encontrada:', series || 'No disponible');

    const processId = `xml_${facturaId}`;
    if (ctx.isProcessActive(processId)) {
      await ctx.answerCbQuery('Ya se está descargando el XML, por favor espere.');
      return;
    }

    ctx.markProcessActive(processId);

    try {
      await ctx.reply('⏳ Descargando XML, por favor espere...');

      const clienteStr = ctx.userState?.clienteNombre || 'Cliente';
      const filePath = await descargarFactura(facturaId, 'xml', folioNumero, clienteStr, ctx);

      if (fs.existsSync(filePath)) {
        await ctx.replyWithDocument({ source: filePath });
        fs.unlinkSync(filePath);
      } else {
        throw new Error('No se pudo generar el archivo XML');
      }
    } catch (error) {
      logger.error('Error al descargar XML:', error);

      let errorMsg = '❌ Ocurrió un error al descargar el XML.';
      if (axios.isAxiosError(error) && error.response) {
        logger.info('Respuesta de error:', error.response.status, error.response.data);
        errorMsg = `❌ Error al descargar (${error.response.status}): ${error.message}`;
      }

      ctx.reply(errorMsg, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('Volver al Menú', 'menu_principal')],
        ]).reply_markup,
      });
    } finally {
      ctx.markProcessInactive(processId);
      await ctx.answerCbQuery();
    }
  });

  // Text handler for queries, order data, etc.
  bot.on('text', async (ctx: BotContext, next: () => Promise<void>) => {
    if (!('text' in ctx.message)) {
      return next();
    }
    const texto = ctx.message.text;

    logger.info(
      `[invoice.handler.ts] Recibido texto: "${texto}", estado: ${JSON.stringify(ctx.userState)}`
    );

    // Check if we're in a registration process or not waiting for anything
    if (
      ctx.userState &&
      ctx.userState.esperando &&
      !ctx.userState.esperando.startsWith('reg_') &&
      !ctx.userState.esperando.startsWith('org_')
    ) {
      // Process according to current state
      switch (ctx.userState.esperando) {
        case 'numeroPedido':
          if (!texto.trim()) {
            return ctx.reply(
              'El número de pedido no puede estar vacío. Por favor, inténtelo de nuevo:'
            );
          }
          ctx.userState.numeroPedido = texto.trim();
          ctx.userState.esperando = 'claveProducto';
          ctx.reply('Ingrese la clave del producto:');
          break;

        case 'claveProducto':
          if (!texto.trim()) {
            return ctx.reply(
              'La clave del producto no puede estar vacía. Por favor, inténtelo de nuevo:'
            );
          }
          ctx.userState.claveProducto = texto.trim();
          ctx.userState.esperando = 'monto';
          ctx.reply('Ingrese el monto a facturar (solo números):');
          break;

        case 'monto': {
          const montoTexto = texto.replace(/[^\d.,]/g, '').replace(/,/g, '.');
          const monto = parseFloat(montoTexto);

          if (isNaN(monto) || monto <= 0) {
            return ctx.reply('Por favor, ingrese un monto válido (solo números):');
          }

          ctx.userState.monto = monto;
          ctx.userState.esperando = 'confirmacion';
          ctx.userState.transactionId = `tx_${Date.now()}_${ctx.from?.id}`;

          await ctx.reply(
            `📋 **Resumen de Factura**\n\n` +
              `Cliente: ${ctx.userState.clienteNombre}\n` +
              `Pedido: ${ctx.userState.numeroPedido}\n` +
              `Producto: ${ctx.userState.claveProducto}\n` +
              `Monto: $${monto.toFixed(2)} MXN\n\n` +
              `¿Confirma la generación de la factura?`,
            {
              parse_mode: 'Markdown',
              reply_markup: Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    '✅ Confirmar',
                    `confirmar_${ctx.userState.transactionId}`
                  ),
                ],
                [Markup.button.callback('❌ Cancelar', `cancelar_${ctx.userState.transactionId}`)],
              ]).reply_markup,
            }
          );
          break;
        }

        case 'folioConsulta': {
          const folioConsulta = texto.trim();
          if (!folioConsulta) {
            return ctx.reply(
              'El número de folio no puede estar vacío. Por favor, inténtelo de nuevo:'
            );
          }

          ctx.reply('⏳ Buscando factura con folio: ' + folioConsulta + ', por favor espere...');
          logger.info('Intentando consultar factura con folio:', folioConsulta);

          try {
            const tenantId = ctx.getTenantId();
            if (!tenantId) {
              throw new Error('No se encontró el tenant ID en el contexto del usuario');
            }

            const facturapi = await FacturapiService.getFacturapiClient(tenantId);

            logger.info(
              `Cliente FacturAPI obtenido para tenant ${tenantId}, buscando factura con folio ${folioConsulta}...`
            );

            const facturas = await facturapi.invoices.list({
              q: folioConsulta,
              limit: 1,
            });

            logger.info(
              `Resultado de búsqueda para folio ${folioConsulta}:`,
              facturas.total_results
            );

            if (facturas.total_results > 0) {
              const factura = facturas.data[0];

              ctx.userState.facturaId = factura.id;
              ctx.userState.folioFactura = factura.folio_number;
              logger.info('Guardando ID de factura en el estado:', ctx.userState.facturaId);

              let estadoFactura = '';
              let estaCancelada = false;

              if (factura.status === 'canceled' || factura.cancellation_status === 'accepted') {
                estadoFactura = '⛔ CANCELADA';
                estaCancelada = true;

                if (factura.cancellation && factura.cancellation.motive) {
                  const motivoCancelacion =
                    MOTIVOS_CANCELACION[factura.cancellation.motive] ||
                    `Motivo ${factura.cancellation.motive}`;
                  estadoFactura += ` (${motivoCancelacion})`;
                }
              } else if (factura.cancellation_status === 'pending') {
                estadoFactura = '⏳ PENDIENTE DE CANCELACIÓN';
                estaCancelada = false;
              } else {
                estadoFactura = '✅ VIGENTE';
                estaCancelada = false;
              }

              await ctx.reply(
                `🔍 **Detalles de la Factura**\n\n` +
                  `Serie-Folio: ${factura.series}-${factura.folio_number}\n` +
                  `Estado: ${estadoFactura}\n` +
                  `Total: $${factura.total.toFixed(2)} MXN\n` +
                  `Fecha: ${new Date(factura.date).toLocaleDateString('es-MX')}`,
                {
                  parse_mode: 'Markdown',
                  reply_markup: Markup.inlineKeyboard([
                    [
                      Markup.button.callback('📄 PDF', `pdf_${factura.id}_${factura.folio_number}`),
                      Markup.button.callback('📂 XML', `xml_${factura.id}_${factura.folio_number}`),
                    ],
                    ...(estaCancelada
                      ? []
                      : [
                          [
                            Markup.button.callback(
                              '🚫 Cancelar Factura',
                              `iniciar_cancelacion_${factura.id}_${factura.folio_number}`
                            ),
                          ],
                        ]),
                    [Markup.button.callback('⬅️ Volver al Menú', 'menu_principal')],
                  ]).reply_markup,
                }
              );

              ctx.userState.esperando = null;
            } else {
              ctx.reply(`❌ No se encontró ninguna factura con el folio: ${folioConsulta}`);
              ctx.userState.esperando = null;
            }
          } catch (error) {
            logger.error('Error al consultar factura por folio:', error);
            if (axios.isAxiosError(error) && error.response) {
              logger.error('Detalles del error:', error.response.status, error.response.data);
            }
            ctx.reply(`❌ Ocurrió un error al buscar la factura con folio: ${folioConsulta}`);
            ctx.userState.esperando = null;
          }
          break;
        }

        default:
          return next();
      }
    } else {
      return next();
    }
  });

  // Implement cancellation handlers
  registerCancellationHandlers(bot);
}

/**
 * Registers handlers for invoice cancellation
 */
function registerCancellationHandlers(bot: any): void {
  // Start cancellation process
  bot.action(/iniciar_cancelacion_(.+)_(\d+)/, async (ctx: BotContext) => {
    const facturaId = ctx.match?.[1];
    const folioFactura = ctx.match?.[2];
    if (!facturaId || !folioFactura) return;

    logger.info(
      `Iniciando proceso de cancelación para factura ${facturaId} (folio: ${folioFactura})`
    );

    const processId = `cancelacion_${facturaId}`;
    if (ctx.isProcessActive(processId)) {
      await ctx.answerCbQuery('Ya se está procesando esta cancelación, por favor espere.');
      return;
    }

    ctx.markProcessActive(processId);

    try {
      await ctx.answerCbQuery();

      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch((e) => {
          logger.info('No se pudo editar markup:', (e as Error).message);
        });
      } catch (error) {
        logger.info('No se pudo editar el markup del mensaje anterior:', (error as Error).message);
      }

      ctx.userState.facturaIdCancelar = facturaId;
      ctx.userState.folioFacturaCancelar = folioFactura;

      await ctx.reply(
        `⚠️ *¡IMPORTANTE! Está por cancelar la factura con folio A-${folioFactura}*\n\n` +
          `Esta acción no se puede deshacer. La factura será cancelada ante el SAT.\n\n` +
          `¿Está seguro que desea continuar con la cancelación?`,
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '✅ Sí, mostrar motivos',
                `mostrar_motivos_${facturaId}_${folioFactura}`
              ),
            ],
            [Markup.button.callback('❌ No, cancelar proceso', `cancelar_proceso_${facturaId}`)],
          ]).reply_markup,
        }
      );
    } catch (error) {
      logger.error('Error al iniciar proceso de cancelación:', error);
      await ctx.reply('❌ Ocurrió un error al iniciar el proceso de cancelación.');
    } finally {
      ctx.markProcessInactive(processId);
    }
  });

  // Show cancellation reasons
  bot.action(/mostrar_motivos_(.+)_(\d+)/, async (ctx: BotContext) => {
    const facturaId = ctx.match?.[1];
    const folioFactura = ctx.match?.[2];
    if (!facturaId || !folioFactura) return;

    logger.info(
      `Mostrando motivos de cancelación para factura ${facturaId} (folio: ${folioFactura})`
    );

    await ctx.answerCbQuery();

    try {
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch((e) => {
          logger.info('No se pudo editar markup:', (e as Error).message);
        });
      } catch (error) {
        logger.info('No se pudo editar el markup del mensaje anterior:', (error as Error).message);
      }

      if (!ctx.userState.facturaIdCancelar || !ctx.userState.folioFacturaCancelar) {
        ctx.userState.facturaIdCancelar = facturaId;
        ctx.userState.folioFacturaCancelar = folioFactura;
      }

      await ctx.reply(`Seleccione el motivo de cancelación para la factura A-${folioFactura}:`, {
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback(
              '01: Comprobante con errores con relación',
              `confirmar_cancelacion_${facturaId}_${folioFactura}_01`
            ),
          ],
          [
            Markup.button.callback(
              '02: Comprobante con errores sin relación',
              `confirmar_cancelacion_${facturaId}_${folioFactura}_02`
            ),
          ],
          [
            Markup.button.callback(
              '03: No se llevó a cabo la operación',
              `confirmar_cancelacion_${facturaId}_${folioFactura}_03`
            ),
          ],
          [
            Markup.button.callback(
              '04: Operación en factura global',
              `confirmar_cancelacion_${facturaId}_${folioFactura}_04`
            ),
          ],
          [Markup.button.callback('❌ Cancelar proceso', `cancelar_proceso_${facturaId}`)],
        ]).reply_markup,
      });
    } catch (error) {
      logger.error('Error al mostrar motivos de cancelación:', error);
      await ctx.reply('❌ Ocurrió un error al mostrar los motivos de cancelación.');
    }
  });

  // Confirm and process cancellation
  bot.action(/confirmar_cancelacion_(.+)_(\d+)_(.+)/, async (ctx: BotContext) => {
    const facturaId = ctx.match?.[1];
    const folioFactura = ctx.match?.[2];
    const motivoCancelacion = ctx.match?.[3];
    if (!facturaId || !folioFactura || !motivoCancelacion) return;

    logger.info(
      `Confirmando cancelación de factura ${facturaId} (folio: ${folioFactura}) con motivo: ${motivoCancelacion}`
    );

    const processId = `cancelacion_final_${facturaId}`;
    if (ctx.isProcessActive(processId)) {
      await ctx.answerCbQuery('Ya se está procesando esta cancelación, por favor espere.');
      return;
    }

    ctx.markProcessActive(processId);

    try {
      await ctx.answerCbQuery();

      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch((e) => {
          logger.info('No se pudo editar markup:', (e as Error).message);
        });
      } catch (error) {
        logger.info('No se pudo editar el markup del mensaje anterior:', (error as Error).message);
      }

      await ctx.reply(
        `⏳ Cancelando factura A-${folioFactura} con motivo: ${MOTIVOS_CANCELACION[motivoCancelacion]}...`
      );

      try {
        const tenantId = ctx.getTenantId();
        if (!tenantId) {
          throw new Error('No se encontró el tenant ID en el contexto del usuario');
        }

        const facturapi = await FacturapiService.getFacturapiClient(tenantId);

        logger.info(
          `Cliente FacturAPI obtenido para tenant ${tenantId}, cancelando factura ${facturaId} con motivo ${motivoCancelacion}...`
        );

        // Map string motive to enum
        const motiveMap: Record<string, CancellationMotive> = {
          '01': CancellationMotive.ERRORES_CON_RELACION,
          '02': CancellationMotive.ERRORES_SIN_RELACION,
          '03': CancellationMotive.NO_SE_CONCRETO,
          '04': CancellationMotive.FACTURA_GLOBAL,
        };

        const result = await facturapi.invoices.cancel(facturaId, {
          motive: motiveMap[motivoCancelacion],
        });

        logger.info('Respuesta de cancelación de FacturAPI:', result);

        await ctx.reply(
          `✅ *Factura A-${folioFactura} cancelada exitosamente*\n\n` +
            `Se ha registrado la cancelación con el siguiente motivo:\n` +
            `• ${MOTIVOS_CANCELACION[motivoCancelacion]}\n\n` +
            `La factura ha sido cancelada ante el SAT.`,
          {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Volver al menú principal', 'volver_menu_principal')],
            ]).reply_markup,
          }
        );

        delete ctx.userState.facturaIdCancelar;
        delete ctx.userState.folioFacturaCancelar;
      } catch (error: any) {
        logger.error('Error completo al cancelar la factura:', error);

        let errorMsg = 'Ocurrió un error al cancelar la factura.';
        if (axios.isAxiosError(error) && error.response) {
          logger.error(
            'Detalles de la respuesta de error:',
            error.response.status,
            error.response.data
          );
          if (error.response.data) {
            if (typeof error.response.data.error === 'string') {
              errorMsg = `Error: ${error.response.data.error}`;
            } else if (error.response.data.details) {
              errorMsg = `Error: ${JSON.stringify(error.response.data.details)}`;
            }
          }
        }

        await ctx.reply(
          `❌ ${errorMsg}\n\nLa factura NO ha sido cancelada. Por favor, intente nuevamente o contacte al administrador.`,
          {
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Volver al menú principal', 'volver_menu_principal')],
            ]).reply_markup,
          }
        );
      }
    } catch (error) {
      logger.error('Error en el proceso de cancelación:', error);
      await ctx.reply('❌ Ocurrió un error en el proceso de cancelación.');
    } finally {
      ctx.markProcessInactive(processId);
    }
  });

  // Cancel cancellation process
  bot.action(/cancelar_proceso_(.+)/, async (ctx: BotContext) => {
    const facturaId = ctx.match?.[1];
    if (!facturaId) return;

    logger.info(`Cancelando proceso de cancelación para factura ${facturaId}`);

    await ctx.answerCbQuery();

    try {
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch((e) => {
          logger.info('No se pudo editar markup:', (e as Error).message);
        });
      } catch (error) {
        logger.info('No se pudo editar el markup del mensaje anterior:', (error as Error).message);
      }

      delete ctx.userState.facturaIdCancelar;
      delete ctx.userState.folioFacturaCancelar;

      await ctx.reply('✅ Proceso de cancelación abortado. La factura NO ha sido cancelada.', {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Volver al menú principal', 'volver_menu_principal')],
        ]).reply_markup,
      });
    } catch (error) {
      logger.error('Error al cancelar proceso:', error);
      await ctx.reply('❌ Ocurrió un error al cancelar el proceso.');
    }
  });
}
