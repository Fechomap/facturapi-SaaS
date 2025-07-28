#!/usr/bin/env node
/**
 * SCRIPT DE DIAGNÓSTICO: Sincronización FacturAPI ↔ PostgreSQL
 *
 * Analiza la discrepancia exacta de facturas entre FacturAPI y PostgreSQL
 * para TODOS los tenants activos.
 *
 * Uso: node scripts/sync-diagnosis.js
 */

import prisma from '../lib/prisma.js';
import facturapIService from '../services/facturapi.service.js';
import logger from '../core/utils/logger.js';

const diagLogger = logger.child({ module: 'sync-diagnosis' });

/**
 * Obtiene todas las facturas de un tenant desde FacturAPI
 */
async function getFacturapiInvoicesCount(tenantId) {
  try {
    diagLogger.info({ tenantId }, 'Consultando facturas en FacturAPI...');

    const facturapi = await facturapIService.getFacturapiClient(tenantId);

    let totalFacturas = 0;
    let page = 1;
    const limit = 50;

    // Obtener todas las facturas paginando
    while (true) {
      const response = await facturapi.invoices.list({
        page,
        limit,
      });

      if (!response.data || response.data.length === 0) {
        break;
      }

      totalFacturas += response.data.length;
      diagLogger.debug({ tenantId, page, count: response.data.length }, 'Página procesada');

      // Si la página tiene menos elementos que el límite, es la última página
      if (response.data.length < limit) {
        break;
      }

      page++;

      // Rate limiting: pequeña pausa entre requests
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    diagLogger.info({ tenantId, totalFacturas }, 'Conteo FacturAPI completado');
    return totalFacturas;
  } catch (error) {
    diagLogger.error(
      {
        tenantId,
        error: error.message,
      },
      'Error consultando FacturAPI'
    );
    return null;
  }
}

/**
 * Cuenta facturas en PostgreSQL para un tenant
 */
async function getPostgreSQLInvoicesCount(tenantId) {
  try {
    const count = await prisma.tenantInvoice.count({
      where: { tenantId },
    });

    diagLogger.debug({ tenantId, count }, 'Conteo PostgreSQL completado');
    return count;
  } catch (error) {
    diagLogger.error(
      {
        tenantId,
        error: error.message,
      },
      'Error consultando PostgreSQL'
    );
    return null;
  }
}

/**
 * Obtiene información básica del tenant
 */
async function getTenantInfo(tenantId) {
  try {
    return await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true,
        rfc: true,
        isActive: true,
        facturapiApiKey: true,
      },
    });
  } catch (error) {
    diagLogger.error({ tenantId, error: error.message }, 'Error obteniendo info del tenant');
    return null;
  }
}

/**
 * Función principal de diagnóstico
 */
async function runDiagnosis() {
  console.log('🔍 INICIANDO DIAGNÓSTICO DE SINCRONIZACIÓN');
  console.log('='.repeat(60));

  try {
    // Obtener todos los tenants activos con API key
    const tenants = await prisma.tenant.findMany({
      where: {
        isActive: true,
        facturapiApiKey: { not: null },
      },
      select: {
        id: true,
        businessName: true,
        rfc: true,
      },
    });

    console.log(`📊 Tenants activos encontrados: ${tenants.length}`);
    console.log('');

    const results = [];

    for (const tenant of tenants) {
      console.log(`\n🏢 Procesando: ${tenant.businessName} (${tenant.rfc})`);
      console.log(`   Tenant ID: ${tenant.id}`);

      // Contar en ambas fuentes
      const [facturapiCount, postgresqlCount] = await Promise.all([
        getFacturapiInvoicesCount(tenant.id),
        getPostgreSQLInvoicesCount(tenant.id),
      ]);

      const result = {
        tenantId: tenant.id,
        businessName: tenant.businessName,
        rfc: tenant.rfc,
        facturapiCount,
        postgresqlCount,
        discrepancia:
          facturapiCount !== null && postgresqlCount !== null
            ? facturapiCount - postgresqlCount
            : null,
        status:
          facturapiCount === null || postgresqlCount === null
            ? 'ERROR'
            : facturapiCount === postgresqlCount
              ? 'SINCRONIZADO'
              : 'DESINCRONIZADO',
      };

      results.push(result);

      // Mostrar resultado inmediato
      if (result.status === 'ERROR') {
        console.log(`   ❌ ERROR en consultas`);
      } else if (result.status === 'SINCRONIZADO') {
        console.log(`   ✅ SINCRONIZADO: ${result.facturapiCount} facturas`);
      } else {
        console.log(`   ⚠️  DESINCRONIZADO:`);
        console.log(`      - FacturAPI: ${result.facturapiCount}`);
        console.log(`      - PostgreSQL: ${result.postgresqlCount}`);
        console.log(`      - Faltantes: ${result.discrepancia}`);
      }

      // Pausa entre tenants para no saturar
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Resumen final
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMEN FINAL');
    console.log('='.repeat(60));

    const sincronizados = results.filter((r) => r.status === 'SINCRONIZADO').length;
    const desincronizados = results.filter((r) => r.status === 'DESINCRONIZADO').length;
    const errores = results.filter((r) => r.status === 'ERROR').length;
    const totalFaltantes = results
      .filter((r) => r.discrepancia > 0)
      .reduce((sum, r) => sum + r.discrepancia, 0);

    console.log(`✅ Tenants sincronizados: ${sincronizados}`);
    console.log(`⚠️  Tenants desincronizados: ${desincronizados}`);
    console.log(`❌ Tenants con errores: ${errores}`);
    console.log(`📊 Total facturas faltantes: ${totalFaltantes}`);

    if (desincronizados > 0) {
      console.log('\n🎯 TENANTS QUE REQUIEREN SINCRONIZACIÓN:');
      results
        .filter((r) => r.status === 'DESINCRONIZADO')
        .sort((a, b) => b.discrepancia - a.discrepancia)
        .forEach((r) => {
          console.log(`   • ${r.businessName}: ${r.discrepancia} facturas faltantes`);
        });
    }

    // Guardar resultados detallados
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = `./scripts/sync-diagnosis-${timestamp}.json`;

    const fs = await import('fs');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

    console.log(`\n💾 Reporte detallado guardado en: ${reportPath}`);

    return results;
  } catch (error) {
    diagLogger.error({ error: error.message }, 'Error en diagnóstico');
    console.error('❌ Error ejecutando diagnóstico:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar si es llamado directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  runDiagnosis()
    .then(() => {
      console.log('\n✅ Diagnóstico completado exitosamente');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Diagnóstico falló:', error.message);
      process.exit(1);
    });
}

export default runDiagnosis;
