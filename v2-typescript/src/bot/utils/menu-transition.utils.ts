// bot/utils/menu-transition.utils.ts
// Utilidades para transiciones suaves de menús

import { Markup } from 'telegraf';
import type { BotContext } from '../../types/bot.types.js';

/**
 * Interfaz para historial de menús
 */
interface MenuHistoryItem {
  id: string;
  data: Record<string, unknown>;
  timestamp: number;
}

/**
 * Interfaz para sistema de menús
 */
interface MenuSystem {
  history: MenuHistoryItem[];
  currentMenu: string;
  menuData: Record<string, unknown>;
  lastUpdate: number;
}

/**
 * Gestor de estado de menús con historial y transiciones
 */
export class MenuStateManager {
  private ctx: BotContext;

  constructor(ctx: BotContext) {
    this.ctx = ctx;
    this.initializeState();
  }

  private initializeState(): void {
    if (!this.ctx.userState) {
      this.ctx.userState = {};
    }
    if (!this.ctx.userState.menuSystem) {
      this.ctx.userState.menuSystem = {
        history: [],
        currentMenu: 'main',
        menuData: {},
        lastUpdate: Date.now(),
      };
    }
  }

  /**
   * Navegar a un nuevo menú guardando el estado actual
   */
  pushMenu(menuId: string, data: Record<string, unknown> = {}): void {
    const currentState = this.ctx.userState.menuSystem as MenuSystem;

    // Guardar estado actual en historial
    currentState.history.push({
      id: currentState.currentMenu,
      data: { ...currentState.menuData },
      timestamp: currentState.lastUpdate,
    });

    // Actualizar estado actual
    currentState.currentMenu = menuId;
    currentState.menuData = { ...data };
    currentState.lastUpdate = Date.now();

    // Limitar historial a 10 elementos para evitar memoria excesiva
    if (currentState.history.length > 10) {
      currentState.history.shift();
    }
  }

  /**
   * Volver al menú anterior
   */
  popMenu(): MenuHistoryItem | null {
    const currentState = this.ctx.userState.menuSystem as MenuSystem;

    if (currentState.history.length > 0) {
      const previousMenu = currentState.history.pop();
      if (previousMenu) {
        currentState.currentMenu = previousMenu.id;
        currentState.menuData = { ...previousMenu.data };
        currentState.lastUpdate = Date.now();
        return previousMenu;
      }
    }

    return null;
  }

  /**
   * Obtener información del menú actual
   */
  getCurrentMenu(): MenuSystem {
    return this.ctx.userState.menuSystem as MenuSystem;
  }

  /**
   * Limpiar historial de menús
   */
  clearHistory(): void {
    (this.ctx.userState.menuSystem as MenuSystem).history = [];
  }

  /**
   * Obtener breadcrumb del camino actual
   */
  getBreadcrumb(): string[] {
    const history = (this.ctx.userState.menuSystem as MenuSystem).history;
    const current = (this.ctx.userState.menuSystem as MenuSystem).currentMenu;

    return [...history.map((h) => h.id), current];
  }
}

/**
 * Utilidades para transiciones suaves
 */
export class MenuTransitionUtils {
  /**
   * Editar mensaje con estado de carga y luego mostrar contenido final
   */
  static async smoothTransition(
    ctx: BotContext,
    loadingText: string,
    finalText: string,
    finalMarkup: ReturnType<typeof Markup.inlineKeyboard>,
    delay = 400
  ): Promise<boolean> {
    try {
      // Mostrar estado de carga
      await ctx.editMessageText(loadingText, { parse_mode: 'Markdown' });

      // Pausa para efecto visual
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Mostrar contenido final
      await ctx.editMessageText(finalText, {
        parse_mode: 'Markdown',
        ...finalMarkup,
      });

      return true;
    } catch (error) {
      console.error('Error en transición suave:', error);

      // Fallback: mostrar contenido final directamente
      try {
        await ctx.editMessageText(finalText, {
          parse_mode: 'Markdown',
          ...finalMarkup,
        });
      } catch (fallbackError) {
        console.error('Error en fallback de transición:', fallbackError);
      }

      return false;
    }
  }

  /**
   * Actualizar solo el teclado con feedback
   */
  static async updateKeyboardWithFeedback(
    ctx: BotContext,
    newMarkup: { inline_keyboard: ReturnType<typeof Markup.button.callback>[][] },
    feedbackText = '✅ Actualizado'
  ): Promise<boolean> {
    try {
      // Dar feedback inmediato
      await ctx.answerCbQuery(feedbackText);

      // Actualizar teclado
      await ctx.editMessageReplyMarkup(newMarkup);

      return true;
    } catch (error) {
      // Manejar error "message not modified" silenciosamente
      const errorMessage = error instanceof Error ? error.message : '';
      if (!errorMessage.includes('message is not modified')) {
        console.error('Error actualizando teclado:', error);
      }

      // Intentar dar feedback aunque falle la actualización
      try {
        await ctx.answerCbQuery(feedbackText);
      } catch (cbError) {
        console.error('Error en callback query:', cbError);
      }

      return false;
    }
  }

  /**
   * Transición con confirmación de estado
   */
  static async confirmedTransition(
    ctx: BotContext,
    newText: string,
    newMarkup: ReturnType<typeof Markup.inlineKeyboard>,
    confirmationDelay = 300
  ): Promise<boolean> {
    try {
      // Mostrar confirmación temporal
      await ctx.editMessageText(`${newText}\n\n🔄 *Actualizando interfaz...*`, {
        parse_mode: 'Markdown',
      });

      // Pausa breve
      await new Promise((resolve) => setTimeout(resolve, confirmationDelay));

      // Mostrar estado final
      await ctx.editMessageText(newText, {
        parse_mode: 'Markdown',
        ...newMarkup,
      });

      return true;
    } catch (error) {
      console.error('Error en transición confirmada:', error);
      return false;
    }
  }

  /**
   * Manejar errores de edición con reintentos
   */
  static async safeEditMessage(
    ctx: BotContext,
    text: string,
    markup: ReturnType<typeof Markup.inlineKeyboard>,
    maxRetries = 3
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Agregar timestamp para evitar "message not modified"
        const uniqueText =
          attempt > 1 ? `${text}\n\n🔄 *Actualizado: ${new Date().toLocaleTimeString()}*` : text;

        await ctx.editMessageText(uniqueText, {
          parse_mode: 'Markdown',
          ...markup,
        });

        return true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '';
        if (errorMessage.includes('message is not modified')) {
          // Contenido idéntico, intentar con timestamp
          continue;
        }

        if (attempt === maxRetries) {
          console.error(`Error después de ${maxRetries} intentos:`, error);
          throw error;
        }

        // Esperar antes del siguiente intento
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
      }
    }

    return false;
  }

  /**
   * Actualización optimista (UI primero, validación después)
   */
  static async optimisticUpdate(
    ctx: BotContext,
    updateFunction: () => Promise<void>,
    validationFunction: () => Promise<void>
  ): Promise<boolean> {
    try {
      // Actualizar UI inmediatamente
      await updateFunction();

      // Validar en background
      setTimeout(async () => {
        try {
          await validationFunction();
        } catch (validationError) {
          console.error('Error en validación optimista:', validationError);
          // Aquí podrías revertir o mostrar error
        }
      }, 100);

      return true;
    } catch (error) {
      console.error('Error en actualización optimista:', error);
      return false;
    }
  }
}

/**
 * Estados de carga predefinidos
 */
export const LoadingStates = {
  GENERIC: '🔄 *Cargando...*',
  FILTERS: '🔄 *Preparando filtros...*',
  CLIENTS: '🔄 *Cargando clientes...*',
  DATES: '🔄 *Configurando fechas...*',
  GENERATING: '🔄 *Generando reporte...*',
  UPDATING: '🔄 *Actualizando...*',
  SAVING: '🔄 *Guardando configuración...*',
};

/**
 * Feedback de acciones predefinido
 */
export const ActionFeedback = {
  SELECTED: '✅ Seleccionado',
  DESELECTED: '❌ Deseleccionado',
  UPDATED: '✅ Actualizado',
  SAVED: '💾 Guardado',
  CLEARED: '🗑️ Limpiado',
  APPLIED: '✅ Aplicado',
  CANCELLED: '❌ Cancelado',
};

/**
 * Interfaz para menú de carga
 */
export interface LoadingMenu {
  text: string;
  markup: ReturnType<typeof Markup.inlineKeyboard>;
}

/**
 * Utilidad para crear menús con estado de carga
 */
export function createLoadingMenu(loadingText = LoadingStates.GENERIC): LoadingMenu {
  return {
    text: loadingText,
    markup: Markup.inlineKeyboard([]),
  };
}

/**
 * Debounce para evitar actualizaciones muy rápidas
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | undefined;
  return function executedFunction(...args: Parameters<T>): void {
    const later = (): void => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Generar breadcrumb visual para navegación
 */
export function generateBreadcrumb(menuPath: string[], separator = ' → '): string {
  const menuNames: Record<string, string> = {
    main: '🏠 Inicio',
    reportes: '📊 Reportes',
    excel_options: '📋 Excel',
    excel_filters: '🔧 Filtros',
    excel_dates: '📅 Fechas',
    excel_clients: '👥 Clientes',
  };

  return menuPath.map((id) => menuNames[id] || id).join(separator);
}

export default {
  MenuStateManager,
  MenuTransitionUtils,
  LoadingStates,
  ActionFeedback,
  createLoadingMenu,
  debounce,
  generateBreadcrumb,
};
