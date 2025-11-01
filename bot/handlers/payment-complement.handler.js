// bot/handlers/payment-complement.handler.js
import { Markup } from 'telegraf';
import fs from 'fs';
import FacturapiService from '../../services/facturapi.service.js';
import logger from '../../core/utils/logger.js';
import { MenuStateManager } from '../utils/menu-transition.utils.js';

// Importar prisma
import { prisma as configPrisma } from '../../config/database.js';
import libPrisma from '../../lib/prisma.js';

// Logger específico
const paymentLogger = logger.child({ module: 'bot-payment-complement' });

// Usar la instancia que esté disponible
const prisma = libPrisma || configPrisma;

/**
 * Registra los manejadores de complementos de pago
 * @param {Object} bot - Instancia del bot
 */
export function registerPaymentComplementHandler(bot) {
  // Botón principal: Complemento de Pago - SIMPLIFICADO (sin selección de cliente)
  bot.action('menu_complemento_pago', async (ctx) => {
    try {
      await ctx.answerCbQuery('💰 Complemento de Pago');

      console.log('[PAYMENT-COMPLEMENT] Botón presionado por usuario:', ctx.from.id);

      const menuManager = new MenuStateManager(ctx);
      menuManager.pushMenu('payment_complement', {});

      // Marcar que estamos esperando UUIDs
      ctx.userState.esperando = 'uuids_pago';

      console.log('[PAYMENT-COMPLEMENT] Estado actualizado, esperando:', ctx.userState.esperando);

      // Intentar editar el mensaje primero, si falla, enviar uno nuevo
      try {
        await ctx.editMessageText(
          '💰 *Complemento de Pago*\n\n' +
            '📝 Escribe el UUID de la factura que quieres pagar.\n\n' +
            'Si son varias facturas, escribe un UUID por línea.\n\n' +
            '✍️ Escribe aquí:',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'menu_principal')]]),
          }
        );
        console.log('[PAYMENT-COMPLEMENT] Mensaje editado exitosamente');
      } catch (editError) {
        // Si no se puede editar, enviar mensaje nuevo
        console.log('[PAYMENT-COMPLEMENT] No se pudo editar, enviando mensaje nuevo');
        await ctx.reply(
          '💰 *Complemento de Pago*\n\n' +
            '📝 Escribe el UUID de la factura que quieres pagar.\n\n' +
            'Si son varias facturas, escribe un UUID por línea.\n\n' +
            '✍️ Escribe aquí:',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'menu_principal')]]),
          }
        );
      }
    } catch (error) {
      console.error('[PAYMENT-COMPLEMENT] Error al iniciar complemento de pago:', error);
      paymentLogger.error('Error al iniciar complemento de pago:', error);
      try {
        await ctx.reply('❌ Ocurrió un error. Por favor, intente nuevamente.');
      } catch (replyError) {
        console.error('[PAYMENT-COMPLEMENT] Error al enviar mensaje de error:', replyError);
      }
    }
  });

  // Manejador de texto para recibir UUID(s)
  bot.on('text', async (ctx, next) => {
    console.log('[PAYMENT-COMPLEMENT] Texto recibido, estado actual:', ctx.userState?.esperando);

    // Verificar primero si estamos en modo de espera de UUIDs
    if (!ctx.userState || ctx.userState.esperando !== 'uuids_pago') {
      // No estamos esperando UUIDs, pasar al siguiente handler
      return next();
    }

    console.log('[PAYMENT-COMPLEMENT] Procesando UUIDs...');
    const texto = ctx.message.text;

    // Solo procesar si estamos esperando UUIDs de pago
    if (ctx.userState.esperando === 'uuids_pago') {
      try {
        await ctx.reply('⏳ Procesando complemento(s) de pago, por favor espere...');

        const tenantId = ctx.getTenantId();

        // Parsear UUIDs (pueden venir separados por comas, espacios, saltos de línea)
        // Formato aceptado:
        // - 343DBD73-CEA7-4672-902F-6A1F89A9C988
        // - ACFEFE7A-403B-4FCB-A094-37F27A7DE8F2
        // - 9D7286F9-8470-4C6B-BF13-9BDBAE4EC30E
        // O separados por comas: UUID1, UUID2, UUID3
        const uuids = texto
          .split(/[,\n]+/) // Separar por comas o saltos de línea
          .map((uuid) => uuid.trim())
          .filter((uuid) => uuid.length > 0);

        if (uuids.length === 0) {
          await ctx.reply(
            '❌ No se detectaron UUIDs válidos. Por favor, intente nuevamente:',
            Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar', 'menu_principal')]])
          );
          return;
        }

        paymentLogger.info(`Procesando ${uuids.length} UUID(s) para complemento de pago`, {
          tenantId,
          uuidsCount: uuids.length,
        });

        // Obtener información de cada factura desde Facturapi
        const facturapi = await FacturapiService.getFacturapiClient(tenantId);

        const facturasInfo = [];
        const errores = [];

        for (const uuid of uuids) {
          try {
            // Buscar la factura por UUID
            const facturas = await facturapi.invoices.list({
              q: uuid,
              limit: 1,
            });

            if (facturas.total_results === 0) {
              errores.push(`UUID ${uuid}: No se encontró la factura`);
              continue;
            }

            const factura = facturas.data[0];

            console.log(`[DEBUG-CUSTOMER] UUID ${uuid} - Customer:`, JSON.stringify(factura.customer, null, 2));

            // Verificar que la factura esté vigente
            if (factura.status === 'canceled') {
              errores.push(`UUID ${uuid}: La factura está cancelada`);
              continue;
            }

            // Obtener el cliente de la factura
            // IMPORTANTE: factura.customer puede ser un objeto o un string (ID)
            // Intentar obtener el ID de múltiples formas
            const facturaCustomerId = typeof factura.customer === 'object'
              ? (factura.customer.id || factura.customer.tax_id || factura.customer.legal_name)
              : factura.customer;

            console.log(`[DEBUG-CUSTOMER] UUID ${uuid} - Customer ID extraído: ${facturaCustomerId}`);

            // Obtener el nombre del cliente
            const customerName = typeof factura.customer === 'object'
              ? factura.customer.legal_name || 'Cliente'
              : 'Cliente';

            facturasInfo.push({
              uuid: uuid, // ✅ USAR EL UUID ORIGINAL QUE ESCRIBIÓ EL USUARIO, no factura.id
              facturapiId: factura.id, // Guardar también el ID de Facturapi por si acaso
              folio: factura.folio_number,
              total: factura.total,
              customer: facturaCustomerId,
              customerObject: factura.customer, // Guardar el objeto completo del customer
              customerName: customerName,
            });
          } catch (error) {
            errores.push(`UUID ${uuid}: Error al obtener información - ${error.message}`);
          }
        }

        // Si hay errores, mostrarlos
        if (errores.length > 0) {
          const mensajeErrores = errores.join('\n• ');
          await ctx.reply(`⚠️ Se encontraron los siguientes problemas:\n\n• ${mensajeErrores}`);
        }

        // Si no hay facturas válidas, abortar
        if (facturasInfo.length === 0) {
          await ctx.reply(
            '❌ No se pudo procesar ningún UUID válido.',
            Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]])
          );
          ctx.userState.esperando = null;
          return;
        }

        // AGRUPAR FACTURAS POR CLIENTE
        const facturasPorCliente = {};

        facturasInfo.forEach((factura) => {
          const clienteId = factura.customer;
          const clienteNombre = factura.customerName;

          console.log(`[AGRUPACION] Factura ${factura.folio} - Cliente ID: ${clienteId} - Nombre: ${clienteNombre}`);

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

        console.log(`[AGRUPACION] Total de clientes detectados: ${clientes.length}`);
        clientes.forEach(cId => {
          console.log(`[AGRUPACION] Cliente ${facturasPorCliente[cId].customerName}: ${facturasPorCliente[cId].facturas.length} facturas`);
        });

        paymentLogger.info(`Creando ${clientes.length} complemento(s) de pago`, {
          tenantId,
          clientes: clientes.length,
          totalFacturas: facturasInfo.length,
        });

        // Crear un complemento por cada cliente
        const resultados = [];

        for (const clienteIdKey of clientes) {
          const { customerObject, customerName, facturas } = facturasPorCliente[clienteIdKey];

          // Validación anti-duplicados: Verificar si ya existe un complemento con estas facturas
          const facturasUUIDs = facturas.map(f => f.uuid).sort().join(',');
          const complementoExistente = await prisma.paymentComplement.findFirst({
            where: {
              tenantId,
              customerId: clienteIdKey,
            },
          });

          if (complementoExistente) {
            const uuidsExistentes = complementoExistente.relatedInvoices.map(inv => inv.uuid).sort().join(',');
            if (uuidsExistentes === facturasUUIDs) {
              console.log(`[ANTI-DUPLICADO] Ya existe complemento ${complementoExistente.series}-${complementoExistente.folioNumber} con las mismas facturas`);
              resultados.push({
                success: false,
                customerName,
                error: `Ya existe un complemento de pago (${complementoExistente.series}-${complementoExistente.folioNumber}) con estas facturas`,
                facturas,
              });
              continue;
            }
          }

          // Preparar datos para el complemento de pago
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
            const resultado = await FacturapiService.createMultipleInvoicesPaymentComplement(tenantId, {
              customer: customerObject,
              payment_form: '03',
              invoices: invoicesData,
            });

            // Guardar en la base de datos
            try {
              const totalAmount = facturas.reduce((sum, f) => sum + parseFloat(f.total), 0);

              await prisma.paymentComplement.create({
                data: {
                  tenantId,
                  facturapiComplementId: resultado.id,
                  uuid: resultado.id, // UUID del SAT
                  series: resultado.series || 'P',
                  folioNumber: resultado.folio_number,
                  customerId: clienteIdKey, // Usar la key correcta del cliente
                  customerName,
                  paymentForm: '03',
                  totalAmount,
                  relatedInvoices: facturas.map(f => ({
                    uuid: f.uuid,
                    folio: f.folio,
                    amount: f.total,
                  })),
                  paymentDate: new Date(),
                },
              });

              paymentLogger.info('Complemento guardado en BD', {
                tenantId,
                complementoId: resultado.id,
              });
            } catch (dbError) {
              paymentLogger.warn('No se pudo guardar complemento en BD (no crítico)', {
                error: dbError.message,
              });
            }

            resultados.push({
              success: true,
              customerName,
              resultado,
              facturas,
            });

            paymentLogger.info('Complemento de pago creado exitosamente', {
              tenantId,
              cliente: customerName,
              complementoId: resultado.id,
              facturas: facturas.length,
            });
          } catch (error) {
            resultados.push({
              success: false,
              customerName,
              error: error.message,
              facturas,
            });

            paymentLogger.error('Error al crear complemento para cliente:', {
              cliente: customerName,
              error: error.message,
            });
          }
        }

        // Construir mensaje de resultado
        const exitosos = resultados.filter((r) => r.success);
        const fallidos = resultados.filter((r) => !r.success);

        let mensaje = '';

        if (exitosos.length > 0) {
          mensaje += `✅ *${exitosos.length} Complemento(s) Creado(s):*\n\n`;

          exitosos.forEach((result, index) => {
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

        // Crear botones de descarga para cada complemento exitoso
        const downloadButtons = [];
        exitosos.forEach((result, index) => {
          if (index < 3) { // Máximo 3 complementos para no saturar botones
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

        // Limpiar estado
        ctx.userState.esperando = null;
      } catch (error) {
        paymentLogger.error('Error al crear complemento de pago:', error);

        let errorMsg = 'Ocurrió un error al crear el complemento de pago.';
        if (error.response?.data) {
          const errorData = error.response.data;
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
        ctx.userState.pagoClienteId = null;
      }
    } else {
      // Si no estamos esperando UUIDs, pasar al siguiente handler
      return next();
    }
  });

  // ========== HANDLERS PARA DESCARGAR PDF/XML DEL COMPLEMENTO DE PAGO ==========

  // Manejador para descargar PDF del complemento de pago
  bot.action(/pago_pdf_(.+)_(\d+)/, async (ctx) => {
    const complementoId = ctx.match[1];
    const folioNumero = ctx.match[2];

    const processId = `pago_pdf_${complementoId}`;
    if (ctx.isProcessActive(processId)) {
      await ctx.answerCbQuery('Ya se está descargando el PDF, por favor espere.');
      return;
    }

    ctx.markProcessActive(processId);

    try {
      await ctx.answerCbQuery();
      await ctx.reply('⏳ Descargando PDF del complemento de pago...');

      // Usar la misma función de descarga que las facturas normales
      const { descargarFactura } = await import('./invoice.handler.js');
      const filePath = await descargarFactura(complementoId, 'pdf', folioNumero, 'Complemento', ctx);

      if (fs.existsSync(filePath)) {
        await ctx.replyWithDocument({ source: filePath });
        fs.unlinkSync(filePath);
      } else {
        throw new Error('No se pudo generar el archivo PDF');
      }
    } catch (error) {
      paymentLogger.error('Error al descargar PDF del complemento:', error);

      let errorMsg = '❌ Ocurrió un error al descargar el PDF.';
      if (error.response) {
        errorMsg = `❌ Error al descargar (${error.response.status}): ${error.message}`;
      }

      await ctx.reply(
        errorMsg,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]])
      );
    } finally {
      ctx.markProcessInactive(processId);
    }
  });

  // Manejador para descargar XML del complemento de pago
  bot.action(/pago_xml_(.+)_(\d+)/, async (ctx) => {
    const complementoId = ctx.match[1];
    const folioNumero = ctx.match[2];

    const processId = `pago_xml_${complementoId}`;
    if (ctx.isProcessActive(processId)) {
      await ctx.answerCbQuery('Ya se está descargando el XML, por favor espere.');
      return;
    }

    ctx.markProcessActive(processId);

    try {
      await ctx.answerCbQuery();
      await ctx.reply('⏳ Descargando XML del complemento de pago...');

      // Usar la misma función de descarga que las facturas normales
      const { descargarFactura } = await import('./invoice.handler.js');
      const filePath = await descargarFactura(complementoId, 'xml', folioNumero, 'Complemento', ctx);

      if (fs.existsSync(filePath)) {
        await ctx.replyWithDocument({ source: filePath });
        fs.unlinkSync(filePath);
      } else {
        throw new Error('No se pudo generar el archivo XML');
      }
    } catch (error) {
      paymentLogger.error('Error al descargar XML del complemento:', error);

      let errorMsg = '❌ Ocurrió un error al descargar el XML.';
      if (error.response) {
        errorMsg = `❌ Error al descargar (${error.response.status}): ${error.message}`;
      }

      await ctx.reply(
        errorMsg,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]])
      );
    } finally {
      ctx.markProcessInactive(processId);
    }
  });
}
