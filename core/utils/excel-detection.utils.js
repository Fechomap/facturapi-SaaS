// core/utils/excel-detection.utils.js - Utilidades para detección robusta de Excel
import logger from './logger.js';

const detectionLogger = logger.child({ module: 'excel-detection' });

/**
 * Detección SIMPLE de Excel - Solo verificar estado esperando o flujo activo
 * @param {Object} ctx - Contexto de Telegram
 * @param {string} tipoCliente - 'axa' o 'chubb'
 * @returns {boolean} - true si debe procesar el Excel
 */
export function debeDetectarExcel(ctx, tipoCliente) {
  const esperandoValue = `archivo_excel_${tipoCliente}`;
  const clientIdField = `${tipoCliente}ClientId`;

  // SIMPLE: Estado esperando O flujo activo
  const estaEsperando = ctx.userState?.esperando === esperandoValue;
  const flujoActivo = ctx.userState?.[clientIdField] && !ctx.userState?.facturaGenerada;

  if (estaEsperando || flujoActivo) {
    console.log(`✅ Excel ${tipoCliente.toUpperCase()} detectado`);
    return true;
  }

  console.log(`❌ Excel ${tipoCliente.toUpperCase()} no detectado`);
  return false;
}

/**
 * Validar si un archivo es Excel válido
 * @param {Object} document - Documento de Telegram
 * @returns {boolean} - true si es Excel válido
 */
export function esArchivoExcelValido(document) {
  if (!document || !document.file_name) {
    console.log('❌ No hay documento o file_name');
    return false;
  }

  const isExcel = document.file_name.match(/\.(xlsx|xls)$/i);
  if (!isExcel) {
    console.log(`❌ Archivo "${document.file_name}" no es Excel`);
    return false;
  }

  console.log(`✅ Archivo Excel válido: ${document.file_name}`);
  return true;
}

export default {
  debeDetectarExcel,
  esArchivoExcelValido,
};
