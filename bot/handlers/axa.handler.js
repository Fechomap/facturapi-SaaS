// bot/handlers/axa.handler.js
import { Markup } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';

// Importar prisma de manera segura
import { prisma as configPrisma } from '../../config/database.js';
// También intentar importar desde lib
import libPrisma from '../../lib/prisma.js';

// Importar utilidades de detección Excel
import { debeDetectarExcel, esArchivoExcelValido } from '../../core/utils/excel-detection.utils.js';

// Importar utilidades de limpieza de estado
import { cleanupFlowChange } from '../../core/utils/state-cleanup.utils.js';

// Usar la instancia que esté disponible
const prisma = libPrisma || configPrisma;

// Verificación de seguridad
if (!prisma) {
  console.error('ERROR CRÍTICO: No se pudo inicializar Prisma, ambas fuentes fallaron');
}

// Función helper para obtener customerId del cliente AXA desde BD
async function getAxaCustomerIdFromDB(tenantId, facturapiCustomerId) {
  try {
    const customer = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId,
        facturapiCustomerId,
        legalName: { contains: 'AXA', mode: 'insensitive' },
      },
      select: { id: true },
    });

    return customer?.id || null;
  } catch (error) {
    console.error('Error obteniendo customerId AXA:', error);
    return null;
  }
}

// Constante para la clave SAT de servicios de grúa
const CLAVE_SAT_SERVICIOS_GRUA = '78101803';

// 📱 UTILIDADES PARA PROGRESO VISUAL
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
 * Actualiza el mensaje de progreso con animación
 */
async function updateProgressMessage(ctx, messageId, step, total, currentTask, details = '') {
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
    await ctx.telegram.editMessageText(ctx.chat.id, messageId, null, progressText, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    // Si no se puede editar el mensaje, crear uno nuevo
    console.log('No se pudo editar mensaje de progreso:', error.message);
  }
}

// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Registra los manejadores para la funcionalidad AXA
 * @param {Object} bot - Instancia del bot de Telegram
 */
export function registerAxaHandler(bot) {
  console.log('🟢 Registrando handler AXA...');

  bot.action('menu_axa', async (ctx) => {
    console.log('🟢 ACTION menu_axa EJECUTADA!');
    await ctx.answerCbQuery();

    try {
      // 🚀 OPTIMIZACIÓN: Limpieza segura y eficiente de estado
      cleanupFlowChange(ctx, 'axa');

      // Limpiar estado específico de AXA anterior
      delete ctx.userState.axaSummary;
      delete ctx.userState.axaClientId;
      delete ctx.userState.clienteId;
      delete ctx.userState.clienteNombre;
      ctx.userState.esperando = null;

      // Obtener el ID del tenant actual
      const tenantId = ctx.getTenantId();

      if (!tenantId) {
        return ctx.reply('❌ Error: No se pudo obtener la información de tu empresa.');
      }

      // Obtener todos los clientes del tenant
      console.log('Buscando cliente AXA para el tenant:', tenantId);

      // 🚀 OPTIMIZACIÓN FASE 1: Precarga cliente AXA directo por RFC (sin cache innecesario)
      console.log('🔍 FASE 1: Obteniendo cliente AXA directo por RFC para tenant:', tenantId);
      const startTime = Date.now();

      // Buscar cliente AXA por RFC único (más eficiente que contains)
      const axaClient = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId: tenantId,
          rfc: 'AAM850528H51', // RFC único de AXA ASSISTANCE MEXICO
          isActive: true,
        },
      });

      const searchDuration = Date.now() - startTime;
      console.log(
        `✅ FASE 1: Cliente AXA obtenido en ${searchDuration}ms ${axaClient ? '(encontrado)' : '(no encontrado)'}`
      );

      // Fallback: Si no se encuentra por RFC, intentar por nombre exacto
      let axaClientFallback = axaClient;
      if (!axaClientFallback) {
        console.log('⚠️ FASE 1: RFC no encontrado, intentando por nombre exacto...');
        const fallbackStartTime = Date.now();

        axaClientFallback = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId: tenantId,
            legalName: 'AXA ASSISTANCE MEXICO',
            isActive: true,
          },
        });

        const fallbackDuration = Date.now() - fallbackStartTime;
        console.log(
          `✅ FASE 1: Fallback completado en ${fallbackDuration}ms ${axaClientFallback ? '(encontrado)' : '(no encontrado)'}`
        );
      }

      if (!axaClientFallback) {
        // Si no se encuentra, intentar configurar los clientes predefinidos
        await ctx.reply(
          '⚠️ No se encontró el cliente AXA. Intentando configurar clientes predefinidos...'
        );

        try {
          // Importar el servicio de configuración de clientes
          const CustomerSetupService = await import('../../services/customer-setup.service.js');

          // Configurar los clientes predefinidos
          await CustomerSetupService.default.setupPredefinedCustomers(tenantId, true);

          // Buscar nuevamente el cliente AXA
          const axaClientAfterSetup = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId: tenantId,
              legalName: {
                contains: 'AXA',
              },
              isActive: true,
            },
          });

          if (!axaClientAfterSetup) {
            return ctx.reply(
              '❌ Error: No se pudo encontrar o configurar el cliente AXA. Por favor, contacta al administrador.'
            );
          }

          // Usar el cliente recién configurado
          ctx.userState.axaClientId = axaClientAfterSetup.facturapiCustomerId;
          ctx.userState.clienteNombre = axaClientAfterSetup.legalName;
          console.log(
            `Cliente AXA configurado y encontrado: ${axaClientAfterSetup.legalName} (ID: ${axaClientAfterSetup.facturapiCustomerId})`
          );
        } catch (setupError) {
          console.error('Error al configurar clientes predefinidos:', setupError);
          return ctx.reply(
            '❌ Error: No se pudo configurar el cliente AXA. Por favor, contacta al administrador.'
          );
        }
      } else {
        // Usar el cliente encontrado (optimizado)
        ctx.userState.axaClientId = axaClientFallback.facturapiCustomerId;
        ctx.userState.clienteNombre = axaClientFallback.legalName;
        console.log(
          `🎯 FASE 1: Cliente AXA cargado exitosamente: ${axaClientFallback.legalName} (ID: ${axaClientFallback.facturapiCustomerId})`
        );
      }

      // Continuar con el procesamiento normal
      ctx.userState.esperando = 'archivo_excel_axa';

      await ctx.reply(
        'Por favor, sube el archivo Excel con los datos de AXA para generar las facturas.'
      );
    } catch (error) {
      console.error('Error al buscar cliente AXA:', error);
      await ctx.reply('❌ Error al buscar cliente AXA: ' + error.message);
    }
  });

  // 🚀 FASE 3: Manejador para servicios realizados (con retención) - USA DATOS PRECALCULADOS
  bot.action('axa_servicios_realizados', async (ctx) => {
    const startTime = Date.now();
    console.log('🔵 BOTÓN CON RETENCIÓN: Iniciando...');

    await ctx.answerCbQuery();

    // 🔍 FASE 3: Verificar que tenemos datos PRECALCULADOS (COMO CHUBB)
    console.log('🔵 BOTÓN CON RETENCIÓN: Verificando tempData...');
    const tempData = global.tempAxaData && global.tempAxaData[ctx.from.id];
    if (!tempData) {
      console.log('🚨 BOTÓN CON RETENCIÓN: global.tempAxaData[ctx.from.id] es NULL/undefined');
      return ctx.reply(
        '❌ No hay datos precalculados para generar facturas. Por favor, suba nuevamente el archivo Excel.'
      );
    }
    if (!tempData.facturaConRetencion) {
      console.log('🚨 BOTÓN CON RETENCIÓN: tempData.facturaConRetencion es NULL/undefined');
      console.log('🚨 Llaves disponibles en tempData:', Object.keys(tempData));
      return ctx.reply(
        '❌ No hay datos de factura CON retención precalculados. Por favor, suba nuevamente el archivo Excel.'
      );
    }
    if (!tempData.facturaConRetencion.facturaData) {
      console.log(
        '🚨 BOTÓN CON RETENCIÓN: tempData.facturaConRetencion.facturaData es NULL/undefined'
      );
      return ctx.reply(
        '❌ No hay datos de FacturAPI precalculados. Por favor, suba nuevamente el archivo Excel.'
      );
    }

    console.log('🔵 BOTÓN CON RETENCIÓN: TempData OK, preparando respuesta...');
    console.log('🚀 FASE 3: Usando datos precalculados CON retención');
    console.log(
      `🚀 FASE 3: Total con retención: $${tempData.facturaConRetencion.total.toFixed(2)}`
    );

    // 🚀 OPTIMIZACIÓN ELEGANTE: Usar cache global como CHUBB (evitar doble guardado)
    console.log('🔵 BOTÓN CON RETENCIÓN: Guardando en cache global...');

    // Asegurar que el tempData existe y actualizar selección
    if (global.tempAxaData && global.tempAxaData[ctx.from.id]) {
      global.tempAxaData[ctx.from.id].seleccionUsuario = {
        tipoServicio: 'realizados',
        conRetencion: true,
        timestamp: Date.now(),
      };
      console.log('🔵 BOTÓN CON RETENCIÓN: Selección guardada en cache global');
    }

    // Guardar mínimo en userState para compatibilidad (middleware guardará automáticamente)
    ctx.userState.axaTipoServicio = 'realizados';
    ctx.userState.axaConRetencion = true;

    console.log('🔵 BOTÓN CON RETENCIÓN: Enviando mensaje de confirmación...');
    // Mostrar confirmación final CON DATOS PRECALCULADOS
    await ctx
      .editMessageReplyMarkup({ inline_keyboard: [] })
      .catch((e) => console.log('No se pudo editar mensaje:', e.message));
    await ctx.reply(
      `🚛 *Servicios Realizados seleccionados*\n\n` +
        `• Se aplicará retención del 4%\n` +
        `• ${tempData.facturaConRetencion.items.length} registros\n` +
        `• **Total: $${tempData.facturaConRetencion.total.toFixed(2)}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', 'axa_confirmar_final')],
          [Markup.button.callback('❌ Cancelar', 'axa_cancelar')],
        ]),
      }
    );

    const duration = Date.now() - startTime;
    console.log(`🔵 BOTÓN CON RETENCIÓN: Completado en ${duration}ms`);
  });

  // 🚀 FASE 3: Manejador para servicios muertos (sin retención) - USA DATOS PRECALCULADOS
  bot.action('axa_servicios_muertos', async (ctx) => {
    const startTime = Date.now();
    console.log('🟡 BOTÓN SIN RETENCIÓN: Iniciando...');

    await ctx.answerCbQuery();

    // 🔍 FASE 3: Verificar que tenemos datos PRECALCULADOS (COMO CHUBB)
    console.log('🟡 BOTÓN SIN RETENCIÓN: Verificando tempData...');
    const tempData = global.tempAxaData && global.tempAxaData[ctx.from.id];
    if (!tempData) {
      console.log('🚨 BOTÓN SIN RETENCIÓN: global.tempAxaData[ctx.from.id] es NULL/undefined');
      return ctx.reply(
        '❌ No hay datos precalculados para generar facturas. Por favor, suba nuevamente el archivo Excel.'
      );
    }
    if (!tempData.facturaSinRetencion) {
      console.log('🚨 BOTÓN SIN RETENCIÓN: tempData.facturaSinRetencion es NULL/undefined');
      console.log('🚨 Llaves disponibles en tempData:', Object.keys(tempData));
      return ctx.reply(
        '❌ No hay datos de factura SIN retención precalculados. Por favor, suba nuevamente el archivo Excel.'
      );
    }
    if (!tempData.facturaSinRetencion.facturaData) {
      console.log(
        '🚨 BOTÓN SIN RETENCIÓN: tempData.facturaSinRetencion.facturaData es NULL/undefined'
      );
      return ctx.reply(
        '❌ No hay datos de FacturAPI precalculados. Por favor, suba nuevamente el archivo Excel.'
      );
    }

    console.log('🟡 BOTÓN SIN RETENCIÓN: TempData OK, preparando respuesta...');
    console.log('🚀 FASE 3: Usando datos precalculados SIN retención');
    console.log(
      `🚀 FASE 3: Total sin retención: $${tempData.facturaSinRetencion.total.toFixed(2)}`
    );

    // 🚀 OPTIMIZACIÓN ELEGANTE: Usar cache global como CHUBB (evitar doble guardado)
    console.log('🟡 BOTÓN SIN RETENCIÓN: Guardando en cache global...');

    // Asegurar que el tempData existe y actualizar selección
    if (global.tempAxaData && global.tempAxaData[ctx.from.id]) {
      global.tempAxaData[ctx.from.id].seleccionUsuario = {
        tipoServicio: 'muertos',
        conRetencion: false,
        timestamp: Date.now(),
      };
      console.log('🟡 BOTÓN SIN RETENCIÓN: Selección guardada en cache global');
    }

    // Guardar mínimo en userState para compatibilidad (middleware guardará automáticamente)
    ctx.userState.axaTipoServicio = 'muertos';
    ctx.userState.axaConRetencion = false;

    console.log('🟡 BOTÓN SIN RETENCIÓN: Enviando mensaje de confirmación...');
    // Mostrar confirmación final CON DATOS PRECALCULADOS
    await ctx
      .editMessageReplyMarkup({ inline_keyboard: [] })
      .catch((e) => console.log('No se pudo editar mensaje:', e.message));
    await ctx.reply(
      `💀 *Servicios Muertos seleccionados*\n\n` +
        `• Sin retención\n` +
        `• ${tempData.facturaSinRetencion.items.length} registros\n` +
        `• **Total: $${tempData.facturaSinRetencion.total.toFixed(2)}**\n\n` +
        `¿Confirma la generación de la factura?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirmar y Generar', 'axa_confirmar_final')],
          [Markup.button.callback('❌ Cancelar', 'axa_cancelar')],
        ]),
      }
    );

    const duration = Date.now() - startTime;
    console.log(`🟡 BOTÓN SIN RETENCIÓN: Completado en ${duration}ms`);
  });

  // 🚀 FASE 3: Manejador OPTIMIZADO para confirmar generación - USA DATOS PRECALCULADOS
  bot.action('axa_confirmar_final', async (ctx) => {
    const startTime = Date.now();
    console.log('🟢 BOTÓN CONFIRMAR: Iniciando...');

    await ctx.answerCbQuery();

    // 📱 FEEDBACK INMEDIATO
    const facturaProgressMsg = await ctx.reply(
      '⚡ Procesando factura AXA...\n⏳ Validando datos precalculados...'
    );

    // 🔍 FASE 3: Verificar que tenemos datos PRECALCULADOS (COMO CHUBB)
    console.log('🟢 BOTÓN CONFIRMAR: Verificando tempData y userState...');
    const tempData = global.tempAxaData && global.tempAxaData[ctx.from.id];

    if (!tempData) {
      console.log('🚨 BOTÓN CONFIRMAR: global.tempAxaData[ctx.from.id] es NULL/undefined');
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        facturaProgressMsg.message_id,
        null,
        '❌ No hay datos precalculados. Por favor, suba nuevamente el archivo Excel.'
      );
      return;
    }

    if (!tempData.facturaConRetencion || !tempData.facturaSinRetencion) {
      console.log('🚨 BOTÓN CONFIRMAR: Falta facturaConRetencion o facturaSinRetencion');
      console.log('🚨 Llaves disponibles en tempData:', Object.keys(tempData));
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        facturaProgressMsg.message_id,
        null,
        '❌ Datos de facturación incompletos. Por favor, suba nuevamente el archivo Excel.'
      );
      return;
    }

    // 🚀 OPTIMIZACIÓN: Fallback entre userState y cache global
    let tipoServicio = ctx.userState.axaTipoServicio;
    let conRetencion = ctx.userState.axaConRetencion;

    // Si no está en userState, buscar en cache global
    if ((tipoServicio === undefined || conRetencion === undefined) && tempData.seleccionUsuario) {
      console.log('🟢 BOTÓN CONFIRMAR: Recuperando de cache global como fallback');
      tipoServicio =
        tempData.seleccionUsuario.tipoServicio === 'realizados' ? 'realizados' : 'muertos';
      conRetencion = tempData.seleccionUsuario.conRetencion;

      // Actualizar userState con los valores del cache
      ctx.userState.axaTipoServicio = tipoServicio;
      ctx.userState.axaConRetencion = conRetencion;
    }

    if (tipoServicio === undefined || conRetencion === undefined) {
      console.log('🚨 BOTÓN CONFIRMAR: No se encontró selección en userState ni cache');
      console.log('🚨 userState - axaTipoServicio:', ctx.userState.axaTipoServicio);
      console.log('🚨 userState - axaConRetencion:', ctx.userState.axaConRetencion);
      console.log('🚨 cache - seleccionUsuario:', tempData.seleccionUsuario);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        facturaProgressMsg.message_id,
        null,
        '❌ Tipo de servicio no definido. Por favor, selecciona el tipo de servicio nuevamente.'
      );
      return;
    }

    console.log('🟢 BOTÓN CONFIRMAR: Todas las validaciones pasaron correctamente');

    try {
      await ctx
        .editMessageReplyMarkup({ inline_keyboard: [] })
        .catch((e) => console.log('No se pudo editar mensaje:', e.message));

      // Usar las variables ya validadas (de userState o cache global)

      // 🚀 FASE 3: Seleccionar datos precalculados según tipo
      const facturaData = conRetencion
        ? tempData.facturaConRetencion
        : tempData.facturaSinRetencion;

      console.log(
        `🚀 FASE 3: Usando factura precalculada ${conRetencion ? 'CON' : 'SIN'} retención`
      );
      console.log(
        `🚀 FASE 3: Items: ${facturaData.items.length}, Total: $${facturaData.total.toFixed(2)}`
      );

      // 📱 Actualizar mensaje con datos precisos
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        facturaProgressMsg.message_id,
        null,
        `⚡ Factura ${tipoServicio} ${conRetencion ? '(con retención 4%)' : '(sin retención)'}...\n` +
          `📊 ${facturaData.items.length} items, Total: $${facturaData.total.toFixed(2)}\n` +
          `🚀 Enviando a FacturAPI...`,
        { parse_mode: 'Markdown' }
      );

      // 🚀 FASE 3: Envío DIRECTO a FacturAPI (sin recálculos)
      console.log('🚀 FASE 3: Llamando a enviarFacturaDirectaAxa...');
      const factura = await enviarFacturaDirectaAxa(
        facturaData.facturaData,
        ctx,
        facturaProgressMsg.message_id
      );
      console.log('🚀 FASE 3: Factura recibida de función:', factura ? factura.id : 'NULL');

      // 📱 Resultado final CON BOTONES DE DESCARGA
      if (factura) {
        console.log('🚀 FASE 3: Enviando mensaje de éxito CON BOTONES al usuario...');
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
        console.log('🚀 FASE 3: Mensaje de éxito CON BOTONES enviado');
      } else {
        console.log('🚨 FASE 3: Factura es NULL, enviando mensaje de error...');
        await ctx.reply('⚠️ No se generó la factura. Error en FacturAPI.');
      }

      // 🧹 Limpiar datos temporales como CHUBB
      console.log('🟢 BOTÓN CONFIRMAR: Limpiando datos temporales...');
      delete ctx.userState.axaSummary;
      delete ctx.userState.axaTipoServicio;
      delete ctx.userState.axaConRetencion;
      if (global.tempAxaData && global.tempAxaData[ctx.from.id]) {
        delete global.tempAxaData[ctx.from.id];
        console.log('🟢 BOTÓN CONFIRMAR: global.tempAxaData limpiado');
      }
      ctx.userState.esperando = null;

      const duration = Date.now() - startTime;
      console.log(`🟢 BOTÓN CONFIRMAR: Completado exitosamente en ${duration}ms`);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`🚨 BOTÓN CONFIRMAR: Error después de ${duration}ms:`, error);
      await ctx.reply(`❌ Error al generar factura: ${error.message}`);
      ctx.userState.esperando = null;
    }
  });

  // Manejador para cancelar la generación de facturas AXA
  bot.action('axa_cancelar', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx
        .editMessageReplyMarkup({ inline_keyboard: [] })
        .catch((e) => console.log('No se pudo editar mensaje:', e.message));
      await ctx.reply('❌ Operación cancelada. No se generó factura.');

      // Limpiar el estado y datos temporales
      delete ctx.userState.axaSummary;
      delete ctx.userState.axaTipoServicio;
      delete ctx.userState.axaConRetencion;
      if (global.tempAxaData && global.tempAxaData[ctx.from.id]) {
        delete global.tempAxaData[ctx.from.id];
      }
      ctx.userState.esperando = null;
    } catch (error) {
      console.error('Error al cancelar operación:', error);
      await ctx.reply('❌ Error al cancelar la operación.');
      ctx.userState.esperando = null;
    }
  });

  // Manejar la recepción del archivo Excel
  bot.on('document', async (ctx, next) => {
    console.log('=========== INICIO HANDLER AXA EXCEL ===========');
    console.log('Documento recibido:', ctx.message.document.file_name);
    console.log('Estado esperando:', ctx.userState?.esperando);

    // 📱 FEEDBACK INMEDIATO: Mostrar que se detectó el documento ANTES de validaciones
    let receivingMessage = null;

    // 🚀 DETECCIÓN ROBUSTA: Usar función utilitaria para solucionar bug de timing
    if (!debeDetectarExcel(ctx, 'axa')) {
      console.log('No estamos esperando archivo Excel para AXA, pasando al siguiente handler');
      console.log('=========== FIN HANDLER AXA EXCEL (PASANDO) ===========');
      return next();
    }

    // 📱 FEEDBACK INMEDIATO: Mostrar procesamiento tan pronto como detectemos que es nuestro contexto
    receivingMessage = await ctx.reply(
      '📥 Recibiendo archivo Excel de AXA...\n⏳ Validando archivo...'
    );

    const document = ctx.message.document;

    // Verificar que sea un archivo Excel usando función utilitaria
    if (!esArchivoExcelValido(document)) {
      console.log('Documento no es Excel, informando al usuario');
      // Actualizar el mensaje existente con el error
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        receivingMessage.message_id,
        null,
        '❌ El archivo debe ser de tipo Excel (.xlsx o .xls). Por favor, intenta de nuevo.'
      );
      console.log('=========== FIN HANDLER AXA EXCEL (NO ES EXCEL) ===========');
      return; // No pasamos al siguiente handler porque es nuestro contexto pero formato incorrecto
    }

    // 📱 MEJORA VISUAL: Actualizar que el archivo es válido
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      receivingMessage.message_id,
      null,
      `✅ Archivo Excel válido: ${document.file_name}\n⏳ Descargando archivo...`
    );

    try {
      // Descargar el archivo
      const fileLink = await ctx.telegram.getFileLink(document.file_id);
      const tempDir = ensureTempDirExists();
      const filePath = path.join(tempDir, document.file_name);

      await downloadFile(fileLink.href, filePath);

      // 📱 MEJORA VISUAL: Actualizar progreso con animación
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        receivingMessage.message_id,
        null,
        `✅ Archivo recibido: ${document.file_name}\n🔍 Validando estructura del Excel...\n⏳ Por favor espere...`
      );

      // Procesar el archivo Excel y generar facturas
      const result = await procesarArchivoAxa(ctx, filePath, receivingMessage.message_id);

      // Limpiar el archivo temporal
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('Error al eliminar archivo temporal:', e);
      }

      // Si no hay confirmación pendiente, reseteamos el estado
      if (!result || !result.pendingConfirmation) {
        ctx.userState.esperando = null;
      }

      console.log('=========== FIN HANDLER AXA EXCEL (PROCESADO) ===========');
    } catch (error) {
      console.error('Error al procesar el archivo Excel:', error);
      ctx.reply(`❌ Error al procesar el archivo: ${error.message}`);
      ctx.userState.esperando = null;
      console.log('=========== FIN HANDLER AXA EXCEL (ERROR) ===========');
    }
  });
}

/**
 * Asegura que existe el directorio temporal
 * @returns {string} - Ruta al directorio temporal
 */
function ensureTempDirExists() {
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * Descarga un archivo desde una URL
 * @param {string} url - URL del archivo para descargar
 * @param {string} outputPath - Ruta donde guardar el archivo
 * @returns {Promise} - Promesa que se resuelve cuando el archivo se descarga
 */
async function downloadFile(url, outputPath) {
  const writer = fs.createWriteStream(outputPath);

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * Procesa el archivo Excel de AXA y genera facturas
 * @param {Object} ctx - Contexto de Telegram
 * @param {string} filePath - Ruta al archivo Excel
 * @returns {Promise} - Promesa que se resuelve cuando se procesan todas las facturas
 */
async function procesarArchivoAxa(ctx, filePath, progressMessageId = null) {
  try {
    // 📱 PASO 1: Leer archivo Excel
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

    // 📱 PASO 2: Detectar columnas
    await updateProgressMessage(
      ctx,
      progressMessageId,
      2,
      6,
      'Detectando columnas',
      'Analizando estructura...'
    );

    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const columnNames = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
      columnNames.push(cell ? cell.v : undefined);
    }

    console.log('Columnas detectadas en el Excel AXA:', columnNames);

    // 📱 PASO 3: Convertir a JSON
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

    // 📱 PASO 4: Validar estructura
    await updateProgressMessage(
      ctx,
      progressMessageId,
      4,
      6,
      'Validando estructura',
      `Verificando ${data.length} registros...`
    );

    // Mapear nombres de columnas que pueden variar
    const columnMappings = mapColumnNamesAxa(data[0]);

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

    // Log para ver la estructura de los datos
    console.log('Mapeado de columnas AXA:', columnMappings);
    console.log('Primeras filas del Excel AXA:', data.slice(0, 2));

    // Verificar que los valores numéricos sean correctos
    const erroresNumericos = [];
    data.forEach((row, index) => {
      const importe = parseFloat(row[columnMappings.importe]);
      if (isNaN(importe) || importe <= 0) {
        erroresNumericos.push(`Fila ${index + 2}: El importe debe ser un número positivo.`);
      }
    });

    if (erroresNumericos.length > 0) {
      // Mostrar hasta 5 errores para no saturar el mensaje
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

    // 📱 PASO 5: Calcular totales
    await updateProgressMessage(
      ctx,
      progressMessageId,
      5,
      6,
      'Calculando totales',
      `Procesando ${data.length} registros...`
    );

    // Calcular el monto total
    const montoTotal = data.reduce((total, item) => {
      return total + parseFloat(item[columnMappings.importe] || 0);
    }, 0);

    // Construir resumen de datos
    let infoResumen = `📊 Resumen de datos procesados:\n\n`;
    infoResumen += `• Servicios de Grúa AXA:\n  - ${data.length} registros\n  - Monto total: ${montoTotal.toFixed(2)} MXN\n\n`;

    // 🚀 OPTIMIZACIÓN CHUBB: Guardar SOLO números en el estado, datos pesados en cache global
    ctx.userState.axaSummary = {
      totalRecords: data.length,
      totalAmount: montoTotal,
      // NO guardar firstRecord - innecesario y añade peso
    };

    // 🚀 FASE 2: PRECÁLCULO de ambas opciones (con/sin retención)
    console.log('🔄 FASE 2: Iniciando precálculo de facturas con y sin retención...');
    const precalculoStartTime = Date.now();

    // Configuración de impuestos
    const baseTaxes = [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }];
    const taxesWithRetention = [
      ...baseTaxes,
      { type: 'IVA', rate: 0.04, factor: 'Tasa', withholding: true },
    ];

    // Precalcular items para ambas opciones
    const itemsConRetencion = [];
    const itemsSinRetencion = [];
    let subtotal = 0;

    for (const row of data) {
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
          product_key: '78101803', // CLAVE_SAT_SERVICIOS_GRUA
          unit_key: 'E48',
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

    // 🧮 CÁLCULO CORRECTO DE TOTALES FINALES
    // Subtotal: $60,183.16
    // IVA 16%: +$9,629.31
    // Retención 4%: -$2,407.33

    const iva16 = subtotal * 0.16; // IVA 16%
    const retencion4 = subtotal * 0.04; // Retención 4%

    const totalSinRetencion = subtotal + iva16; // $60,183.16 + $9,629.31 = $69,812.47
    const totalConRetencion = subtotal + iva16 - retencion4; // $60,183.16 + $9,629.31 - $2,407.33 = $67,405.14

    // Estructuras completas para FacturAPI
    const facturaBaseData = {
      customer: ctx.userState.axaClientId,
      use: 'G03',
      payment_form: '99',
      payment_method: 'PPD',
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
    console.log(`✅ FASE 2: Precálculo completado en ${precalculoDuration}ms`);
    console.log(`📊 FASE 2: Subtotal base: $${subtotal.toFixed(2)}`);
    console.log(
      `📊 FASE 2: CON retención (IVA 16% - Ret 4%): ${itemsConRetencion.length} items, Total: $${totalConRetencion.toFixed(2)}`
    );
    console.log(
      `📊 FASE 2: SIN retención (IVA 16% solamente): ${itemsSinRetencion.length} items, Total: $${totalSinRetencion.toFixed(2)}`
    );

    // Guardar datos precalculados en memoria del proceso
    global.tempAxaData = global.tempAxaData || {};
    global.tempAxaData[ctx.from.id] = {
      // Datos originales (para compatibilidad)
      data,
      columnMappings,
      timestamp: Date.now(),

      // 🚀 NUEVOS DATOS PRECALCULADOS FASE 2
      clientId: ctx.userState.axaClientId,
      subtotal: subtotal,
      iva16: iva16,
      retencion4: retencion4,
      facturaConRetencion: {
        items: itemsConRetencion,
        total: totalConRetencion, // $67,405.14 (Subtotal + IVA 16% - Retención 4%)
        facturaData: facturaConRetencionData,
      },
      facturaSinRetencion: {
        items: itemsSinRetencion,
        total: totalSinRetencion, // $69,812.47 (Subtotal + IVA 16%)
        facturaData: facturaSinRetencionData,
      },
    };

    // Limpiar datos antiguos (más de 10 minutos)
    for (const userId in global.tempAxaData) {
      if (Date.now() - global.tempAxaData[userId].timestamp > 600000) {
        delete global.tempAxaData[userId];
      }
    }

    // 📱 PASO 6: Completado - OPTIMIZACIÓN: Solo mostrar botones CUANDO cache esté listo
    await updateProgressMessage(
      ctx,
      progressMessageId,
      6,
      6,
      'Procesamiento completado',
      `${data.length} registros listos para facturar`
    );

    // 🚀 VERIFICAR que cache global esté listo antes de mostrar botones
    const tempDataCheck = global.tempAxaData && global.tempAxaData[ctx.from.id];
    if (
      !tempDataCheck ||
      !tempDataCheck.facturaConRetencion ||
      !tempDataCheck.facturaSinRetencion
    ) {
      console.log('🚨 ERROR: Cache global AXA no está listo, no mostrar botones aún');
      await ctx.reply(
        '❌ Error interno: Los cálculos no están listos. Por favor, intenta subir el archivo nuevamente.'
      );
      return { success: false, error: 'Cache no listo' };
    }

    console.log('✅ Cache global AXA verificado, mostrando botones');
    console.log(
      `✅ Datos en cache: CON retención: $${tempDataCheck.facturaConRetencion.total.toFixed(2)}, SIN retención: $${tempDataCheck.facturaSinRetencion.total.toFixed(2)}`
    );

    // Preguntar sobre el tipo de servicios SOLO cuando cache esté listo
    await ctx.reply(
      `${infoResumen}\n¿Qué tipo de servicios son?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '🚛 Servicios Realizados (con retención 4%)',
            'axa_servicios_realizados'
          ),
        ],
        [Markup.button.callback('💀 Servicios Muertos (sin retención)', 'axa_servicios_muertos')],
        [Markup.button.callback('❌ Cancelar', 'axa_cancelar')],
      ])
    );

    return { success: true, pendingConfirmation: true };
  } catch (error) {
    console.error('Error al procesar archivo Excel AXA:', error);
    await ctx.reply(`❌ Error al procesar el archivo Excel: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Mapea los nombres de las columnas encontrados en el Excel AXA a nombres estandarizados
 * @param {Object} firstRow - Primera fila del Excel para detectar los nombres de columnas
 * @returns {Object|null} - Objeto con el mapeo de columnas o null si no se encuentran las columnas requeridas
 */
function mapColumnNamesAxa(firstRow) {
  if (!firstRow) return null;

  // Posibles nombres para cada columna requerida de AXA
  const posiblesColumnas = {
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
  const columnMapping = {};

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
  const requiredKeys = ['factura', 'orden', 'folio', 'autorizacion', 'importe'];
  if (requiredKeys.every((key) => columnMapping[key])) {
    return columnMapping;
  }

  console.log('No se encontraron todas las columnas requeridas para AXA:', columnMapping);
  return null;
}

/**
 * 🚀 FASE 3: Envía factura precalculada directamente a FacturAPI (SIN RECÁLCULOS)
 * @param {Object} facturaData - Datos de factura precalculados de FASE 2
 * @param {Object} ctx - Contexto de Telegram
 * @param {number} progressMessageId - ID del mensaje de progreso
 * @returns {Promise<Object>} - Factura generada
 */
async function enviarFacturaDirectaAxa(facturaData, ctx, progressMessageId = null) {
  try {
    console.log('🚀 FASE 3: Enviando factura precalculada a FacturAPI');
    console.log(`🚀 FASE 3: Items en factura: ${facturaData.items.length}`);

    // Obtener tenant y cliente FacturAPI
    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      throw new Error('No se pudo obtener el ID del tenant');
    }

    const facturapIService = await import('../../services/facturapi.service.js').then(
      (m) => m.default
    );
    const facturapi = await facturapIService.getFacturapiClient(tenantId);

    // 📱 Actualizar progreso
    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessageId,
        null,
        `🚀 Enviando a FacturAPI...\n📡 Conectando con servidor...`,
        { parse_mode: 'Markdown' }
      );
    }

    // 🚀 FASE 3: Envío DIRECTO (datos ya preparados en FASE 2)
    console.log('🚀 FASE 3: Enviando solicitud directa a FacturAPI...');
    const factura = await facturapi.invoices.create(facturaData);

    console.log(`🚀 FASE 3: Factura creada exitosamente: ${factura.id}`);
    console.log(`🚀 FASE 3: Folio asignado: ${factura.folio_number}`);

    // Registrar factura en BD
    console.log('🚀 FASE 3: Registrando factura en BD...');

    // Obtener el customerId del cliente AXA desde userState
    const axaCustomerId = await getAxaCustomerIdFromDB(tenantId, ctx.userState.axaClientId);

    const TenantService = await import('../../services/tenant.service.js').then((m) => m.default);
    await TenantService.registerInvoice(
      tenantId,
      factura.id,
      factura.series,
      factura.folio_number,
      axaCustomerId, // ✅ Ahora sí vinculamos al cliente AXA
      factura.total,
      parseInt(ctx.from.id) <= 2147483647 ? parseInt(ctx.from.id) : null // ✅ INT4 safe
    );
    console.log('🚀 FASE 3: Factura registrada en BD exitosamente');

    console.log('🚀 FASE 3: Retornando factura...');
    return factura;
  } catch (error) {
    console.error('🚨 FASE 3: Error al enviar factura a FacturAPI:', error);
    throw error;
  }
}

/**
 * Genera una factura para AXA con todos los registros
 * @param {Array} items - Elementos a incluir en la factura
 * @param {Object} ctx - Contexto de Telegram
 * @param {Object} columnMappings - Mapeo de nombres de columnas
 * @param {boolean} conRetencion - Si aplica retención del 4%
 * @returns {Promise<Object>} - Factura generada
 */
async function generarFacturaAxa(
  items,
  ctx,
  columnMappings,
  conRetencion = false,
  progressMessageId = null
) {
  if (items.length === 0) {
    console.log('No hay items para generar factura AXA');
    return null;
  }

  // Calcular el monto total de todos los servicios
  const montoTotal = items.reduce((total, item) => {
    const importe = parseFloat(item[columnMappings.importe]);
    return total + (isNaN(importe) ? 0 : importe);
  }, 0);

  if (montoTotal <= 0) {
    await ctx.reply(`⚠️ No se generó factura para AXA porque el monto total es 0.`);
    return null;
  }

  // OPTIMIZACIÓN: Construir array de ítems en chunks para mejor rendimiento
  const chunkSize = 10;
  const facturaItems = [];

  // Pre-definir estructura de impuestos para evitar recrearla
  const baseTaxes = [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }];
  const taxesWithRetention = [
    ...baseTaxes,
    { type: 'IVA', rate: 0.04, factor: 'Tasa', withholding: true },
  ];

  // Procesar items en chunks
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, Math.min(i + chunkSize, items.length));

    chunk.forEach((item) => {
      const factura = item[columnMappings.factura] || 'N/A';
      const orden = item[columnMappings.orden] || 'N/A';
      const folio = item[columnMappings.folio] || 'N/A';
      const autorizacion = item[columnMappings.autorizacion] || 'N/A';
      const importe = parseFloat(item[columnMappings.importe]);

      // Usar template literal optimizado
      const descripcion = `ARRASTRE DE GRUA FACTURA ${factura} No. ORDEN ${orden} No. FOLIO ${folio} AUTORIZACION ${autorizacion}`;

      facturaItems.push({
        quantity: 1,
        product: {
          description: descripcion,
          product_key: CLAVE_SAT_SERVICIOS_GRUA,
          unit_key: 'E48',
          unit_name: 'SERVICIO',
          price: importe,
          tax_included: false,
          taxes: conRetencion ? taxesWithRetention : baseTaxes,
        },
      });
    });

    // Pequeña pausa para no bloquear el event loop en datasets grandes
    if (i + chunkSize < items.length && items.length > 50) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  // Construir los datos de la factura
  const facturaData = {
    customer: ctx.userState.axaClientId,
    items: facturaItems,
    use: 'G03', // Uso de CFDI
    payment_form: '99', // Forma de pago
    payment_method: 'PPD', // Método de pago
    currency: 'MXN',
    exchange: 1,
  };

  // Mostrar resumen de la factura antes de generarla (formato estándar como CHUBB)
  await ctx.reply(
    `📋 *Vista previa de factura*\n\n` +
      `• Tipo: ${conRetencion ? 'Servicios de Grúa AXA Con Retención (4%)' : 'Servicios de Grúa AXA Sin Retención'}\n` +
      `• Cliente: AXA ASSISTANCE MEXICO\n` +
      `• Clave SAT: ${CLAVE_SAT_SERVICIOS_GRUA}\n` +
      `• Registros incluidos: ${items.length}\n` +
      `• Monto: $${montoTotal.toFixed(2)} MXN\n`,
    { parse_mode: 'Markdown' }
  );

  // Llamar directamente a FacturAPI para generar la factura
  try {
    // 📱 Actualizar progreso si se proporciona messageId
    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessageId,
        null,
        `🚀 Enviando factura a FacturAPI...\n\n📡 Conectando con el servidor...`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(`⏳ Generando factura para AXA...`);
    }

    // Obtener el ID del tenant actual
    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      throw new Error('No se pudo obtener el ID del tenant');
    }

    console.log(`Tenant ID obtenido: ${tenantId}`);

    // Importar facturapIService
    const facturapIService = await import('../../services/facturapi.service.js').then(
      (m) => m.default
    );

    // Obtener cliente de FacturAPI
    const facturapi = await facturapIService.getFacturapiClient(tenantId);
    console.log('Cliente FacturAPI obtenido correctamente');

    // 📱 Actualizar progreso - Preparando datos
    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessageId,
        null,
        `🔄 Enviando ${facturaItems.length} servicios a FacturAPI...\n\n⏳ Procesando datos...`,
        { parse_mode: 'Markdown' }
      );
    }

    // Obtenemos el TenantService pero NO solicitamos ni asignamos el folio
    const TenantService = await import('../../services/tenant.service.js').then((m) => m.default);

    // OPTIMIZACIÓN: Log reducido para mejor rendimiento
    console.log(
      `Enviando solicitud a FacturAPI: ${facturaItems.length} items, cliente: ${ctx.userState.axaClientId}`
    );

    // 📱 Actualizar progreso - Enviando a FacturAPI
    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessageId,
        null,
        `🚀 Creando factura en FacturAPI...\n\n💫 Enviando datos al servidor...`,
        { parse_mode: 'Markdown' }
      );
    }

    // Crear la factura directamente en FacturAPI (sin enviar folio)
    const factura = await facturapi.invoices.create(facturaData);
    console.log(
      'Factura AXA creada en FacturAPI, folio asignado automáticamente:',
      factura.folio_number
    );

    // 📱 Actualizar progreso - Factura creada
    if (progressMessageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMessageId,
        null,
        `✅ Factura creada exitosamente\n\n📋 Folio: ${factura.series}-${factura.folio_number}\n💰 Total: $${factura.total.toFixed(2)} MXN`,
        { parse_mode: 'Markdown' }
      );
    }

    // Registrar la factura en la base de datos con el folio devuelto por FacturAPI
    try {
      // Obtener el customerId del cliente AXA desde userState
      const axaCustomerId = await getAxaCustomerIdFromDB(tenantId, ctx.userState.axaClientId);

      const registeredInvoice = await TenantService.registerInvoice(
        tenantId,
        factura.id,
        factura.series || 'A',
        factura.folio_number, // Usamos el folio que FacturAPI asignó
        axaCustomerId, // ✅ Ahora sí vinculamos al cliente AXA
        factura.total,
        ctx.from?.id && parseInt(ctx.from.id) <= 2147483647 ? parseInt(ctx.from.id) : null // ✅ INT4 safe
      );

      console.log('Factura AXA registrada en la base de datos:', registeredInvoice);
    } catch (registerError) {
      // Si hay un error al registrar, lo registramos pero continuamos
      console.error('Error al registrar factura AXA en la base de datos:', registerError);
    }

    // Guardar el ID de la factura en el estado del usuario para usarlo posteriormente
    ctx.userState.facturaId = factura.id;
    ctx.userState.folioFactura = factura.folio_number;
    ctx.userState.facturaGenerada = true;

    // 📱 Mensaje final con opciones de descarga
    await ctx.reply(
      `🎉 *Factura AXA generada exitosamente*\n\n` +
        `• Cliente: AXA ASSISTANCE MEXICO\n` +
        `• Folio: ${factura.series}-${factura.folio_number}\n` +
        `• Clave SAT: ${CLAVE_SAT_SERVICIOS_GRUA}\n` +
        `• Total: $${factura.total.toFixed(2)} MXN\n\n` +
        `📥 Seleccione una opción para descargar:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📄 Descargar PDF', `pdf_${factura.id}_${factura.folio_number}`)],
          [Markup.button.callback('🔠 Descargar XML', `xml_${factura.id}_${factura.folio_number}`)],
        ]),
      }
    );

    return factura;
  } catch (error) {
    console.error('Error al generar factura AXA:', error);
    let errorMsg = 'Error al generar la factura.';

    if (error.response && error.response.data) {
      console.log('Respuesta de error completa:', JSON.stringify(error.response.data, null, 2));
      if (typeof error.response.data.message === 'string') {
        errorMsg = `Error de FacturAPI: ${error.response.data.message}`;
      } else if (error.response.data.details) {
        errorMsg = `Error de validación: ${JSON.stringify(error.response.data.details)}`;
      }
    }

    await ctx.reply(`❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
}
