/**
 * Tipos TypeScript para el handler de Club de Asistencia
 */

import { BatchDataBase } from '@services/redis-batch-state.service.js';

/**
 * Datos de una factura (con o sin retención)
 */
export interface ClubAsistenciaFacturaData {
  items: any[];
  total: number;
  facturaData: any;
}

/**
 * Selección del usuario (con/sin retención)
 */
export interface ClubAsistenciaSeleccion {
  conRetencion: boolean;
  timestamp: number;
}

/**
 * Datos almacenados en Redis para Club de Asistencia
 */
export interface ClubAsistenciaBatchData extends BatchDataBase {
  facturaConRetencion?: ClubAsistenciaFacturaData;
  facturaSinRetencion?: ClubAsistenciaFacturaData;
  seleccionUsuario?: ClubAsistenciaSeleccion;
  clienteId?: string;
  clienteName?: string;
}
