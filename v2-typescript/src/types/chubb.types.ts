/**
 * Tipos TypeScript para el handler de CHUBB
 */

import { BatchDataBase } from '@services/redis-batch-state.service.js';

/**
 * Mapeo de columnas Excel de CHUBB
 */
export interface ChubbColumnMapping {
  numeroCaso: string;
  servicio: string;
  monto: string;
  retencion?: string;
}

/**
 * Grupos de servicios CHUBB
 */
export interface ChubbGrupos {
  gruaConRetencion: any[];
  gruaSinRetencion: any[];
  otrosServicios: any[];
}

/**
 * Resumen de montos por grupo
 */
export interface ChubbMontosPorGrupo {
  gruaConRetencion?: number;
  gruaSinRetencion?: number;
  otrosServicios?: number;
}

/**
 * Datos almacenados en Redis para el batch de CHUBB
 */
export interface ChubbBatchData extends BatchDataBase {
  grupos: ChubbGrupos;
  columnMappings: ChubbColumnMapping;
  montosPorGrupo: ChubbMontosPorGrupo;
  clienteId?: number;
  clienteFacturapiId?: string;
  clienteName?: string;
}
