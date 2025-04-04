// bot/handlers/production-setup.handler.js
import { Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { fileURLToPath } from 'url';
import { config } from '../../config/index.js';
import TenantService from '../../services/tenant.service.js';
import prisma from '../../lib/prisma.js';

// Constantes
const ADMIN_CHAT_IDS = process.env.ADMIN_CHAT_IDS ? process.env.ADMIN_CHAT_IDS.split(',').map(id => BigInt(id.trim())) : [];
const FACTURAPI_USER_KEY = process.env.FACTURAPI_USER_KEY;

// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, '../../temp');

// Estados del proceso
const SetupState = {
  AWAITING_CER: 'awaiting_cer',
  AWAITING_KEY: 'awaiting_key',
  AWAITING_PASSWORD: 'awaiting_password',
  AWAITING_ADMIN_APPROVAL: 'awaiting_admin_approval',
  AWAITING_FINAL_CONFIRMATION: 'awaiting_final_confirmation'
};
// Comando para configuración de facturación real
const PRODUCTION_SETUP_COMMAND = 'registro_factura_real_completo';

/**
 * Verifica si una fecha ha pasado
 * @param {Date} date - Fecha a verificar
 * @returns {boolean} - true si la fecha ya pasó
 */
function isDatePassed(date) {
  return date < new Date();
}

/**
 * Registra los manejadores para el proceso de configuración productiva
 * @param {Object} bot - Instancia del bot de Telegram
 */
export function registerProductionSetupHandler(bot) {
  // Registro del comando especial
  bot.command(PRODUCTION_SETUP_COMMAND, async (ctx) => {
    try {
      console.log('Iniciando proceso de configuración productiva mediante comando');
      
      // Verificar que el usuario tiene un tenant asociado
      if (!ctx.hasTenant()) {
        return ctx.reply(
          '❌ Para configurar el modo de facturación real, primero debes registrar tu empresa.\n\n' +
          'Usa /registro para comenzar.'
        );
      }
      
      // Obtener información del tenant
      const tenantId = ctx.getTenantId();
      const tenant = await TenantService.findTenantWithSubscription(tenantId);
      
      if (!tenant) {
        return ctx.reply('❌ No se pudo obtener la información de tu empresa.');
      }
      
      // Verificar si ya tiene un certificado configurado
      // Nota: Ya no verificamos el formato de la API key, solo si tiene un certificado configurado
      try {
        const facturapIService = await import('../../services/facturapi.service.js').then(m => m.default);
        const orgInfo = await facturapIService.getOrganizationInfo(tenantId);
        
        if (orgInfo && orgInfo.legal && orgInfo.legal.certificate && orgInfo.legal.certificate.expires_at) {
          return ctx.reply(
            '✅ Tu cuenta ya tiene un certificado configurado.\n\n' +
            'Puedes generar facturas reales.'
          );
        }
      } catch (error) {
        console.log('Error al verificar certificado:', error);
        // Continuamos con el proceso si hay error al verificar
      }
      
      // Verificar si tiene suscripción activa
      if (!tenant.subscriptions || tenant.subscriptions.length === 0) {
        return ctx.reply(
          '❌ No tienes una suscripción activa. Para usar facturación real necesitas una suscripción activa.'
        );
      }
      
      const subscription = tenant.subscriptions[0];
      if (subscription.status !== 'active' && 
          (subscription.status !== 'trial' || 
           (subscription.trialEndsAt && isDatePassed(subscription.trialEndsAt)))) {
        return ctx.reply(
          '❌ Tu suscripción no está activa. Por favor, actualiza tu plan para usar facturación real.'
        );
      }
      
      // Iniciar el proceso de configuración
      ctx.userState.productionSetup = {
        state: SetupState.AWAITING_CER,
        tenantId: tenant.id,
        orgId: tenant.facturapiOrganizationId,
        businessName: tenant.businessName,
        rfc: tenant.rfc
      };
      
      console.log('Estado de configuración inicializado:', ctx.userState.productionSetup);
      
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
      console.error('Error al iniciar configuración productiva:', error);
      ctx.reply('❌ Ocurrió un error al iniciar el proceso. Por favor, intenta nuevamente más tarde.');
    }
  });
  
  // Handler de diagnóstico para documentos
  // Handler de diagnóstico para documentos
  bot.on('document', async (ctx, next) => {
    console.log('=========== INICIO DIAGNÓSTICO DE DOCUMENTO PRODUCCIÓN ===========');
    console.log('Documento recibido:', ctx.message.document.file_name);
    console.log('Estado del usuario:', ctx.userState ? 'Presente' : 'Ausente');
    console.log('productionSetup:', ctx.userState?.productionSetup ? 'Presente' : 'Ausente');
    
    // Verificar si es nuestro contexto: Solo procesar si es .cer o .key Y hay estado de configuración
    const fileName = ctx.message.document.file_name || '';
    const isCertFile = fileName.endsWith('.cer') || fileName.endsWith('.key');
    
    // Si NO es un archivo de certificado O no hay configuración activa, pasar al siguiente handler
    if (!isCertFile || !ctx.userState?.productionSetup) {
      console.log('No es archivo de certificado o no hay config productiva, pasando al siguiente handler');
      console.log('=========== FIN DIAGNÓSTICO DE DOCUMENTO PRODUCCIÓN (PASANDO) ===========');
      return next();
    }
    
    // A partir de aquí sabemos que ES un archivo .cer o .key y que SÍ hay estado de configuración
    console.log('Estado actual de configuración:', ctx.userState.productionSetup.state);
    
    try {
      const setup = ctx.userState.productionSetup;
      const document = ctx.message.document;
      
      // Procesamiento específico según el estado
      if (setup.state === SetupState.AWAITING_CER && document.file_name.endsWith('.cer')) {
        console.log('🔔 Detectado archivo .cer en estado correcto');
        
        try {
          // Descargar el archivo .cer
          await ctx.reply('⏳ Recibiendo archivo .cer, procesando...');
          const cerPath = await downloadTelegramFile(ctx, document.file_id, document.file_name);
          
          // Guardar la ruta del archivo en el estado para usar después
          setup.cerPath = cerPath;
          
          // Actualizar el estado para esperar el archivo .key
          setup.state = SetupState.AWAITING_KEY;
          
          console.log(`Archivo .cer guardado en: ${cerPath}`);
          console.log(`Estado actualizado a: ${setup.state}`);
          
          // Solicitar el archivo .key al usuario
          await ctx.reply(
            '✅ Archivo .cer recibido correctamente.\n\n' +
            'Por favor, envía ahora tu archivo .key',
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.error('Error al procesar archivo .cer:', error);
          await ctx.reply('❌ Error al procesar el archivo .cer. Por favor, intenta nuevamente.');
          
          // Limpiar el estado en caso de error
          delete ctx.userState.productionSetup;
        }
        
        console.log('=========== FIN DIAGNÓSTICO DE DOCUMENTO PRODUCCIÓN (PROCESADO CER) ===========');
        return; // No continuar con los siguientes handlers
      } 
      else if (setup.state === SetupState.AWAITING_KEY && document.file_name.endsWith('.key')) {
        console.log('🔔 Detectado archivo .key en estado correcto');
        
        try {
          // Descargar el archivo .key
          await ctx.reply('⏳ Recibiendo archivo .key, procesando...');
          const keyPath = await downloadTelegramFile(ctx, document.file_id, document.file_name);
          
          // Guardar la ruta del archivo en el estado para usar después
          setup.keyPath = keyPath;
          
          // Actualizar el estado para esperar la contraseña
          setup.state = SetupState.AWAITING_PASSWORD;
          
          console.log(`Archivo .key guardado en: ${keyPath}`);
          console.log(`Estado actualizado a: ${setup.state}`);
          
          // Solicitar la contraseña al usuario
          await ctx.reply(
            '✅ Archivo .key recibido correctamente.\n\n' +
            'Por favor, introduce la contraseña de tu certificado:',
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.error('Error al procesar archivo .key:', error);
          await ctx.reply('❌ Error al procesar el archivo .key. Por favor, intenta nuevamente.');
          
          // Limpiar archivos y estado en caso de error
          if (setup.cerPath) {
            cleanupFiles([setup.cerPath]);
          }
          delete ctx.userState.productionSetup;
        }
        
        console.log('=========== FIN DIAGNÓSTICO DE DOCUMENTO PRODUCCIÓN (PROCESADO KEY) ===========');
        return; // No continuar con los siguientes handlers
      }
      
      // Si llegamos aquí, es un archivo de certificado pero en un estado incorrecto
      console.log('Archivo de certificado recibido en estado incorrecto');
      await ctx.reply('❌ Archivo recibido en un momento incorrecto del proceso. Por favor, sigue las instrucciones.');
      console.log('=========== FIN DIAGNÓSTICO DE DOCUMENTO PRODUCCIÓN (ESTADO INCORRECTO) ===========');
      return; // No pasar a otros handlers porque es nuestro contexto pero estado incorrecto
      
    } catch (error) {
      console.error('Error al procesar el archivo de certificado:', error);
      await ctx.reply('❌ Error al procesar el archivo. Por favor, intenta nuevamente.');
      console.log('=========== FIN DIAGNÓSTICO DE DOCUMENTO PRODUCCIÓN (ERROR) ===========');
      return next(); // En caso de error sí pasamos al siguiente por si acaso
    }
  }); // IMPORTANTE: QUITAR la prioridad 100 para que cada handler se ejecute en orden normal
  
  // Manejador para el botón de "Facturar Real"
  bot.action('setup_production', async (ctx) => {
    await ctx.answerCbQuery();
    
    try {
      console.log('Iniciando proceso de configuración productiva');
      
      // Verificar que el usuario tiene un tenant asociado
      if (!ctx.hasTenant()) {
        return ctx.reply(
          '❌ Para configurar el modo de facturación real, primero debes registrar tu empresa.\n\n' +
          'Usa /registro para comenzar.'
        );
      }
      
      // Obtener información del tenant
      const tenantId = ctx.getTenantId();
      const tenant = await TenantService.findTenantWithSubscription(tenantId);
      
      if (!tenant) {
        return ctx.reply('❌ No se pudo obtener la información de tu empresa.');
      }
      
      // Verificar si ya tiene un certificado configurado
      // Nota: Ya no verificamos el formato de la API key, solo si tiene un certificado configurado
      try {
        const facturapIService = await import('../../services/facturapi.service.js').then(m => m.default);
        const orgInfo = await facturapIService.getOrganizationInfo(tenantId);
        
        if (orgInfo && orgInfo.legal && orgInfo.legal.certificate && orgInfo.legal.certificate.expires_at) {
          return ctx.reply(
            '✅ Tu cuenta ya tiene un certificado configurado.\n\n' +
            'Puedes generar facturas reales.'
          );
        }
      } catch (error) {
        console.log('Error al verificar certificado:', error);
        // Continuamos con el proceso si hay error al verificar
      }
      
      // Iniciar el proceso de configuración
      ctx.userState.productionSetup = {
        state: SetupState.AWAITING_CER,
        tenantId: tenant.id,
        orgId: tenant.facturapiOrganizationId,
        businessName: tenant.businessName,
        rfc: tenant.rfc
      };
      
      console.log('Estado de configuración inicializado:', ctx.userState.productionSetup);
      
      // No agregar esperando porque este estado ya existe independientemente
      
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
      console.error('Error al iniciar configuración productiva:', error);
      ctx.reply('❌ Ocurrió un error al iniciar el proceso. Por favor, intenta nuevamente más tarde.');
    }
  });
  
  // IMPORTANTE: Este handler está desactivado para evitar conflictos con el handler de diagnóstico
  // Solo descomentar si el handler de diagnóstico está desactivado
  /*
  bot.on('document', async (ctx, next) => {
    console.log('Document handler secundario - DESACTIVADO');
    return next(); // Siempre pasar al siguiente middleware
  });
  */
  
  // Manejador para recibir la contraseña
  bot.on('text', async (ctx, next) => {
    // Añadir logs detallados para depuración
    console.log('Text handler - Mensaje recibido:', ctx.message.text);
    console.log('Text handler - Estado del usuario:', JSON.stringify(ctx.userState));
    
    // Verificar si estamos esperando la contraseña
    if (!ctx.userState || 
        !ctx.userState.productionSetup || 
        ctx.userState.productionSetup.state !== SetupState.AWAITING_PASSWORD) {
      console.log('No estamos esperando contraseña, pasando al siguiente middleware');
      return next();
    }
    
    const setup = ctx.userState.productionSetup;
    console.log('Estado de configuración productiva (password):', setup);
    const password = ctx.message.text.trim();
    
    try {
      // Guardar la contraseña
      setup.password = password;
      
      await ctx.reply('⏳ Enviando información a FacturAPI. Por favor, espera...');
      
      // Enviar los archivos y la contraseña a FacturAPI
      const result = await uploadCertificateToFacturAPI(
        setup.orgId,
        setup.cerPath,
        setup.keyPath,
        setup.password
      );
      
      if (result.success) {
        // Actualizar estado a espera de aprobación admin
        setup.state = SetupState.AWAITING_ADMIN_APPROVAL;
        console.log('Estado actualizado a AWAITING_ADMIN_APPROVAL');
        
        await ctx.reply(
          '✅ Certificado enviado correctamente a FacturAPI.\n\n' +
          'Un administrador verificará la información y habilitará la facturación real.\n\n' +
          'Te notificaremos cuando el proceso esté completado.'
        );
        
        // Notificar a los administradores
        await notifyAdmins(bot, setup, ctx.from);
      } else {
        await ctx.reply(
          `❌ Error al enviar el certificado: ${result.error}\n\n` +
          'Por favor, verifica que los archivos y la contraseña sean correctos e intenta nuevamente.'
        );
        
        // Reiniciar el proceso
        delete ctx.userState.productionSetup;
        console.log('Proceso reiniciado debido a error');
      }
      
      // Limpiar archivos temporales
      cleanupFiles([setup.cerPath, setup.keyPath]);
      
    } catch (error) {
      console.error('Error al procesar contraseña:', error);
      ctx.reply('❌ Ocurrió un error al procesar la información. Por favor, intenta nuevamente.');
      
      // Limpiar archivos temporales
      if (setup.cerPath) {
        cleanupFiles([setup.cerPath, setup.keyPath]);
      }
      
      // Reiniciar el proceso
      delete ctx.userState.productionSetup;
      console.log('Proceso reiniciado debido a error en el manejo de la contraseña');
    }
  });
  
  // Manejador para la acción de aprobación del administrador
  bot.action(/^approve_production_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    
    const tenantId = ctx.match[1];
    
    try {
      // Verificar que el usuario es un administrador
      if (!ADMIN_CHAT_IDS.includes(BigInt(ctx.from.id))) {
        return ctx.reply('❌ No tienes permisos para realizar esta acción.');
      }
      
      // Buscar el tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId }
      });
      
      if (!tenant) {
        return ctx.reply(`❌ No se encontró el tenant con ID ${tenantId}`);
      }
      
      // Actualizar el mensaje con confirmación
      await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n✅ Aprobado por ' + ctx.from.username,
        { reply_markup: { inline_keyboard: [] } }
      );
      
      // Encontrar el usuario del tenant para enviar notificación
      const tenantUser = await prisma.tenantUser.findFirst({
        where: { 
          tenantId: tenantId,
          role: 'admin'
        }
      });
      
      if (tenantUser) {
        // Enviar mensaje al usuario
        await bot.telegram.sendMessage(
          tenantUser.telegramId.toString(),
          '✅ ¡Buenas noticias! Un administrador ha verificado tu certificado y ha habilitado la facturación real.\n\n' +
          'Por favor, presiona el botón para completar la configuración:',
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Completar Configuración', `complete_setup_${tenantId}`)]
          ])
        );
      }
    } catch (error) {
      console.error('Error al aprobar configuración:', error);
      ctx.reply('❌ Ocurrió un error al procesar la aprobación.');
    }
  });
  
  // Manejador para completar la configuración
  bot.action(/^complete_setup_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    
    const tenantId = ctx.match[1];
    
    try {
      // Verificar que el usuario pertenece al tenant
      if (ctx.getTenantId() !== tenantId) {
        return ctx.reply('❌ No tienes permisos para realizar esta acción.');
      }
      
      await ctx.reply('⏳ Renovando y obteniendo API Key de producción...');
      
      // Obtener tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId }
      });
      
      if (!tenant || !tenant.facturapiOrganizationId) {
        return ctx.reply('❌ No se encontró información de la organización.');
      }
      
      // Renovar API Key Live
      const apiKeyLive = await renewFacturapiLiveKey(tenant.facturapiOrganizationId);
      
      if (!apiKeyLive) {
        return ctx.reply(
          '❌ No se pudo obtener la API Key de producción.\n\n' +
          'Por favor, contacta a soporte técnico.'
        );
      }
      
      // Actualizar tenant en la base de datos
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          facturapiApiKey: apiKeyLive
        }
      });
      
      // Registrar en el log de auditoría
      await prisma.auditLog.create({
        data: {
          tenantId: tenantId,
          action: 'tenant:update:production',
          entityType: 'tenant',
          entityId: tenantId,
          details: {
            changedTo: 'production'
          }
        }
      });
      
      // NUEVA SECCIÓN: Eliminar los clientes existentes y volver a crearlos con la API key de producción
      await ctx.reply('⏳ Reconfigurando clientes con tu nueva API key de producción...');
      
      try {
        // 1. Eliminar todos los clientes actuales del tenant
        await prisma.tenantCustomer.deleteMany({
          where: { tenantId }
        });
        
        // 2. AÑADIR ESTE BLOQUE: Eliminar facturas y documentos asociados
        await ctx.reply('⏳ Eliminando facturas y documentos de prueba...');
        
        // Obtener IDs de todas las facturas del tenant
        const facturas = await prisma.tenantInvoice.findMany({
          where: { tenantId },
          select: { id: true }
        });
        
        const facturaIds = facturas.map(f => f.id);
        
        // Eliminar documentos asociados a estas facturas
        if (facturaIds.length > 0) {
          await prisma.tenantDocument.deleteMany({
            where: {
              invoiceId: { in: facturaIds }
            }
          });
        }
        
        // Eliminar las facturas
        const deletedInvoices = await prisma.tenantInvoice.deleteMany({
          where: { tenantId }
        });
        
        // Resetear el contador de folios
        await prisma.tenantFolio.updateMany({
          where: { tenantId },
          data: { currentNumber: 800 } // Reiniciar al valor inicial
        });
        
        // Resetear el contador de facturas usadas
        await prisma.tenantSubscription.updateMany({
          where: { tenantId },
          data: { invoicesUsed: 0 } // Reiniciar a 0 el contador de facturas
        });
        
        console.log(`Se eliminaron ${deletedInvoices.count} facturas de prueba para el tenant ${tenantId}`);
        
        // 3. Volver a configurar los clientes con la nueva API key
        const CustomerSetupService = await import('../../services/customer-setup.service.js');
        const setupResults = await CustomerSetupService.default.setupPredefinedCustomers(tenantId, true);
        
        // 4. Contar éxitos para informar al usuario
        const successCount = setupResults.filter(r => r.success).length;
        await ctx.reply(`✅ Se han configurado ${successCount} clientes con tu nueva API de producción.`);
      } catch (clientError) {
        console.error('Error al reconfigurar clientes:', clientError);
        await ctx.reply('⚠️ Se produjo un error al configurar los clientes. Por favor, configúralos manualmente desde el menú.');
      }
      
      await ctx.reply(
        '🎉 *¡Felicidades!* Tu cuenta ha sido configurada correctamente para facturación real.\n\n' +
        'Ahora puedes emitir facturas válidas ante el SAT.\n\n' +
        'Recuerda que todas las facturas generadas a partir de este momento serán documentos fiscales oficiales.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🏠 Volver al Menú Principal', 'menu_principal')]
          ])
        }
      );
      
    } catch (error) {
      console.error('Error al completar configuración:', error);
      ctx.reply(
        '❌ Ocurrió un error al completar la configuración.\n\n' +
        'Por favor, intenta nuevamente o contacta a soporte técnico.'
      );
    }
  });
  
  // Comando para administradores para generar instrucciones
  bot.command('generar_comando_produccion', async (ctx) => {
    // Verificar que el usuario es un administrador
    if (!ADMIN_CHAT_IDS.includes(BigInt(ctx.from.id))) {
      return ctx.reply('❌ Este comando es solo para administradores.');
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

/**
 * Descarga un archivo de Telegram
 * @param {Object} ctx - Contexto de Telegram
 * @param {string} fileId - ID del archivo
 * @param {string} fileName - Nombre del archivo
 * @returns {Promise<string>} - Ruta del archivo guardado
 */
async function downloadTelegramFile(ctx, fileId, fileName) {
  console.log(`⏬ Iniciando descarga de archivo: ${fileName} (ID: ${fileId})`);
  
  // Asegurar que el directorio temporal existe
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    console.log('📁 Directorio temporal creado:', TEMP_DIR);
  }
  
  try {
    // Obtener enlace de descarga
    console.log('🔗 Obteniendo enlace de descarga...');
    const fileLink = await ctx.telegram.getFileLink(fileId);
    console.log('✅ Enlace obtenido:', fileLink.href);
    
    // Ruta completa del archivo
    const filePath = path.join(TEMP_DIR, fileName);
    console.log('📝 Guardando en:', filePath);
    
    // Descargar el archivo usando axios con timeout extendido
    console.log('⬇️ Descargando archivo...');
    const response = await axios({
      method: 'GET',
      url: fileLink.href,
      responseType: 'stream',
      timeout: 30000 // 30 segundos para permitir descargas más grandes
    });
    
    // Escribir el archivo en disco
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('✅ Archivo guardado exitosamente en:', filePath);
        // Verificar que el archivo existe y tiene tamaño
        try {
          const stats = fs.statSync(filePath);
          console.log(`📊 Tamaño del archivo: ${stats.size} bytes`);
          if (stats.size === 0) {
            console.error('⚠️ Archivo vacío');
            reject(new Error('El archivo descargado está vacío'));
            return;
          }
        } catch (err) {
          console.error('⚠️ Error al verificar archivo:', err);
          reject(err);
          return;
        }
        resolve(filePath);
      });
      
      writer.on('error', (err) => {
        console.error('❌ Error al guardar archivo:', err);
        reject(err);
      });
    });
  } catch (error) {
    console.error('❌ Error al descargar archivo:', error);
    throw error;
  }
}

/**
 * Sube los certificados a FacturAPI
 * @param {string} organizationId - ID de la organización
 * @param {string} cerPath - Ruta del archivo .cer
 * @param {string} keyPath - Ruta del archivo .key
 * @param {string} password - Contraseña del certificado
 * @returns {Promise<Object>} - Resultado de la operación
 */
async function uploadCertificateToFacturAPI(organizationId, cerPath, keyPath, password) {
  try {
    if (!FACTURAPI_USER_KEY) {
      throw new Error('FACTURAPI_USER_KEY no está configurada');
    }
    
    console.log(`Iniciando envío de certificados a FacturAPI para organización ${organizationId}`);
    console.log(`Verificando archivo .cer: ${cerPath}`);
    console.log(`Verificando archivo .key: ${keyPath}`);
    
    // Verificar que los archivos existen
    if (!fs.existsSync(cerPath)) {
      throw new Error(`El archivo .cer no existe en la ruta: ${cerPath}`);
    }
    
    if (!fs.existsSync(keyPath)) {
      throw new Error(`El archivo .key no existe en la ruta: ${keyPath}`);
    }
    
    // Log del tamaño de los archivos para verificar que no estén vacíos
    const cerStats = fs.statSync(cerPath);
    const keyStats = fs.statSync(keyPath);
    console.log(`Tamaño archivo .cer: ${cerStats.size} bytes`);
    console.log(`Tamaño archivo .key: ${keyStats.size} bytes`);
    
    if (cerStats.size === 0 || keyStats.size === 0) {
      throw new Error('Uno o ambos archivos están vacíos');
    }
    
    // Crear un FormData
    const formData = new FormData();
    formData.append('cer', fs.createReadStream(cerPath));
    formData.append('key', fs.createReadStream(keyPath));
    formData.append('password', password);
    
    console.log('FormData creado correctamente. Enviando a FacturAPI...');
    
    // Hacer la petición a FacturAPI con timeout extendido
    const response = await axios({
      method: 'PUT',
      url: `https://www.facturapi.io/v2/organizations/${organizationId}/certificate`,
      headers: {
        'Authorization': `Bearer ${FACTURAPI_USER_KEY}`,
        ...formData.getHeaders()
      },
      data: formData,
      timeout: 30000 // 30 segundos para permitir la carga de archivos grandes
    });
    
    console.log('✅ Certificados enviados correctamente a FacturAPI');
    console.log('Respuesta:', response.data);
    
    return { 
      success: true, 
      data: response.data 
    };
  } catch (error) {
    console.error('Error al subir certificado a FacturAPI:', error);
    
    // Logging detallado para depuración
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data));
      console.error('Headers:', JSON.stringify(error.response.headers));
    } else if (error.request) {
      console.error('No se recibió respuesta del servidor:', error.request);
    } else {
      console.error('Error:', error.message);
    }
    
    let errorMessage = 'Error desconocido';
    if (error.response && error.response.data) {
      errorMessage = error.response.data.message || JSON.stringify(error.response.data);
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Notifica a los administradores sobre la solicitud
 * @param {Object} bot - Instancia del bot
 * @param {Object} setup - Datos de configuración
 * @param {Object} user - Datos del usuario
 */
async function notifyAdmins(bot, setup, user) {
  // Modificar esta parte para evitar problemas con el formato Markdown
  const message = 
    '🔔 *Nueva solicitud de configuración productiva*\n\n' +
    `*Empresa:* ${setup.businessName}\n` +
    `*RFC:* ${setup.rfc || 'No disponible'}\n` +
    // Eliminar los backticks (`) que causan el problema
    `*ID Organización:* ${setup.orgId}\n` +
    `*Usuario:* ${user.first_name} ${user.last_name || ''} (@${user.username || 'sin_username'})\n` +
    `*ID Telegram:* ${user.id}\n\n` +
    'Por favor, verifica los certificados en el dashboard de FacturAPI y genera la API Key Live.';
  
  // Enviar mensaje a todos los administradores
  for (const adminId of ADMIN_CHAT_IDS) {
    try {
      await bot.telegram.sendMessage(
        adminId.toString(),
        message,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Aprobar', `approve_production_${setup.tenantId}`)]
          ])
        }
      );
      console.log(`✅ Notificación enviada al administrador ${adminId}`);
    } catch (error) {
      console.error(`Error al enviar notificación al admin ${adminId}:`, error);
      
      // Intento alternativo sin formato Markdown
      try {
        console.log("Intentando enviar notificación sin formato Markdown...");
        await bot.telegram.sendMessage(
          adminId.toString(),
          `Nueva solicitud de configuración productiva para ${setup.businessName} (${setup.rfc}). Por favor verifica los certificados.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Aprobar', `approve_production_${setup.tenantId}`)]
          ])
        );
        console.log(`✅ Notificación alternativa enviada al administrador ${adminId}`);
      } catch (fallbackError) {
        console.error(`Error al enviar notificación alternativa:`, fallbackError);
      }
    }
  }
}

/**
 * Renueva y obtiene la API Key Live de FacturAPI
 * @param {string} organizationId - ID de la organización
 * @returns {Promise<string|null>} - API Key Live renovada o null si hay error
 */
async function renewFacturapiLiveKey(organizationId) {
  try {
    if (!FACTURAPI_USER_KEY) {
      throw new Error('FACTURAPI_USER_KEY no está configurada');
    }
    
    // Hacer la petición PUT a FacturAPI para renovar la API Key Live
    const response = await axios({
      method: 'PUT', // Método PUT para renovar la API Key
      url: `https://www.facturapi.io/v2/organizations/${organizationId}/apikeys/live`,
      headers: {
        'Authorization': `Bearer ${FACTURAPI_USER_KEY}`
      }
    });
    
    // La respuesta debe ser directamente la API key renovada
    return response.data;
  } catch (error) {
    console.error('Error al renovar API Key Live:', error);
    
    // Mostrar detalles del error para depuración
    if (error.response) {
      console.error('Detalles de error:', {
        status: error.response.status,
        data: error.response.data
      });
    }
    
    return null;
  }
}

/**
 * Limpia archivos temporales
 * @param {Array<string>} filePaths - Rutas de archivos a eliminar
 */
function cleanupFiles(filePaths) {
  for (const filePath of filePaths) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`Archivo eliminado: ${filePath}`);
      } catch (error) {
        console.error(`Error al eliminar archivo ${filePath}:`, error);
      }
    }
  }
}
