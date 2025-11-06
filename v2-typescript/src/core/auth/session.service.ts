// core/auth/session.service.ts
import { prisma } from '../../config/database';
import logger from '../utils/logger';
import redisSessionService from '../../services/redis-session.service';
import facturapiQueueService from '../../services/facturapi-queue.service';

const sessionLogger = logger.child({ module: 'session-service' });

const activeProcesses = new Set<string>();

interface SessionState {
  esperando?: string | null;
  facturaId?: string;
  folioFactura?: number;
  clienteNombre?: string;
  facturaGenerada?: boolean;
  tenantId?: string;
  tenantName?: string;
  userStatus?: string;
  _isPartialState?: boolean;
  [key: string]: any;
}

interface TenantInfo {
  hasTenant: boolean;
  tenantId?: string;
  tenantName?: string;
}

/**
 * Servicio para gestión de sesiones de usuario
 */
class SessionService {
  static sessionCache = new Map<string, any>();
  static pendingWrites = new Map<string, any>();
  static writeTimer: NodeJS.Timeout | null = null;
  static pendingSaves = new Map<string, NodeJS.Timeout>();

  /**
   * Método optimizado para obtener SOLO información de tenant
   */
  static async getTenantOnly(telegramId: bigint | string | number): Promise<TenantInfo> {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);

    const dbStartTime = Date.now();
    sessionLogger.debug(
      { telegramId: telegramIdBigInt.toString() },
      'Obteniendo solo información de tenant'
    );

    try {
      const tenantUser = await prisma.tenantUser.findFirst({
        where: { telegramId: telegramIdBigInt },
        select: {
          tenantId: true,
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
    } catch (error: any) {
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
   */
  static async getUserState(telegramId: bigint | string | number): Promise<SessionState> {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
    const cacheKey = `session:${telegramIdBigInt.toString()}`;

    const redisResult = await redisSessionService.getSession(cacheKey);
    if (redisResult.success) {
      return redisResult.data as SessionState;
    }

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

      await redisSessionService.setSession(cacheKey, session.sessionData as any);

      sessionLogger.debug(
        { telegramId: telegramIdBigInt.toString() },
        'Sesión obtenida correctamente de la base de datos'
      );
      return session.sessionData as SessionState;
    } catch (error: any) {
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
   * Guarda el estado de sesión de un usuario (con cache)
   */
  static async saveUserState(telegramId: bigint | string | number, state: SessionState) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
    const cacheKey = `session:${telegramIdBigInt.toString()}`;

    await redisSessionService.setSession(cacheKey, state as any);

    const isImportantState = state.facturaGenerada || state.esperando || !state.tenantId;

    if (!isImportantState) {
      console.log(
        `[SESSION_SKIP] Saltando DB write para estado temporal de usuario ${telegramIdBigInt}`
      );
      return { sessionData: state };
    }

    const queueKey = `save-user-state-${telegramIdBigInt.toString()}`;

    if (this.pendingSaves) {
      const existingTimeout = this.pendingSaves.get(queueKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.pendingSaves.delete(queueKey);
      }
    } else {
      this.pendingSaves = new Map();
    }

    const timeoutId = setTimeout(() => {
      facturapiQueueService.enqueue(
        () => this.saveUserStateImmediate(telegramId, state),
        'save-user-state',
        { telegramId: telegramIdBigInt.toString() }
      );
      this.pendingSaves.delete(queueKey);
    }, 2000);

    this.pendingSaves.set(queueKey, timeoutId);

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
   * Guarda el estado original (sin cache)
   */
  static async saveUserStateImmediate(telegramId: bigint | string | number, state: SessionState) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);

    const dbStartTime = Date.now();
    sessionLogger.debug({ telegramId: telegramIdBigInt.toString() }, 'Guardando estado de sesión');

    try {
      const session = await prisma.userSession.upsert({
        where: { telegramId: telegramIdBigInt },
        update: {
          sessionData: state as any,
          updatedAt: new Date(),
        },
        create: {
          telegramId: telegramIdBigInt,
          sessionData: state as any,
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
    } catch (error: any) {
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
   * Reinicia el estado de un usuario pero preserva datos importantes
   */
  static async resetUserState(telegramId: bigint | string | number): Promise<SessionState> {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);

    const resetStartTime = Date.now();
    sessionLogger.debug(
      { telegramId: telegramIdBigInt.toString() },
      'Reiniciando estado de sesión'
    );

    try {
      const getCurrentStateStartTime = Date.now();
      const currentState = await this.getUserState(telegramIdBigInt);
      const getCurrentStateDuration = Date.now() - getCurrentStateStartTime;
      console.log(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - getCurrentState en resetUserState tomó ${getCurrentStateDuration}ms`
      );

      const prepareStateStartTime = Date.now();

      const newState: SessionState = {
        esperando: null,
        ...(currentState.facturaId && { facturaId: currentState.facturaId }),
        ...(currentState.folioFactura && { folioFactura: currentState.folioFactura }),
        ...(currentState.clienteNombre && { clienteNombre: currentState.clienteNombre }),
        ...(currentState.facturaGenerada && { facturaGenerada: currentState.facturaGenerada }),
        ...(currentState.tenantId && { tenantId: currentState.tenantId }),
        ...(currentState.tenantName && { tenantName: currentState.tenantName }),
        ...(currentState.userStatus && { userStatus: currentState.userStatus }),
      };

      const prepareStateDuration = Date.now() - prepareStateStartTime;
      console.log(
        `[SESSION_METRICS] Usuario ${telegramIdBigInt} - prepareState en resetUserState tomó ${prepareStateDuration}ms`
      );

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

      sessionLogger.debug(
        { telegramId: telegramIdBigInt.toString() },
        'Estado de sesión reiniciado'
      );
      return newState;
    } catch (error: any) {
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

  static isProcessActive(processId: string): boolean {
    return activeProcesses.has(processId);
  }

  static markProcessActive(processId: string): void {
    sessionLogger.debug({ processId }, 'Marcando proceso como activo');
    activeProcesses.add(processId);
  }

  static markProcessInactive(processId: string): void {
    sessionLogger.debug({ processId }, 'Marcando proceso como inactivo');
    activeProcesses.delete(processId);
  }

  static isSignificantStateChange(oldState: SessionState, newState: SessionState): boolean {
    const significantFields = ['esperando', 'facturaGenerada', 'tenantId', 'userStatus'];
    return significantFields.some((field) => oldState[field] !== newState[field]);
  }

  /**
   * Crea un middleware para la sesión de Telegram
   */
  static createMiddleware() {
    return async (ctx: any, next: () => Promise<void>) => {
      const userId = ctx.from?.id;
      if (!userId) return next();

      const isStartCommand =
        ctx.message?.text === '/start' || ctx.message?.text?.startsWith('/start ');

      let userState: SessionState;
      if (isStartCommand) {
        const tenantInfo = await this.getTenantOnly(userId);

        userState = { esperando: null };

        if (tenantInfo.hasTenant) {
          userState.tenantId = tenantInfo.tenantId;
          userState.tenantName = tenantInfo.tenantName;
          userState.userStatus = 'authorized';
        }

        userState._isPartialState = true;
      } else {
        userState = await this.getUserState(userId);
      }

      ctx.userState = userState;

      ctx.resetState = async () => await this.resetUserState(userId);

      ctx.loadFullState = async () => {
        if (ctx.userState._isPartialState) {
          sessionLogger.debug({ telegramId: userId }, 'Cargando estado completo desde estado parcial');
          ctx.userState = await this.getUserState(userId);
          return true;
        }
        return false;
      };

      ctx.isProcessActive = (processId: string) => this.isProcessActive(processId);
      ctx.markProcessActive = (processId: string) => this.markProcessActive(processId);
      ctx.markProcessInactive = (processId: string) => this.markProcessInactive(processId);

      const initialState = JSON.stringify(ctx.userState);

      try {
        await next();
      } finally {
        if (
          ctx.userState &&
          !ctx.userState._isPartialState &&
          JSON.stringify(ctx.userState) !== initialState
        ) {
          const isSignificantChange = this.isSignificantStateChange(
            JSON.parse(initialState || '{}'),
            ctx.userState
          );

          if (isSignificantChange) {
            sessionLogger.debug({ telegramId: userId }, 'Guardando estado actualizado');
            await this.saveUserState(userId, ctx.userState);
          } else {
            sessionLogger.debug({ telegramId: userId }, 'Cambio menor, saltando DB write');
            await redisSessionService.setSession(`session:${userId}`, ctx.userState);
          }
        }
      }
    };
  }
}

const sessionMiddleware = SessionService.createMiddleware();

export { SessionService, sessionMiddleware };
export default SessionService;
