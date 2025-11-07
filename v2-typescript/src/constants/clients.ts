/**
 * Constantes de clientes predefinidos
 * Elimina el uso de "magic strings" en el código
 */

export const CLIENT_RFCS = {
  ESCOTEL: 'EEC081222FH8',
  AXA: 'AAM850528H51',
  CHUBB: 'CDS211206J20', // Corregido: era CSE990527I53
  QUALITAS: 'QCS931209G49',
  CLUB_ASISTENCIA: 'CAS981016P46',
} as const;

export const SAT_PRODUCT_KEYS = {
  SERVICIOS_GRUA: '78101803',
  // Agregar otras claves SAT según se necesiten
} as const;

export const SAT_UNIT_KEYS = {
  SERVICIO: 'E48',
  // Agregar otras unidades según se necesiten
} as const;

export const CFDI_USE = {
  GASTOS_GENERAL: 'G03',
  ADQUISICION_MERCANCIAS: 'G01',
  // Agregar otros usos según se necesiten
} as const;

export const PAYMENT_FORM = {
  POR_DEFINIR: '99',
  TRANSFERENCIA_ELECTRONICA: '03',
  // Agregar otras formas según se necesiten
} as const;

export const PAYMENT_METHOD = {
  PAGO_DIFERIDO: 'PPD',
  PAGO_UNA_EXHIBICION: 'PUE',
} as const;
