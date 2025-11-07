/**
 * Process Guard Helper - Blindaje contra doble clic y procesos concurrentes
 *
 * REGLAS DE HOMOLOGACIÓN:
 * - Todos los botones críticos deben estar protegidos
 * - Mensajes consistentes cuando un proceso está activo
 * - Limpieza automática de procesos huérfanos
 */

import type { Context } from 'telegraf';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('ProcessGuard');

export class ProcessGuard {
  /**
   * Verifica si un proceso está activo y responde automáticamente si lo está
   * @returns true si el proceso YA está activo (debe abortar), false si está libre
   */
  static async checkAndBlock(
    ctx: Context,
    processId: string,
    customMessage?: string
  ): Promise<boolean> {
    const isActive = (ctx as any).isProcessActive?.(processId);

    if (isActive) {
      const message =
        customMessage ||
        '⏳ Este proceso ya está en ejecución. Por favor, espere a que termine.';

      try {
        await ctx.answerCbQuery(message);
      } catch (error) {
        logger.debug('No se pudo responder al callback query');
      }

      return true; // Proceso bloqueado
    }

    return false; // Proceso libre
  }

  /**
   * Marca un proceso como activo
   */
  static markActive(ctx: Context, processId: string): void {
    (ctx as any).markProcessActive?.(processId);
    logger.debug(`Proceso marcado como activo: ${processId}`);
  }

  /**
   * Marca un proceso como inactivo
   */
  static markInactive(ctx: Context, processId: string): void {
    (ctx as any).markProcessInactive?.(processId);
    logger.debug(`Proceso marcado como inactivo: ${processId}`);
  }

  /**
   * Ejecuta una función protegida contra ejecución concurrente
   * Uso: await ProcessGuard.execute(ctx, 'process_id', async () => { ... })
   */
  static async execute<T>(
    ctx: Context,
    processId: string,
    fn: () => Promise<T>,
    customBlockedMessage?: string
  ): Promise<T | null> {
    // Verificar si ya está activo
    const isBlocked = await this.checkAndBlock(ctx, processId, customBlockedMessage);
    if (isBlocked) {
      return null; // Proceso bloqueado, retornar null
    }

    // Marcar como activo
    this.markActive(ctx, processId);

    try {
      // Ejecutar la función
      const result = await fn();
      return result;
    } finally {
      // Siempre marcar como inactivo, incluso si hay error
      this.markInactive(ctx, processId);
    }
  }

  /**
   * Remueve los botones de un mensaje para evitar más clics
   */
  static async removeButtons(ctx: Context, silent: boolean = true): Promise<void> {
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (error) {
      if (!silent) {
        logger.warn('No se pudieron remover los botones del mensaje');
      }
    }
  }

  /**
   * Wrapper para actions de Telegraf con protección automática
   * Uso en bot.action():
   * bot.action('my_action', ProcessGuard.wrap('my_action', async (ctx) => { ... }))
   */
  static wrap(
    processId: string,
    handler: (ctx: Context) => Promise<void>,
    customBlockedMessage?: string
  ): (ctx: Context) => Promise<void> {
    return async (ctx: Context) => {
      await this.execute(ctx, processId, () => handler(ctx), customBlockedMessage);
    };
  }

  /**
   * Verifica la validez de un transactionId (para evitar confirmaciones duplicadas)
   */
  static validateTransaction(
    ctx: Context,
    transactionId: string | undefined,
    expectedTransactionId?: string
  ): { valid: boolean; error?: string } {
    if (!transactionId) {
      return {
        valid: false,
        error: 'ID de transacción no encontrado',
      };
    }

    const userState = (ctx as any).userState;

    // Si ya se generó la factura, validar que el transactionId coincida
    if (userState?.facturaGenerada && expectedTransactionId) {
      if (userState.transactionId !== transactionId) {
        return {
          valid: false,
          error: 'Esta solicitud ya no es válida. Por favor, genere una nueva factura.',
        };
      }
    }

    return { valid: true };
  }

  /**
   * Responde al callback query de forma segura
   */
  static async answerCallback(
    ctx: Context,
    message: string = '✓ Seleccionado',
    showAlert: boolean = false
  ): Promise<void> {
    try {
      await ctx.answerCbQuery(message, { show_alert: showAlert });
    } catch (error) {
      logger.debug('No se pudo responder al callback query (no crítico)');
    }
  }

  /**
   * Limpia el estado del usuario de forma segura
   */
  static clearUserState(ctx: Context, keys: string[]): void {
    const userState = (ctx as any).userState;
    if (!userState) return;

    keys.forEach((key) => {
      delete userState[key];
    });

    logger.debug(`Estado del usuario limpiado: ${keys.join(', ')}`);
  }

  /**
   * Establece que el usuario está esperando algo específico
   */
  static setWaitingFor(ctx: Context, waitingFor: string | null): void {
    const userState = (ctx as any).userState;
    if (!userState) return;

    userState.esperando = waitingFor;
    logger.debug(`Usuario esperando: ${waitingFor || 'nada'}`);
  }
}
