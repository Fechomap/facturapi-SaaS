import type { BotContext } from '../../types/bot.types.js';
import type { Bot } from '../../types/bot.types.js';
import { createModuleLogger } from '@core/utils/logger.js';
import { mainMenu, startMenu, persistentKeyboard } from '../views/menu.view.js';

const logger = createModuleLogger('start-command');

/**
 * Lógica principal del comando start/menu
 */
async function executeStartLogic(
  ctx: BotContext,
  source: 'start' | 'menu' = 'start'
): Promise<void> {
  // Medir tiempo total
  const startTime = Date.now();
  const telegramId = ctx.from?.id;

  logger.info({ source: source.toUpperCase(), telegramId }, 'Comando iniciado');

  try {
    // Limpieza de estado: Limpiar cualquier estado pendiente para empezar desde cero
    if (ctx.userState?.esperando) {
      logger.debug(
        { source: source.toUpperCase(), estado: ctx.userState.esperando },
        'Limpiando estado pendiente'
      );
      ctx.userState.esperando = null;
    }

    // Limpiar datos temporales de facturas y flujos (preservando tenant info)
    const statesToClean = [
      'numeroPedido',
      'claveProducto',
      'monto',
      'clienteNombre',
      'clienteId',
      'facturaId',
      'folioFactura',
      'facturaGenerada',
      'facturaIdCancelar',
      'folioFacturaCancelar',
      'axaData',
      'chubbGrupos',
      'pdfAnalysis',
      'selectedClientId',
      'selectedClientName',
      'invoiceData',
      'currentStep',
    ];

    statesToClean.forEach((state) => {
      if (ctx.userState?.[state]) {
        delete ctx.userState[state];
      }
    });

    logger.debug(
      { source: source.toUpperCase() },
      'Estado limpiado, usuario puede operar desde cero'
    );

    // Usar directamente la información de tenant que ya fue cargada por el middleware
    // Evitamos completamente una consulta adicional a la base de datos

    // Verificar si hay tenant (instantáneo, sin consulta DB)
    const tenantCheckStartTime = Date.now();
    const hasTenant = !!ctx.userState?.tenantId;
    const tenantCheckDuration = Date.now() - tenantCheckStartTime;
    logger.debug(
      { source: source.toUpperCase(), telegramId, duration: tenantCheckDuration, hasTenant },
      'Verificación de tenant completada'
    );

    // Medir tiempo de respuesta
    const replyStartTime = Date.now();

    // Primero establecer el teclado persistente (solo en /start, no en MENU)
    if (source === 'start') {
      await ctx.reply('🔧 Configurando interfaz...', persistentKeyboard());
    }

    // Luego mostrar el menú según el estado del usuario
    if (hasTenant) {
      await ctx.reply(
        `¡Bienvenido de nuevo, ${ctx.from?.first_name}!\nEstás conectado como usuario de ${ctx.userState.tenantName}.\nSelecciona una opción:`,
        mainMenu()
      );
    } else {
      await ctx.reply(
        `¡Bienvenido al Sistema de Facturación, ${ctx.from?.first_name}!\n\n` +
          `Para comenzar a utilizar el sistema, necesitas crear una organización en FacturAPI y luego registrar tu empresa.\n\n` +
          `Usa el botón "Crear organización" para comenzar o "Más información" para conocer los planes disponibles.`,
        startMenu()
      );
    }

    const replyDuration = Date.now() - replyStartTime;
    const totalDuration = Date.now() - startTime;

    logger.info(
      {
        source: source.toUpperCase(),
        telegramId,
        tenantCheck: tenantCheckDuration,
        reply: replyDuration,
        total: totalDuration,
      },
      'Comando completado exitosamente'
    );
  } catch (error) {
    const errorDuration = Date.now() - startTime;
    logger.error(
      { source: source.toUpperCase(), telegramId, duration: errorDuration, error },
      'Error en comando'
    );
    throw error;
  }
}

/**
 * Registra el comando start (/start) y el handler del botón MENU
 * @param bot - Instancia del bot
 */
export function registerStartCommand(bot: Bot): void {
  // Comando /start
  bot.start(async (ctx: BotContext) => {
    await executeStartLogic(ctx, 'start');
  });

  // Handler para el botón persistente MENU - ejecuta exactamente la misma lógica
  bot.hears('📱 MENU', async (ctx: BotContext) => {
    await executeStartLogic(ctx, 'menu');
  });
}
