/**
 * Tipos TypeScript para el handler de AXA
 */

import { BatchDataBase } from '@services/redis-batch-state.service.js';

/**
 * Tipo de servicio AXA
 */
export type AxaTipoServicio = 'realizados' | 'muertos';

/**
 * Datos de una factura AXA (con o sin retención)
 */
export interface AxaFacturaData {
  items: any[];
  total: number;
  facturaData: any;
}

/**
 * Selección del usuario
 */
export interface AxaSeleccion {
  tipoServicio: AxaTipoServicio;
  conRetencion: boolean;
  timestamp: number;
}

/**
 * Datos almacenados en Redis para el batch de AXA
 */
export interface AxaBatchData extends BatchDataBase {
  facturaConRetencion?: AxaFacturaData;
  facturaSinRetencion?: AxaFacturaData;
  seleccionUsuario?: AxaSeleccion;
  clienteId?: number;
  clienteFacturapiId?: string;
  clienteName?: string;
}
