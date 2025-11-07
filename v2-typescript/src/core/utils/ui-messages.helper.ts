/**
 * UI Messages Helper - Estandarización de mensajes en toda la aplicación
 *
 * REGLAS DE HOMOLOGACIÓN:
 * - Usar Markdown consistente (* para bold, no **)
 * - Emojis estandarizados por tipo de mensaje
 * - Formato consistente en todos los handlers
 */

import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';

export class UIMessages {
  /**
   * Mensaje de progreso estandarizado para procesamiento de archivos
   */
  static processingFile(
    clientName: string,
    step: number,
    total: number,
    currentTask: string,
    details: string = ''
  ): string {
    const PROGRESS_FRAMES = ['⏳', '⌛', '⏳', '⌛'];
    const PROGRESS_BARS = [
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

    const percentage = Math.round((step / total) * 100);
    const progressBarIndex = Math.min(Math.floor((step / total) * 10), 9);
    const frameIndex = step % PROGRESS_FRAMES.length;

    let message =
      `${PROGRESS_FRAMES[frameIndex]} *Procesando archivo ${clientName}*\n\n` +
      `📊 Progreso: ${percentage}% ${PROGRESS_BARS[progressBarIndex]}\n` +
      `🔄 ${currentTask}\n`;

    if (details) {
      message += `📝 ${details}\n`;
    }

    message += `\n⏱️ Por favor espere...`;

    return message;
  }

  /**
   * Mensaje de éxito estandarizado
   */
  static success(
    clientName: string,
    invoiceCount: number,
    totalAmount: number,
    folioInfo?: string
  ): string {
    let message = `✅ *Proceso ${clientName} completado exitosamente*\n\n`;
    message += `📊 ${invoiceCount} factura${invoiceCount > 1 ? 's' : ''} generada${invoiceCount > 1 ? 's' : ''}\n`;
    message += `💰 Total: $${totalAmount.toFixed(2)}\n`;

    if (folioInfo) {
      message += `📋 ${folioInfo}\n`;
    }

    message += `\n📥 Seleccione una opción para descargar:`;

    return message;
  }

  /**
   * Mensaje de éxito para lotes múltiples
   */
  static batchSuccess(
    clientName: string,
    successCount: number,
    failCount: number,
    totalServices: number
  ): string {
    let message = `✅ *Facturas ${clientName} generadas exitosamente*\n\n`;
    message += `🏢 Cliente: ${clientName}\n\n`;
    message += `📊 Total: ${successCount} factura${successCount > 1 ? 's' : ''} generada${successCount > 1 ? 's' : ''}\n`;
    message += `📦 Servicios totales: ${totalServices}\n`;

    if (failCount > 0) {
      message += `\n⚠️ ${failCount} factura${failCount > 1 ? 's' : ''} con errores en generación\n`;
    }

    return message;
  }

  /**
   * Mensaje de error estandarizado con botón de volver
   */
  static error(errorMessage: string, includeBackButton: boolean = true): {
    text: string;
    options: any;
  } {
    const text = `❌ *Error*\n\n${errorMessage}`;

    const options: any = {
      parse_mode: 'Markdown',
    };

    if (includeBackButton) {
      options.reply_markup = Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Volver al menú', 'menu_principal')],
      ]).reply_markup;
    }

    return { text, options };
  }

  /**
   * Validación de archivo Excel estandarizada
   */
  static validateExcelFile(
    file: any,
    maxSizeMB: number = 15
  ): { valid: boolean; error?: { text: string; options: any } } {
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    // Validar tamaño
    if (file.file_size && file.file_size > maxSizeBytes) {
      return {
        valid: false,
        error: this.error(
          `El archivo es demasiado grande (${Math.round(file.file_size / (1024 * 1024))} MB).\n` +
            `El tamaño máximo permitido es ${maxSizeMB} MB.`,
          true
        ),
      };
    }

    // Validar extensión
    const fileName = file.file_name || '';
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    if (!isExcel) {
      return {
        valid: false,
        error: this.error('El archivo debe ser un Excel (.xlsx o .xls)', true),
      };
    }

    return { valid: true };
  }

  /**
   * Mensaje de archivo recibido
   */
  static fileReceived(fileName: string, clientName: string): string {
    return `✅ Archivo recibido: ${fileName}\n🔍 Validando estructura del Excel...\n⏱️ Por favor espere...`;
  }

  /**
   * Mensaje de confirmación de datos procesados
   */
  static confirmationPrompt(
    clientName: string,
    recordCount: number,
    totalAmount: number,
    additionalInfo?: string
  ): string {
    let message = `📊 *Resumen de datos procesados:*\n\n`;
    message += `• Cliente: ${clientName}\n`;
    message += `• ${recordCount} registro${recordCount > 1 ? 's' : ''}\n`;
    message += `• Monto total: $${totalAmount.toFixed(2)} MXN\n`;

    if (additionalInfo) {
      message += `\n${additionalInfo}\n`;
    }

    message += `\n¿Desea generar la${recordCount > 1 ? 's' : ''} factura${recordCount > 1 ? 's' : ''}?`;

    return message;
  }

  /**
   * Mensaje de Excel sin datos
   */
  static emptyExcelError(): { text: string; options: any } {
    return this.error('El archivo Excel no contiene datos. Por favor, revisa el archivo e intenta de nuevo.', true);
  }

  /**
   * Mensaje de estructura de Excel inválida
   */
  static invalidStructureError(requiredColumns: string[]): { text: string; options: any } {
    const columnsList = requiredColumns.join(', ');
    return this.error(
      `El archivo Excel no tiene todas las columnas requeridas.\n\nColumnas necesarias: ${columnsList}`,
      true
    );
  }

  /**
   * Mensaje de datos numéricos inválidos
   */
  static invalidNumericDataError(errors: string[], maxShow: number = 5): {
    text: string;
    options: any;
  } {
    const errorsToShow = errors.slice(0, maxShow);
    const remainingErrors = errors.length - maxShow;

    let errorMessage = 'Se encontraron errores en los datos numéricos:\n\n';
    errorMessage += errorsToShow.join('\n');

    if (remainingErrors > 0) {
      errorMessage += `\n\n...y ${remainingErrors} error${remainingErrors > 1 ? 'es' : ''} más.`;
    }

    return this.error(errorMessage, true);
  }

  /**
   * Breadcrumb para navegación consistente
   */
  static breadcrumb(path: string[]): string {
    return `🏠 ${path.join(' → ')}`;
  }

  /**
   * Mensaje de inicio de flujo
   */
  static startFlow(clientName: string, instructions: string): string {
    let message = `📋 *Cliente ${clientName} seleccionado*\n\n`;
    message += `${instructions}\n\n`;
    message += `⏱️ Esperando archivo...`;

    return message;
  }

  /**
   * Mensaje de proceso cancelado
   */
  static cancelled(): string {
    return '❌ Operación cancelada.';
  }

  /**
   * Mensaje de datos expirados (para Redis)
   */
  static dataExpired(): { text: string; options: any } {
    return this.error('Los datos han expirado. Por favor, suba nuevamente el archivo Excel.', true);
  }
}
