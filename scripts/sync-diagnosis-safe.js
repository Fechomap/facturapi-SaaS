#!/usr/bin/env node
/**
 * SCRIPT DE DIAGNÓSTICO SEGURO: Sincronización FacturAPI ↔ PostgreSQL
 *
 * Versión optimizada con rate limiting agresivo y timeouts
 *
 * Uso: node scripts/sync-diagnosis-safe.js [tenantId]
 */

import prisma from '../lib/prisma.js';
import facturapIService from '../services/facturapi.service.js';

/**
 * Pausa segura entre requests
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Obtiene el conteo de facturas de FacturAPI con timeout
 */
async function getFacturapiCount(tenantId, tenantName) {
  try {
    console.log(`📡 Consultando FacturAPI para: ${tenantName}...`);

    const facturapi = await facturapIService.getFacturapiClient(tenantId);

    // Solo obtener la primera página para estimar el total
    const response = await Promise.race([
      facturapi.invoices.list({ page: 1, limit: 50 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000)),
    ]);

    if (!response || !response.data) {
      throw new Error('Respuesta inválida de FacturAPI');
    }

    console.log(`   📄 Primera página: ${response.data.length} facturas`);

    // Si hay exactamente 50, hay más páginas. Estimamos el total
    if (response.data.length === 50) {
      // Para obtener el total exacto, necesitamos paginar
      let total = 0;
      let page = 1;

      while (page <= 20) {
        // Límite de 20 páginas (1000 facturas max por tenant)
        console.log(`   📄 Consultando página ${page}...`);

        const pageResponse = await Promise.race([
          facturapi.invoices.list({ page, limit: 50 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout página')), 8000)),
        ]);

        if (!pageResponse.data || pageResponse.data.length === 0) {
          break;
        }

        total += pageResponse.data.length;

        if (pageResponse.data.length < 50) {
          break; // Última página
        }

        page++;
        await sleep(1000); // Pausa de 1 segundo entre páginas
      }

      return total;
    } else {
      return response.data.length;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

/**
 * Cuenta facturas en PostgreSQL
 */
async function getPostgreSQLCount(tenantId) {
  try {
    const count = await prisma.tenantInvoice.count({
      where: { tenantId },
    });
    return count;
  } catch (error) {
    console.log(`   ❌ Error PostgreSQL: ${error.message}`);
    return null;
  }
}

/**
 * Diagnóstico para un tenant específico
 */
async function diagnoseTenant(tenantId) {
  console.log(`\n🔍 Analizando tenant: ${tenantId}`);

  // Obtener info del tenant
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      businessName: true,
      rfc: true,
      isActive: true,
      facturapiApiKey: true,
    },
  });

  if (!tenant) {
    console.log('❌ Tenant no encontrado');
    return null;
  }

  if (!tenant.isActive) {
    console.log('⚠️  Tenant inactivo');
    return null;
  }

  if (!tenant.facturapiApiKey) {
    console.log('⚠️  Tenant sin API key de FacturAPI');
    return null;
  }

  console.log(`🏢 ${tenant.businessName} (${tenant.rfc})`);

  // Contar en ambas fuentes
  console.log('📊 Contando facturas...');

  const postgresqlCount = await getPostgreSQLCount(tenantId);
  console.log(`   💾 PostgreSQL: ${postgresqlCount}`);

  await sleep(1000); // Pausa antes de consultar FacturAPI

  const facturapiCount = await getFacturapiCount(tenantId, tenant.businessName);
  console.log(`   📡 FacturAPI: ${facturapiCount}`);

  if (facturapiCount === null || postgresqlCount === null) {
    console.log('❌ Error en conteos');
    return null;
  }

  const discrepancia = facturapiCount - postgresqlCount;

  console.log('\n📊 RESULTADO:');
  if (discrepancia === 0) {
    console.log('✅ SINCRONIZADO - No hay discrepancias');
  } else if (discrepancia > 0) {
    console.log(`⚠️  FALTANTES: ${discrepancia} facturas en PostgreSQL`);
  } else {
    console.log(`⚠️  EXCESO: ${Math.abs(discrepancia)} facturas extra en PostgreSQL`);
  }

  return {
    tenantId,
    businessName: tenant.businessName,
    rfc: tenant.rfc,
    facturapiCount,
    postgresqlCount,
    discrepancia,
  };
}

/**
 * Diagnóstico para todos los tenants
 */
async function diagnoseAll() {
  console.log('🔍 DIAGNÓSTICO COMPLETO DE SINCRONIZACIÓN');
  console.log('='.repeat(50));

  const tenants = await prisma.tenant.findMany({
    where: {
      isActive: true,
      facturapiApiKey: { not: null },
    },
    select: {
      id: true,
      businessName: true,
    },
    take: 5, // Limitar a 5 tenants para prueba
  });

  console.log(`📊 Analizando ${tenants.length} tenants activos...`);

  const results = [];

  for (const tenant of tenants) {
    const result = await diagnoseTenant(tenant.id);
    if (result) {
      results.push(result);
    }

    console.log('\n' + '-'.repeat(30));
    await sleep(2000); // Pausa de 2 segundos entre tenants
  }

  // Resumen
  console.log('\n📊 RESUMEN:');
  const problematicos = results.filter((r) => r.discrepancia !== 0);
  const totalFaltantes = results
    .filter((r) => r.discrepancia > 0)
    .reduce((sum, r) => sum + r.discrepancia, 0);

  console.log(`✅ Tenants sincronizados: ${results.length - problematicos.length}`);
  console.log(`⚠️  Tenants con problemas: ${problematicos.length}`);
  console.log(`📊 Total facturas faltantes: ${totalFaltantes}`);

  return results;
}

// Ejecutar
async function main() {
  try {
    const targetTenant = process.argv[2];

    if (targetTenant) {
      // Diagnóstico de un tenant específico
      await diagnoseTenant(targetTenant);
    } else {
      // Diagnóstico completo
      await diagnoseAll();
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
