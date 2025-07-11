// core/auth/session.service.js
import { prisma } from '../../config/database.js';
import logger from '../utils/logger.js';
import redisSessionService from '../../services/redis-session.service.js';
import facturapiQueueService from '../../services/facturapi-queue.service.js';

// Logger específico para el servicio de sesión
const sessionLogger = logger.child({ module: 'session-service' });

// Conjunto para rastrear acciones en progreso (evitar clics duplicados)
const activeProcesses = new Set();

/**
 * Servicio para gestión de sesiones de usuario
 */
class SessionService {
  /**
   * Método optimizado para obtener SOLO información de tenant
   * Usado principalmente por el comando /start para mejorar rendimiento
   * @param {BigInt|string|number} telegramId - ID de Telegram del usuario
   * @returns {Promise<Object>} - Solo información de tenant {tenantId, tenantName}
   */
  static async getTenantOnly(telegramId) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);

    // 🔍 MÉTRICAS: Medir tiempo de consulta DB optimizada
    const dbStartTime = Date.now();
    sessionLogger.debug(
      { telegramId: telegramIdBigInt.toString() },
      'Obteniendo solo información de tenant'
    );

    try {
      // Consulta directa a la tabla tenant_user para mayor rendimiento
      const tenantUser = await prisma.tenantUser.findUnique({
        where: { telegramId: telegramIdBigInt },
        select: {
          tenant: {
            select: {
              id: true,
              businessName: true,
            },
          },
        },
      });

      const dbDuration = Date.now() - dbStartTime;
      console.log(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - DB query getTenantOnly tomó ${dbDuration}ms`
      );

      if (!tenantUser || !tenantUser.tenant) {
        return { hasTenant: false };
      }

      return {
        hasTenant: true,
        tenantId: tenantUser.tenant.id,
        tenantName: tenantUser.tenant.businessName,
      };
    } catch (error) {
      const dbDuration = Date.now() - dbStartTime;
      console.error(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - DB query getTenantOnly ERROR después de ${dbDuration}ms:`,
        error
      );
      sessionLogger.error(
        { error, telegramId: telegramIdBigInt.toString() },
        'Error al obtener información de tenant'
      );
      return { hasTenant: false };
    }
  }

  /**
   * Obtiene el estado de sesión de un usuario
   * @param {BigInt|string|number} telegramId - ID de Telegram del usuario
   * @returns {Promise<Object>} - Estado de la sesión
   */
  static async getUserState(telegramId) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
    const cacheKey = `session:${telegramIdBigInt.toString()}`;

    // Intentar obtener la sesión de Redis
    const redisResult = await redisSessionService.getSession(cacheKey);
    if (redisResult.success) {
      return redisResult.data;
    }

    // Si no está en Redis, obtener de la base de datos
    const dbStartTime = Date.now();
    sessionLogger.debug(
      { telegramId: telegramIdBigInt.toString() },
      'Obteniendo estado de sesión de la base de datos'
    );

    try {
      const session = await prisma.userSession.findUnique({
        where: { telegramId: telegramIdBigInt },
      });

      const dbDuration = Date.now() - dbStartTime;
      console.log(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - DB query getUserState tomó ${dbDuration}ms`
      );

      if (!session) {
        sessionLogger.debug(
          { telegramId: telegramIdBigInt.toString() },
          'Sesión no encontrada, devolviendo estado inicial'
        );
        return { esperando: null };
      }

      // Guardar en Redis para futuras solicitudes
      await redisSessionService.setSession(cacheKey, session.sessionData);

      sessionLogger.debug(
        { telegramId: telegramIdBigInt.toString() },
        'Sesión obtenida correctamente de la base de datos'
      );
      return session.sessionData;
    } catch (error) {
      const dbDuration = Date.now() - dbStartTime;
      console.error(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - DB query getUserState ERROR después de ${dbDuration}ms:`,
        error
      );
      sessionLogger.error(
        { error, telegramId: telegramIdBigInt.toString() },
        'Error al obtener estado de sesión'
      );
      return { esperando: null };
    }
  }

  /**
   * Cache en memoria para reducir escrituras a DB
   */
  static sessionCache = new Map();
  static pendingWrites = new Map();
  static writeTimer = null;

  /**
   * Guarda el estado de sesión de un usuario (con cache)
   * @param {BigInt|string|number} telegramId - ID de Telegram del usuario
   * @param {Object} state - Estado a guardar
   * @returns {Promise<Object>} - Sesión actualizada
   */
  static async saveUserState(telegramId, state) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
    const cacheKey = `session:${telegramIdBigInt.toString()}`;

    // Guardar en Redis
    await redisSessionService.setSession(cacheKey, state);

    // Encolar el guardado en la base de datos
    facturapiQueueService.enqueue(
      () => this.saveUserStateImmediate(telegramId, state),
      'save-user-state',
      { telegramId: telegramIdBigInt.toString() }
    );

    return { sessionData: state };
  }

  /**
   * Escribe todas las sesiones pendientes a la DB
   */
  static async flushPendingWrites() {
    if (this.pendingWrites.size === 0) return;

    const writes = Array.from(this.pendingWrites.entries());
    this.pendingWrites.clear();
    this.writeTimer = null;

    console.log(`[SESSION_BATCH] Escribiendo ${writes.length} sesiones a DB`);
    const startTime = Date.now();

    // Escribir en paralelo con límite
    const batchSize = 5;
    for (let i = 0; i < writes.length; i += batchSize) {
      const batch = writes.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async ([_, { telegramIdBigInt, state }]) => {
          try {
            await prisma.userSession.upsert({
              where: { telegramId: telegramIdBigInt },
              update: {
                sessionData: state,
                updatedAt: new Date(),
              },
              create: {
                telegramId: telegramIdBigInt,
                sessionData: state,
              },
            });
          } catch (error) {
            console.error(`Error guardando sesión ${telegramIdBigInt}:`, error);
          }
        })
      );
    }

    const duration = Date.now() - startTime;
    console.log(`[SESSION_BATCH] ${writes.length} sesiones escritas en ${duration}ms`);
  }

  /**
   * Guarda el estado original (sin cache) para compatibilidad
   */
  static async saveUserStateImmediate(telegramId, state) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);

    // 🔍 MÉTRICAS: Medir tiempo de escritura DB
    const dbStartTime = Date.now();
    sessionLogger.debug({ telegramId: telegramIdBigInt.toString() }, 'Guardando estado de sesión');

    try {
      // 🚀 SOLUCIÓN DEFINITIVA: UPSERT con retry y timeout
      const session = await prisma.userSession.upsert({
        where: { telegramId: telegramIdBigInt },
        update: {
          sessionData: state,
          updatedAt: new Date(),
        },
        create: {
          telegramId: telegramIdBigInt,
          sessionData: state,
        },
      });

      const dbDuration = Date.now() - dbStartTime;
      console.log(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - DB upsert saveUserState tomó ${dbDuration}ms`
      );

      sessionLogger.debug(
        { telegramId: telegramIdBigInt.toString() },
        'Estado de sesión guardado correctamente'
      );
      return session;
    } catch (error) {
      const dbDuration = Date.now() - dbStartTime;
      console.error(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - DB upsert saveUserState ERROR después de ${dbDuration}ms:`,
        error
      );
      sessionLogger.error(
        { error, telegramId: telegramIdBigInt.toString() },
        'Error al guardar estado de sesión'
      );
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

    // 🔍 MÉTRICAS: Medir tiempo total de resetUserState
    const resetStartTime = Date.now();
    sessionLogger.debug(
      { telegramId: telegramIdBigInt.toString() },
      'Reiniciando estado de sesión'
    );

    try {
      // 🔍 MÉTRICAS: Medir tiempo de getCurrentState
      const getCurrentStateStartTime = Date.now();
      const currentState = await this.getUserState(telegramIdBigInt);
      const getCurrentStateDuration = Date.now() - getCurrentStateStartTime;
      console.log(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - getCurrentState en resetUserState tomó ${getCurrentStateDuration}ms`
      );

      // 🔍 MÉTRICAS: Medir tiempo de preparación de estado
      const prepareStateStartTime = Date.now();

      // 🚀 OPTIMIZACIÓN: Crear estado mínimo para reducir serialización JSON
      const newState = {
        esperando: null,
        // Preservar solo datos esenciales (reducir payload)
        ...(currentState.facturaId && { facturaId: currentState.facturaId }),
        ...(currentState.folioFactura && { folioFactura: currentState.folioFactura }),
        ...(currentState.clienteNombre && { clienteNombre: currentState.clienteNombre }),
        ...(currentState.facturaGenerada && { facturaGenerada: currentState.facturaGenerada }),
        // Preservar datos relacionados con el tenant
        ...(currentState.tenantId && { tenantId: currentState.tenantId }),
        ...(currentState.tenantName && { tenantName: currentState.tenantName }),
        ...(currentState.userStatus && { userStatus: currentState.userStatus }),
      };

      const prepareStateDuration = Date.now() - prepareStateStartTime;
      console.log(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - prepareState en resetUserState tomó ${prepareStateDuration}ms`
      );

      // 🔍 MÉTRICAS: Medir tiempo de saveUserState
      const saveStateStartTime = Date.now();
      await this.saveUserState(telegramIdBigInt, newState);
      const saveStateDuration = Date.now() - saveStateStartTime;
      console.log(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - saveUserState en resetUserState tomó ${saveStateDuration}ms`
      );

      const totalResetDuration = Date.now() - resetStartTime;
      console.log(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - resetUserState TOTAL tomó ${totalResetDuration}ms`
      );
      console.log(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - resetUserState DESGLOSE: getCurrentState=${getCurrentStateDuration}ms, prepareState=${prepareStateDuration}ms, saveState=${saveStateDuration}ms, total=${totalResetDuration}ms`
      );

      sessionLogger.debug(
        { telegramId: telegramIdBigInt.toString() },
        'Estado de sesión reiniciado'
      );
      return newState;
    } catch (error) {
      const totalResetDuration = Date.now() - resetStartTime;
      console.error(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - resetUserState ERROR después de ${totalResetDuration}ms:`,
        error
      );
      sessionLogger.error(
        { error, telegramId: telegramIdBigInt.toString() },
        'Error al reiniciar estado de sesión'
      );
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

      // 🚀 OPTIMIZACIÓN: Detectar el comando /start para usar la consulta optimizada
      const isStartCommand =
        ctx.message?.text === '/start' || ctx.message?.text?.startsWith('/start ');

      let userState;
      if (isStartCommand) {
        // Para el comando /start, no cargar todo el estado sino solo la información de tenant
        // Esta información será suficiente para decidir qué menú mostrar
        const tenantInfo = await this.getTenantOnly(userId);

        // Inicializar un estado mínimo con la información de tenant
        userState = { esperando: null };

        // Si hay un tenant, añadir la información al estado
        if (tenantInfo.hasTenant) {
          userState.tenantId = tenantInfo.tenantId;
          userState.tenantName = tenantInfo.tenantName;
          userState.userStatus = 'authorized'; // Asumimos que si hay tenant, el usuario está autorizado
        }

        // Marcar que este estado es parcial para poder cargarlo completamente si es necesario después
        userState._isPartialState = true;
      } else {
        // Para otros comandos, cargar el estado completo como siempre
        userState = await this.getUserState(userId);
      }

      // Añadir el estado del usuario al contexto
      ctx.userState = userState;

      // Añadir funciones de utilidad
      ctx.resetState = async () => await this.resetUserState(userId);

      // Añadir función para cargar el estado completo si es necesario
      ctx.loadFullState = async () => {
        if (ctx.userState._isPartialState) {
          sessionLogger.debug(
            { telegramId: userId },
            'Cargando estado completo desde estado parcial'
          );
          ctx.userState = await this.getUserState(userId);
          return true;
        }
        return false;
      };

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
        // Y solo si no es un estado parcial (para evitar sobrescribir datos importantes)
        if (
          ctx.userState &&
          !ctx.userState._isPartialState &&
          JSON.stringify(ctx.userState) !== initialState
        ) {
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
