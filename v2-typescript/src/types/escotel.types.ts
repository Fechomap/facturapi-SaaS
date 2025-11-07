/**
 * Tipos TypeScript para el handler de ESCOTEL
 */

import { BatchDataBase } from '@services/redis-batch-state.service.js';

/**
 * Datos de un servicio individual en el Excel de ESCOTEL
 */
export interface EscotelServicio {
  id: string; // Ej: "25GA_12345"
  claveSat: string | null;
  descripcion: string | null;
  ubicacion: string | null;
  subtotal: number;
  iva: number;
  retencion: number;
  total: number;
}

/**
 * Totales calculados para una hoja/factura
 */
export interface EscotelTotales {
  subtotal: number;
  iva: number;
  retencion: number;
  total: number;
}

/**
 * Datos de una hoja procesada del Excel
 */
export interface EscotelHojaData {
  nombreHoja: string;
  servicios: EscotelServicio[];
  totales: EscotelTotales;
  totalEsperadoExcel: number | null;
  discrepancia: number;
  tieneDiscrepancia: boolean;
}

/**
 * Item de FacturAPI preparado
 */
export interface FacturapiTax {
  type: string;
  rate: number;
  factor: string;
  withholding: boolean;
}

export interface FacturapiProduct {
  description: string;
  product_key: string;
  unit_key: string;
  unit_name: string;
  price: number;
  tax_included: boolean;
  taxes: FacturapiTax[];
}

export interface FacturapiItem {
  quantity: number;
  product: FacturapiProduct;
}

/**
 * Datos de factura preparados para FacturAPI
 */
export interface EscotelFacturaData {
  customer: string; // ID de FacturAPI del cliente
  items: FacturapiItem[];
  use: string; // "G03"
  payment_form: string; // "99"
  payment_method: string; // "PPD"
  currency: string; // "MXN"
  exchange: number; // 1
}

/**
 * Información completa de una factura a generar
 */
export interface EscotelFacturaInfo {
  nombreHoja: string;
  facturaData: EscotelFacturaData;
  servicios: EscotelServicio[];
  totales: EscotelTotales;
  totalEsperadoExcel: number | null;
  discrepancia: number;
  tieneDiscrepancia: boolean;
}

/**
 * Datos almacenados en Redis para el batch de ESCOTEL
 */
export interface EscotelBatchData extends BatchDataBase {
  facturas: EscotelFacturaInfo[];
  clienteId: number;
  clienteFacturapiId: string;
  clienteName: string;
  totalHojas: number;
  totalHojasExcel: number;
  totalHojasVacias: number;
  totalServicios: number;
  hojasConDiscrepancia: EscotelFacturaInfo[];
}

/**
 * Resultado de una factura generada
 */
export interface EscotelFacturaGenerada {
  nombreHoja: string;
  factura: {
    id: string;
    series: string;
    folio_number: number;
    total: number;
  };
  servicios: number; // cantidad de servicios
  totales: EscotelTotales;
  totalEsperadoExcel: number | null;
  discrepancia: number;
  tieneDiscrepancia: boolean;
}

/**
 * Error en generación de factura
 */
export interface EscotelFacturaError {
  nombreHoja: string;
  error: string;
}

/**
 * Resultado del procesamiento de un archivo Excel
 */
export interface EscotelProcessResult {
  success: boolean;
  hojas?: number;
  servicios?: number;
  error?: string;
}

/**
 * Resultado del envío de facturas
 */
export interface EscotelEnvioResult {
  success: boolean;
  generadas: number;
  errores: number;
  facturasGeneradas?: EscotelFacturaGenerada[];
  facturasError?: EscotelFacturaError[];
}
