/**
 * Invoice Validation Utilities
 * Circuit breakers para validación de montos de facturas
 */

import { createModuleLogger } from '@core/utils/logger.js';

const logger = createModuleLogger('invoice-validation');

type ClientName = 'QUALITAS' | 'CHUBB' | 'AXA' | 'ESCOTEL' | 'CLUB_ASISTENCIA';

const INVOICE_AMOUNT_LIMITS: Record<ClientName | 'DEFAULT', { min: number; max: number }> = {
  QUALITAS: { min: 1, max: 1500000 },
  CHUBB: { min: 1, max: 1500000 },
  AXA: { min: 1, max: 1500000 },
  ESCOTEL: { min: 1, max: 1500000 },
  CLUB_ASISTENCIA: { min: 1, max: 1500000 },
  DEFAULT: { min: 1, max: 1500000 },
};

/**
 * Valida que un monto de factura esté dentro de los límites de sanidad.
 * Arroja un error si la validación falla.
 * @param amount - El monto a validar.
 * @param clientName - El nombre del cliente para obtener límites específicos.
 * @param context - Información adicional para el mensaje de error (e.g., 'total de la hoja X').
 */
export function validateInvoiceAmount(
  amount: number,
  clientName: ClientName,
  context: string = 'el total'
): void {
  const limits = INVOICE_AMOUNT_LIMITS[clientName] || INVOICE_AMOUNT_LIMITS.DEFAULT;

  if (isNaN(amount)) {
    const errorMessage = `Monto inválido (NaN) detectado para ${context}. Esto indica un error de parsing en el archivo Excel.`;
    logger.error({ amount, clientName, context }, errorMessage);
    throw new Error(errorMessage);
  }

  if (amount < limits.min) {
    const errorMessage = `El monto para ${context} ($${amount.toFixed(2)}) es menor al límite mínimo permitido ($${limits.min.toFixed(2)}).`;
    logger.error({ amount, clientName, context, limits }, errorMessage);
    throw new Error(errorMessage);
  }

  if (amount > limits.max) {
    const errorMessage =
      `El monto para ${context} ($${amount.toFixed(2)}) excede el límite máximo permitido ($${limits.max.toFixed(2)}).\n\n` +
      `Posibles causas:\n` +
      `• La columna de importe es incorrecta.\n` +
      `• El formato numérico del archivo Excel es inválido.\n` +
      `• Existen filas duplicadas en el archivo.\n\n` +
      `Si el monto es correcto, contacte a soporte para ajustar los límites de seguridad.`;
    logger.error({ amount, clientName, context, limits }, errorMessage);
    throw new Error(errorMessage);
  }

  logger.debug({ amount, clientName, context, limits }, 'Validación de monto exitosa.');
}

export { INVOICE_AMOUNT_LIMITS, type ClientName };
