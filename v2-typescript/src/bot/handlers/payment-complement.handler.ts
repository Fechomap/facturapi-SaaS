/**
 * Payment Complement handler for Telegram bot
 * Handles payment complement creation for invoices (CFDI tipo P)
 */

import { Markup } from 'telegraf';
import { promises as fs } from 'fs';
import type { BotContext } from '@/types/bot.types.js';
import { createModuleLogger } from '@core/utils/logger.js';
import FacturapiService from '@services/facturapi.service.js';
import { prisma } from '@/config/database.js';

const logger = createModuleLogger('bot-payment-complement');

interface InvoiceInfo {
  uuid: string;
  facturapiId: string;
  folio: string;
  total: number;
  customer: string;
  customerObject: any;
  customerName: string;
}

interface PaymentComplementResult {
  id: string;
  series?: string;
  folio_number: number | string;
  [key: string]: any; // Allow additional properties
}

interface ProcessResult {
  success: boolean;
  customerName: string;
  resultado?: PaymentComplementResult;
  error?: string;
  facturas: InvoiceInfo[];
}

/**
 * Registers payment complement handlers
 */
export function registerPaymentComplementHandler(bot: any): void {
  logger.info('Registrando handlers de complemento de pago...');

  // Main button: Payment Complement - SIMPLIFIED (no client selection)
  bot.action('menu_complemento_pago', async (ctx: BotContext) => {
    try {
      await ctx.answerCbQuery('💰 Complemento de Pago');

      logger.info(`Botón de complemento de pago presionado por usuario: ${ctx.from?.id}`);

      // Mark that we are waiting for UUIDs
      if (!ctx.userState) {
        ctx.userState = {};
      }
      ctx.userState.esperando = 'uuids_pago';

      logger.info(`Estado actualizado, esperando: ${ctx.userState.esperando}`);

      const message =
        '💰 *Complemento de Pago*\n\n' +
        '📝 Escribe el UUID de la factura que quieres pagar.\n\n' +
        'Si son varias facturas, escribe un UUID por línea.\n\n' +
        '✍️ Escribe aquí:';

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancelar', 'menu_principal')],
      ]);

      // Try to edit the message first, if it fails, send a new one
      try {
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
        logger.info('Mensaje editado exitosamente');
      } catch (editError) {
        // If we can't edit, send a new message
        logger.info('No se pudo editar, enviando mensaje nuevo');
        await ctx.reply(message, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
      }
    } catch (error) {
      logger.error({ error }, 'Error al iniciar complemento de pago');
      try {
        await ctx.reply('❌ Ocurrió un error. Por favor, intente nuevamente.');
      } catch (replyError) {
        logger.error({ error: replyError }, 'Error al enviar mensaje de error');
      }
    }
  });

  // Text handler to receive UUID(s)
  bot.on('text', async (ctx: BotContext, next: () => Promise<void>) => {
    logger.debug(`Texto recibido, estado actual: ${ctx.userState?.esperando}`);

    // Check first if we are in UUID waiting mode
    if (!ctx.userState || ctx.userState.esperando !== 'uuids_pago') {
      // We are not waiting for UUIDs, pass to next handler
      return next();
    }

    logger.info('Procesando UUIDs de pago...');
    const texto = 'text' in ctx.message! ? ctx.message.text : '';

    // Only process if we are waiting for payment UUIDs
    if (ctx.userState.esperando === 'uuids_pago') {
      try {
        await ctx.reply('⏳ Procesando complemento(s) de pago, por favor espere...');

        const tenantId = ctx.getTenantId();

        // Parse UUIDs (can be separated by commas, spaces, line breaks)
        // Accepted format:
        // - 343DBD73-CEA7-4672-902F-6A1F89A9C988
        // - ACFEFE7A-403B-4FCB-A094-37F27A7DE8F2
        // - 9D7286F9-8470-4C6B-BF13-9BDBAE4EC30E
        // Or separated by commas: UUID1, UUID2, UUID3
        const uuids = texto
          .split(/[,\n]+/) // Separate by commas or line breaks
          .map((uuid) => uuid.trim())
          .filter((uuid) => uuid.length > 0);

        if (uuids.length === 0) {
          await ctx.reply(
            '❌ No se detectaron UUIDs válidos. Por favor, intente nuevamente:',
            Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'menu_principal')]])
          );
          return;
        }

        logger.info(`Procesando ${uuids.length} UUID(s) para complemento de pago`, {
          tenantId,
          uuidsCount: uuids.length,
        });

        // Get information for each invoice from Facturapi
        const facturapi = await FacturapiService.getFacturapiClient(tenantId);

        const facturasInfo: InvoiceInfo[] = [];
        const errores: string[] = [];

        for (const uuid of uuids) {
          try {
            // Search invoice by UUID
            const facturas = await facturapi.invoices.list({
              q: uuid,
              limit: 1,
            });

            if (facturas.total_results === 0) {
              errores.push(`UUID ${uuid}: No se encontró la factura`);
              continue;
            }

            const factura = facturas.data[0];

            logger.debug(`UUID ${uuid} - Customer:`, JSON.stringify(factura.customer, null, 2));

            // Verify that the invoice is valid
            if (factura.status === 'canceled') {
              errores.push(`UUID ${uuid}: La factura está cancelada`);
              continue;
            }

            // Get customer from invoice
            // IMPORTANT: factura.customer can be an object or a string (ID)
            // Try to get the ID in multiple ways
            const facturaCustomerId =
              typeof factura.customer === 'object'
                ? factura.customer.id || factura.customer.tax_id || factura.customer.legal_name
                : factura.customer;

            logger.debug(`UUID ${uuid} - Customer ID extraído: ${facturaCustomerId}`);

            // Get customer name
            const customerName =
              typeof factura.customer === 'object'
                ? factura.customer.legal_name || 'Cliente'
                : 'Cliente';

            facturasInfo.push({
              uuid: uuid, // ✅ USE THE ORIGINAL UUID THAT THE USER WROTE, not factura.id
              facturapiId: factura.id, // Also save the Facturapi ID just in case
              folio: String(factura.folio_number), // Convert to string explicitly
              total: factura.total,
              customer: facturaCustomerId,
              customerObject: factura.customer, // Save the complete customer object
              customerName: customerName,
            });
          } catch (error) {
            errores.push(
              `UUID ${uuid}: Error al obtener información - ${(error as Error).message}`
            );
          }
        }

        // If there are errors, show them
        if (errores.length > 0) {
          const mensajeErrores = errores.join('\n• ');
          await ctx.reply(`⚠️ Se encontraron los siguientes problemas:\n\n• ${mensajeErrores}`);
        }

        // If there are no valid invoices, abort
        if (facturasInfo.length === 0) {
          await ctx.reply(
            '❌ No se pudo procesar ningún UUID válido.',
            Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]])
          );
          ctx.userState.esperando = null;
          return;
        }

        // GROUP INVOICES BY CUSTOMER
        const facturasPorCliente: Record<
          string,
          {
            customerObject: any;
            customerName: string;
            facturas: InvoiceInfo[];
          }
        > = {};

        facturasInfo.forEach((factura) => {
          const clienteId = factura.customer;
          const clienteNombre = factura.customerName;

          logger.debug(
            `[AGRUPACION] Factura ${factura.folio} - Cliente ID: ${clienteId} - Nombre: ${clienteNombre}`
          );

          if (!facturasPorCliente[clienteId]) {
            facturasPorCliente[clienteId] = {
              customerObject: factura.customerObject,
              customerName: factura.customerName,
              facturas: [],
            };
          }
          facturasPorCliente[clienteId].facturas.push(factura);
        });

        const clientes = Object.keys(facturasPorCliente);

        logger.debug(`[AGRUPACION] Total de clientes detectados: ${clientes.length}`);
        clientes.forEach((cId) => {
          logger.debug(
            `[AGRUPACION] Cliente ${facturasPorCliente[cId].customerName}: ${facturasPorCliente[cId].facturas.length} facturas`
          );
        });

        logger.info(`Creando ${clientes.length} complemento(s) de pago`, {
          tenantId,
          clientes: clientes.length,
          totalFacturas: facturasInfo.length,
        });

        // Create one complement per customer
        const resultados: ProcessResult[] = [];

        for (const clienteIdKey of clientes) {
          const { customerObject, customerName, facturas } = facturasPorCliente[clienteIdKey];

          // Anti-duplicate validation: Check if a complement already exists with these invoices
          const facturasUUIDs = facturas
            .map((f) => f.uuid)
            .sort()
            .join(',');
          const complementoExistente = await prisma.paymentComplement.findFirst({
            where: {
              tenantId,
              customerId: clienteIdKey,
            },
          });

          if (complementoExistente) {
            // Validate relatedInvoices is not null and is an array
            if (
              complementoExistente.relatedInvoices &&
              Array.isArray(complementoExistente.relatedInvoices)
            ) {
              const uuidsExistentes = (complementoExistente.relatedInvoices as Array<any>)
                .map((inv: any) => inv.uuid)
                .sort()
                .join(',');
              if (uuidsExistentes === facturasUUIDs) {
                logger.info(
                  `[ANTI-DUPLICADO] Ya existe complemento ${complementoExistente.series}-${complementoExistente.folioNumber} con las mismas facturas`
                );
                resultados.push({
                  success: false,
                  customerName,
                  error: `Ya existe un complemento de pago (${complementoExistente.series}-${complementoExistente.folioNumber}) con estas facturas`,
                  facturas,
                });
                continue;
              }
            }
          }

          // Prepare data for payment complement
          const invoicesData = facturas.map((factura) => ({
            uuid: factura.uuid,
            amount: factura.total,
            installment: 1,
            last_balance: factura.total,
            tax_rate: 0.16,
            retention_rate: 0.04,
            include_retention: true,
          }));

          try {
            const resultado = (await FacturapiService.createMultipleInvoicesPaymentComplement(
              tenantId,
              {
                customer: customerObject,
                payment_form: '03',
                invoices: invoicesData,
              }
            )) as PaymentComplementResult;

            // Save to database
            try {
              const totalAmount = facturas.reduce(
                (sum, f) => sum + parseFloat(f.total.toString()),
                0
              );

              await prisma.paymentComplement.create({
                data: {
                  tenantId,
                  facturapiComplementId: resultado.id,
                  uuid: resultado.id, // SAT UUID
                  series: resultado.series || 'P',
                  folioNumber:
                    typeof resultado.folio_number === 'string'
                      ? parseInt(resultado.folio_number, 10)
                      : resultado.folio_number,
                  customerId: clienteIdKey, // Use the correct customer key
                  customerName,
                  paymentForm: '03',
                  totalAmount,
                  relatedInvoices: facturas.map((f) => ({
                    uuid: f.uuid,
                    folio: f.folio,
                    amount: f.total,
                  })),
                  paymentDate: new Date(),
                },
              });

              logger.info('Complemento guardado en BD', {
                tenantId,
                complementoId: resultado.id,
              });
            } catch (dbError) {
              logger.warn('No se pudo guardar complemento en BD (no crítico)', {
                error: (dbError as Error).message,
              });
            }

            resultados.push({
              success: true,
              customerName,
              resultado,
              facturas,
            });

            logger.info('Complemento de pago creado exitosamente', {
              tenantId,
              cliente: customerName,
              complementoId: resultado.id,
              facturas: facturas.length,
            });
          } catch (error) {
            resultados.push({
              success: false,
              customerName,
              error: (error as Error).message,
              facturas,
            });

            logger.error('Error al crear complemento para cliente:', {
              cliente: customerName,
              error: (error as Error).message,
            });
          }
        }

        // Build result message
        const exitosos = resultados.filter((r) => r.success);
        const fallidos = resultados.filter((r) => !r.success);

        let mensaje = '';

        if (exitosos.length > 0) {
          mensaje += `✅ *${exitosos.length} Complemento(s) Creado(s):*\n\n`;

          exitosos.forEach((result, index) => {
            if (!result.resultado) return; // Skip if no resultado (shouldn't happen for exitosos)

            const facturasList = result.facturas
              .map((f) => `    - Folio ${f.folio}: $${f.total.toFixed(2)}`)
              .join('\n');

            mensaje += `*${index + 1}. Cliente:* ${result.customerName}\n`;
            mensaje += `   *UUID:* \`${result.resultado.id}\`\n`;
            mensaje += `   *Folio:* ${result.resultado.series || 'P'}-${result.resultado.folio_number}\n`;
            mensaje += `   *Facturas (${result.facturas.length}):*\n${facturasList}\n\n`;
          });
        }

        if (fallidos.length > 0) {
          mensaje += `\n❌ *${fallidos.length} Error(es):*\n\n`;
          fallidos.forEach((result, index) => {
            mensaje += `${index + 1}. Cliente ${result.customerName}: ${result.error}\n`;
          });
        }

        // Create download buttons for each successful complement
        const downloadButtons: any[] = [];
        exitosos.forEach((result, index) => {
          if (index < 3 && result.resultado) {
            // Maximum 3 complements to not saturate buttons
            downloadButtons.push([
              Markup.button.callback(
                `📄 PDF ${result.customerName.substring(0, 15)}...`,
                `pago_pdf_${result.resultado.id}_${result.resultado.folio_number}`
              ),
              Markup.button.callback(
                `📋 XML`,
                `pago_xml_${result.resultado.id}_${result.resultado.folio_number}`
              ),
            ]);
          }
        });

        downloadButtons.push([Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]);

        await ctx.reply(mensaje, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(downloadButtons),
        });

        // Clear state
        ctx.userState.esperando = null;
      } catch (error) {
        logger.error({ error }, 'Error al crear complemento de pago');

        let errorMsg = 'Ocurrió un error al crear el complemento de pago.';
        if ((error as any).response?.data) {
          const errorData = (error as any).response.data;
          if (typeof errorData.error === 'string') {
            errorMsg = `❌ Error: ${errorData.error}`;
          } else if (errorData.details) {
            errorMsg = `❌ Error de validación: ${JSON.stringify(errorData.details)}`;
          }
        }

        await ctx.reply(
          errorMsg,
          Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]])
        );

        ctx.userState.esperando = null;
      }
    } else {
      // If we are not waiting for UUIDs, pass to next handler
      return next();
    }
  });

  // ========== HANDLERS TO DOWNLOAD PDF/XML OF PAYMENT COMPLEMENT ==========

  // Handler to download PDF of payment complement
  bot.action(/pago_pdf_(.+)_(\d+)/, async (ctx: BotContext) => {
    const complementoId = ctx.match?.[1];
    const folioNumero = ctx.match?.[2];

    if (!complementoId || !folioNumero) {
      await ctx.answerCbQuery('Error: datos no válidos');
      return;
    }

    const processId = `pago_pdf_${complementoId}`;
    if (ctx.isProcessActive(processId)) {
      await ctx.answerCbQuery('Ya se está descargando el PDF, por favor espere.');
      return;
    }

    ctx.markProcessActive(processId);

    try {
      await ctx.answerCbQuery();
      await ctx.reply('⏳ Descargando PDF del complemento de pago...');

      // Use the same download function as normal invoices
      const { descargarFactura } = await import('./invoice.handler.js');
      const filePath = await descargarFactura(
        complementoId,
        'pdf',
        folioNumero,
        'Complemento',
        ctx
      );

      // Check if file exists using async fs
      try {
        await fs.access(filePath);
        await ctx.replyWithDocument({ source: filePath });
        await fs.unlink(filePath);
      } catch (fileError) {
        throw new Error('No se pudo generar el archivo PDF');
      }
    } catch (error) {
      logger.error({ error }, 'Error al descargar PDF del complemento');

      let errorMsg = '❌ Ocurrió un error al descargar el PDF.';
      if ((error as any).response) {
        errorMsg = `❌ Error al descargar (${(error as any).response.status}): ${(error as Error).message}`;
      }

      await ctx.reply(
        errorMsg,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]])
      );
    } finally {
      ctx.markProcessInactive(processId);
    }
  });

  // Handler to download XML of payment complement
  bot.action(/pago_xml_(.+)_(\d+)/, async (ctx: BotContext) => {
    const complementoId = ctx.match?.[1];
    const folioNumero = ctx.match?.[2];

    if (!complementoId || !folioNumero) {
      await ctx.answerCbQuery('Error: datos no válidos');
      return;
    }

    const processId = `pago_xml_${complementoId}`;
    if (ctx.isProcessActive(processId)) {
      await ctx.answerCbQuery('Ya se está descargando el XML, por favor espere.');
      return;
    }

    ctx.markProcessActive(processId);

    try {
      await ctx.answerCbQuery();
      await ctx.reply('⏳ Descargando XML del complemento de pago...');

      // Use the same download function as normal invoices
      const { descargarFactura } = await import('./invoice.handler.js');
      const filePath = await descargarFactura(
        complementoId,
        'xml',
        folioNumero,
        'Complemento',
        ctx
      );

      // Check if file exists using async fs
      try {
        await fs.access(filePath);
        await ctx.replyWithDocument({ source: filePath });
        await fs.unlink(filePath);
      } catch (fileError) {
        throw new Error('No se pudo generar el archivo XML');
      }
    } catch (error) {
      logger.error({ error }, 'Error al descargar XML del complemento');

      let errorMsg = '❌ Ocurrió un error al descargar el XML.';
      if ((error as any).response) {
        errorMsg = `❌ Error al descargar (${(error as any).response.status}): ${(error as Error).message}`;
      }

      await ctx.reply(
        errorMsg,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]])
      );
    } finally {
      ctx.markProcessInactive(processId);
    }
  });

  logger.info('✅ Handlers de complemento de pago registrados');
}
