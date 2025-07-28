#!/usr/bin/env node
// scripts/count-invoices-by-tenant.js
// Script para contar facturas exactas por tenant en FacturAPI vs PostgreSQL

import { connectDatabase } from '../config/database.js';
import { prisma as configPrisma } from '../config/database.js';
import libPrisma from '../lib/prisma.js';
import axios from 'axios';

// Usar la instancia de Prisma que esté disponible
const prisma = libPrisma || configPrisma;

/**
 * Obtener todos los tenants activos
 */
async function getAllActiveTenants() {
  try {
    const tenants = await prisma.tenant.findMany({
      where: {
        isActive: true,
        facturapiApiKey: {
          not: null,
        },
      },
      select: {
        id: true,
        businessName: true,
        rfc: true,
        facturapiApiKey: true,
        facturapiOrganizationId: true,
      },
    });

    console.log(`✅ Encontrados ${tenants.length} tenants activos con FacturAPI`);
    return tenants;
  } catch (error) {
    console.error('❌ Error obteniendo tenants:', error.message);
    throw error;
  }
}

/**
 * Contar facturas en FacturAPI para un tenant específico
 */
async function countFacturAPIInvoices(tenant) {
  try {
    console.log(`📡 Consultando FacturAPI para: ${tenant.businessName} (${tenant.rfc})`);

    const isTestMode = tenant.facturapiApiKey.startsWith('sk_test_');
    const baseURL = 'https://www.facturapi.io/v2';

    // Hacer una sola consulta para obtener el total
    const response = await axios.get(`${baseURL}/invoices`, {
      headers: {
        Authorization: `Bearer ${tenant.facturapiApiKey}`,
        'Content-Type': 'application/json',
      },
      params: {
        limit: 1, // Solo necesitamos el header con el total
        page: 1,
      },
    });

    // En FacturAPI, el total viene en los headers
    const totalHeader = response.headers['x-total-count'] || response.headers['X-Total-Count'];
    const total = totalHeader ? parseInt(totalHeader) : 0;

    console.log(`   ✅ Total en FacturAPI: ${total} facturas`);

    return {
      tenant_id: tenant.id,
      business_name: tenant.businessName,
      rfc: tenant.rfc,
      facturapi_total: total,
      test_mode: isTestMode,
      status: 'success',
    };
  } catch (error) {
    console.error(
      `   ❌ Error consultando FacturAPI para ${tenant.businessName}:`,
      error.response?.data || error.message
    );

    return {
      tenant_id: tenant.id,
      business_name: tenant.businessName,
      rfc: tenant.rfc,
      facturapi_total: 0,
      test_mode: false,
      status: 'error',
      error: error.message,
    };
  }
}

/**
 * Contar facturas en PostgreSQL para un tenant específico
 */
async function countPostgreSQLInvoices(tenant) {
  try {
    console.log(`🗄️ Consultando PostgreSQL para: ${tenant.businessName}`);

    const total = await prisma.invoice.count({
      where: {
        tenantId: tenant.id,
      },
    });

    // Contar por status
    const statusCounts = await prisma.invoice.groupBy({
      by: ['status'],
      where: {
        tenantId: tenant.id,
      },
      _count: {
        status: true,
      },
    });

    console.log(`   ✅ Total en PostgreSQL: ${total} facturas`);

    const statusBreakdown = {};
    statusCounts.forEach((item) => {
      statusBreakdown[item.status] = item._count.status;
    });

    return {
      postgresql_total: total,
      status_breakdown: statusBreakdown,
      status: 'success',
    };
  } catch (error) {
    console.error(`   ❌ Error consultando PostgreSQL para ${tenant.businessName}:`, error.message);

    return {
      postgresql_total: 0,
      status_breakdown: {},
      status: 'error',
      error: error.message,
    };
  }
}

/**
 * Generar reporte comparativo completo
 */
async function generateComparisonReport() {
  console.log('📊 REPORTE COMPARATIVO: FacturAPI vs PostgreSQL');
  console.log('═'.repeat(60));
  console.log(`Fecha: ${new Date().toLocaleString()}`);

  const results = [];
  let totalFacturapiInvoices = 0;
  let totalPostgresqlInvoices = 0;

  try {
    // Conectar a la base de datos
    await connectDatabase();
    console.log('✅ Conexión a PostgreSQL establecida');

    // Obtener todos los tenants
    const tenants = await getAllActiveTenants();

    // Procesar cada tenant
    for (const tenant of tenants) {
      console.log(`\n🔍 Procesando: ${tenant.businessName} (${tenant.id})`);

      // Contar en ambas bases
      const [facturapiResult, postgresqlResult] = await Promise.all([
        countFacturAPIInvoices(tenant),
        countPostgreSQLInvoices(tenant),
      ]);

      // Combinar resultados
      const combined = {
        ...facturapiResult,
        ...postgresqlResult,
        discrepancy: facturapiResult.facturapi_total - postgresqlResult.postgresql_total,
        sync_status:
          facturapiResult.facturapi_total === postgresqlResult.postgresql_total
            ? '✅ SYNC'
            : '❌ DESYNC',
      };

      results.push(combined);

      totalFacturapiInvoices += facturapiResult.facturapi_total;
      totalPostgresqlInvoices += postgresqlResult.postgresql_total;

      // Mostrar resultado inmediato
      console.log(
        `   📊 Resultado: ${facturapiResult.facturapi_total} (API) vs ${postgresqlResult.postgresql_total} (PG) = ${combined.sync_status}`
      );
    }
  } catch (error) {
    console.error('❌ Error en reporte:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }

  // Mostrar resumen final
  console.log('\n' + '═'.repeat(60));
  console.log('📈 RESUMEN GENERAL');
  console.log('═'.repeat(60));

  console.log(`📡 Total FacturAPI: ${totalFacturapiInvoices} facturas`);
  console.log(`🗄️ Total PostgreSQL: ${totalPostgresqlInvoices} facturas`);
  console.log(
    `📊 Discrepancia global: ${Math.abs(totalFacturapiInvoices - totalPostgresqlInvoices)} facturas`
  );

  // Tenants con problemas
  const problematicTenants = results.filter((r) => r.discrepancy !== 0);
  if (problematicTenants.length > 0) {
    console.log(`\n🚨 TENANTS CON DESINCRONIZACIÓN (${problematicTenants.length}):`);
    problematicTenants.forEach((tenant) => {
      console.log(
        `   ❌ ${tenant.business_name}: ${tenant.discrepancy > 0 ? '+' : ''}${tenant.discrepancy} facturas`
      );
      console.log(
        `      FacturAPI: ${tenant.facturapi_total} | PostgreSQL: ${tenant.postgresql_total}`
      );
    });
  }

  // Tenants sincronizados
  const syncedTenants = results.filter((r) => r.discrepancy === 0);
  if (syncedTenants.length > 0) {
    console.log(`\n✅ TENANTS SINCRONIZADOS (${syncedTenants.length}):`);
    syncedTenants.forEach((tenant) => {
      console.log(`   ✅ ${tenant.business_name}: ${tenant.facturapi_total} facturas`);
    });
  }

  return {
    summary: {
      total_tenants: results.length,
      total_facturapi: totalFacturapiInvoices,
      total_postgresql: totalPostgresqlInvoices,
      global_discrepancy: totalFacturapiInvoices - totalPostgresqlInvoices,
      synced_tenants: syncedTenants.length,
      problematic_tenants: problematicTenants.length,
    },
    details: results,
    problematic_tenants: problematicTenants,
    synced_tenants: syncedTenants,
  };
}

/**
 * Función principal
 */
async function main() {
  try {
    const report = await generateComparisonReport();

    console.log('\n🎯 ANÁLISIS COMPLETADO');
    console.log(`Tenants problemáticos: ${report.problematic_tenants.length}`);
    console.log(`Tenants sincronizados: ${report.synced_tenants.length}`);

    return report;
  } catch (error) {
    console.error('❌ Error fatal:', error.message);
    process.exit(1);
  }
}

// Ejecutar si es llamado directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
