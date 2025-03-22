// core/auth/session.service.js
import { prisma } from '../../config/database.js';
import logger from '../utils/logger.js';

// Logger específico para el servicio de sesión
const sessionLogger = logger.child({ module: 'session-service' });

// Conjunto para rastrear acciones en progreso (evitar clics duplicados)
const activeProcesses = new Set();

/**
 * Servicio para gestión de sesiones de usuario
 */
class SessionService {
  /**
   * Obtiene el estado de sesión de un usuario
   * @param {BigInt|string|number} telegramId - ID de Telegram del usuario
   * @returns {Promise<Object>} - Estado de la sesión
   */
  static async getUserState(telegramId) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
    sessionLogger.debug({ telegramId: telegramIdBigInt.toString() }, 'Obteniendo estado de sesión');
    
    try {
      const session = await prisma.userSession.findUnique({
        where: { telegramId: telegramIdBigInt }
      });

      if (!session) {
        sessionLogger.debug({ telegramId: telegramIdBigInt.toString() }, 'Sesión no encontrada, devolviendo estado inicial');
        return { esperando: null };
      }

      sessionLogger.debug({ telegramId: telegramIdBigInt.toString() }, 'Sesión obtenida correctamente');
      return session.sessionData;
    } catch (error) {
      sessionLogger.error({ error, telegramId: telegramIdBigInt.toString() }, 'Error al obtener estado de sesión');
      return { esperando: null };
    }
  }

  /**
   * Guarda el estado de sesión de un usuario
   * @param {BigInt|string|number} telegramId - ID de Telegram del usuario
   * @param {Object} state - Estado a guardar
   * @returns {Promise<Object>} - Sesión actualizada
   */
  static async saveUserState(telegramId, state) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
    sessionLogger.debug({ telegramId: telegramIdBigInt.toString() }, 'Guardando estado de sesión');
    
    try {
      const session = await prisma.userSession.upsert({
        where: { telegramId: telegramIdBigInt },
        update: {
          sessionData: state,
          updatedAt: new Date()
        },
        create: {
          telegramId: telegramIdBigInt,
          sessionData: state
        }
      });

      sessionLogger.debug({ telegramId: telegramIdBigInt.toString() }, 'Estado de sesión guardado correctamente');
      return session;
    } catch (error) {
      sessionLogger.error({ error, telegramId: telegramIdBigInt.toString() }, 'Error al guardar estado de sesión');
      throw error;
    }
  }

  /**
   * Reinicia el estado de un usuario pero preserva datos de factura y tenant
   * @param {BigInt|string|number} telegramId - ID de Telegram del usuario
   * @returns {Promise<Object>} - Nuevo estado
   */
  static async resetUserState(telegramId) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
    sessionLogger.debug({ telegramId: telegramIdBigInt.toString() }, 'Reiniciando estado de sesión');
    
    try {
      const currentState = await this.getUserState(telegramIdBigInt);
      
      // Crear un nuevo estado preservando ciertos datos
      const newState = {
        esperando: null,
        // Preservar estos datos si existen
        facturaId: currentState.facturaId,
        folioFactura: currentState.folioFactura,
        clienteNombre: currentState.clienteNombre,
        facturaGenerada: currentState.facturaGenerada,
        // Preservar datos relacionados con el tenant
        tenantId: currentState.tenantId,
        tenantName: currentState.tenantName,
        userStatus: currentState.userStatus
      };
    
      await this.saveUserState(telegramIdBigInt, newState);
      sessionLogger.debug({ telegramId: telegramIdBigInt.toString() }, 'Estado de sesión reiniciado');
      return newState;
    } catch (error) {
      sessionLogger.error({ error, telegramId: telegramIdBigInt.toString() }, 'Error al reiniciar estado de sesión');
      throw error;
    }
  }

  /**
   * Verifica si un proceso está activo
   * @param {string} processId - ID del proceso
   * @returns {boolean} - true si está activo
   */
  static isProcessActive(processId) {
    return activeProcesses.has(processId);
  }

  /**
   * Marca un proceso como activo
   * @param {string} processId - ID del proceso
   */
  static markProcessActive(processId) {
    sessionLogger.debug({ processId }, 'Marcando proceso como activo');
    activeProcesses.add(processId);
  }

  /**
   * Marca un proceso como inactivo
   * @param {string} processId - ID del proceso
   */
  static markProcessInactive(processId) {
    sessionLogger.debug({ processId }, 'Marcando proceso como inactivo');
    activeProcesses.delete(processId);
  }

  /**
   * Crea un middleware para la sesión de Telegram
   * @returns {Function} - Middleware de Telegraf
   */
  static createMiddleware() {
    return async (ctx, next) => {
      // Asegurar que el ID del usuario esté disponible
      const userId = ctx.from?.id;
      if (!userId) return next();
      
      // Obtener el estado del usuario
      const userState = await this.getUserState(userId);
      
      // Añadir el estado del usuario al contexto
      ctx.userState = userState;
      
      // Añadir funciones de utilidad
      ctx.resetState = async () => await this.resetUserState(userId);
      
      // Añadir funciones para manejo de procesos activos
      ctx.isProcessActive = (processId) => this.isProcessActive(processId);
      ctx.markProcessActive = (processId) => this.markProcessActive(processId);
      ctx.markProcessInactive = (processId) => this.markProcessInactive(processId);
      
      // Guardar el estado actual para comparar después
      const initialState = JSON.stringify(ctx.userState);
      
      try {
        // Manejar la solicitud actual
        await next();
      } finally {
        // Guardar el estado después de procesar la solicitud
        // Solo si ha cambiado para evitar sobrescrituras innecesarias
        if (ctx.userState && JSON.stringify(ctx.userState) !== initialState) {
          sessionLogger.debug({ telegramId: userId }, 'Guardando estado actualizado');
          await this.saveUserState(userId, ctx.userState);
        }
      }
    };
  }
}

// Crear una instancia del middleware
const sessionMiddleware = SessionService.createMiddleware();

// Exportar el servicio y el middleware
export { SessionService, sessionMiddleware };
export default SessionService;