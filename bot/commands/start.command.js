// bot/commands/start.command.js
import { mainMenu, startMenu } from '../views/menu.view.js';

/**
 * Registra el comando start (/start)
 * @param {Object} bot - Instancia del bot
 */
export function registerStartCommand(bot) {
  bot.start(async (ctx) => {
    // 🔍 MÉTRICAS: Medir tiempo total del comando /start
    const startTime = Date.now();
    const telegramId = ctx.from.id;
    
    console.log(`[START_METRICS] Usuario ${telegramId} - Comando /start iniciado`);
    
    try {
      // 🚀 OPTIMIZACIÓN: Eliminar resetState() innecesario
      // El comando /start NO necesita resetear el estado
      
      // 🔍 MÉTRICAS: Medir tiempo de hasTenant
      const tenantCheckStartTime = Date.now();
      const hasTenant = ctx.hasTenant();
      const tenantCheckDuration = Date.now() - tenantCheckStartTime;
      console.log(`[START_METRICS] Usuario ${telegramId} - hasTenant() tomó ${tenantCheckDuration}ms, resultado: ${hasTenant}`);
      
      // 🔍 MÉTRICAS: Medir tiempo de respuesta
      const replyStartTime = Date.now();
      
      // Comprobar si el usuario ya está asociado a un tenant
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
      console.log(`[START_METRICS] Usuario ${telegramId} - reply tomó ${replyDuration}ms`);
      
      // 🔍 MÉTRICAS: Tiempo total
      const totalDuration = Date.now() - startTime;
      console.log(`[START_METRICS] Usuario ${telegramId} - TOTAL /start tomó ${totalDuration}ms`);
      
      // 🔍 MÉTRICAS: Desglose detallado
      console.log(`[START_METRICS] Usuario ${telegramId} - DESGLOSE: tenantCheck=${tenantCheckDuration}ms, reply=${replyDuration}ms, total=${totalDuration}ms`);
      
    } catch (error) {
      const errorDuration = Date.now() - startTime;
      console.error(`[START_METRICS] Usuario ${telegramId} - ERROR después de ${errorDuration}ms:`, error);
      throw error;
    }
  });
}