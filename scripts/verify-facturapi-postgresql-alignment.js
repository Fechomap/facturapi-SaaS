#!/usr/bin/env node
// scripts/verify-facturapi-postgresql-alignment.js
// Script para verificar alineación entre FacturAPI y PostgreSQL

import { config } from '../config/index.js';
import { connectDatabase } from '../config/database.js';
import { prisma as configPrisma } from '../config/database.js';
import libPrisma from '../lib/prisma.js';
import axios from 'axios';

// Usar la instancia de Prisma que esté disponible
const prisma = libPrisma || configPrisma;

const TENANT_ID = '3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb';

/**
 * Obtener configuración de FacturAPI para el tenant
 */
async function getFacturAPIConfig() {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: TENANT_ID },
      select: {
        facturapiApiKey: true,
        businessName: true,
        rfc: true,
      },
    });

    if (!tenant) {
      throw new Error(`Tenant ${TENANT_ID} no encontrado`);
    }

    if (!tenant.facturapiApiKey) {
      throw new Error(`Tenant ${TENANT_ID} no tiene API key de FacturAPI`);
    }

    // Determinar si es test mode basado en la API key
    const isTestMode = tenant.facturapiApiKey.startsWith('sk_test_');

    return {
      apiKey: tenant.facturapiApiKey,
      testMode: isTestMode,
      baseURL: 'https://www.facturapi.io/v2',
      businessName: tenant.businessName,
      rfc: tenant.rfc,
    };
  } catch (error) {
    console.error('❌ Error obteniendo configuración FacturAPI:', error.message);
    throw error;
  }
}

/**
 * Obtener todas las facturas del tenant desde FacturAPI
 */
async function getInvoicesFromFacturAPI(config) {
  console.log('📡 Consultando facturas en FacturAPI...');

  const allInvoices = [];
  let page = 1;
  let hasMore = true;

  try {
    while (hasMore) {
      console.log(`   Página ${page}...`);

      const response = await axios.get(`${config.baseURL}/invoices`, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        params: {
          limit: 50,
          page: page,
        },
      });

      const invoices = response.data.data || response.data;
      allInvoices.push(...invoices);

      // Verificar si hay más páginas
      hasMore = invoices.length === 50;
      page++;

      // Limitar a 20 páginas por seguridad (1000 facturas máx)
      if (page > 20) {
        console.log('⚠️ Limitando a 20 páginas (1000 facturas)');
        break;
      }
    }

    console.log(`✅ Total facturas en FacturAPI: ${allInvoices.length}`);
    return allInvoices;
  } catch (error) {
    console.error('❌ Error consultando FacturAPI:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Obtener todas las facturas del tenant desde PostgreSQL
 */
async function getInvoicesFromPostgreSQL() {
  console.log('🗄️ Consultando facturas en PostgreSQL...');

  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        tenantId: TENANT_ID,
      },
      select: {
        id: true,
        facturapiId: true,
        folio: true,
        serie: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        total: true,
        customerName: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(`✅ Total facturas en PostgreSQL: ${invoices.length}`);
    return invoices;
  } catch (error) {
    console.error('❌ Error consultando PostgreSQL:', error.message);
    throw error;
  }
}

/**
 * Comparar facturas entre FacturAPI y PostgreSQL
 */
function compareInvoices(facturapiInvoices, postgresqlInvoices) {
  console.log('\n🔍 ANÁLISIS COMPARATIVO:');
  console.log('═'.repeat(50));

  // Crear mapas para comparación
  const facturapiMap = new Map();
  const postgresqlMap = new Map();

  // Mapear facturas de FacturAPI
  facturapiInvoices.forEach((invoice) => {
    facturapiMap.set(invoice.id, {
      id: invoice.id,
      folio: invoice.folio_number,
      serie: invoice.series,
      status: invoice.status,
      date: invoice.date,
      total: invoice.total,
      customer: invoice.customer?.legal_name || 'N/A',
    });
  });

  // Mapear facturas de PostgreSQL
  postgresqlInvoices.forEach((invoice) => {
    if (invoice.facturapiId) {
      postgresqlMap.set(invoice.facturapiId, {
        id: invoice.facturapiId,
        localId: invoice.id,
        folio: invoice.folio,
        serie: invoice.serie,
        status: invoice.status,
        createdAt: invoice.createdAt,
        total: invoice.total,
        customer: invoice.customerName,
      });
    }
  });

  // Facturas en FacturAPI pero NO en PostgreSQL
  const missingInPostgreSQL = [];
  facturapiMap.forEach((invoice, id) => {
    if (!postgresqlMap.has(id)) {
      missingInPostgreSQL.push(invoice);
    }
  });

  // Facturas en PostgreSQL pero NO en FacturAPI
  const missingInFacturAPI = [];
  postgresqlMap.forEach((invoice, id) => {
    if (!facturapiMap.has(id)) {
      missingInFacturAPI.push(invoice);
    }
  });

  // Facturas que coinciden
  const matching = [];
  facturapiMap.forEach((facturapiInvoice, id) => {
    const postgresqlInvoice = postgresqlMap.get(id);
    if (postgresqlInvoice) {
      matching.push({
        facturapiId: id,
        facturapiData: facturapiInvoice,
        postgresqlData: postgresqlInvoice,
      });
    }
  });

  return {
    facturapiTotal: facturapiInvoices.length,
    postgresqlTotal: postgresqlInvoices.length,
    missingInPostgreSQL,
    missingInFacturAPI,
    matching,
    discrepancy: Math.abs(facturapiInvoices.length - postgresqlInvoices.length),
  };
}

/**
 * Buscar facturas específicas del 27/07/2025 21:51
 */
function findSpecificInvoices(facturapiInvoices, postgresqlInvoices) {
  console.log('\n🎯 BÚSQUEDA ESPECÍFICA: Facturas del 27/07/2025 21:51');
  console.log('═'.repeat(50));

  // Rango de tiempo objetivo (27 julio 2025, ~21:51)
  const targetDate = new Date('2025-07-27');
  const targetHour = 21;
  const targetMinute = 51;

  console.log(
    `Buscando facturas creadas el ${targetDate.toDateString()} alrededor de las ${targetHour}:${targetMinute}`
  );

  // Buscar en FacturAPI
  const facturapiMatches = facturapiInvoices.filter((invoice) => {
    const invoiceDate = new Date(invoice.date || invoice.created_at);
    return (
      invoiceDate.getDate() === 27 &&
      invoiceDate.getMonth() === 6 && // Julio = mes 6 (0-indexed)
      invoiceDate.getFullYear() === 2025
    );
  });

  // Buscar en PostgreSQL
  const postgresqlMatches = postgresqlInvoices.filter((invoice) => {
    const invoiceDate = new Date(invoice.createdAt);
    return (
      invoiceDate.getDate() === 27 &&
      invoiceDate.getMonth() === 6 &&
      invoiceDate.getFullYear() === 2025
    );
  });

  console.log(`📡 FacturAPI - Facturas del 27/07/2025: ${facturapiMatches.length}`);
  facturapiMatches.forEach((invoice) => {
    console.log(`   - ${invoice.id} | Folio: ${invoice.folio_number} | Fecha: ${invoice.date}`);
  });

  console.log(`🗄️ PostgreSQL - Facturas del 27/07/2025: ${postgresqlMatches.length}`);
  postgresqlMatches.forEach((invoice) => {
    console.log(
      `   - ${invoice.facturapiId} | Folio: ${invoice.folio} | Fecha: ${invoice.createdAt}`
    );
  });

  return {
    facturapiMatches,
    postgresqlMatches,
  };
}

/**
 * Generar reporte detallado
 */
function generateReport(comparison, specificSearch) {
  console.log('\n📊 REPORTE FINAL');
  console.log('═'.repeat(50));

  console.log(`📡 FacturAPI Total: ${comparison.facturapiTotal} facturas`);
  console.log(`🗄️ PostgreSQL Total: ${comparison.postgresqlTotal} facturas`);
  console.log(`🔗 Facturas que coinciden: ${comparison.matching.length}`);
  console.log(`⚠️ Discrepancia total: ${comparison.discrepancy} facturas`);

  if (comparison.missingInPostgreSQL.length > 0) {
    console.log(
      `\n❌ FACTURAS EN FACTURAPI PERO NO EN POSTGRESQL (${comparison.missingInPostgreSQL.length}):`
    );
    comparison.missingInPostgreSQL.slice(0, 10).forEach((invoice) => {
      console.log(
        `   - ${invoice.id} | ${invoice.serie}${invoice.folio} | ${invoice.date} | ${invoice.customer}`
      );
    });
    if (comparison.missingInPostgreSQL.length > 10) {
      console.log(`   ... y ${comparison.missingInPostgreSQL.length - 10} más`);
    }
  }

  if (comparison.missingInFacturAPI.length > 0) {
    console.log(
      `\n❌ FACTURAS EN POSTGRESQL PERO NO EN FACTURAPI (${comparison.missingInFacturAPI.length}):`
    );
    comparison.missingInFacturAPI.slice(0, 10).forEach((invoice) => {
      console.log(
        `   - ${invoice.id} | ${invoice.serie}${invoice.folio} | Local ID: ${invoice.localId}`
      );
    });
    if (comparison.missingInFacturAPI.length > 10) {
      console.log(`   ... y ${comparison.missingInFacturAPI.length - 10} más`);
    }
  }

  console.log(`\n🎯 FACTURAS ESPECÍFICAS DEL 27/07/2025:`);
  console.log(`   FacturAPI: ${specificSearch.facturapiMatches.length} facturas`);
  console.log(`   PostgreSQL: ${specificSearch.postgresqlMatches.length} facturas`);

  // Conclusiones
  console.log('\n💡 CONCLUSIONES:');
  if (comparison.discrepancy === 0) {
    console.log('✅ Los conteos coinciden perfectamente');
  } else {
    console.log(`❌ Hay ${comparison.discrepancy} facturas de diferencia`);

    if (comparison.missingInPostgreSQL.length > 0) {
      console.log(
        `⚠️ HAY ${comparison.missingInPostgreSQL.length} FACTURAS EN FACTURAPI QUE NO ESTÁN EN POSTGRESQL`
      );
      console.log('   Esto indica un problema de sincronización crítico');
    }

    if (comparison.missingInFacturAPI.length > 0) {
      console.log(
        `⚠️ HAY ${comparison.missingInFacturAPI.length} FACTURAS EN POSTGRESQL QUE NO ESTÁN EN FACTURAPI`
      );
      console.log('   Esto podría indicar facturas locales no sincronizadas');
    }
  }

  if (specificSearch.facturapiMatches.length > specificSearch.postgresqlMatches.length) {
    console.log(
      `🚨 PROBLEMA IDENTIFICADO: Hay ${specificSearch.facturapiMatches.length - specificSearch.postgresqlMatches.length} facturas del 27/07 que están en FacturAPI pero NO en PostgreSQL`
    );
  }
}

/**
 * Función principal
 */
async function main() {
  console.log('🔍 VERIFICACIÓN DE ALINEACIÓN: FacturAPI ↔ PostgreSQL');
  console.log('═'.repeat(60));
  console.log(`Tenant ID: ${TENANT_ID}`);
  console.log(`Fecha de análisis: ${new Date().toLocaleString()}`);

  try {
    // Conectar a la base de datos
    await connectDatabase();
    console.log('✅ Conexión a PostgreSQL establecida');

    // Obtener configuración de FacturAPI
    const facturapiConfig = await getFacturAPIConfig();
    console.log(
      `✅ Configuración FacturAPI obtenida (${facturapiConfig.testMode ? 'TEST' : 'LIVE'})`
    );
    console.log(`   Empresa: ${facturapiConfig.businessName} (${facturapiConfig.rfc})`);

    // Obtener facturas de ambas fuentes
    const [facturapiInvoices, postgresqlInvoices] = await Promise.all([
      getInvoicesFromFacturAPI(facturapiConfig),
      getInvoicesFromPostgreSQL(),
    ]);

    // Comparar facturas
    const comparison = compareInvoices(facturapiInvoices, postgresqlInvoices);

    // Buscar facturas específicas
    const specificSearch = findSpecificInvoices(facturapiInvoices, postgresqlInvoices);

    // Generar reporte
    generateReport(comparison, specificSearch);

    // Retornar datos para uso programático
    return {
      success: true,
      comparison,
      specificSearch,
      facturapiConfig,
    };
  } catch (error) {
    console.error('❌ Error en verificación:', error.message);
    return {
      success: false,
      error: error.message,
    };
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar si es llamado directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((result) => {
      if (result.success) {
        console.log('\n✅ Verificación completada exitosamente');
        process.exit(0);
      } else {
        console.log('\n❌ Verificación falló');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('❌ Error fatal:', error);
      process.exit(1);
    });
}

export default main;
