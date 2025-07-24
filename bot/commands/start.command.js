// bot/commands/start.command.js
import { mainMenu, startMenu, persistentKeyboard } from '../views/menu.view.js';

/**
 * Lógica principal del comando start/menu
 */
async function executeStartLogic(ctx, source = 'start') {
  // 🔍 MÉTRICAS: Medir tiempo total
  const startTime = Date.now();
  const telegramId = ctx.from.id;

  console.log(`[${source.toUpperCase()}_METRICS] Usuario ${telegramId} - Comando iniciado`);

  try {
    // 🚀 SUPER OPTIMIZACIÓN: Usar directamente la información de tenant que ya fue cargada por el middleware
    // Evitamos completamente una consulta adicional a la base de datos

    // 🔍 MÉTRICAS: Verificar si hay tenant (instantáneo, sin consulta DB)
    const tenantCheckStartTime = Date.now();
    const hasTenant = !!ctx.userState?.tenantId;
    const tenantCheckDuration = Date.now() - tenantCheckStartTime;
    console.log(
      `[${source.toUpperCase()}_METRICS] Usuario ${telegramId} - verificar tenant tomó ${tenantCheckDuration}ms, resultado: ${hasTenant}`
    );

    // 🔍 MÉTRICAS: Medir tiempo de respuesta
    const replyStartTime = Date.now();

    // Primero establecer el teclado persistente (solo en /start, no en MENU)
    if (source === 'start') {
      await ctx.reply('🔧 Configurando interfaz...', persistentKeyboard());
    }

    // Luego mostrar el menú según el estado del usuario
    if (hasTenant) {
      await ctx.reply(
        `¡Bienvenido de nuevo, ${ctx.from.first_name}!\nEstás conectado como usuario de ${ctx.userState.tenantName}.\nSelecciona una opción:`,
        mainMenu()
      );
    } else {
      await ctx.reply(
        `¡Bienvenido al Sistema de Facturación, ${ctx.from.first_name}!\n\n` +
          `Para comenzar a utilizar el sistema, necesitas crear una organización en FacturAPI y luego registrar tu empresa.\n\n` +
          `Usa el botón "Crear organización" para comenzar o "Más información" para conocer los planes disponibles.`,
        startMenu()
      );
    }

    const replyDuration = Date.now() - replyStartTime;
    console.log(`[${source.toUpperCase()}_METRICS] Usuario ${telegramId} - reply tomó ${replyDuration}ms`);

    // 🔍 MÉTRICAS: Tiempo total
    const totalDuration = Date.now() - startTime;
    console.log(`[${source.toUpperCase()}_METRICS] Usuario ${telegramId} - TOTAL tomó ${totalDuration}ms`);

    // 🔍 MÉTRICAS: Desglose detallado
    console.log(
      `[${source.toUpperCase()}_METRICS] Usuario ${telegramId} - DESGLOSE: tenantCheck=${tenantCheckDuration}ms, reply=${replyDuration}ms, total=${totalDuration}ms`
    );
  } catch (error) {
    const errorDuration = Date.now() - startTime;
    console.error(
      `[${source.toUpperCase()}_METRICS] Usuario ${telegramId} - ERROR después de ${errorDuration}ms:`,
      error
    );
    throw error;
  }
}

/**
 * Registra el comando start (/start) y el handler del botón MENU
 * @param {Object} bot - Instancia del bot
 */
export function registerStartCommand(bot) {
  // Comando /start
  bot.start(async (ctx) => {
    await executeStartLogic(ctx, 'start');
  });

  // Handler para el botón persistente MENU - ejecuta exactamente la misma lógica
  bot.hears('📱 MENU', async (ctx) => {
    await executeStartLogic(ctx, 'menu');
  });
}
