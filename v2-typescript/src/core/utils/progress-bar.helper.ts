/**
 * Progress Bar Helper - Estandarización de barras de progreso
 *
 * REGLAS DE HOMOLOGACIÓN:
 * - Usar los mismos frames de animación en todos los procesos
 * - Mismas barras de progreso visuales
 * - Manejo consistente de errores de edición de mensajes
 */

import type { Context } from 'telegraf';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('ProgressBarHelper');

export class ProgressBar {
  // Frames de animación estandarizados
  private static readonly PROGRESS_FRAMES = ['⏳', '⌛', '⏳', '⌛'];

  // Barras de progreso visuales estandarizadas
  private static readonly PROGRESS_BARS = [
    '▱▱▱▱▱▱▱▱▱▱',
    '▰▱▱▱▱▱▱▱▱▱',
    '▰▰▱▱▱▱▱▱▱▱',
    '▰▰▰▱▱▱▱▱▱▱',
    '▰▰▰▰▱▱▱▱▱▱',
    '▰▰▰▰▰▱▱▱▱▱',
    '▰▰▰▰▰▰▱▱▱▱',
    '▰▰▰▰▰▰▰▱▱▱',
    '▰▰▰▰▰▰▰▰▱▱',
    '▰▰▰▰▰▰▰▰▰▱',
    '▰▰▰▰▰▰▰▰▰▰',
  ];

  /**
   * Actualiza un mensaje con barra de progreso estandarizada
   */
  static async update(
    ctx: Context,
    messageId: number | undefined | null,
    step: number,
    total: number,
    currentTask: string,
    details: string = '',
    clientName?: string
  ): Promise<void> {
    if (!messageId) return;

    const percentage = Math.round((step / total) * 100);
    const progressBarIndex = Math.min(Math.floor((step / total) * 10), 9);
    const frameIndex = step % this.PROGRESS_FRAMES.length;

    const clientText = clientName ? ` ${clientName}` : '';
    let progressText =
      `${this.PROGRESS_FRAMES[frameIndex]} *Procesando${clientText}*\n\n` +
      `📊 Progreso: ${percentage}% ${this.PROGRESS_BARS[progressBarIndex]}\n` +
      `🔄 ${currentTask}\n`;

    if (details) {
      progressText += `📝 ${details}\n`;
    }

    progressText += `\n⏱️ Por favor espere...`;

    try {
      await ctx.telegram.editMessageText(ctx.chat?.id, messageId, undefined, progressText, {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      // Silenciar errores de edición de mensaje (mensaje no modificado, etc.)
      logger.debug('No se pudo editar mensaje de progreso (no crítico)');
    }
  }

  /**
   * Actualiza progreso simplificado (sin cliente específico)
   */
  static async updateSimple(
    ctx: Context,
    messageId: number | undefined | null,
    current: number,
    total: number,
    task: string = 'Procesando'
  ): Promise<void> {
    if (!messageId) return;

    const percentage = Math.round((current / total) * 100);
    const progressBarIndex = Math.min(Math.floor((current / total) * 10), 9);

    const progressText = `🔄 ${task}... ${this.PROGRESS_BARS[progressBarIndex]} (${current}/${total})`;

    try {
      await ctx.telegram.editMessageText(ctx.chat?.id, messageId, undefined, progressText);
    } catch (error) {
      logger.debug('No se pudo editar mensaje de progreso simple');
    }
  }

  /**
   * Actualiza progreso para lotes con animación visual
   */
  static async updateBatch(
    ctx: Context,
    chatId: number,
    messageId: number,
    current: number,
    total: number,
    taskName: string = 'lote'
  ): Promise<void> {
    const progressBarIndex = Math.min(
      Math.floor((current / total) * (this.PROGRESS_BARS.length - 1)),
      this.PROGRESS_BARS.length - 1
    );

    const progressText = `🔄 Analizando ${taskName}... ${this.PROGRESS_BARS[progressBarIndex]} (${current}/${total})`;

    try {
      await ctx.telegram.editMessageText(chatId, messageId, undefined, progressText);
    } catch (error) {
      logger.debug('No se pudo editar mensaje de progreso de lote');
    }
  }

  /**
   * Obtiene el porcentaje calculado
   */
  static getPercentage(current: number, total: number): number {
    return Math.round((current / total) * 100);
  }

  /**
   * Obtiene el índice de la barra de progreso
   */
  static getBarIndex(current: number, total: number): number {
    return Math.min(Math.floor((current / total) * 10), 9);
  }

  /**
   * Obtiene el texto de la barra de progreso
   */
  static getBar(current: number, total: number): string {
    const index = this.getBarIndex(current, total);
    return this.PROGRESS_BARS[index];
  }

  /**
   * Obtiene el frame de animación
   */
  static getFrame(step: number): string {
    return this.PROGRESS_FRAMES[step % this.PROGRESS_FRAMES.length];
  }

  /**
   * Crea mensaje de progreso completado
   */
  static completed(taskName: string, itemsProcessed: number): string {
    return `✅ *${taskName} completado*\n\n📊 ${itemsProcessed} elemento${itemsProcessed > 1 ? 's' : ''} procesado${itemsProcessed > 1 ? 's' : ''}`;
  }

  /**
   * Actualiza mensaje con estado final
   */
  static async updateCompleted(
    ctx: Context,
    messageId: number | undefined | null,
    taskName: string,
    itemsProcessed: number
  ): Promise<void> {
    if (!messageId) return;

    const completedText = this.completed(taskName, itemsProcessed);

    try {
      await ctx.telegram.editMessageText(ctx.chat?.id, messageId, undefined, completedText, {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      logger.debug('No se pudo editar mensaje de completado');
    }
  }

  /**
   * Actualiza mensaje con error
   */
  static async updateError(
    ctx: Context,
    messageId: number | undefined | null,
    errorMessage: string
  ): Promise<void> {
    if (!messageId) return;

    const errorText = `❌ *Error*\n\n${errorMessage}`;

    try {
      await ctx.telegram.editMessageText(ctx.chat?.id, messageId, undefined, errorText, {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      logger.debug('No se pudo editar mensaje de error');
    }
  }
}
