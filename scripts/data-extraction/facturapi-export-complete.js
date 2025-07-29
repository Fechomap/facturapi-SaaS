#!/usr/bin/env node
/**
 * EXPORTADOR COMPLETO: Solo FacturAPI
 * 
 * Extrae TODA la información de facturas de FacturAPI de los 3 tenants específicos
 * y genera CSV + EXCEL para análisis
 * 
 * Uso: node scripts/facturapi-export-complete.js
 */

import prisma from '../../lib/prisma.js';
import axios from 'axios';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

// Obtener todos los tenants activos dinámicamente
async function getAllActiveTenants() {
  try {
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true, businessName: true, rfc: true }
    });
    return tenants.map(t => t.id);
  } catch (error) {
    log('ERROR', 'Error obteniendo tenants:', error);
    return [];
  }
}

const CONFIG = {
  RATE_LIMIT_MS: 3000, // 3 segundos entre consultas
  OUTPUT_DIR: './facturapi-export',
  TIMESTAMP: new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
             new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, ''),
  MAX_PAGES_PER_TENANT: 200, // Máximo 200 páginas = 10,000 facturas por tenant
};

let STATS = {
  startTime: new Date(),
  tenants: {
    processed: 0,
    errors: 0,
  },
  facturapi: {
    totalInvoices: 0,
    totalRequests: 0,
    errors: 0,
    totalPages: 0,
  }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Convertir fecha UTC a timezone de México (CDMX)
 * @param {Date|string} date - Fecha a convertir
 * @returns {string} - Fecha en formato YYYY-MM-DD HH:mm:ss en timezone México
 */
function formatDateToMexicoTimezone(date) {
  if (!date) return '';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '';
  
  // Convertir a timezone de México (UTC-6)
  const mexicoDate = new Date(dateObj.toLocaleString("en-US", {timeZone: "America/Mexico_City"}));
  
  const year = mexicoDate.getFullYear();
  const month = String(mexicoDate.getMonth() + 1).padStart(2, '0');
  const day = String(mexicoDate.getDate()).padStart(2, '0');
  const hours = String(mexicoDate.getHours()).padStart(2, '0');
  const minutes = String(mexicoDate.getMinutes()).padStart(2, '0');
  const seconds = String(mexicoDate.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Obtener solo la fecha (sin hora) en timezone de México
 * @param {Date|string} date - Fecha a convertir
 * @returns {string} - Fecha en formato YYYY-MM-DD
 */
function formatDateOnlyToMexico(date) {
  if (!date) return '';
  return formatDateToMexicoTimezone(date).split(' ')[0];
}

function log(level, message, data = null) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = {
    INFO: '📊',
    SUCCESS: '✅', 
    WARNING: '⚠️',
    ERROR: '❌',
    DEBUG: '🔍'
  }[level] || '📝';
  
  console.log(`${prefix} [${timestamp}] ${message}`);
  if (data && typeof data === 'object') {
    console.log('   ', JSON.stringify(data, null, 2));
  } else if (data) {
    console.log('   ', data);
  }
}

/**
 * Obtener información del tenant
 */
async function getTenantInfo(tenantId) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true,
        rfc: true,
        email: true,
        phone: true,
        facturapiApiKey: true,
        facturapiOrganizationId: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!tenant) {
      throw new Error(`Tenant ${tenantId} no encontrado`);
    }

    if (!tenant.isActive) {
      log('WARNING', `Tenant ${tenantId} está inactivo, pero continuando...`);
    }

    if (!tenant.facturapiApiKey) {
      throw new Error(`Tenant ${tenantId} no tiene API key de FacturAPI`);
    }

    return tenant;
  } catch (error) {
    log('ERROR', `Error obteniendo tenant ${tenantId}`, { error: error.message });
    throw error;
  }
}

/**
 * Extraer TODAS las facturas de FacturAPI para un tenant
 */
async function extractFacturapiInvoices(tenant) {
  log('INFO', `📡 Extrayendo facturas de FacturAPI: ${tenant.businessName}`);
  
  const allInvoices = [];
  let page = 1;
  let hasMore = true;
  let consecutiveErrors = 0;

  try {
    while (hasMore && page <= CONFIG.MAX_PAGES_PER_TENANT) {
      try {
        log('DEBUG', `   📄 Página ${page}...`);
        
        const response = await axios.get(
          'https://www.facturapi.io/v2/invoices',
          {
            headers: {
              'Authorization': `Bearer ${tenant.facturapiApiKey}`,
              'Content-Type': 'application/json',
            },
            params: {
              limit: 50,
              page: page,
            },
            timeout: 20000, // 20 segundos timeout
          }
        );

        const invoices = response.data.data || response.data;
        
        if (!Array.isArray(invoices)) {
          log('WARNING', `   Respuesta inesperada en página ${page}`, { response: response.data });
          break;
        }

        allInvoices.push(...invoices);
        
        log('DEBUG', `   ✅ Página ${page}: ${invoices.length} facturas (Total: ${allInvoices.length})`);
        
        // Verificar si hay más páginas
        hasMore = invoices.length === 50;
        page++;
        consecutiveErrors = 0; // Reset contador de errores
        
        STATS.facturapi.totalRequests++;
        STATS.facturapi.totalPages++;
        
        // Rate limiting
        if (hasMore) {
          await sleep(CONFIG.RATE_LIMIT_MS);
        }
        
      } catch (pageError) {
        consecutiveErrors++;
        log('ERROR', `   Error en página ${page} (intento ${consecutiveErrors})`, { error: pageError.message });
        
        if (consecutiveErrors >= 3) {
          log('ERROR', `   Demasiados errores consecutivos, terminando extracción para ${tenant.businessName}`);
          break;
        }
        
        // Pausa extra en caso de error
        await sleep(CONFIG.RATE_LIMIT_MS * 2);
        // No incrementar página para reintentar
      }
    }

    STATS.facturapi.totalInvoices += allInvoices.length;
    
    log('SUCCESS', `📡 FacturAPI completado: ${allInvoices.length} facturas en ${page - 1} páginas`);
    
    // Transformar datos a formato detallado para análisis
    return allInvoices.map((invoice, index) => ({
      // Identificadores
      rowNumber: index + 1,
      tenantId: tenant.id,
      tenantName: tenant.businessName,
      tenantRfc: tenant.rfc,
      tenantEmail: tenant.email,
      tenantPhone: tenant.phone,
      facturapiOrgId: tenant.facturapiOrganizationId,
      
      // Datos de la factura
      facturapiId: invoice.id,
      uuid: invoice.uuid || '',
      series: invoice.series || '',
      folioNumber: invoice.folio_number || '',
      folio: `${invoice.series || ''}${invoice.folio_number || ''}`,
      
      // Estados y tipo
      status: invoice.status || '',
      type: invoice.type || 'invoice',
      use: invoice.use || '',
      paymentMethod: invoice.payment_method || '',
      paymentForm: invoice.payment_form || '',
      
      // Fechas (timezone México CDMX)
      date: invoice.date || '',
      dateOnly: formatDateOnlyToMexico(invoice.date),
      createdAt: invoice.created_at || '',
      createdAtOnly: formatDateOnlyToMexico(invoice.created_at),
      
      // Montos
      subtotal: invoice.subtotal || 0,
      tax: invoice.tax || 0,
      total: invoice.total || 0,
      currency: invoice.currency || 'MXN',
      
      // Cliente
      customerLegalName: invoice.customer?.legal_name || '',
      customerTaxId: invoice.customer?.tax_id || '',
      customerEmail: invoice.customer?.email || '',
      customerPhone: invoice.customer?.phone || '',
      
      // Dirección del cliente
      customerStreet: invoice.customer?.address?.street || '',
      customerExterior: invoice.customer?.address?.exterior || '',
      customerInterior: invoice.customer?.address?.interior || '',
      customerNeighborhood: invoice.customer?.address?.neighborhood || '',
      customerCity: invoice.customer?.address?.city || '',
      customerState: invoice.customer?.address?.state || '',
      customerZip: invoice.customer?.address?.zip || '',
      customerCountry: invoice.customer?.address?.country || '',
      
      // Items (resumen)
      itemsCount: invoice.items?.length || 0,
      firstItemDescription: invoice.items?.[0]?.description || '',
      firstItemQuantity: invoice.items?.[0]?.quantity || 0,
      firstItemPrice: invoice.items?.[0]?.price || 0,
      
      // Información fiscal
      stamp: invoice.stamp || '',
      
      // Metadatos para debugging
      rawCreatedAt: invoice.created_at,
      rawDate: invoice.date,
      extractedAt: new Date().toISOString(),
    }));

  } catch (error) {
    log('ERROR', `Error general extrayendo de FacturAPI: ${tenant.businessName}`, { error: error.message });
    STATS.facturapi.errors++;
    throw error;
  }
}

/**
 * Exportar resultados a CSV con manejo robusto
 */
function exportToCSV(data, filename) {
  try {
    mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
    
    if (!data || data.length === 0) {
      log('WARNING', `Sin datos para exportar: ${filename}`);
      writeFileSync(path.join(CONFIG.OUTPUT_DIR, filename), 'Sin datos encontrados\n', 'utf8');
      return;
    }
    
    log('INFO', `📝 Generando CSV: ${filename} (${data.length} registros)`);
    
    // Obtener todas las columnas únicas
    const allHeaders = new Set();
    data.forEach(row => {
      Object.keys(row).forEach(key => allHeaders.add(key));
    });
    
    const headers = Array.from(allHeaders).sort();
    
    // Generar CSV
    const csvRows = [
      headers.join(','), // Header
      ...data.map(row => 
        headers.map(header => {
          let value = row[header];
          
          // Manejar valores nulos/undefined
          if (value === null || value === undefined) {
            value = '';
          }
          
          // Convertir a string y escapar
          value = String(value);
          
          // Escapar comillas dobles y envolver en comillas si contiene comas o saltos
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            value = `"${value.replace(/"/g, '""')}"`;
          }
          
          return value;
        }).join(',')
      )
    ];
    
    const csvContent = csvRows.join('\n');
    const filePath = path.join(CONFIG.OUTPUT_DIR, filename);
    
    writeFileSync(filePath, csvContent, 'utf8');
    
    log('SUCCESS', `📁 CSV exportado: ${filePath}`);
    log('INFO', `   📊 ${data.length} registros, ${headers.length} columnas`);
    
  } catch (error) {
    log('ERROR', `Error exportando CSV ${filename}`, { error: error.message });
  }
}

/**
 * Exportar resultados a Excel nativo con formato
 */
async function exportToExcel(data, filename) {
  try {
    mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
    
    if (!data || data.length === 0) {
      log('WARNING', `Sin datos para exportar Excel: ${filename}`);
      return;
    }
    
    log('INFO', `📊 Generando Excel: ${filename} (${data.length} registros)`);
    
    // Crear workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FacturAPI Audit Script';
    workbook.created = new Date();
    
    // Crear worksheet
    const worksheet = workbook.addWorksheet('Facturas FacturAPI', {
      pageSetup: { paperSize: 9, orientation: 'landscape' }
    });
    
    // Obtener headers
    const headers = Object.keys(data[0]).sort();
    
    // Configurar columnas con headers
    worksheet.columns = headers.map(header => ({
      header: header,
      key: header,
      width: getColumnWidth(header),
    }));
    
    // Estilo del header
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '4472C4' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    
    // Agregar datos
    data.forEach((row, index) => {
      const worksheetRow = worksheet.addRow(row);
      
      // Alternar colores de filas
      if (index % 2 === 1) {
        worksheetRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'F2F2F2' }
          };
        });
      }
      
      // Formatear celdas especiales
      worksheetRow.eachCell((cell, colNumber) => {
        const header = headers[colNumber - 1];
        
        // Formato para fechas
        if (header.includes('date') || header.includes('Date') || header.includes('fecha') || header.includes('Fecha')) {
          if (cell.value && cell.value !== '') {
            cell.numFmt = 'yyyy-mm-dd';
          }
        }
        
        // Formato para montos
        if (header.includes('total') || header.includes('Total') || header.includes('subtotal') || header.includes('tax')) {
          if (typeof cell.value === 'number') {
            cell.numFmt = '"$"#,##0.00';
          }
        }
        
        // Bordes para todas las celdas
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });
    
    // Freeze header row
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    
    // Auto-filtros
    worksheet.autoFilter = {
      from: 'A1',
      to: `${String.fromCharCode(64 + headers.length)}${data.length + 1}`
    };
    
    // Guardar archivo
    const filePath = path.join(CONFIG.OUTPUT_DIR, filename);
    await workbook.xlsx.writeFile(filePath);
    
    log('SUCCESS', `📊 Excel exportado: ${filePath}`);
    log('INFO', `   ✨ Con formato, filtros y freeze de headers`);
    
  } catch (error) {
    log('ERROR', `Error exportando Excel ${filename}`, { error: error.message });
  }
}

/**
 * Obtener ancho apropiado de columna según el header
 */
function getColumnWidth(header) {
  const widthMap = {
    'tenantName': 25,
    'facturapiId': 30,
    'customerName': 30,
    'customerLegalName': 30,
    'folio': 15,
    'total': 12,
    'subtotal': 12,
    'date': 12,
    'createdAt': 12,
    'uuid': 35,
    'status': 12,
    'series': 8,
    'folioNumber': 12,
  };
  
  // Buscar coincidencia exacta o parcial
  for (const [key, width] of Object.entries(widthMap)) {
    if (header === key || header.toLowerCase().includes(key.toLowerCase())) {
      return width;
    }
  }
  
  // Ancho por defecto basado en longitud del header
  return Math.min(Math.max(header.length + 2, 10), 50);
}

/**
 * Mostrar resumen ejecutivo
 */
function showExecutiveSummary(allData) {
  const duration = Math.round((Date.now() - STATS.startTime.getTime()) / 1000);
  
  console.log('\n' + '═'.repeat(80));
  console.log('📊 RESUMEN EJECUTIVO - EXPORTACIÓN FACTURAPI');
  console.log('═'.repeat(80));
  
  console.log(`⏱️  Duración total: ${Math.floor(duration / 60)}m ${duration % 60}s`);
  console.log(`🏢 Tenants procesados: ${STATS.tenants.processed}/${TARGET_TENANTS.length}`);
  console.log(`📡 Total facturas extraídas: ${STATS.facturapi.totalInvoices}`);
  console.log(`📄 Total páginas consultadas: ${STATS.facturapi.totalPages}`);
  console.log(`🌐 Total requests a FacturAPI: ${STATS.facturapi.totalRequests}`);
  console.log(`❌ Errores encontrados: ${STATS.facturapi.errors}`);
  
  // Análisis por tenant
  const tenantSummary = {};
  allData.forEach(invoice => {
    if (!tenantSummary[invoice.tenantName]) {
      tenantSummary[invoice.tenantName] = {
        count: 0,
        rfc: invoice.tenantRfc,
      };
    }
    tenantSummary[invoice.tenantName].count++;
  });
  
  console.log(`\n📈 FACTURAS POR TENANT:`);
  Object.entries(tenantSummary).forEach(([name, data]) => {
    console.log(`   ${name} (${data.rfc}): ${data.count} facturas`);
  });
  
  // Análisis de fechas
  const dateRanges = allData.map(inv => inv.dateOnly).filter(d => d);
  const minDate = dateRanges.length > 0 ? Math.min(...dateRanges.map(d => new Date(d).getTime())) : null;
  const maxDate = dateRanges.length > 0 ? Math.max(...dateRanges.map(d => new Date(d).getTime())) : null;
  
  if (minDate && maxDate) {
    console.log(`\n📅 RANGO DE FECHAS:`);
    console.log(`   Fecha más antigua: ${new Date(minDate).toISOString().split('T')[0]}`);
    console.log(`   Fecha más reciente: ${new Date(maxDate).toISOString().split('T')[0]}`);
  }
  
  console.log(`\n📁 ARCHIVOS GENERADOS:`);
  console.log(`   📄 CSV completo: ${CONFIG.OUTPUT_DIR}/${CONFIG.TIMESTAMP}_facturapi_complete.csv`);
  
  console.log('═'.repeat(80));
}

/**
 * Función principal
 */
async function main() {
  try {
    log('INFO', '🚀 INICIANDO EXPORTACIÓN COMPLETA DE FACTURAPI');
    console.log('═'.repeat(80));
    
    // Obtener todos los tenants activos
    const TARGET_TENANTS = await getAllActiveTenants();
    
    log('INFO', `📋 Tenants activos encontrados: ${TARGET_TENANTS.length}`);
    log('INFO', `📁 Directorio salida: ${CONFIG.OUTPUT_DIR}`);
    log('INFO', `⚡ Rate limit: ${CONFIG.RATE_LIMIT_MS}ms entre requests`);
    
    const allFacturapiData = [];
    
    // Procesar cada tenant
    for (let i = 0; i < TARGET_TENANTS.length; i++) {
      const tenantId = TARGET_TENANTS[i];
      
      try {
        log('INFO', `\n🎯 Procesando tenant ${i + 1}/${TARGET_TENANTS.length}: ${tenantId}`);
        
        // Obtener información del tenant
        const tenant = await getTenantInfo(tenantId);
        log('INFO', `🏢 ${tenant.businessName} (${tenant.rfc})`);
        
        // Extraer facturas de FacturAPI
        const facturapiInvoices = await extractFacturapiInvoices(tenant);
        allFacturapiData.push(...facturapiInvoices);
        
        STATS.tenants.processed++;
        
        log('SUCCESS', `✅ Tenant completado: ${facturapiInvoices.length} facturas extraídas`);
        
        // Pausa entre tenants
        if (i < TARGET_TENANTS.length - 1) {
          log('INFO', '   ⏳ Pausa entre tenants...');
          await sleep(5000); // 5 segundos entre tenants
        }
        
      } catch (error) {
        log('ERROR', `Error procesando tenant ${tenantId}`, { error: error.message });
        STATS.tenants.errors++;
        
        // Continuar con el siguiente tenant
        continue;
      }
    }
    
    // Exportar resultados en ambos formatos
    const baseFilename = `${CONFIG.TIMESTAMP}_facturapi_complete`;
    const csvFilename = `${baseFilename}.csv`;
    const excelFilename = `${baseFilename}.xlsx`;
    
    // Exportar CSV y Excel en paralelo
    await Promise.all([
      Promise.resolve(exportToCSV(allFacturapiData, csvFilename)),
      exportToExcel(allFacturapiData, excelFilename)
    ]);
    
    // Mostrar resumen
    showExecutiveSummary(allFacturapiData);
    
    log('SUCCESS', '🎉 EXPORTACIÓN COMPLETADA EXITOSAMENTE');
    
  } catch (error) {
    log('ERROR', 'Error fatal en exportación', { error: error.message });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    
    // Forzar salida limpia
    setTimeout(() => {
      log('INFO', '👋 Finalizando proceso...');
      process.exit(0);
    }, 2000);
  }
}

// Ejecutar
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  });
}

export default main;