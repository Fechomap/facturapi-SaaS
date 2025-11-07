/**
 * UI Buttons Helper - Estandarización de botones en toda la aplicación
 *
 * REGLAS DE HOMOLOGACIÓN:
 * - Emojis estandarizados por tipo de acción
 * - Formato consistente en textos de botones
 * - IDs de callback_data consistentes
 */

import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';

export class UIButtons {
  /**
   * Botón de volver al menú principal (estandarizado)
   */
  static backToMenu(): ReturnType<typeof Markup.button.callback> {
    return Markup.button.callback('🔙 Volver al menú', 'menu_principal');
  }

  /**
   * Botón de cancelar operación
   */
  static cancel(callbackData: string = 'menu_principal'): ReturnType<
    typeof Markup.button.callback
  > {
    return Markup.button.callback('❌ Cancelar', callbackData);
  }

  /**
   * Botones de confirmación para generar facturas
   * Incluye cantidad de facturas si es mayor a 1
   */
  static confirmGenerate(
    invoiceCount: number,
    confirmCallbackData: string,
    cancelCallbackData: string = 'menu_principal'
  ): InlineKeyboardMarkup {
    const confirmText =
      invoiceCount > 1
        ? `✅ Confirmar y Generar ${invoiceCount} Facturas`
        : '✅ Confirmar y Generar';

    return Markup.inlineKeyboard([
      [Markup.button.callback(confirmText, confirmCallbackData)],
      [this.cancel(cancelCallbackData)],
    ]).reply_markup;
  }

  /**
   * Botones de descarga (PDF y XML) estandarizados
   */
  static downloadButtons(
    invoiceId: string,
    folio: string | number
  ): InlineKeyboardMarkup {
    return Markup.inlineKeyboard([
      [Markup.button.callback('📄 Descargar PDF', `pdf_${invoiceId}_${folio}`)],
      [Markup.button.callback('🔠 Descargar XML', `xml_${invoiceId}_${folio}`)],
    ]).reply_markup;
  }

  /**
   * Botones de descarga masiva (ZIP) para lotes
   */
  static downloadZipButtons(
    pdfCallbackData: string,
    xmlCallbackData: string,
    includeBackButton: boolean = true
  ): InlineKeyboardMarkup {
    const buttons = [
      [Markup.button.callback('📦 Descargar Todos los PDFs (ZIP)', pdfCallbackData)],
      [Markup.button.callback('🗂️ Descargar Todos los XMLs (ZIP)', xmlCallbackData)],
    ];

    if (includeBackButton) {
      buttons.push([this.backToMenu()]);
    }

    return Markup.inlineKeyboard(buttons).reply_markup;
  }

  /**
   * Botones de selección de tipo de servicio (con/sin retención)
   */
  static serviceTypeButtons(
    batchId: string,
    withRetentionCallback: string,
    withoutRetentionCallback: string
  ): InlineKeyboardMarkup {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '🚛 Servicios Realizados (con retención 4%)',
          `${withRetentionCallback}:${batchId}`
        ),
      ],
      [
        Markup.button.callback(
          '💀 Servicios Muertos (sin retención)',
          `${withoutRetentionCallback}:${batchId}`
        ),
      ],
      [this.cancel()],
    ]).reply_markup;
  }

  /**
   * Botones de confirmación genéricos con retención
   */
  static retentionConfirmButtons(
    batchId: string,
    withRetentionText: string = 'con retención 4%',
    withoutRetentionText: string = 'sin retención'
  ): InlineKeyboardMarkup {
    return Markup.inlineKeyboard([
      [Markup.button.callback(`✅ Sí, ${withRetentionText}`, `confirm_with_retention:${batchId}`)],
      [Markup.button.callback(`❌ No, ${withoutRetentionText}`, `confirm_without_retention:${batchId}`)],
      [this.cancel()],
    ]).reply_markup;
  }

  /**
   * Botones de finalizar proceso de lote
   */
  static batchFinishButtons(): InlineKeyboardMarkup {
    return Markup.inlineKeyboard([
      [Markup.button.callback('✅ Finalizar', 'batch_finish')],
      [this.backToMenu()],
    ]).reply_markup;
  }

  /**
   * Botones para lote con descargas y finalizar
   */
  static batchCompleteButtons(): InlineKeyboardMarkup {
    return Markup.inlineKeyboard([
      [Markup.button.callback('📄 Descargar PDFs', 'batch_download_pdfs')],
      [Markup.button.callback('📂 Descargar XMLs', 'batch_download_xmls')],
      [Markup.button.callback('✅ Finalizar', 'batch_finish')],
    ]).reply_markup;
  }

  /**
   * Botón solo de volver (sin más opciones)
   */
  static backButtonOnly(): InlineKeyboardMarkup {
    return Markup.inlineKeyboard([[this.backToMenu()]]).reply_markup;
  }

  /**
   * Botones para confirmar con resumen (con monto)
   */
  static confirmWithSummary(
    confirmText: string,
    confirmCallbackData: string,
    itemsCount: number,
    total: number
  ): InlineKeyboardMarkup {
    return Markup.inlineKeyboard([
      [Markup.button.callback(`✅ ${confirmText}`, confirmCallbackData)],
      [this.cancel()],
    ]).reply_markup;
  }

  /**
   * Remover todos los botones de un mensaje (para deshabilitar después de confirmación)
   */
  static removeAll(): { inline_keyboard: any[] } {
    return { inline_keyboard: [] };
  }

  /**
   * Botones de selección de cliente
   */
  static clientSelection(
    clients: Array<{ id: string; name: string }>,
    callbackPrefix: string = 'cliente_',
    includeBackButton: boolean = true
  ): InlineKeyboardMarkup {
    const buttons = clients.map((client) => [
      Markup.button.callback(client.name, `${callbackPrefix}${client.id}`),
    ]);

    if (includeBackButton) {
      buttons.push([this.backToMenu()]);
    }

    return Markup.inlineKeyboard(buttons).reply_markup;
  }

  /**
   * Botones de complemento de pago (PDF/XML)
   */
  static paymentComplementButtons(
    complementId: string,
    folioNumber: string | number
  ): InlineKeyboardMarkup {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '📄 Descargar PDF',
          `pago_pdf_${complementId}_${folioNumber}`
        ),
        Markup.button.callback(
          '🔠 Descargar XML',
          `pago_xml_${complementId}_${folioNumber}`
        ),
      ],
      [this.backToMenu()],
    ]).reply_markup;
  }

  /**
   * Botones de error con opción de reintentar
   */
  static errorWithRetry(
    retryCallbackData: string,
    retryText: string = 'Intentar de nuevo'
  ): InlineKeyboardMarkup {
    return Markup.inlineKeyboard([
      [Markup.button.callback(`🔄 ${retryText}`, retryCallbackData)],
      [this.backToMenu()],
    ]).reply_markup;
  }
}
