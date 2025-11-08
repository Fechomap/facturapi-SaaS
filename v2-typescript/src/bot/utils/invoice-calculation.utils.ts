/**
 * Utilidades para calcular datos financieros de facturas
 *
 * Estas funciones calculan subtotal, IVA y retenciones desde el facturaData
 * que enviamos a FacturAPI, ANTES de crear la factura.
 *
 * Esto es necesario porque FacturAPI NO devuelve el campo 'subtotal' en su respuesta.
 */

interface CalculatedFinancialData {
  subtotal: number;
  ivaAmount: number;
  retencionAmount: number;
  discount: number;
}

/**
 * Calcula datos financieros desde facturaData (lo que enviamos a FacturAPI)
 *
 * @param facturaData - El objeto que enviamos a facturapi.invoices.create()
 * @returns Subtotal, IVA, retenciones y descuentos calculados
 */
export function calculateFinancialDataFromFacturaData(facturaData: any): CalculatedFinancialData {
  let subtotal = 0;
  let ivaAmount = 0;
  let retencionAmount = 0;
  let discount = 0;

  if (!facturaData.items || !Array.isArray(facturaData.items)) {
    return { subtotal: 0, ivaAmount: 0, retencionAmount: 0, discount: 0 };
  }

  for (const item of facturaData.items) {
    const quantity = item.quantity || 0;
    const price = item.product?.price || 0;
    const itemDiscount = item.discount || 0;
    const taxIncluded = item.product?.tax_included || false;

    // Calcular subtotal del item
    let itemSubtotal = quantity * price;

    if (taxIncluded) {
      // Si tax_included = true, el precio YA incluye el IVA
      // Necesitamos separar el subtotal del IVA
      const taxes = item.product?.taxes || [];
      const ivaTax = taxes.find((tax: any) => tax.type === 'IVA' && !tax.withholding);

      if (ivaTax) {
        // Precio con IVA / (1 + tasa) = subtotal sin IVA
        itemSubtotal = itemSubtotal / (1 + (ivaTax.rate || 0));
      }
    }

    subtotal += itemSubtotal;
    discount += itemDiscount;

    // Calcular impuestos sobre el subtotal
    const taxes = item.product?.taxes || [];
    for (const tax of taxes) {
      const taxAmount = itemSubtotal * (tax.rate || 0);

      if (tax.type === 'IVA' && !tax.withholding) {
        ivaAmount += taxAmount;
      } else if (tax.withholding) {
        retencionAmount += taxAmount;
      }
    }
  }

  return {
    subtotal: Math.round(subtotal * 100) / 100, // Redondear a 2 decimales
    ivaAmount: Math.round(ivaAmount * 100) / 100,
    retencionAmount: Math.round(retencionAmount * 100) / 100,
    discount: Math.round(discount * 100) / 100,
  };
}

/**
 * Extrae datos adicionales de la factura creada (campos que SÍ devuelve FacturAPI)
 *
 * @param factura - Respuesta de facturapi.invoices.create()
 * @returns Objeto con datos adicionales para guardar en BD
 */
export function extractAdditionalDataFromFacturapiResponse(factura: any) {
  return {
    currency: factura.currency || 'MXN',
    paymentForm: factura.payment_form,
    paymentMethod: factura.payment_method,
    verificationUrl: factura.verification_url,
    satCertNumber: factura.stamp?.sat_cert_number,
    usoCfdi: factura.use,
    tipoComprobante: factura.type,
    exportacion: factura.export,
    items: factura.items,
  };
}
