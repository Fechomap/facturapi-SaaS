// bot/views/invoice.view.js
import { Markup } from 'telegraf';

/**
 * Genera vista de resumen de factura para confirmar generación
 * @param {Object} invoiceData - Datos de la factura
 * @param {string} transactionId - ID de transacción
 */
export function invoiceSummaryView(invoiceData, transactionId) {
  const message = 
    `📋 *Resumen de la Factura*\n\n` +
    `• Cliente: ${invoiceData.clienteNombre}\n` +
    `• Número de Pedido: ${invoiceData.numeroPedido}\n` +
    `• Clave de Producto: ${invoiceData.claveProducto}\n` +
    `• Monto: $${invoiceData.monto.toFixed(2)} MXN\n` +
    `¿Desea proceder con la generación de la factura?`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirmar', `confirmar_${transactionId}`)],
    [Markup.button.callback('❌ Cancelar', `cancelar_${transactionId}`)]
  ]);
  
  return { message, keyboard, parse_mode: 'Markdown' };
}

/**
 * Genera vista de factura generada con opciones de descarga
 * @param {Object} invoice - Datos de la factura generada
 */
export function invoiceCreatedView(invoice) {
  const message = 
    `✅ *Factura generada exitosamente*\n\n` +
    `Folio: ${invoice.series}-${invoice.folio_number}\n` +
    `Total: $${invoice.total.toFixed(2)} MXN\n\n` +
    `Seleccione una opción para descargar:`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📄 Descargar PDF', `pdf_${invoice.id}_${invoice.folio_number}`)],
    [Markup.button.callback('🔠 Descargar XML', `xml_${invoice.id}_${invoice.folio_number}`)]
  ]);
  
  return { message, keyboard, parse_mode: 'Markdown' };
}

/**
 * Genera vista de factura consultada
 * @param {Object} invoice - Datos de factura consultada
 * @param {string} estadoFactura - Estado formateado de la factura
 * @param {boolean} estaCancelada - Si la factura está cancelada
 */
export function invoiceDetailsView(invoice, estadoFactura, estaCancelada) {
  // Asegurarnos que todos los valores existan o usar valores por defecto
  const series = invoice.series || 'A';
  const folioNumber = invoice.folio_number || '?';
  const total = typeof invoice.total === 'number' ? invoice.total.toFixed(2) : '0.00';
  
  let mensaje = `✅ *Factura encontrada*\n\n` +
    `Folio: ${series}-${folioNumber}\n` +
    `Total: $${total} MXN\n` +
    `Estado: ${estadoFactura || 'Desconocido'}\n`;
  
  if (invoice.cancellation_status === 'canceled' && invoice.cancellation_date) {
    mensaje += `Fecha de cancelación: ${invoice.cancellation_date}\n`;
  }
  
  mensaje += `\nSeleccione una opción:`;
  
  // Usar el ID de FacturAPI para los botones (facturapiInvoiceId o id)
  const facturaId = invoice.facturapiInvoiceId || invoice.id;
  
  // Botones diferentes según si la factura está cancelada o no
  let botonesFactura = [
    [Markup.button.callback('📄 Descargar PDF', `pdf_${facturaId}_${folioNumber}`)],
    [Markup.button.callback('🔠 Descargar XML', `xml_${facturaId}_${folioNumber}`)]
  ];
  
  // Solo mostramos el botón de cancelación si la factura NO está cancelada
  if (!estaCancelada) {
    botonesFactura.push([Markup.button.callback('❌ Cancelar Factura', `iniciar_cancelacion_${facturaId}_${folioNumber}`)]);
  }
  
  return { message: mensaje, keyboard: Markup.inlineKeyboard(botonesFactura), parse_mode: 'Markdown' };
}