#!/usr/bin/env node
/**
 * EXPORTADOR POSTGRESQL: Facturas de los 3 tenants
 *
 * Extrae TODAS las facturas de PostgreSQL de los mismos tenants
 * para comparar con FacturAPI
 */

import prisma from '../../lib/prisma.js';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

// Obtener todos los tenants activos dinámicamente
async function getAllActiveTenants() {
  try {
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true, businessName: true, rfc: true },
    });
    return tenants.map((t) => t.id);
  } catch (error) {
    log('ERROR', 'Error obteniendo tenants:', error);
    return [];
  }
}

const CONFIG = {
  OUTPUT_DIR: './postgresql-export',
  TIMESTAMP:
    new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] +
    '_' +
    new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, ''),
};

const STATS = {
  startTime: new Date(),
  tenants: { processed: 0, errors: 0 },
  postgresql: { totalInvoices: 0, errors: 0 },
};

/**
 * Convertir fecha UTC a timezone de México (CDMX)
 * @param {Date} date - Fecha a convertir
 * @returns {string} - Fecha en formato YYYY-MM-DD HH:mm:ss en timezone México
 */
function formatDateToMexicoTimezone(date) {
  if (!date) return '';

  // Convertir a timezone de México (UTC-6)
  const mexicoDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));

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
 * @param {Date} date - Fecha a convertir
 * @returns {string} - Fecha en formato YYYY-MM-DD
 */
function formatDateOnlyToMexico(date) {
  if (!date) return '';
  return formatDateToMexicoTimezone(date).split(' ')[0];
}

/**
 * Obtener solo la hora en timezone de México
 * @param {Date} date - Fecha a convertir
 * @returns {string} - Hora en formato HH:mm:ss
 */
function formatTimeOnlyToMexico(date) {
  if (!date) return '';
  return formatDateToMexicoTimezone(date).split(' ')[1];
}

function log(level, message, data = null) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix =
    { INFO: '📊', SUCCESS: '✅', WARNING: '⚠️', ERROR: '❌', DEBUG: '🔍' }[level] || '📝';

  console.log(`${prefix} [${timestamp}] ${message}`);
  if (data) console.log('   ', JSON.stringify(data, null, 2));
}

async function getTenantInfo(tenantId) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true,
        rfc: true,
        email: true,
        isActive: true,
      },
    });

    if (!tenant) {
      throw new Error(`Tenant ${tenantId} no encontrado`);
    }

    return tenant;
  } catch (error) {
    log('ERROR', `Error obteniendo tenant ${tenantId}`, { error: error.message });
    throw error;
  }
}

async function extractPostgreSQLInvoices(tenant) {
  log('INFO', `🗄️ Extrayendo facturas de PostgreSQL: ${tenant.businessName}`);

  try {
    // Extraer de la tabla tenantInvoice
    const invoices = await prisma.tenantInvoice.findMany({
      where: {
        tenantId: tenant.id,
      },
      select: {
        id: true,
        tenantId: true,
        facturapiInvoiceId: true,
        uuid: true,
        series: true,
        folioNumber: true,
        status: true,
        invoiceDate: true,
        createdAt: true,
        updatedAt: true,
        total: true,
        customerId: true,
        createdById: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    STATS.postgresql.totalInvoices += invoices.length;
    log('SUCCESS', `🗄️ PostgreSQL completado: ${invoices.length} facturas`);

    // Transformar datos a formato simplificado
    return invoices.map((invoice, index) => ({
      tenantId: tenant.id,
      tenantName: tenant.businessName,
      tenantRfc: tenant.rfc,
      folio: `${invoice.series || ''}${invoice.folioNumber || ''}`,
      uuid: invoice.uuid || '',
      fechaFactura: formatDateOnlyToMexico(invoice.invoiceDate),
      total: parseFloat(invoice.total || 0),
      status: invoice.status || '',
      postgresId: invoice.id,
      facturapiId: invoice.facturapiInvoiceId,
    }));
  } catch (error) {
    log('ERROR', `Error extrayendo de PostgreSQL: ${tenant.businessName}`, {
      error: error.message,
    });
    STATS.postgresql.errors++;
    return [];
  }
}

function exportToCSV(data, filename) {
  try {
    mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });

    if (!data?.length) {
      log('WARNING', 'Sin datos para CSV');
      return;
    }

    log('INFO', `📝 Generando CSV: ${filename}`);

    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(','),
      ...data.map((row) =>
        headers
          .map((header) => {
            let value = String(row[header] || '');
            if (value.includes(',') || value.includes('"')) {
              value = `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          })
          .join(',')
      ),
    ];

    const filePath = path.join(CONFIG.OUTPUT_DIR, filename);
    writeFileSync(filePath, csvRows.join('\n'), 'utf8');

    log('SUCCESS', `📁 CSV exportado: ${filePath}`);
    log('INFO', `   📊 ${data.length} registros, ${headers.length} columnas`);
  } catch (error) {
    log('ERROR', `Error exportando CSV`, { error: error.message });
  }
}

async function exportToExcel(data, filename) {
  try {
    mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });

    if (!data?.length) {
      log('WARNING', 'Sin datos para Excel');
      return;
    }

    log('INFO', `📊 Generando Excel: ${filename}`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PostgreSQL Audit';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Facturas PostgreSQL');

    const headers = Object.keys(data[0]);
    worksheet.columns = headers.map((header) => ({
      header: header,
      key: header,
      width: getColumnWidth(header),
    }));

    // Header style
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '28A745' }, // Verde para PostgreSQL
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // Add data
    data.forEach((row, index) => {
      const worksheetRow = worksheet.addRow(row);

      if (index % 2 === 1) {
        worksheetRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'F2F2F2' },
          };
        });
      }

      worksheetRow.eachCell((cell, colNumber) => {
        const header = headers[colNumber - 1];

        if (header === 'fechaFactura') {
          if (cell.value && cell.value !== '') {
            cell.numFmt = 'yyyy-mm-dd';
            cell.alignment = { horizontal: 'center' };
          }
        }

        if (header === 'total') {
          if (!isNaN(cell.value) && cell.value !== '') {
            cell.numFmt = '"$"#,##0.00';
            cell.alignment = { horizontal: 'right' };
          }
        }

        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    });

    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = {
      from: 'A1',
      to: `${String.fromCharCode(64 + headers.length)}${data.length + 1}`,
    };

    const filePath = path.join(CONFIG.OUTPUT_DIR, filename);
    await workbook.xlsx.writeFile(filePath);

    log('SUCCESS', `📊 Excel exportado: ${filePath}`);
    log('INFO', `   ✨ Con formato PostgreSQL (headers verdes)`);
  } catch (error) {
    log('ERROR', `Error exportando Excel`, { error: error.message });
  }
}

function getColumnWidth(header) {
  const widthMap = {
    tenantId: 40,
    tenantName: 30,
    tenantRfc: 15,
    folio: 15,
    uuid: 40,
    fechaFactura: 12,
    total: 15,
    status: 12,
    postgresId: 12,
    facturapiId: 30,
  };

  return widthMap[header] || 15;
}

function showSummary(allData) {
  const duration = Math.round((Date.now() - STATS.startTime.getTime()) / 1000);

  console.log('\n' + '═'.repeat(80));
  console.log('📊 RESUMEN EJECUTIVO - AUDITORÍA POSTGRESQL');
  console.log('═'.repeat(80));

  console.log(`⏱️  Duración: ${Math.floor(duration / 60)}m ${duration % 60}s`);
  console.log(`🏢 Tenants procesados: ${STATS.tenants.processed}`);
  console.log(`🗄️ Total facturas: ${STATS.postgresql.totalInvoices}`);
  console.log(`❌ Errores: ${STATS.postgresql.errors}`);

  // Por tenant
  const tenantSummary = {};
  allData.forEach((invoice) => {
    if (!tenantSummary[invoice.tenantName]) {
      tenantSummary[invoice.tenantName] = { count: 0, rfc: invoice.tenantRfc };
    }
    tenantSummary[invoice.tenantName].count++;
  });

  console.log(`\n📈 FACTURAS POR TENANT:`);
  Object.entries(tenantSummary).forEach(([name, data]) => {
    console.log(`   ${name} (${data.rfc}): ${data.count} facturas`);
  });

  // Fechas
  const dateRanges = allData.map((inv) => inv.fechaFactura).filter((d) => d);
  if (dateRanges.length > 0) {
    const minDate = Math.min(...dateRanges.map((d) => new Date(d).getTime()));
    const maxDate = Math.max(...dateRanges.map((d) => new Date(d).getTime()));

    console.log(`\n📅 RANGO DE FECHAS (invoiceDate):`);
    console.log(`   Más antigua: ${new Date(minDate).toISOString().split('T')[0]}`);
    console.log(`   Más reciente: ${new Date(maxDate).toISOString().split('T')[0]}`);
  }

  // Análisis de campos específicos
  const facturapiIds = allData.filter((inv) => inv.facturapiId).length;
  const withCustomer = allData.filter((inv) => inv.customerId).length;
  const withCreatedBy = allData.filter((inv) => inv.createdById).length;

  console.log(`\n🔍 ANÁLISIS DE CAMPOS:`);
  console.log(`   Con FacturAPI ID: ${facturapiIds}/${allData.length}`);
  console.log(`   Con Customer ID: ${withCustomer}/${allData.length}`);
  console.log(`   Con Created By ID: ${withCreatedBy}/${allData.length}`);

  console.log(`\n📁 ARCHIVOS GENERADOS:`);
  console.log(`   📄 ${CONFIG.OUTPUT_DIR}/${CONFIG.TIMESTAMP}_postgresql_complete.csv`);
  console.log(`   📊 ${CONFIG.OUTPUT_DIR}/${CONFIG.TIMESTAMP}_postgresql_complete.xlsx`);
  console.log('═'.repeat(80));
}

async function main() {
  try {
    log('INFO', '🚀 INICIANDO EXTRACCIÓN POSTGRESQL');
    console.log('═'.repeat(80));

    // Obtener todos los tenants activos
    const TARGET_TENANTS = await getAllActiveTenants();

    log('INFO', `📋 Tenants activos encontrados: ${TARGET_TENANTS.length}`);
    log('INFO', `📁 Salida: ${CONFIG.OUTPUT_DIR}`);

    const allData = [];

    for (let i = 0; i < TARGET_TENANTS.length; i++) {
      const tenantId = TARGET_TENANTS[i];

      try {
        log('INFO', `\n🎯 Tenant ${i + 1}/${TARGET_TENANTS.length}: ${tenantId}`);

        const tenant = await getTenantInfo(tenantId);
        log('INFO', `🏢 ${tenant.businessName} (${tenant.rfc})`);

        const invoices = await extractPostgreSQLInvoices(tenant);
        allData.push(...invoices);

        STATS.tenants.processed++;
        log('SUCCESS', `✅ Completado: ${invoices.length} facturas`);
      } catch (error) {
        log('ERROR', `Error en tenant ${tenantId}`, { error: error.message });
        STATS.tenants.errors++;
        continue;
      }
    }

    // Exportar CSV y Excel
    const baseFilename = `${CONFIG.TIMESTAMP}_postgresql_complete`;
    const csvFilename = `${baseFilename}.csv`;
    const excelFilename = `${baseFilename}.xlsx`;

    exportToCSV(allData, csvFilename);
    await exportToExcel(allData, excelFilename);

    // Resumen
    showSummary(allData);

    log('SUCCESS', '🎉 EXTRACCIÓN POSTGRESQL COMPLETADA');
  } catch (error) {
    log('ERROR', 'Error fatal', { error: error.message });
    process.exit(1);
  } finally {
    await prisma.$disconnect();

    setTimeout(() => {
      log('INFO', '👋 Finalizando...');
      process.exit(0);
    }, 2000);
  }
}

main().catch((error) => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});
