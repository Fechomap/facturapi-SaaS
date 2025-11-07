/**
 * Test Handlers - Comandos de diagnóstico
 * Migrado a TypeScript V2
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Context } from 'telegraf';
import { createModuleLogger } from '@core/utils/logger.js';

const logger = createModuleLogger('TestHandlers');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, '../../../temp');

/**
 * Registra comandos de prueba para diagnóstico
 */
export function registerTestHandlers(bot: any): void {
  // Comando para verificar el estado de los handlers
  bot.command('test_handlers', async (ctx: Context) => {
    logger.info({ userId: ctx.from?.id }, 'Test de handlers iniciado');

    const userState = (ctx as any).userState;
    logger.debug({ userState }, 'Estado completo del usuario');

    const setupState = userState?.productionSetup?.state || 'No inicializado';
    const tenantId = (ctx as any).getTenantId?.() || 'No disponible';

    let message = '<b>📊 Diagnóstico de Handlers</b>\n\n';
    message += `• Estado productionSetup: ${setupState}\n`;
    message += `• Tenant ID: ${tenantId}\n`;

    // Verificar directorio temporal
    try {
      await fs.access(TEMP_DIR);
      message += '• Directorio temporal: ✅ Existe\n';

      // Verificar permisos
      try {
        const testFile = path.join(TEMP_DIR, 'test.txt');
        await fs.writeFile(testFile, 'Test', 'utf8');
        await fs.unlink(testFile);
        message += '• Permisos escritura: ✅ Correctos\n';
      } catch (error) {
        message += '• Permisos escritura: ❌ Error\n';
        logger.error({ error }, 'Error verificando permisos');
      }
    } catch {
      message += '• Directorio temporal: ❌ No existe\n';
    }

    // Verificar variables de entorno
    message += `• FACTURAPI_USER_KEY: ${process.env.FACTURAPI_USER_KEY ? '✅ Configurada' : '❌ No configurada'}\n`;
    message += `• ADMIN_CHAT_IDS: ${process.env.ADMIN_CHAT_IDS ? '✅ Configurada' : '❌ No configurada'}\n`;

    await ctx.reply(message, { parse_mode: 'HTML' });
  });

  // Comando para reiniciar el estado de configuración
  bot.command('reset_setup', async (ctx: Context) => {
    logger.info({ userId: ctx.from?.id }, 'Reinicio de estado de configuración');

    const userState = (ctx as any).userState;
    const tenantId = (ctx as any).getTenantId?.();

    if (!tenantId) {
      await ctx.reply('❌ No tienes un tenant asignado. No se puede reiniciar la configuración.');
      return;
    }

    if (userState?.productionSetup) {
      delete userState.productionSetup;
      await ctx.reply('✅ Estado de configuración productiva reiniciado correctamente.');
    } else {
      await ctx.reply('ℹ️ No había estado de configuración activo para reiniciar.');
    }

    logger.debug({ userState }, 'Nuevo estado después del reinicio');
  });

  // Comando para forzar el estado inicial
  bot.command('force_setup', async (ctx: Context) => {
    logger.info({ userId: ctx.from?.id }, 'Forzando estado inicial de configuración');

    const hasTenant = (ctx as any).hasTenant?.();
    if (!hasTenant) {
      await ctx.reply('❌ No tienes un tenant asignado. No se puede forzar la configuración.');
      return;
    }

    try {
      const tenantId = (ctx as any).getTenantId();

      const { default: TenantService } = await import('@services/tenant.service.js');
      const tenant = await TenantService.findTenantWithSubscription(tenantId);

      if (!tenant) {
        await ctx.reply('❌ No se pudo obtener la información del tenant.');
        return;
      }

      (ctx as any).userState.productionSetup = {
        state: 'awaiting_cer',
        tenantId: tenant.id,
        orgId: tenant.facturapiOrganizationId,
        businessName: tenant.businessName,
        rfc: tenant.rfc,
      };

      logger.debug({ productionSetup: (ctx as any).userState.productionSetup }, 'Estado forzado');

      await ctx.reply(
        '✅ Estado de configuración forzado correctamente.\n\n' +
          'Por favor, envía ahora el archivo .cer para continuar con el proceso.'
      );
    } catch (error) {
      logger.error({ error }, 'Error al forzar estado');
      await ctx.reply('❌ Error al forzar el estado de configuración.');
    }
  });

  // Comando para verificar sistema de archivos
  bot.command('test_files', async (ctx: Context) => {
    logger.info({ userId: ctx.from?.id }, 'Test de sistema de archivos iniciado');

    try {
      // Verificar o crear directorio temporal
      try {
        await fs.access(TEMP_DIR);
        await ctx.reply('✅ Directorio temporal existente: ' + TEMP_DIR);
      } catch {
        await fs.mkdir(TEMP_DIR, { recursive: true });
        await ctx.reply('✅ Directorio temporal creado: ' + TEMP_DIR);
      }

      // Crear archivo de prueba
      const testFile = path.join(TEMP_DIR, 'test.txt');
      await fs.writeFile(testFile, 'Test file created at ' + new Date().toISOString(), 'utf8');
      await ctx.reply('✅ Archivo de prueba creado: ' + testFile);

      // Leer archivo de prueba
      const content = await fs.readFile(testFile, 'utf8');
      await ctx.reply('✅ Contenido leído: ' + content);

      // Eliminar archivo de prueba
      await fs.unlink(testFile);
      await ctx.reply('✅ Archivo de prueba eliminado correctamente');
    } catch (error) {
      logger.error({ error }, 'Error en test de archivos');
      await ctx.reply(
        `❌ Error en test de archivos: ${error instanceof Error ? error.message : 'Error desconocido'}`
      );
    }
  });

  // Comando de ayuda
  bot.command('help_setup', async (ctx: Context) => {
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

    await ctx.reply(message, { parse_mode: 'HTML' });
  });

  logger.info('✅ Handlers de prueba (V2 TypeScript) registrados correctamente');
}

export default registerTestHandlers;
