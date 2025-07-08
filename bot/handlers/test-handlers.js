// bot/handlers/test-handlers.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, '../../temp');

/**
 * Registra comandos de prueba para diagnóstico de problemas
 * @param {Object} bot - Instancia del bot de Telegram
 */
export function registerTestHandlers(bot) {
  // Comando para verificar el estado de los handlers
  bot.command('test_handlers', (ctx) => {
    console.log('Test de handlers iniciado');
    
    // Análisis del estado del usuario
    console.log('Estado completo del usuario:', JSON.stringify(ctx.userState, null, 2));
    
    // Verificar el estado de configuración productiva
    const setupState = ctx.userState?.productionSetup?.state || 'No inicializado';
    
    // Usar HTML en lugar de Markdown para evitar problemas de escape
    let message = '<b>📊 Diagnóstico de Handlers</b>\n\n';
    message += `• Estado productionSetup: ${setupState}\n`;
    message += `• Tenant ID: ${ctx.userState?.tenantId || 'No disponible'}\n`;
    
    // Verificar el directorio temporal
    if (!fs.existsSync(TEMP_DIR)) {
      message += '• Directorio temporal: ❌ No existe\n';
    } else {
      message += '• Directorio temporal: ✅ Existe\n';
      
      // Verificar permisos
      try {
        const testFile = path.join(TEMP_DIR, 'test.txt');
        fs.writeFileSync(testFile, 'Test', 'utf8');
        fs.unlinkSync(testFile);
        message += '• Permisos escritura: ✅ Correctos\n';
      } catch (error) {
        message += '• Permisos escritura: ❌ Error\n';
        console.error('Error al verificar permisos:', error);
      }
    }
    
    // Verificar variables de entorno críticas
    message += `• FACTURAPI_USER_KEY: ${process.env.FACTURAPI_USER_KEY ? '✅ Configurada' : '❌ No configurada'}\n`;
    message += `• ADMIN_CHAT_IDS: ${process.env.ADMIN_CHAT_IDS ? '✅ Configurada' : '❌ No configurada'}\n`;
    
    // Enviar respuesta al usuario con formato HTML en lugar de Markdown
    ctx.reply(message, { parse_mode: 'HTML' });
  });
  
  // Comando para reiniciar el estado de configuración productiva
  bot.command('reset_setup', async (ctx) => {
    console.log('Reinicio de estado de configuración productiva');
    
    // Guardar información importante
    const tenantId = ctx.userState?.tenantId;
    
    if (!tenantId) {
      return ctx.reply('❌ No tienes un tenant asignado. No se puede reiniciar la configuración.');
    }
    
    // Reiniciar solo el estado de configuración
    if (ctx.userState?.productionSetup) {
      delete ctx.userState.productionSetup;
      await ctx.reply('✅ Estado de configuración productiva reiniciado correctamente.');
    } else {
      await ctx.reply('ℹ️ No había estado de configuración activo para reiniciar.');
    }
    
    // Verificar el nuevo estado
    console.log('Nuevo estado después del reinicio:', JSON.stringify(ctx.userState, null, 2));
  });
  
  // Comando para forzar el estado inicial de configuración
    // Comando para forzar el estado inicial de configuración
    bot.command('force_setup', async (ctx) => {
        console.log('Forzando estado inicial de configuración productiva');
        
        // Verificar que el usuario tiene un tenant asociado
        if (!ctx.hasTenant()) {
        return ctx.reply('❌ No tienes un tenant asignado. No se puede forzar la configuración.');
        }
        
        try {
        // Obtener información del tenant
        const tenantId = ctx.getTenantId();
        
        // Buscar tenant en la base de datos
        const tenantService = await import('../../services/tenant.service.js');
        const tenant = await tenantService.default.findTenantWithSubscription(tenantId);
        
        if (!tenant) {
            return ctx.reply('❌ No se pudo obtener la información del tenant.');
        }
        
        // Forzar el estado inicial
        ctx.userState.productionSetup = {
            state: 'awaiting_cer',
            tenantId: tenant.id,
            orgId: tenant.facturapiOrganizationId,
            businessName: tenant.businessName,
            rfc: tenant.rfc
        };
        
        console.log('Estado forzado:', ctx.userState.productionSetup);
        
        await ctx.reply(
            '✅ Estado de configuración forzado correctamente.\n\n' +
            'Por favor, envía ahora el archivo .cer para continuar con el proceso.'
        );
        } catch (error) {
        console.error('Error al forzar estado:', error);
        await ctx.reply('❌ Error al forzar el estado de configuración.');
        }
    });
    
    // Comando para verificar el sistema de archivos
    bot.command('test_files', async (ctx) => {
        console.log('Test de sistema de archivos iniciado');
        
        try {
        // Verificar o crear directorio temporal
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
            await ctx.reply('✅ Directorio temporal creado: ' + TEMP_DIR);
        } else {
            await ctx.reply('✅ Directorio temporal existente: ' + TEMP_DIR);
        }
        
        // Crear archivo de prueba
        const testFile = path.join(TEMP_DIR, 'test.txt');
        fs.writeFileSync(testFile, 'Test file created at ' + new Date().toISOString(), 'utf8');
        await ctx.reply('✅ Archivo de prueba creado: ' + testFile);
        
        // Leer archivo de prueba
        const content = fs.readFileSync(testFile, 'utf8');
        await ctx.reply('✅ Contenido leído: ' + content);
        
        // Eliminar archivo de prueba
        fs.unlinkSync(testFile);
        await ctx.reply('✅ Archivo de prueba eliminado correctamente');
        
        } catch (error) {
        console.error('Error en test de archivos:', error);
        await ctx.reply('❌ Error en test de archivos: ' + error.message);
        }
    });
    
    // Comando para documentar el proceso completo
    bot.command('help_setup', (ctx) => {
        let message = '<b>📋 Guía de Configuración Productiva</b>\n\n';
        message += '<b>1. Iniciar el proceso:</b>\n';
        message += '• Usa /reset_setup para limpiar cualquier estado anterior\n';
        message += '• Usa /force_setup para iniciar un nuevo estado\n\n';
        
        message += '<b>2. Enviar archivos:</b>\n';
        message += '• Envía el archivo <code>.cer</code>\n';
        message += '• Envía el archivo <code>.key</code>\n';
        message += '• Envía la contraseña del certificado\n\n';
        
        message += '<b>3. Diagnosticar problemas:</b>\n';
        message += '• Usa /test_handlers para ver el estado actual\n';
        message += '• Usa /test_files para verificar el sistema de archivos\n';
        
        ctx.reply(message, { parse_mode: 'HTML' });
    });
    
    console.log('✅ Handlers de prueba registrados correctamente');
    }