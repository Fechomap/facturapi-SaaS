// bot/views/invoice.view.ts
import { Markup } from 'telegraf';

interface InvoiceData {
  clienteNombre?: string;
  claveProducto: string;
  monto: number;
}

interface Invoice {
  id: string;
  series?: string;
  folio_number: number;
  total: number;
  status?: string;
  cancellation_status?: string;
  cancellation_date?: string;
  facturapiInvoiceId?: string;
}

interface ComplementoPago {
  facturapiComplementId: string;
  series: string;
  folioNumber: number;
  totalAmount: string | number;
  paymentDate: string;
}

interface ViewResponse {
  message: string;
  keyboard: ReturnType<typeof Markup.inlineKeyboard>;
  parse_mode?: 'Markdown';
}

/**
 * Genera vista de resumen de factura para confirmar generación
 * @param invoiceData - Datos de la factura
 * @param transactionId - ID de transacción
 */
export function invoiceSummaryView(invoiceData: InvoiceData, transactionId: string): ViewResponse {
  // Determinar si el cliente requiere retención (SOS, INFOASIST, ARSA)
  const clienteNombre = invoiceData.clienteNombre || '';
  const requiresWithholding =
    clienteNombre.includes('INFOASIST') ||
    clienteNombre.includes('ARSA') ||
    clienteNombre.includes('S.O.S') ||
    clienteNombre.includes('SOS');

  // Determinar tipo de servicio con información de retención
  const tipoServicio = requiresWithholding
    ? 'Servicio Con Retención (4%)'
    : 'Servicio Sin Retención';

  // Usar formato estándar CHUBB
  const message =
    `📋 *Vista previa de factura*\n\n` +
    `• Tipo: ${tipoServicio}\n` +
    `• Cliente: ${invoiceData.clienteNombre}\n` +
    `• Clave SAT: ${invoiceData.claveProducto}\n` +
    `• Registros incluidos: 1\n` +
    `• Monto: $${invoiceData.monto.toFixed(2)} MXN\n`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirmar', `confirmar_${transactionId}`)],
    [Markup.button.callback('❌ Cancelar', `cancelar_${transactionId}`)],
  ]);

  return { message, keyboard, parse_mode: 'Markdown' };
}

/**
 * Genera vista de factura generada con opciones de descarga
 * @param invoice - Datos de la factura generada
 */
export function invoiceCreatedView(invoice: Invoice): ViewResponse {
  const message =
    `✅ *Factura generada exitosamente*\n\n` +
    `Folio: ${invoice.series}-${invoice.folio_number}\n` +
    `Total: $${invoice.total.toFixed(2)} MXN\n\n` +
    `Seleccione una opción para descargar:`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📄 Descargar PDF', `pdf_${invoice.id}_${invoice.folio_number}`)],
    [Markup.button.callback('🔠 Descargar XML', `xml_${invoice.id}_${invoice.folio_number}`)],
  ]);

  return { message, keyboard, parse_mode: 'Markdown' };
}

/**
 * Genera vista de factura consultada
 * @param invoice - Datos de factura consultada
 * @param estadoFactura - Estado formateado de la factura
 * @param estaCancelada - Si la factura está cancelada
 * @param complementosPago - Lista de complementos de pago asociados (opcional)
 */
export function invoiceDetailsView(
  invoice: Invoice,
  estadoFactura: string,
  estaCancelada: boolean,
  complementosPago: ComplementoPago[] = []
): ViewResponse {
  // Determinar si la factura está cancelada basándonos en el estado o cancellation_status
  const cancelada =
    estaCancelada || invoice.status === 'canceled' || invoice.cancellation_status === 'accepted';

  // Ajustar el estado a mostrar según la condición de cancelación
  const estadoMostrar = cancelada ? '⛔ CANCELADA' : estadoFactura || '✅ VIGENTE';

  let mensaje =
    `✅ *Factura encontrada*\n\n` +
    `Folio: ${invoice.series || 'A'}-${invoice.folio_number}\n` +
    `Total: $${typeof invoice.total === 'number' ? invoice.total.toFixed(2) : invoice.total || '0.00'} MXN\n` +
    `Estado: ${estadoMostrar}\n`;

  if (cancelada && invoice.cancellation_date) {
    mensaje += `Fecha de cancelación: ${invoice.cancellation_date}\n`;
  }

  // Mostrar complementos de pago si existen
  if (complementosPago && complementosPago.length > 0) {
    mensaje += `\n💰 *Complementos de Pago (${complementosPago.length}):*\n`;
    complementosPago.forEach((comp) => {
      const fecha = new Date(comp.paymentDate).toLocaleDateString('es-MX');
      mensaje += `  • ${comp.series}-${comp.folioNumber} - $${parseFloat(comp.totalAmount.toString()).toFixed(2)} (${fecha})\n`;
    });
  }

  mensaje += `\nSeleccione una opción:`;

  // Usar el ID de FacturAPI para los botones
  const facturaId = invoice.facturapiInvoiceId || invoice.id;

  // Botones diferentes según si la factura está cancelada o no
  const botonesFactura: Array<Array<ReturnType<typeof Markup.button.callback>>> = [
    [Markup.button.callback('📄 PDF Factura', `pdf_${facturaId}_${invoice.folio_number}`)],
    [Markup.button.callback('🔠 XML Factura', `xml_${facturaId}_${invoice.folio_number}`)],
  ];

  // Agregar botones de descarga para cada complemento de pago
  if (complementosPago && complementosPago.length > 0) {
    complementosPago.forEach((comp) => {
      const label = `💰 Complemento ${comp.series}-${comp.folioNumber}`;
      botonesFactura.push([
        Markup.button.callback(
          `📄 PDF ${label}`,
          `pago_pdf_${comp.facturapiComplementId}_${comp.folioNumber}`
        ),
        Markup.button.callback(
          `📋 XML`,
          `pago_xml_${comp.facturapiComplementId}_${comp.folioNumber}`
        ),
      ]);
    });
  }

  // Solo mostramos el botón de cancelación si la factura NO está cancelada
  if (!cancelada) {
    botonesFactura.push([
      Markup.button.callback(
        '❌ Cancelar Factura',
        `iniciar_cancelacion_${facturaId}_${invoice.folio_number}`
      ),
    ]);
  }

  return {
    message: mensaje,
    keyboard: Markup.inlineKeyboard(botonesFactura),
    parse_mode: 'Markdown',
  };
}
