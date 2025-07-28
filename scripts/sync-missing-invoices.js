#!/usr/bin/env node
/**
 * SCRIPT DE SINCRONIZACIÓN: Recuperar facturas faltantes
 *
 * Sincroniza facturas que existen en FacturAPI pero no en PostgreSQL
 *
 * Uso: node scripts/sync-missing-invoices.js <tenantId> [--dry-run]
 */

import prisma from '../lib/prisma.js';
import facturapIService from '../services/facturapi.service.js';
import TenantService from '../services/tenant.service.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Obtiene todas las facturas de FacturAPI para un tenant
 */
async function getAllFacturapiInvoices(tenantId, tenantName) {
  console.log(`📡 Obteniendo TODAS las facturas de FacturAPI para: ${tenantName}`);

  const facturapi = await facturapIService.getFacturapiClient(tenantId);
  const allInvoices = [];
  let page = 1;

  while (page <= 20) {
    // Max 20 páginas (1000 facturas)
    console.log(`   📄 Página ${page}...`);

    try {
      const response = await Promise.race([
        facturapi.invoices.list({ page, limit: 50 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000)),
      ]);

      if (!response.data || response.data.length === 0) {
        console.log(`   ✅ Página ${page}: Sin más facturas`);
        break;
      }

      allInvoices.push(...response.data);
      console.log(`   ✅ Página ${page}: ${response.data.length} facturas obtenidas`);

      if (response.data.length < 50) {
        console.log(`   🏁 Última página alcanzada`);
        break;
      }

      page++;
      await sleep(1500); // Pausa de 1.5 segundos entre páginas
    } catch (error) {
      console.log(`   ❌ Error en página ${page}: ${error.message}`);
      break;
    }
  }

  console.log(`📊 Total obtenido de FacturAPI: ${allInvoices.length} facturas`);
  return allInvoices;
}

/**
 * Obtiene los IDs de facturas que ya existen en PostgreSQL
 */
async function getExistingInvoiceIds(tenantId) {
  console.log(`💾 Obteniendo facturas existentes en PostgreSQL...`);

  const existing = await prisma.tenantInvoice.findMany({
    where: { tenantId },
    select: { facturapiInvoiceId: true },
  });

  const existingIds = new Set(existing.map((inv) => inv.facturapiInvoiceId));
  console.log(`💾 Facturas existentes en PostgreSQL: ${existingIds.size}`);

  return existingIds;
}

/**
 * Encuentra las facturas que están en FacturAPI pero no en PostgreSQL
 */
function findMissingInvoices(facturapiInvoices, existingIds) {
  console.log(`🔍 Identificando facturas faltantes...`);

  const missing = facturapiInvoices.filter((invoice) => !existingIds.has(invoice.id));

  console.log(`🎯 Facturas faltantes identificadas: ${missing.length}`);

  // Mostrar algunas de ejemplo
  if (missing.length > 0) {
    console.log(`\n📋 Ejemplos de facturas faltantes:`);
    missing.slice(0, 5).forEach((inv, index) => {
      console.log(
        `   ${index + 1}. Folio: ${inv.folio_number}, Total: $${inv.total}, Fecha: ${inv.date}`
      );
    });

    if (missing.length > 5) {
      console.log(`   ... y ${missing.length - 5} más`);
    }
  }

  return missing;
}

/**
 * Registra una factura faltante en PostgreSQL
 */
async function registerMissingInvoice(tenantId, invoice, dryRun = false) {
  try {
    console.log(`📝 ${dryRun ? '[DRY-RUN] ' : ''}Registrando folio ${invoice.folio_number}...`);

    if (dryRun) {
      console.log(`   ✅ [DRY-RUN] Simularía registro de factura ${invoice.id}`);
      return { success: true, id: 'dry-run' };
    }

    // Buscar el customer ID en nuestra BD local si existe
    let localCustomerId = null;
    if (invoice.customer && invoice.customer.id) {
      const localCustomer = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          facturapiCustomerId: invoice.customer.id,
        },
        select: { id: true },
      });

      if (localCustomer) {
        localCustomerId = localCustomer.id;
      }
    }

    // Registrar la factura usando el servicio existente
    await TenantService.registerInvoice(
      tenantId,
      invoice.id,
      invoice.series || 'GTR',
      invoice.folio_number,
      localCustomerId,
      parseFloat(invoice.total),
      null // createdById = null (por el quick fix)
    );

    console.log(`   ✅ Factura ${invoice.folio_number} registrada exitosamente`);
    return { success: true };
  } catch (error) {
    console.log(`   ❌ Error registrando factura ${invoice.folio_number}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Sincroniza todas las facturas faltantes
 */
async function syncMissingInvoices(tenantId, missingInvoices, dryRun = false) {
  console.log(
    `\n🚀 ${dryRun ? '[DRY-RUN] ' : ''}Iniciando sincronización de ${missingInvoices.length} facturas...`
  );

  const results = {
    total: missingInvoices.length,
    success: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < missingInvoices.length; i++) {
    const invoice = missingInvoices[i];

    console.log(
      `\n📋 [${i + 1}/${missingInvoices.length}] Procesando factura ${invoice.folio_number}...`
    );

    const result = await registerMissingInvoice(tenantId, invoice, dryRun);

    if (result.success) {
      results.success++;
    } else {
      results.failed++;
      results.errors.push({
        folio: invoice.folio_number,
        id: invoice.id,
        error: result.error,
      });
    }

    // Pausa entre facturas para no saturar
    await sleep(2000); // 2 segundos entre facturas

    // Mostrar progreso cada 10 facturas
    if ((i + 1) % 10 === 0) {
      console.log(
        `\n📊 Progreso: ${i + 1}/${missingInvoices.length} - Exitosas: ${results.success}, Fallidas: ${results.failed}`
      );
    }
  }

  return results;
}

/**
 * Función principal
 */
async function main() {
  const tenantId = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');

  if (!tenantId) {
    console.error('❌ Error: Debes proporcionar un tenantId');
    console.log('Uso: node scripts/sync-missing-invoices.js <tenantId> [--dry-run]');
    process.exit(1);
  }

  console.log(`🎯 Sincronizando facturas faltantes para tenant: ${tenantId}`);
  console.log(`⚙️  Modo: ${dryRun ? 'DRY-RUN (simulación)' : 'REAL (ejecutará cambios)'}`);
  console.log('='.repeat(60));

  try {
    // 1. Obtener info del tenant
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { businessName: true, rfc: true, isActive: true, facturapiApiKey: true },
    });

    if (!tenant) {
      throw new Error('Tenant no encontrado');
    }

    if (!tenant.isActive) {
      throw new Error('Tenant inactivo');
    }

    if (!tenant.facturapiApiKey) {
      throw new Error('Tenant sin API key de FacturAPI');
    }

    console.log(`🏢 Empresa: ${tenant.businessName} (${tenant.rfc})`);

    // 2. Obtener todas las facturas de FacturAPI
    const facturapiInvoices = await getAllFacturapiInvoices(tenantId, tenant.businessName);

    if (facturapiInvoices.length === 0) {
      console.log('ℹ️  No hay facturas en FacturAPI para este tenant');
      return;
    }

    // 3. Obtener facturas existentes en PostgreSQL
    const existingIds = await getExistingInvoiceIds(tenantId);

    // 4. Encontrar facturas faltantes
    const missingInvoices = findMissingInvoices(facturapiInvoices, existingIds);

    if (missingInvoices.length === 0) {
      console.log('✅ ¡Perfecto! No hay facturas faltantes. Todo está sincronizado.');
      return;
    }

    // 5. Confirmar antes de proceder (si no es dry-run)
    if (!dryRun) {
      console.log(
        `\n⚠️  ¿Continuar con la sincronización de ${missingInvoices.length} facturas? (Ctrl+C para cancelar)`
      );
      console.log('   Presiona Enter para continuar...');

      // Esperar input del usuario
      await new Promise((resolve) => {
        process.stdin.once('data', () => resolve());
      });
    }

    // 6. Sincronizar facturas faltantes
    const results = await syncMissingInvoices(tenantId, missingInvoices, dryRun);

    // 7. Mostrar resultados finales
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESULTADOS FINALES');
    console.log('='.repeat(60));
    console.log(`✅ Facturas sincronizadas exitosamente: ${results.success}`);
    console.log(`❌ Facturas con errores: ${results.failed}`);
    console.log(`📊 Total procesadas: ${results.total}`);

    if (results.errors.length > 0) {
      console.log(`\n❌ Errores encontrados:`);
      results.errors.forEach((err) => {
        console.log(`   • Folio ${err.folio}: ${err.error}`);
      });
    }

    if (!dryRun && results.success > 0) {
      console.log(`\n🎉 ¡Sincronización completada! ${results.success} facturas recuperadas.`);
      console.log('💡 Recomendación: Ejecuta el diagnóstico nuevamente para verificar.');
    }
  } catch (error) {
    console.error(`❌ Error fatal: ${error.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
