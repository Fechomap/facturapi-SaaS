// bot/handlers/chubb.handler.js
import { Markup } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import moment from 'moment-timezone';
import { config } from '../../config/index.js';
import { fileURLToPath } from 'url';

// Importar prisma de manera segura
import { prisma as configPrisma } from '../../config/database.js';
// También intentar importar desde lib
import libPrisma from '../../lib/prisma.js';

// Usar la instancia que esté disponible
const prisma = libPrisma || configPrisma;

// Verificación de seguridad
if (!prisma) {
  console.error('ERROR CRÍTICO: No se pudo inicializar Prisma, ambas fuentes fallaron');
}


// Constantes para las claves SAT
const CLAVE_SAT_GRUA_CON_RETENCION = '78101803';
const CLAVE_SAT_SERVICIOS_SIN_RETENCION = '90121800';

// Obtener la ruta del directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Registra los manejadores para la funcionalidad CHUBB
 * @param {Object} bot - Instancia del bot de Telegram
 */
export function registerChubbHandler(bot) {
  bot.action('menu_chubb', async (ctx) => {
    await ctx.answerCbQuery();
    
    try {
      // Obtener el ID del tenant actual
      const tenantId = ctx.getTenantId();
      
      if (!tenantId) {
        return ctx.reply('❌ Error: No se pudo obtener la información de tu empresa.');
      }
      
      // Usar el servicio configurado adecuadamente en lugar de prisma directamente
      let chubbClient;
      try {
        // Intentar importar TenantService que ya debería tener la conexión correcta a la BD
        const TenantService = await import('../../services/tenant.service.js');
        
        // Buscar el cliente CHUBB usando la función del servicio
        chubbClient = await TenantService.default.getCustomerByName(tenantId, 'CHUBB');
      } catch (dbError) {
        console.error('Error al buscar cliente CHUBB con TenantService:', dbError);
        
        // Fallback si TenantService no funciona
        if (prisma && prisma.tenantCustomer) {
          chubbClient = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId,
              legalName: { contains: 'CHUBB' } // Busca un cliente cuyo nombre contenga "CHUBB"
            }
          });
        } else {
          throw new Error('No se pudo acceder a la base de datos. Prisma no está disponible.');
        }
      }
      
      if (!chubbClient) {
        return ctx.reply('❌ Error de configuración: Cliente CHUBB no encontrado para tu empresa. Por favor, configura primero los clientes.');
      }
      
      // Guardar el ID del cliente CHUBB en el estado del usuario
      ctx.userState.chubbClientId = chubbClient.facturapiCustomerId;
      ctx.userState.clienteNombre = chubbClient.legalName;
      console.log(`Cliente CHUBB encontrado: ${chubbClient.legalName} (ID: ${chubbClient.facturapiCustomerId})`);
      
      // Continuar con el procesamiento normal
      ctx.userState.esperando = 'archivo_excel_chubb';
      await ctx.reply('Por favor, sube el archivo Excel con los datos de CHUBB para generar las facturas.');
      
    } catch (error) {
      console.error('Error al buscar cliente CHUBB:', error);
      await ctx.reply('❌ Error al buscar cliente CHUBB: ' + error.message);
    }
  });
  
  // Manejador para confirmar la generación de facturas CHUBB
  bot.action('chubb_confirmar', async (ctx) => {
    await ctx.answerCbQuery();
    
    // Verificar que tenemos datos para procesar
    if (!ctx.userState.chubbGrupos || !ctx.userState.chubbColumnMappings) {
      return ctx.reply('❌ No hay datos pendientes para generar facturas. Por favor, suba nuevamente el archivo Excel.');
    }
    
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(e => console.log('No se pudo editar mensaje:', e.message));
      await ctx.reply('⏳ Procesando solicitud de generación de facturas...');
      
      const grupos = ctx.userState.chubbGrupos;
      const columnMappings = ctx.userState.chubbColumnMappings;
      const facturas = [];
      
      // Generar facturas para cada grupo que tenga datos
      // Grupo 1: Servicios GRUA con Retención
      if (grupos.gruaConRetencion.length > 0) {
        await ctx.reply(`⏳ Generando factura para servicios GRUA con retención (${grupos.gruaConRetencion.length} registros)...`);
        const facturaGruaConRetencion = await generarFacturaParaGrupo(
          grupos.gruaConRetencion,
          CLAVE_SAT_GRUA_CON_RETENCION,
          true, // con retención
          ctx,
          columnMappings
        );
        if (facturaGruaConRetencion) {
          facturas.push(facturaGruaConRetencion);
        }
      } else {
        await ctx.reply('ℹ️ No hay servicios GRUA con retención para facturar.');
      }
      
      // Grupo 2: Servicios GRUA sin Retención
      if (grupos.gruaSinRetencion.length > 0) {
        await ctx.reply(`⏳ Generando factura para servicios GRUA sin retención (${grupos.gruaSinRetencion.length} registros)...`);
        const facturaGruaSinRetencion = await generarFacturaParaGrupo(
          grupos.gruaSinRetencion,
          CLAVE_SAT_SERVICIOS_SIN_RETENCION,
          false, // sin retención
          ctx,
          columnMappings
        );
        if (facturaGruaSinRetencion) {
          facturas.push(facturaGruaSinRetencion);
        }
      } else {
        await ctx.reply('ℹ️ No hay servicios GRUA sin retención para facturar.');
      }
      
      // Grupo 3: Otros Servicios sin Retención
      if (grupos.otrosServicios.length > 0) {
        await ctx.reply(`⏳ Generando factura para otros servicios sin retención (${grupos.otrosServicios.length} registros)...`);
        const facturaOtrosServicios = await generarFacturaParaGrupo(
          grupos.otrosServicios,
          CLAVE_SAT_SERVICIOS_SIN_RETENCION,
          false, // sin retención
          ctx,
          columnMappings
        );
        if (facturaOtrosServicios) {
          facturas.push(facturaOtrosServicios);
        }
      } else {
        await ctx.reply('ℹ️ No hay otros servicios para facturar.');
      }
      
      // Informar resultado final
      if (facturas.length > 0) {
        await ctx.reply(`✅ Proceso completado. Se generaron ${facturas.length} facturas exitosamente.`);
      } else {
        await ctx.reply('⚠️ No se generó ninguna factura. Por favor, verifica los datos del archivo Excel.');
      }
      
      // Limpiar el estado
      delete ctx.userState.chubbGrupos;
      delete ctx.userState.chubbColumnMappings;
      delete ctx.userState.chubbMontosPorGrupo;
      ctx.userState.esperando = null;
      
    } catch (error) {
      console.error('Error al procesar confirmación de facturas CHUBB:', error);
      await ctx.reply(`❌ Error al generar facturas: ${error.message}`);
      ctx.userState.esperando = null;
    }
  });
  
  // Manejador para cancelar la generación de facturas CHUBB
  bot.action('chubb_cancelar', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(e => console.log('No se pudo editar mensaje:', e.message));
      await ctx.reply('❌ Operación cancelada. No se generaron facturas.');
      
      // Limpiar el estado
      delete ctx.userState.chubbGrupos;
      delete ctx.userState.chubbColumnMappings;
      delete ctx.userState.chubbMontosPorGrupo;
      ctx.userState.esperando = null;
    } catch (error) {
      console.error('Error al cancelar operación:', error);
      await ctx.reply('❌ Error al cancelar la operación.');
      ctx.userState.esperando = null;
    }
  });

  // Manejar la recepción del archivo Excel
  // Manejar la recepción del archivo Excel
  bot.on('document', async (ctx, next) => {
    console.log('=========== INICIO HANDLER CHUBB EXCEL ===========');
    console.log('Documento recibido:', ctx.message.document.file_name);
    console.log('Estado esperando:', ctx.userState?.esperando);
    
    // Solo procesar si estamos esperando un archivo Excel para CHUBB
    if (!ctx.userState || ctx.userState.esperando !== 'archivo_excel_chubb') {
      console.log('No estamos esperando archivo Excel para CHUBB, pasando al siguiente handler');
      console.log('=========== FIN HANDLER CHUBB EXCEL (PASANDO) ===========');
      return next();
    }

    const document = ctx.message.document;
    
    // Verificar que sea un archivo Excel
    if (!document.file_name.match(/\.(xlsx|xls)$/i)) {
      console.log('Documento no es Excel, informando al usuario');
      await ctx.reply('❌ El archivo debe ser de tipo Excel (.xlsx o .xls). Por favor, intenta de nuevo.');
      console.log('=========== FIN HANDLER CHUBB EXCEL (NO ES EXCEL) ===========');
      return; // No pasamos al siguiente handler porque es nuestro contexto pero formato incorrecto
    }

    await ctx.reply('⏳ Recibiendo archivo, por favor espere...');

    try {
      // Descargar el archivo
      const fileLink = await ctx.telegram.getFileLink(document.file_id);
      const tempDir = ensureTempDirExists();
      const filePath = path.join(tempDir, document.file_name);
      
      await downloadFile(fileLink.href, filePath);
      
      await ctx.reply(`✅ Archivo recibido: ${document.file_name}\n⏳ Procesando datos, esto puede tomar un momento...`);
      
      // Procesar el archivo Excel y generar facturas
      const result = await procesarArchivoChubb(ctx, filePath);
      
      // Limpiar el archivo temporal
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('Error al eliminar archivo temporal:', e);
      }

      // Si no hay confirmación pendiente, reseteamos el estado
      if (!result || !result.pendingConfirmation) {
        ctx.userState.esperando = null;
      }
      
      console.log('=========== FIN HANDLER CHUBB EXCEL (PROCESADO) ===========');
      
    } catch (error) {
      console.error('Error al procesar el archivo Excel:', error);
      ctx.reply(`❌ Error al procesar el archivo: ${error.message}`);
      ctx.userState.esperando = null;
      console.log('=========== FIN HANDLER CHUBB EXCEL (ERROR) ===========');
    }
  });
}

/**
 * Asegura que existe el directorio temporal
 * @returns {string} - Ruta al directorio temporal
 */
function ensureTempDirExists() {
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * Descarga un archivo desde una URL
 * @param {string} url - URL del archivo para descargar
 * @param {string} outputPath - Ruta donde guardar el archivo
 * @returns {Promise} - Promesa que se resuelve cuando el archivo se descarga
 */
async function downloadFile(url, outputPath) {
  const writer = fs.createWriteStream(outputPath);
  
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });
  
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * Procesa el archivo Excel de CHUBB y genera facturas
 * @param {Object} ctx - Contexto de Telegram
 * @param {string} filePath - Ruta al archivo Excel
 * @returns {Promise} - Promesa que se resuelve cuando se procesan todas las facturas
 */
async function procesarArchivoChubb(ctx, filePath) {
  try {
    // Leer el archivo Excel
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Obtener los nombres de las columnas para informar al usuario
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const columnNames = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cell = worksheet[XLSX.utils.encode_cell({r:range.s.r, c:C})];
      columnNames.push(cell ? cell.v : undefined);
    }
    
    console.log('Columnas detectadas en el Excel:', columnNames);
    
    // Convertir a JSON
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    if (data.length === 0) {
      await ctx.reply('❌ El archivo Excel no contiene datos. Por favor, revisa el archivo e intenta de nuevo.');
      return { success: false, error: 'Excel sin datos' };
    }

    // Verificar que existan las columnas necesarias
    await ctx.reply('⏳ Validando estructura del archivo Excel...');
    
    // Mapear nombres de columnas que pueden variar
    const columnMappings = mapColumnNames(data[0]);
    
    if (!columnMappings) {
      await ctx.reply('❌ El archivo Excel no tiene todas las columnas requeridas. Se necesitan columnas para: Número de Caso, Servicio, Monto y datos de retención.');
      return { success: false, error: 'Estructura de Excel inválida' };
    }
    
    // Log para ver la estructura de los datos
    console.log('Mapeado de columnas:', columnMappings);
    console.log('Primeras filas del Excel:', data.slice(0, 2));
    
    // Verificar que los valores numéricos sean correctos
    let erroresNumericos = [];
    data.forEach((row, index) => {
      const monto = parseFloat(row[columnMappings.monto]);
      if (isNaN(monto) || monto <= 0) {
        erroresNumericos.push(`Fila ${index + 2}: El monto debe ser un número positivo.`);
      }
    });
    
    if (erroresNumericos.length > 0) {
      // Mostrar hasta 5 errores para no saturar el mensaje
      const erroresMostrados = erroresNumericos.slice(0, 5);
      await ctx.reply(`❌ Se encontraron errores en los datos numéricos:\n${erroresMostrados.join('\n')}\n${erroresNumericos.length > 5 ? `...y ${erroresNumericos.length - 5} más.` : ''}`);
      return { success: false, error: 'Datos numéricos inválidos' };
    }
    
    await ctx.reply('✅ Estructura del archivo validada correctamente.');
    
    // Clasificar los datos en grupos según las reglas usando el mapeo de columnas
    const grupos = clasificarDatos(data, columnMappings);
    
    // Verificar si hay datos para procesar
    const totalRegistros = Object.values(grupos).reduce((total, grupo) => total + grupo.length, 0);
    if (totalRegistros === 0) {
      await ctx.reply('❌ No se encontraron datos válidos para generar facturas después de aplicar los criterios de clasificación.');
      return { success: false, error: 'No hay datos clasificables' };
    }
    
    // Construir resumen de datos por grupo
    let infoGrupos = '📊 Resumen de datos clasificados:\n\n';
    let montosPorGrupo = {};
    
    if (grupos.gruaConRetencion.length > 0) {
      const montoTotal = grupos.gruaConRetencion.reduce((total, item) => {
        return total + parseFloat(item[columnMappings.monto] || 0);
      }, 0);
      montosPorGrupo.gruaConRetencion = montoTotal;
      infoGrupos += `• Servicios GRUA (Con Retención 4%):\n  - ${grupos.gruaConRetencion.length} registros\n  - Monto total: ${montoTotal.toFixed(2)} MXN\n\n`;
    }
    
    if (grupos.gruaSinRetencion.length > 0) {
      const montoTotal = grupos.gruaSinRetencion.reduce((total, item) => {
        return total + parseFloat(item[columnMappings.monto] || 0);
      }, 0);
      montosPorGrupo.gruaSinRetencion = montoTotal;
      infoGrupos += `• Servicios GRUA (Sin Retención):\n  - ${grupos.gruaSinRetencion.length} registros\n  - Monto total: ${montoTotal.toFixed(2)} MXN\n\n`;
    }
    
    if (grupos.otrosServicios.length > 0) {
      const montoTotal = grupos.otrosServicios.reduce((total, item) => {
        return total + parseFloat(item[columnMappings.monto] || 0);
      }, 0);
      montosPorGrupo.otrosServicios = montoTotal;
      infoGrupos += `• Otros Servicios (Sin Retención):\n  - ${grupos.otrosServicios.length} registros\n  - Monto total: ${montoTotal.toFixed(2)} MXN\n\n`;
    }
    
    // Guardar temporalmente los datos en el estado del usuario para procesarlos después de la confirmación
    ctx.userState.chubbGrupos = grupos;
    ctx.userState.chubbColumnMappings = columnMappings;
    ctx.userState.chubbMontosPorGrupo = montosPorGrupo;
    
    // Solicitar confirmación al usuario antes de generar las facturas
    await ctx.reply(
      `${infoGrupos}\n¿Desea proceder con la generación de facturas?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Generar Facturas', 'chubb_confirmar')],
        [Markup.button.callback('❌ Cancelar', 'chubb_cancelar')]
      ])
    );
    
    return { success: true, pendingConfirmation: true };
    
  } catch (error) {
    console.error('Error al procesar archivo Excel:', error);
    await ctx.reply(`❌ Error al procesar el archivo Excel: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Mapea los nombres de las columnas encontrados en el Excel a nombres estandarizados
 * @param {Object} firstRow - Primera fila del Excel para detectar los nombres de columnas
 * @returns {Object|null} - Objeto con el mapeo de columnas o null si no se encuentran las columnas requeridas
 */
function mapColumnNames(firstRow) {
  if (!firstRow) return null;
  
  // Posibles nombres para cada columna requerida
  const posiblesColumnas = {
    numeroCaso: ['No. Caso', 'Caso', 'Numero de Caso', 'Num Caso', 'No Caso', 'Folio'],
    servicio: ['Servicio', 'Tipo de Servicio', 'Tipo Servicio', 'C'],
    monto: ['Subtotal', 'Monto', 'Importe', 'Valor', 'Costo', 'H', 'Precio'],
    retencion: ['Retención', 'Retencion', 'Ret', 'Retención (4%)', 'Retencion 4%', 'Valor Retención']
  };
  
  // Objeto para almacenar las columnas encontradas
  let columnMapping = {};
  
  // Buscar el mejor match para cada columna requerida
  Object.keys(posiblesColumnas).forEach(tipoColumna => {
    // Buscar por nombre exacto primero
    const nombreEncontrado = posiblesColumnas[tipoColumna].find(posibleNombre => 
      Object.keys(firstRow).includes(posibleNombre)
    );
    
    if (nombreEncontrado) {
      columnMapping[tipoColumna] = nombreEncontrado;
    }
    // Si no encontramos match exacto, buscar por coincidencia parcial (case insensitive)
    else {
      const keys = Object.keys(firstRow);
      const matchParcial = keys.find(key => 
        posiblesColumnas[tipoColumna].some(posibleNombre => 
          key.toLowerCase().includes(posibleNombre.toLowerCase())
        )
      );
      
      if (matchParcial) {
        columnMapping[tipoColumna] = matchParcial;
      }
    }
  });
  
  // Verificar que encontramos todas las columnas necesarias
  const requiredKeys = ['numeroCaso', 'servicio', 'monto'];
  if (requiredKeys.every(key => columnMapping[key])) {
    // Si no encontramos la columna de retención, podemos usar un valor por defecto
    if (!columnMapping.retencion) {
      console.log('No se encontró columna de retención, se asume 0');
    }
    return columnMapping;
  }
  
  console.log('No se encontraron todas las columnas requeridas:', columnMapping);
  return null;
}

/**
 * Clasifica los datos del Excel en grupos según las reglas especificadas
 * @param {Array} data - Datos del Excel
 * @param {Object} columnMappings - Mapeo de nombres de columnas
 * @returns {Object} - Objeto con los grupos clasificados
 */
function clasificarDatos(data, columnMappings) {
  const grupos = {
    gruaConRetencion: [],
    gruaSinRetencion: [],
    otrosServicios: []
  };
  
  // Log para depuración
  console.log('Iniciando clasificación de datos con mapeo:', columnMappings);
  
  data.forEach((row, index) => {
    try {
      // Obtener valores usando el mapeo de columnas
      const servicio = String(row[columnMappings.servicio] || '').trim().toUpperCase();
      
      // Obtener el valor de retención - puede ser número o texto
      let valorRetencion = 0;
      if (columnMappings.retencion) {
        valorRetencion = row[columnMappings.retencion];
        // Si es string, intentar convertir a número
        if (typeof valorRetencion === 'string') {
          valorRetencion = parseFloat(valorRetencion.replace(/[^\d.-]/g, ''));
        }
      }
      
      // Para depuración
      console.log(`Fila ${index+2}: Servicio="${servicio}", Retención=${valorRetencion}`);
      
      // Reglas de clasificación ajustadas para los datos de CHUBB
      if (servicio === 'GRUA') {
        // Si hay valor negativo en retención o es < 0, va al grupo con retención
        if (valorRetencion < 0) {
          grupos.gruaConRetencion.push(row);
          console.log(`  → Clasificado como: GRUA CON RETENCIÓN`);
        } else {
          grupos.gruaSinRetencion.push(row);
          console.log(`  → Clasificado como: GRUA SIN RETENCIÓN`);
        }
      } else if (servicio) {
        grupos.otrosServicios.push(row);
        console.log(`  → Clasificado como: OTRO SERVICIO`);
      } else {
        console.log(`  → Fila omitida: No tiene servicio identificable`);
      }
    } catch (error) {
      console.error(`Error al clasificar fila ${index+2}:`, error, row);
    }
  });
  
  // Log de resumen
  console.log(`Clasificación completada: ${grupos.gruaConRetencion.length} con retención, ${grupos.gruaSinRetencion.length} sin retención, ${grupos.otrosServicios.length} otros servicios`);
  
  return grupos;
}

/**
 * Genera una factura para un grupo específico
 * @param {Array} items - Elementos a incluir en la factura
 * @param {string} claveSAT - Clave SAT a utilizar
 * @param {boolean} conRetencion - Si aplica retención o no
 * @param {Object} ctx - Contexto de Telegram
 * @param {Object} columnMappings - Mapeo de nombres de columnas
 * @returns {Promise<Object>} - Factura generada
 */
async function generarFacturaParaGrupo(items, claveSAT, conRetencion, ctx, columnMappings) {
  if (items.length === 0) {
    console.log(`No hay items para generar factura con clave ${claveSAT}`);
    return null;
  }
  
  // Calcular el monto total de todos los servicios en este grupo
  const montoTotal = items.reduce((total, item) => {
    const monto = parseFloat(item[columnMappings.monto]);
    return total + (isNaN(monto) ? 0 : monto);
  }, 0);
  
  if (montoTotal <= 0) {
    await ctx.reply(`⚠️ No se generó factura para clave SAT ${claveSAT} porque el monto total es 0.`);
    return null;
  }
  
  // Construir array de ítems para la factura
  const facturaItems = items.map(item => {
    const numeroCaso = item[columnMappings.numeroCaso] || 'N/A';
    const tipoServicio = item[columnMappings.servicio] || 'N/A';
    const subtotal = parseFloat(item[columnMappings.monto]);
    
    // Obtener el valor de retención si existe
    let retencionTexto = '';
    let retencionValor = 0;
    if (columnMappings.retencion && item[columnMappings.retencion]) {
      retencionValor = parseFloat(item[columnMappings.retencion]);
      // Solo incluir si hay retención (valor distinto de 0)
      if (retencionValor !== 0) {
        retencionTexto = ` | Retención: $${Math.abs(retencionValor).toFixed(2)}`;
      }
    }
    
    // Descripción para cada ítem individual
    const descripcion = `No. Caso ${numeroCaso} Proveedor ${item.Proveedor || '2233-GRUAS CRK'} Servicio ${tipoServicio} | Subtotal: $${subtotal.toFixed(2)}${retencionTexto}`;
    
    return {
      quantity: 1,
      product: {
        description: descripcion,
        product_key: claveSAT,
        unit_key: "E48",  // Clave de unidad para SERVICIO
        unit_name: "SERVICIO",
        price: subtotal,
        tax_included: false,
        taxes: conRetencion ? 
          [
            { type: "IVA", rate: 0.16, factor: "Tasa" },
            { type: "IVA", rate: 0.04, factor: "Tasa", withholding: true }
          ] : 
          [
            { type: "IVA", rate: 0.16, factor: "Tasa" }
          ]
      }
    };
  });
  
  // Construir los datos de la factura
  const facturaData = {
    customer: ctx.userState.chubbClientId,
    items: facturaItems,
    use: "G03",  // Uso de CFDI
    payment_form: "99",  // Forma de pago
    payment_method: "PPD",  // Método de pago
    currency: "MXN",
    exchange: 1
  };
  
  // Mostrar resumen detallado de la factura antes de generarla
  await ctx.reply(
    `📋 *Vista previa de factura*\n\n` +
    `• Tipo: ${conRetencion ? 'GRUA Con Retención (4%)' : claveSAT === CLAVE_SAT_GRUA_CON_RETENCION ? 'GRUA Sin Retención' : 'Otros Servicios Sin Retención'}\n` +
    `• Cliente: CHUBB\n` +
    `• Clave SAT: ${claveSAT}\n` +
    `• Registros incluidos: ${items.length}\n` +
    `• Monto: $${montoTotal.toFixed(2)} MXN\n`,
    { parse_mode: 'Markdown' }
  );

  // Llamar directamente a FacturAPI para generar la factura
  try {
    await ctx.reply(`⏳ Generando factura para: ${claveSAT} (${conRetencion ? 'Con' : 'Sin'} retención)...`);
    
    // Obtener el ID del tenant actual
    const tenantId = ctx.getTenantId();
    if (!tenantId) {
      throw new Error('No se pudo obtener el ID del tenant');
    }
    
    console.log(`Tenant ID obtenido: ${tenantId}`);
    
    // Importar facturapIService
    const facturapIService = await import('../../services/facturapi.service.js').then(m => m.default);
    
    // Obtener cliente de FacturAPI
    const facturapi = await facturapIService.getFacturapiClient(tenantId);
    console.log('Cliente FacturAPI obtenido correctamente');
    
    // Obtenemos el TenantService pero NO solicitamos ni asignamos el folio
    const TenantService = await import('../../services/tenant.service.js').then(m => m.default);
    
    console.log('Enviando solicitud a FacturAPI con datos:', JSON.stringify(facturaData, null, 2));
    
    // Crear la factura directamente en FacturAPI (sin enviar folio)
    const factura = await facturapi.invoices.create(facturaData);
    console.log('Factura creada en FacturAPI, folio asignado automáticamente:', factura.folio_number);
    
    // Registrar la factura en la base de datos con el folio devuelto por FacturAPI
    try {
      const registeredInvoice = await TenantService.registerInvoice(
        tenantId,
        factura.id,
        factura.series || 'A',
        factura.folio_number, // Usamos el folio que FacturAPI asignó
        null, // customerId, podríamos buscar el ID del cliente en la base de datos si es necesario
        factura.total,
        ctx.from?.id ? BigInt(ctx.from.id) : null // ID del usuario que creó la factura
      );
      
      console.log('Factura registrada en la base de datos:', registeredInvoice);
    } catch (registerError) {
      // Si hay un error al registrar, lo registramos pero continuamos
      console.error('Error al registrar factura en la base de datos:', registerError);
    }
    
    // Guardar el ID de la factura en el estado del usuario para usarlo posteriormente
    ctx.userState.facturaId = factura.id;
    ctx.userState.folioFactura = factura.folio_number;
    ctx.userState.facturaGenerada = true;
    
    // Mostrar información de la factura generada
    await ctx.reply(
      `✅ *Factura generada exitosamente*\n\n` +
      `• Cliente: CHUBB\n` +
      `• Folio: ${factura.series}-${factura.folio_number}\n` +
      `• Clave SAT: ${claveSAT}\n` +
      `• ${conRetencion ? 'Con Retención (4%)' : 'Sin Retención'}\n` +
      `• Total: $${factura.total.toFixed(2)} MXN\n\n` +
      `Seleccione una opción para descargar:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📄 Descargar PDF', `pdf_${factura.id}_${factura.folio_number}`)],
          [Markup.button.callback('🔠 Descargar XML', `xml_${factura.id}_${factura.folio_number}`)]
        ])
      }
    );
    
    return factura;
    
  } catch (error) {
    console.error('Error al generar factura:', error);
    let errorMsg = 'Error al generar la factura.';
    
    if (error.response && error.response.data) {
      console.log('Respuesta de error completa:', JSON.stringify(error.response.data, null, 2));
      if (typeof error.response.data.message === 'string') {
        errorMsg = `Error de FacturAPI: ${error.response.data.message}`;
      } else if (error.response.data.details) {
        errorMsg = `Error de validación: ${JSON.stringify(error.response.data.details)}`;
      }
    }
    
    await ctx.reply(`❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
}