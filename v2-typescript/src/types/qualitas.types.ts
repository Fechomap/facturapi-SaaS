/**
 * Tipos TypeScript para el handler de Qualitas
 */

import { BatchDataBase } from '@services/redis-batch-state.service.js';

/**
 * Datos de una factura (con o sin retención)
 */
export interface QualitasFacturaData {
  items: any[];
  total: number;
  facturaData: any;
}

/**
 * Selección del usuario (con/sin retención)
 */
export interface QualitasSeleccion {
  conRetencion: boolean;
  timestamp: number;
}

/**
 * Datos almacenados en Redis para Qualitas
 */
export interface QualitasBatchData extends BatchDataBase {
  facturaConRetencion?: QualitasFacturaData;
  facturaSinRetencion?: QualitasFacturaData;
  seleccionUsuario?: QualitasSeleccion;
  clienteId?: string;
  clienteName?: string;
}
