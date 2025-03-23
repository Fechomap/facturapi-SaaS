// bot/handlers/invoice.handler.js
import { Markup } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../config/index.js';
import TenantService from '../../services/tenant.service.js';
import InvoiceService from '../../services/invoice.service.js';
import { invoiceSummaryView, invoiceCreatedView, invoiceDetailsView } from '../views/invoice.view.js';
import CustomerSetupService from '../../services/customer-setup.service.js';

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
 * Descarga un archivo de factura (PDF/XML)
 * @param {string} facturaId - ID de la factura
 * @param {string} formato - Formato (pdf/xml)
 * @param {string} folio - Número de folio
 * @param {string} clienteNombre - Nombre del cliente
 * @param {Object} ctx - Contexto del usuario
 * @returns {Promise<string>} - Ruta al archivo descargado
 */
async function descargarFactura(facturaId, formato, folio, clienteNombre, ctx) {
  const apiUrl = `${config.apiBaseUrl}/api/facturas/${facturaId}/${formato}`;
  console.log('Descargando desde URL:', apiUrl);

  const tempDir = ensureTempDirExists();
  const clienteStr = clienteNombre || 'Cliente';
  const folioStr = folio || 'unknown';

  // Por ejemplo: "Cliente-818.pdf"
  const filePath = `${tempDir}/A${folioStr}.${formato}`;
  console.log('Creando archivo temporal en:', filePath);

  const writer = fs.createWriteStream(filePath);

  try {
    console.log('Enviando solicitud a:', apiUrl);
    
    // Obtener el tenant ID del contexto del usuario
    const tenantId = ctx.userState?.tenantId;
    if (!tenantId) {
      throw new Error('No se encontró el tenant ID en el estado del usuario');
    }
    
    const response = await axios({
      method: 'GET',
      url: apiUrl,
      responseType: 'stream',
      headers: {
        // Añadir el header X-Tenant-ID
        'X-Tenant-ID': tenantId
      }
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('Archivo descargado exitosamente:', filePath);
        resolve(filePath);
      });
      writer.on('error', (err) => {
        console.error('Error al escribir el archivo:', err);
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          console.error('Error al eliminar archivo parcial:', e);
        }
        reject(err);
      });
    });
  } catch (error) {
    console.error('Error en la petición de descarga:', error.message);
    
    // Capturar y mostrar más detalles del error
    if (error.response) {
      console.error('Respuesta de error:', error.response.status, error.response.data);
      
      // Si la respuesta es un stream, extraer el contenido
      if (error.response.data && typeof error.response.data.on === 'function') {
        try {
          const chunks = [];
          error.response.data.on('data', chunk => chunks.push(chunk));
          error.response.data.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            console.error('Contenido de la respuesta de error:', body);
          });
        } catch (e) {
          console.error('Error al leer respuesta del error:', e);
        }
      }
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
      const clientButtons = availableCustomers.map(customer => {
        const shortName = shortenName(customer.legalName);
        shortToFullNameMap[shortName] = customer.legalName;
        
        // Guardar el ID de FacturAPI en el estado global para usarlo después
        if (!ctx.clientIds) ctx.clientIds = {};
        ctx.clientIds[customer.legalName] = customer.facturapiCustomerId;
        
        return [Markup.button.callback(shortName, `cliente_${customer.facturapiCustomerId}`)]
      });
      
      // Guardar el mapa de nombres en el estado del contexto
      ctx.clientNameMap = shortToFullNameMap;
      
      // Iniciamos el flujo para generar factura con los clientes disponibles
      await ctx.reply(
        'Seleccione el cliente para generar la factura:',
        Markup.inlineKeyboard([
          ...clientButtons,
          // Si CHUBB está en los clientes disponibles, no agregar el botón extra para CHUBB
          ...(!availableCustomers.some(c => c.legalName.includes('CHUBB')) ? 
            [[Markup.button.callback('CHUBB (Archivo Excel)', 'menu_chubb')]] : [])
        ])
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
    const transactionId = ctx.match[1];

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

    // Verificar si el usuario puede generar facturas (límites del plan)
    const canGenerateResult = await TenantService.canGenerateInvoice(ctx.getTenantId());
    
    if (!canGenerateResult.canGenerate) {
      return ctx.reply(
        `❌ No puedes generar más facturas: ${canGenerateResult.reason}\n\n` +
        `Contacta al administrador o actualiza tu plan de suscripción.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('💳 Ver planes', 'show_pricing')],
          [Markup.button.callback('🔙 Volver', 'menu_principal')]
        ])
      );
    }

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
      await ctx.answerCbQuery();
    }
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
    const folioFactura = ctx.match[2];

    console.log('Estado del usuario al descargar PDF:', ctx.userState);
    console.log('ID de factura solicitado:', facturaId);

    const processId = `pdf_${facturaId}`;
    if (ctx.isProcessActive(processId)) {
      await ctx.answerCbQuery('Ya se está descargando el PDF, por favor espere.');
      return;
    }

    ctx.markProcessActive(processId);

    try {
      await ctx.reply('⏳ Descargando PDF, por favor espere...');

      const clienteStr = ctx.userState?.clienteNombre || 'Cliente';
      const filePath = await descargarFactura(facturaId, 'pdf', folioFactura, clienteStr, ctx);

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
    const folioFactura = ctx.match[2];

    console.log('Estado del usuario al descargar XML:', ctx.userState);
    console.log('ID de factura solicitado:', facturaId);

    const processId = `xml_${facturaId}`;
    if (ctx.isProcessActive(processId)) {
      await ctx.answerCbQuery('Ya se está descargando el XML, por favor espere.');
      return;
    }

    ctx.markProcessActive(processId);

    try {
      await ctx.reply('⏳ Descargando XML, por favor espere...');

      const clienteStr = ctx.userState?.clienteNombre || 'Cliente';
      const filePath = await descargarFactura(facturaId, 'xml', folioFactura, clienteStr, ctx);

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
          console.log('Intentando consultar folio:', folioConsulta);
        
          try {
            const apiUrl = `${config.apiBaseUrl}/api/facturas/by-folio/${folioConsulta}`;
            console.log('URL de consulta:', apiUrl);
            
            // Obtener el tenant ID del contexto del usuario
            const tenantId = ctx.getTenantId();
            if (!tenantId) {
              throw new Error('No se encontró el tenant ID en el contexto del usuario');
            }
            
            // Incluir el header X-Tenant-ID en la solicitud
            const response = await axios.get(apiUrl, {
              headers: {
                'X-Tenant-ID': tenantId
              }
            });
            
            const factura = response.data;
            console.log('Respuesta del backend:', factura);
        
            if (factura && (factura.id || factura.facturapiInvoiceId)) {
              // Guardamos información de la factura en el estado del usuario
              ctx.userState.facturaId = factura.facturapiInvoiceId || factura.id; // Usar el ID de FacturAPI
              ctx.userState.folioFactura = factura.folio_number;
              // Depuración: confirmar que se guarda el ID correcto
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
      
      // Llamar a la API para cancelar la factura
      try {
      const apiUrl = `${config.apiBaseUrl}/api/facturas/${facturaId}`;
        console.log(`Enviando solicitud de cancelación a: ${apiUrl} con motivo: ${motivoCancelacion}`);
        
        const response = await axios.delete(apiUrl, { 
          data: { 
            motive: motivoCancelacion 
          },
          headers: {
            'X-Tenant-ID': ctx.getTenantId() // Añadir el header del tenant
          }
        });
        
        console.log('Respuesta de cancelación:', response.data);
        
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