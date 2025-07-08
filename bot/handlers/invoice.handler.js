// bot/handlers/invoice.handler.js
import { Markup } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import TenantService from '../../services/tenant.service.js';
import InvoiceService from '../../services/invoice.service.js';
import { invoiceSummaryView, invoiceCreatedView, invoiceDetailsView } from '../views/invoice.view.js';
import CustomerSetupService from '../../services/customer-setup.service.js';
import { clientSelectionMenu } from '../views/menu.view.js';

// Importar prisma de manera segura
import { prisma as configPrisma } from '../../config/database.js';
// También intentar importar desde lib
import libPrisma from '../../lib/prisma.js';

// Usar la instancia que esté disponible
const prisma = libPrisma || configPrisma;

// Verificación de seguridad
if (!prisma) {
  console.error('ERROR CRÍTICO: No se pudo inicializar Prisma, ambas fuentes fallaron');
}


// Motivos de cancelación del SAT para referencia
const MOTIVOS_CANCELACION = {
  '01': 'Comprobante emitido con errores con relación',
  '02': 'Comprobante emitido con errores sin relación',
  '03': 'No se llevó a cabo la operación',
  '04': 'Operación nominativa relacionada en la factura global'
};

// Recrear __dirname 
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Asegura que existe el directorio temporal
 * @returns {string} - Ruta al directorio temporal
 */
function ensureTempDirExists() {
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    try {
      fs.mkdirSync(tempDir, { recursive: true });
      console.log('Directorio temporal creado:', tempDir);
    } catch (err) {
      console.error('Error al crear directorio temporal:', err);
    }
  }
  return tempDir;
}

/**
 * Descarga un archivo de factura (PDF/XML) directamente de FacturAPI
 * @param {string} facturaId - ID de la factura
 * @param {string} formato - Formato (pdf/xml)
 * @param {string} folio - Número de folio
 * @param {string} clienteNombre - Nombre del cliente
 * @param {Object} ctx - Contexto del usuario
 * @returns {Promise<string>} - Ruta al archivo descargado
 */
async function descargarFactura(facturaId, formato, folio, clienteNombre, ctx) {
  console.log(`Descargando factura ${facturaId} en formato ${formato}`);

  const tempDir = ensureTempDirExists();
  const folioStr = folio || 'unknown';

  // Intentar obtener la serie del estado del usuario
  const series = ctx.userState?.series || 'A'; // 'A' como fallback
  console.log(`Serie utilizada para el archivo: ${series}`);
  
  // Construir el nombre del archivo con la serie correcta
  const filePath = `${tempDir}/${series}${folioStr}.${formato}`;
  console.log('Creando archivo temporal en:', filePath);

  fs.createWriteStream(filePath);

  try {
    // Obtener el tenant ID del contexto del usuario
    const tenantId = ctx.userState?.tenantId;
    if (!tenantId) {
      throw new Error('No se encontró el tenant ID en el estado del usuario');
    }
    
    // Obtener el cliente de FacturAPI para este tenant
    const facturapIService = (await import('../../services/facturapi.service.js')).default;
    await facturapIService.getFacturapiClient(tenantId);
    
    console.log(`Cliente FacturAPI obtenido para tenant ${tenantId}, descargando ${formato}...`);
    
    // Usar axios para descargar directamente desde la API de FacturAPI
    if (formato === 'pdf' || formato === 'xml') {
      // Obtener la API key directamente del tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId }
      });
      
      if (!tenant || !tenant.facturapiApiKey) {
        throw new Error('No se pudo obtener la API key del tenant');
      }
      
      // Construir la URL de la API de FacturAPI
      const apiUrl = `https://www.facturapi.io/v2/invoices/${facturaId}/${formato}`;
      
      console.log(`Descargando desde URL de FacturAPI: ${apiUrl}`);
      
      // Realizar la solicitud con axios
      const response = await axios({
        method: 'GET',
        url: apiUrl,
        responseType: 'arraybuffer', // Importante: usar arraybuffer para archivos binarios
        headers: {
          'Authorization': `Bearer ${tenant.facturapiApiKey}` // Usar la API key del tenant
        }
      });
      
      // Escribir el archivo
      fs.writeFileSync(filePath, response.data);
      console.log('Archivo descargado exitosamente:', filePath);
      return filePath;
    } else {
      throw new Error(`Formato no soportado: ${formato}`);
    }
  } catch (error) {
    console.error(`Error al descargar ${formato} de FacturAPI:`, error.message);
    
    // Mostrar detalles adicionales si están disponibles
    if (error.response) {
      console.error('Detalles del error:', error.response.status, error.response.data);
    }
    
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      console.error('Error al eliminar archivo parcial:', e);
    }
    
    throw error;
  }
}

/**
 * Registra los manejadores relacionados con facturas
 * @param {Object} bot - Instancia del bot
 */
export function registerInvoiceHandler(bot) {
  // Menú de generación de factura
  bot.action('menu_generar', async (ctx) => {
    await ctx.answerCbQuery();
    
    try {
      // Importar el servicio para verificar si hay clientes configurados
      // Verificar si el tenant tiene clientes configurados
      const hasCustomers = await CustomerSetupService.hasConfiguredCustomers(ctx.getTenantId());
      
      if (!hasCustomers) {
        // Si no hay clientes configurados, intentar configurarlos automáticamente
        return ctx.reply(
          '⚠️ No tienes clientes configurados en tu cuenta. Vamos a intentar configurarlos automáticamente.',
          Markup.inlineKeyboard([
            [Markup.button.callback('Configurar Clientes', 'configure_clients')]
          ])
        );
      }
      
      // Obtener los clientes disponibles para este tenant
      const availableCustomers = await prisma.tenantCustomer.findMany({
        where: {
          tenantId: ctx.getTenantId(),
          isActive: true
        },
        select: {
          id: true,
          legalName: true,
          facturapiCustomerId: true
        }
      });
      
      // Si no hay clientes disponibles (aunque existan en la base de datos)
      if (availableCustomers.length === 0) {
        return ctx.reply(
          '⚠️ No hay clientes disponibles para facturar. Por favor, contacta a soporte.'
        );
      }
      
      // Función para acortar nombres largos
      const shortenName = (name) => {
        // Límite seguro para callback_data en Telegram
        const maxClienteLength = 30;
        
        if (!name || name.length <= maxClienteLength) return name;
        
        // Para nombres largos, usar primeras palabras y agregar "..."
        const words = name.split(' ');
        let shortened = words[0];
        let i = 1;
        
        while (i < words.length && (shortened.length + words[i].length + 1) <= (maxClienteLength - 3)) {
          shortened += ' ' + words[i];
          i++;
        }
        
        return shortened + '...';
      };
      
      // Mapa de nombres cortos a nombres completos
      const shortToFullNameMap = {};
      
      // Construir los botones para los clientes disponibles
      availableCustomers.map(customer => {
        const shortName = shortenName(customer.legalName);
        shortToFullNameMap[shortName] = customer.legalName;
        
        // Guardar el ID de FacturAPI en el estado global para usarlo después
        if (!ctx.clientIds) ctx.clientIds = {};
        ctx.clientIds[customer.legalName] = customer.facturapiCustomerId;
        
        return [Markup.button.callback(shortName, `cliente_${customer.facturapiCustomerId}`)]
      });
      
      // Guardar el mapa de nombres en el estado del contexto
      ctx.clientNameMap = shortToFullNameMap;
      
      // Filtrar clientes, excluyendo CHUBB y AXA del flujo normal (solo Excel)
      const clientsForMenu = availableCustomers
        .filter(customer => !customer.legalName.includes('CHUBB') && !customer.legalName.includes('AXA'))
        .map(customer => ({
          id: customer.facturapiCustomerId,
          name: shortenName(customer.legalName)
        }));

      // Usar la función existente en menu.view.js
      await ctx.reply(
        'Seleccione el cliente para generar la factura:',
        clientSelectionMenu(clientsForMenu, true) // `true` para incluir siempre la opción CHUBB
      );
    } catch (error) {
      console.error('Error al verificar clientes:', error);
      
      ctx.reply(
        '❌ Ocurrió un error al obtener los clientes disponibles. Por favor, intente nuevamente más tarde.',
        Markup.inlineKeyboard([
          [Markup.button.callback('Volver al Menú', 'menu_principal')]
        ])
      );
    }
  });

  // Manejar consulta de facturas
  bot.action('menu_consultar', (ctx) => {
    ctx.answerCbQuery();
    // Iniciamos el flujo de consulta
    ctx.userState.esperando = 'folioConsulta';
    ctx.reply('Por favor, ingrese el número de folio de la factura que desea consultar:');
  });

  // Manejador para confirmación de factura
  bot.action(/^confirmar_(?!cancelacion_)(.+)/, async (ctx) => {
    console.log(`[DEBUG] Entering confirmar_ action handler for transactionId: ${ctx.match?.[1]}`); // ADDED INITIAL LOG + transactionId check
    try { // ADDED TRY BLOCK
      const transactionId = ctx.match[1];
      if (!transactionId) {
          console.error('[ERROR] Transaction ID not found in ctx.match for confirmar_ action.');
          await ctx.answerCbQuery('Error interno: ID de transacción no encontrado.');
          return ctx.reply('❌ Ocurrió un error interno (ID no encontrado). Por favor, intente generar la factura de nuevo.');
      }

      // Verificar si hay una sesión activa
    if (!ctx.userState) {
      return ctx.reply('La sesión ha expirado. Por favor, comience de nuevo.', 
        Markup.inlineKeyboard([[Markup.button.callback('Volver al Menú', 'menu_principal')]])
      );
    }

    // Verificar si el usuario pertenece a un tenant
    if (!ctx.hasTenant()) {
      return ctx.reply(
        'No tienes una empresa registrada. Por favor, usa /registro para crear una.',
        Markup.inlineKeyboard([
          [Markup.button.callback('📝 Registrarme', 'start_registration')]
        ])
      );
    }

    // --- MOVED SUBSCRIPTION CHECK HERE ---
    // Verificar si el usuario puede generar facturas (límites del plan y estado)
    console.log(`[CHECK_SUBS] Verificando capacidad para generar factura para tenant ${ctx.getTenantId()}...`); // REPLACED LOGGER
    const canGenerateResult = await TenantService.canGenerateInvoice(ctx.getTenantId());
    console.log(`[CHECK_SUBS] Resultado de verificación de capacidad para tenant ${ctx.getTenantId()}:`, canGenerateResult); // REPLACED LOGGER
    
    if (!canGenerateResult.canGenerate) {
      console.warn(`[CHECK_SUBS] Generación de factura NO permitida para tenant ${ctx.getTenantId()}. Resultado:`, canGenerateResult); // REPLACED LOGGER
      // Verificar si la razón es por suscripción inactiva
      const inactiveStates = ['pending_payment', 'expired', 'canceled', 'none'];
      if (canGenerateResult.subscriptionStatus && inactiveStates.includes(canGenerateResult.subscriptionStatus)) {
        console.warn(`[CHECK_SUBS] Razón: Suscripción inactiva (${canGenerateResult.subscriptionStatus}) para tenant ${ctx.getTenantId()}. Enviando alerta...`); // REPLACED LOGGER
        // Construir el mensaje de alerta específico
        const statusText = canGenerateResult.subscriptionStatus === 'pending_payment' ? 'Pago pendiente' : 'Vencida';
        const paymentLink = canGenerateResult.paymentLink || 'https://mock-stripe-payment-link.com/pricemockdefault/1745906401125'; // Fallback
        const planName = 'Basic Plan'; // TODO: Obtener el nombre real del plan si es posible desde canGenerateResult o tenant

        return ctx.reply(
          `🚨 Suscripción Vencida\n\n` +
          `Tu período de prueba o suscripción para Pego ha vencido.\n\n` +
          `Plan: ${planName}\n` + // Ajustar si se obtiene el nombre real
          `Estado: ${statusText}\n\n` +
          `Para reactivar tu servicio y continuar usándolo, por favor realiza tu pago a través del siguiente enlace:\n\n` +
          `${paymentLink}\n\n` +
          `Si tienes alguna duda, contáctanos.`,
          Markup.inlineKeyboard([
            [Markup.button.url('Realizar Pago', paymentLink)], // Botón directo al pago
            [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]
          ])
        );
      } else {
        console.warn(`[CHECK_SUBS] Razón: Otra (${canGenerateResult.reason}) para tenant ${ctx.getTenantId()}. Enviando alerta genérica...`); // REPLACED LOGGER
        // Si la razón es otra (límite alcanzado, error interno, etc.)
        return ctx.reply(
          `❌ No puedes generar más facturas: ${canGenerateResult.reason}\n\n` +
          `Contacta al administrador o revisa tu plan.`,
          Markup.inlineKeyboard([
            // Podríamos añadir botones específicos según la razón aquí
            [Markup.button.callback('🔙 Volver al Menú', 'menu_principal')]
          ])
        );
      }
    } else {
        console.log(`[CHECK_SUBS] Generación de factura PERMITIDA para tenant ${ctx.getTenantId()}. Continuando flujo...`); // REPLACED LOGGER
    }
    // --- END MOVED SUBSCRIPTION CHECK ---


    // Solo verificar el ID de transacción si ya se generó una factura
    if (ctx.userState.facturaGenerada && ctx.userState.transactionId !== transactionId) {
      return ctx.reply(
        'Esta solicitud ya no es válida. Por favor, genere una nueva factura.',
        Markup.inlineKeyboard([[Markup.button.callback('Volver al Menú', 'menu_principal')]])
      );
    }

    // Verificar si este proceso ya está en curso
    if (ctx.isProcessActive(transactionId)) {
      await ctx.answerCbQuery('Esta factura ya está siendo procesada, por favor espere.');
      return;
    }

    // Marcar este proceso como activo
    ctx.markProcessActive(transactionId);

    try {
      // Intentar eliminar los botones para evitar clics adicionales
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (error) {
        if (!error.description || !error.description.includes("message is not modified")) {
          throw error;
        }
      }
      await ctx.reply('⏳ Generando factura, por favor espere...');

      // Generar la factura con el tenant actual
      const factura = await InvoiceService.generateInvoice({
        ...ctx.userState,
        userId: ctx.from.id  // Añadir ID del usuario para auditoría
      }, ctx.getTenantId());  // Pasar el ID del tenant

      // Guardar datos de la factura generada
      ctx.userState.facturaId = factura.id;
      ctx.userState.series = factura.series; // Usar el mismo nombre que se usa en descargarFactura
      ctx.userState.folioFactura = factura.folio_number;
      ctx.userState.facturaGenerada = true;

      // Usar la vista para mostrar la factura creada
      const { message, keyboard, parse_mode } = invoiceCreatedView(factura);
      ctx.reply(message, { parse_mode, ...keyboard });
    } catch (error) {
      console.error('Error al generar factura:', error);
      let errorMsg = 'Ocurrió un error al generar la factura.';

      if (error.response && error.response.data) {
        const errorData = error.response.data;
        if (typeof errorData.error === 'string') {
          if (errorData.error.includes("Couldn't find product_key")) {
            errorMsg = `❌ La clave de producto "${ctx.userState.claveProducto}" no es válida o no existe en el catálogo de FacturAPI.`;
          } else if (errorData.error.includes("Couldn't find customer")) {
            errorMsg = `❌ No se pudo encontrar el cliente seleccionado. Puede que haya sido eliminado.`;
          } else if (errorData.error.includes("connect")) {
            errorMsg = `❌ Error de conexión con el servicio de FacturAPI. Verifique la conexión.`;
          } else {
            errorMsg = `❌ Error: ${errorData.error}`;
          }
        } else if (errorData.details) {
          errorMsg = `❌ Error de validación en los datos: ${JSON.stringify(errorData.details)}`;
        }
      } else if (error.code === 'ECONNREFUSED') {
        errorMsg = `❌ No se pudo conectar con el servidor de facturación.`;
      }

      ctx.reply(errorMsg, Markup.inlineKeyboard([[Markup.button.callback('Volver al Menú', 'menu_principal')]]));
    } finally {
      ctx.markProcessInactive(transactionId);
      await ctx.answerCbQuery(); // From original finally block
    } // END OF ORIGINAL FINALLY
    } catch (err) { // ADDED CATCH BLOCK
        console.error('[ERROR] Uncaught error within confirmar_ handler:', err); // Log the actual error
        // Send a generic error message to the user
        try {
            // Use the specific error message if available, otherwise generic
            const userMessage = err.message && typeof err.message === 'string' ? 
                                `❌ Error: ${err.message}` : 
                                '❌ Ocurrió un error inesperado al procesar tu solicitud. Por favor, intenta de nuevo o contacta a soporte.';
            await ctx.reply(userMessage);
        } catch (replyError) {
            console.error('[ERROR] Failed to send error reply to user:', replyError);
        }
        // Ensure the callback query is answered even in case of error
        try {
            await ctx.answerCbQuery('Error procesando la solicitud.'); // Provide text for the notification
        } catch (answerError) {
             console.error('[ERROR] Failed to answer callback query on error:', answerError);
        }
    } // END OF ADDED CATCH BLOCK
  });

  // Manejador para cancelar operación
  bot.action(/cancelar_(.+)/, async (ctx) => {
    const transactionId = ctx.match[1];

    if (ctx.isProcessActive(transactionId)) {
      await ctx.answerCbQuery('Esta solicitud ya está siendo procesada.');
      return;
    }

    ctx.markProcessActive(transactionId);

    try {
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (error) {
        if (!error.description || !error.description.includes("message is not modified")) {
          throw error;
        }
      }
      ctx.resetState();
      ctx.reply(
        'Operación cancelada. Puede iniciar nuevamente cuando desee.',
        Markup.inlineKeyboard([[Markup.button.callback('Volver al Menú', 'menu_principal')]])
      );
    } finally {
      ctx.markProcessInactive(transactionId);
      await ctx.answerCbQuery();
    }
  });

  // Manejador para descargar PDF
  bot.action(/pdf_(.+)_(\d+)/, async (ctx) => {
    const facturaId = ctx.match[1];
    const folioNumero = ctx.match[2];  // Extraer el número de folio del regex

    console.log('Estado del usuario al descargar PDF:', ctx.userState);
    console.log('ID de factura solicitado:', facturaId);
    console.log('Serie en estado del usuario:', ctx.userState?.series || 'No disponible');

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
      console.error('Error al descargar PDF:', error);

      let errorMsg = '❌ Ocurrió un error al descargar el PDF.';
      if (error.response) {
        console.log('Respuesta de error:', error.response.status, error.response.data);
        errorMsg = `❌ Error al descargar (${error.response.status}): ${error.message}`;
      }

      ctx.reply(errorMsg, Markup.inlineKeyboard([[Markup.button.callback('Volver al Menú', 'menu_principal')]]));
    } finally {
      ctx.markProcessInactive(processId);
      await ctx.answerCbQuery();
    }
  });

  // Manejador para descargar XML
  bot.action(/xml_(.+)_(\d+)/, async (ctx) => {
    const facturaId = ctx.match[1];
    const folioNumero = ctx.match[2];  // Extraer el número de folio del regex

    console.log('Estado del usuario al descargar XML:', ctx.userState);
    console.log('ID de factura solicitado:', facturaId);
    console.log('Serie en estado del usuario:', ctx.userState?.series || 'No disponible');

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
      console.error('Error al descargar XML:', error);

      let errorMsg = '❌ Ocurrió un error al descargar el XML.';
      if (error.response) {
        console.log('Respuesta de error:', error.response.status, error.response.data);
        errorMsg = `❌ Error al descargar (${error.response.status}): ${error.message}`;
      }

      ctx.reply(errorMsg, Markup.inlineKeyboard([[Markup.button.callback('Volver al Menú', 'menu_principal')]]));
    } finally {
      ctx.markProcessInactive(processId);
      await ctx.answerCbQuery();
    }
  });

  // Manejador de texto para consultas, datos de pedido, etc.
  bot.on('text', async (ctx, next) => {
    const texto = ctx.message.text;
    
    console.log(`[invoice.handler.js] Recibido texto: "${texto}", estado: ${JSON.stringify(ctx.userState)}`);
  
    // Verificar si estamos en un proceso de registro o no esperando nada
    if (ctx.userState && ctx.userState.esperando && 
        !ctx.userState.esperando.startsWith('reg_') && 
        !ctx.userState.esperando.startsWith('org_')) {
      
      // Procesar según el estado actual
      switch (ctx.userState.esperando) {
        case 'numeroPedido':
          if (!texto.trim()) {
            return ctx.reply('El número de pedido no puede estar vacío. Por favor, inténtelo de nuevo:');
          }
          ctx.userState.numeroPedido = texto.trim();
          ctx.userState.esperando = 'claveProducto';
          ctx.reply('Ingrese la clave del producto:');
          break;

        case 'claveProducto':
          if (!texto.trim()) {
            return ctx.reply('La clave del producto no puede estar vacía. Por favor, inténtelo de nuevo:');
          }
          ctx.userState.claveProducto = texto.trim();
          ctx.userState.esperando = 'monto';
          ctx.reply('Ingrese el monto a facturar (solo números):');
          break;

        case 'monto': {
          // Eliminar caracteres no numéricos excepto punto y coma
          const montoTexto = texto.replace(/[^\d.,]/g, '').replace(/,/g, '.');
          const monto = parseFloat(montoTexto);

          if (isNaN(monto) || monto <= 0) {
            return ctx.reply('Por favor, ingrese un monto válido (solo números):');
          }

          ctx.userState.monto = monto;
          ctx.userState.esperando = 'confirmacion';

          // Generar un ID de transacción único para esta confirmación
          ctx.userState.transactionId = `tx_${Date.now()}_${ctx.from.id}`;

          // Mostrar resumen para confirmación usando la vista
          const { message, keyboard, parse_mode } = invoiceSummaryView(ctx.userState, ctx.userState.transactionId);
          ctx.reply(message, { parse_mode, ...keyboard });
          break;
        }

        case 'folioConsulta': {
          const folioConsulta = texto.trim();
          if (!folioConsulta) {
            return ctx.reply('El número de folio no puede estar vacío. Por favor, inténtelo de nuevo:');
          }
        
          ctx.reply('⏳ Buscando factura con folio: ' + folioConsulta + ', por favor espere...');
          console.log('Intentando consultar factura con folio:', folioConsulta);
        
          try {
            // Obtener el tenant ID del contexto del usuario
            const tenantId = ctx.getTenantId();
            if (!tenantId) {
              throw new Error('No se encontró el tenant ID en el contexto del usuario');
            }
            
            // Obtener el cliente de FacturAPI para este tenant
            const facturapIService = (await import('../../services/facturapi.service.js')).default;
            const facturapi = await facturapIService.getFacturapiClient(tenantId);
            
            console.log(`Cliente FacturAPI obtenido para tenant ${tenantId}, buscando factura con folio ${folioConsulta}...`);
            
            // Buscar la factura por folio
            const facturas = await facturapi.invoices.list({
              q: folioConsulta, // Buscar por folio
              limit: 1 // Solo necesitamos una
            });
            
            console.log(`Resultado de búsqueda para folio ${folioConsulta}:`, facturas.total_results);
            
            if (facturas.total_results > 0) {
              const factura = facturas.data[0];
              
              // Guardamos información de la factura en el estado del usuario
              ctx.userState.facturaId = factura.id;
              ctx.userState.folioFactura = factura.folio_number;
              console.log('Guardando ID de factura en el estado:', ctx.userState.facturaId);
              
              // Determinar el estado de la factura
              let estadoFactura = '';
              let estaCancelada = false;
              
              // Revisar tanto el campo status como cancellation_status
              if (factura.status === 'canceled' || factura.cancellation_status === 'accepted') {
                estadoFactura = '⛔ CANCELADA';
                estaCancelada = true;
                
                // Agregar información del motivo si está disponible
                if (factura.cancellation && factura.cancellation.motive) {
                  const motivoCancelacion = MOTIVOS_CANCELACION[factura.cancellation.motive] || 
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
              
              // Usar la vista para mostrar los detalles de la factura
              const { message, keyboard, parse_mode } = invoiceDetailsView(factura, estadoFactura, estaCancelada);
              ctx.reply(message, { parse_mode, ...keyboard });
              
              ctx.userState.esperando = null; // Reseteamos el estado
            } else {
              ctx.reply(`❌ No se encontró ninguna factura con el folio: ${folioConsulta}`);
              ctx.userState.esperando = null;
            }
          } catch (error) {
            console.error('Error al consultar factura por folio:', error);
            if (error.response) {
              console.error('Detalles del error:', error.response.status, error.response.data);
            }
            ctx.reply(`❌ Ocurrió un error al buscar la factura con folio: ${folioConsulta}`);
            ctx.userState.esperando = null;
          }
          break;
        }

        default:
          // Si el estado no coincide con ninguno, seguir con el siguiente middleware
          return next();
      }
    } else {
      // Si no estamos esperando ninguna entrada, seguir con el siguiente middleware
      return next();
    }
  });

  // Implementar manejadores de cancelación de facturas
  registerCancellationHandlers(bot);
}

/**
 * Registra los manejadores para cancelación de facturas
 * @param {Object} bot - Instancia del bot
 */
function registerCancellationHandlers(bot) {
  // Iniciar proceso de cancelación
  bot.action(/iniciar_cancelacion_(.+)_(\d+)/, async (ctx) => {
    const facturaId = ctx.match[1];
    const folioFactura = ctx.match[2];
    
    console.log(`Iniciando proceso de cancelación para factura ${facturaId} (folio: ${folioFactura})`);
    
    // Verificar si el proceso ya está activo
    const processId = `cancelacion_${facturaId}`;
    if (ctx.isProcessActive(processId)) {
      await ctx.answerCbQuery('Ya se está procesando esta cancelación, por favor espere.');
      return;
    }
    
    ctx.markProcessActive(processId);
    
    try {
      await ctx.answerCbQuery();
      
      // Intentar modificar el markup del mensaje anterior
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(e => {
          console.log('No se pudo editar markup:', e.message);
        });
      } catch (error) {
        console.log('No se pudo editar el markup del mensaje anterior:', error.message);
      }
      
      // Guardar los datos de la factura en el estado del usuario
      ctx.userState.facturaIdCancelar = facturaId;
      ctx.userState.folioFacturaCancelar = folioFactura;
      
      // Mostrar advertencia y solicitar confirmación
      await ctx.reply(
        `⚠️ *¡IMPORTANTE! Está por cancelar la factura con folio A-${folioFactura}*\n\n` +
        `Esta acción no se puede deshacer. La factura será cancelada ante el SAT.\n\n` +
        `¿Está seguro que desea continuar con la cancelación?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Sí, mostrar motivos', `mostrar_motivos_${facturaId}_${folioFactura}`)],
            [Markup.button.callback('❌ No, cancelar proceso', `cancelar_proceso_${facturaId}`)]
          ])
        }
      );
    } catch (error) {
      console.error('Error al iniciar proceso de cancelación:', error);
      await ctx.reply('❌ Ocurrió un error al iniciar el proceso de cancelación.');
    } finally {
      ctx.markProcessInactive(processId);
    }
  });

  // Mostrar motivos de cancelación
  bot.action(/mostrar_motivos_(.+)_(\d+)/, async (ctx) => {
    const facturaId = ctx.match[1];
    const folioFactura = ctx.match[2];
    
    console.log(`Mostrando motivos de cancelación para factura ${facturaId} (folio: ${folioFactura})`);
    
    await ctx.answerCbQuery();
    
    try {
      // Intentar modificar el markup del mensaje anterior
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(e => {
          console.log('No se pudo editar markup:', e.message);
        });
      } catch (error) {
        console.log('No se pudo editar el markup del mensaje anterior:', error.message);
      }
      
      // Verificar que los datos de la factura están en el estado
      if (!ctx.userState.facturaIdCancelar || !ctx.userState.folioFacturaCancelar) {
        ctx.userState.facturaIdCancelar = facturaId;
        ctx.userState.folioFacturaCancelar = folioFactura;
      }
      
      // Mostrar motivos de cancelación como botones
      await ctx.reply(
        `Seleccione el motivo de cancelación para la factura A-${folioFactura}:`,
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('01: Comprobante con errores con relación', `confirmar_cancelacion_${facturaId}_${folioFactura}_01`)],
            [Markup.button.callback('02: Comprobante con errores sin relación', `confirmar_cancelacion_${facturaId}_${folioFactura}_02`)],
            [Markup.button.callback('03: No se llevó a cabo la operación', `confirmar_cancelacion_${facturaId}_${folioFactura}_03`)],
            [Markup.button.callback('04: Operación en factura global', `confirmar_cancelacion_${facturaId}_${folioFactura}_04`)],
            [Markup.button.callback('❌ Cancelar proceso', `cancelar_proceso_${facturaId}`)]
          ])
        }
      );
    } catch (error) {
      console.error('Error al mostrar motivos de cancelación:', error);
      await ctx.reply('❌ Ocurrió un error al mostrar los motivos de cancelación.');
    }
  });

  // Confirmar y procesar la cancelación
  bot.action(/confirmar_cancelacion_(.+)_(\d+)_(.+)/, async (ctx) => {
    const facturaId = ctx.match[1];
    const folioFactura = ctx.match[2];
    const motivoCancelacion = ctx.match[3];
    
    console.log(`Confirmando cancelación de factura ${facturaId} (folio: ${folioFactura}) con motivo: ${motivoCancelacion}`);
    
    // Verificar si el proceso ya está activo
    const processId = `cancelacion_final_${facturaId}`;
    if (ctx.isProcessActive(processId)) {
      await ctx.answerCbQuery('Ya se está procesando esta cancelación, por favor espere.');
      return;
    }
    
    ctx.markProcessActive(processId);
    
    try {
      await ctx.answerCbQuery();
      
      // Intentar modificar el markup del mensaje anterior
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(e => {
          console.log('No se pudo editar markup:', e.message);
        });
      } catch (error) {
        console.log('No se pudo editar el markup del mensaje anterior:', error.message);
      }
      
      // Mostrar mensaje de procesamiento
      await ctx.reply(`⏳ Cancelando factura A-${folioFactura} con motivo: ${MOTIVOS_CANCELACION[motivoCancelacion]}...`);
      
      // Cancelar la factura directamente con FacturAPI
      try {
        // Obtener el tenant ID del contexto del usuario
        const tenantId = ctx.getTenantId();
        if (!tenantId) {
          throw new Error('No se encontró el tenant ID en el contexto del usuario');
        }
        
        // Obtener el cliente de FacturAPI para este tenant
        const facturapIService = (await import('../../services/facturapi.service.js')).default;
        const facturapi = await facturapIService.getFacturapiClient(tenantId);
        
        console.log(`Cliente FacturAPI obtenido para tenant ${tenantId}, cancelando factura ${facturaId} con motivo ${motivoCancelacion}...`);
        
        // Cancelar la factura
        const result = await facturapi.invoices.cancel(facturaId, { motive: motivoCancelacion });
        
        console.log('Respuesta de cancelación de FacturAPI:', result);
        
        // Éxito en la cancelación
        await ctx.reply(
          `✅ *Factura A-${folioFactura} cancelada exitosamente*\n\n` +
          `Se ha registrado la cancelación con el siguiente motivo:\n` +
          `• ${MOTIVOS_CANCELACION[motivoCancelacion]}\n\n` +
          `La factura ha sido cancelada ante el SAT.`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Volver al menú principal', 'volver_menu_principal')]
            ])
          }
        );
        
        // Limpiar el estado de usuario después de una cancelación exitosa
        delete ctx.userState.facturaIdCancelar;
        delete ctx.userState.folioFacturaCancelar;
        
      } catch (error) {
        console.error('Error completo al cancelar la factura:', error);
        
        let errorMsg = 'Ocurrió un error al cancelar la factura.';
        if (error.response) {
          console.error('Detalles de la respuesta de error:', error.response.status, error.response.data);
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
          Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Volver al menú principal', 'volver_menu_principal')]
          ])
        );
      }
    } catch (error) {
      console.error('Error en el proceso de cancelación:', error);
      await ctx.reply('❌ Ocurrió un error en el proceso de cancelación.');
    } finally {
      ctx.markProcessInactive(processId);
    }
  });

  // Cancelar el proceso de cancelación
  bot.action(/cancelar_proceso_(.+)/, async (ctx) => {
    const facturaId = ctx.match[1];
    console.log(`Cancelando proceso de cancelación para factura ${facturaId}`);
    
    await ctx.answerCbQuery();
    
    try {
      // Intentar modificar el markup del mensaje anterior
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(e => {
          console.log('No se pudo editar markup:', e.message);
        });
      } catch (error) {
        console.log('No se pudo editar el markup del mensaje anterior:', error.message);
      }
      
      // Limpiar datos de cancelación del estado
      delete ctx.userState.facturaIdCancelar;
      delete ctx.userState.folioFacturaCancelar;
      
      await ctx.reply(
        '✅ Proceso de cancelación abortado. La factura NO ha sido cancelada.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Volver al menú principal', 'volver_menu_principal')]
        ])
      );
    } catch (error) {
      console.error('Error al cancelar proceso:', error);
      await ctx.reply('❌ Ocurrió un error al cancelar el proceso.');
    }
  });
}
