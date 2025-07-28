#!/usr/bin/env node
/**
 * SINCRONIZACIÓN MASIVA: Recuperar todas las facturas faltantes
 *
 * Sincroniza TODAS las facturas que existen en FacturAPI pero no en PostgreSQL
 * Con rate limiting, progreso en tiempo real y manejo robusto de errores
 *
 * Uso: node scripts/sync-missing-invoices-massive.js <tenantId> [--dry-run] [--batch-size=10]
 */

import prisma from '../lib/prisma.js';
import facturapIService from '../services/facturapi.service.js';
import TenantService from '../services/tenant.service.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Configuración por defecto
 */
const CONFIG = {
  DEFAULT_BATCH_SIZE: 10, // Facturas por lote
  DELAY_BETWEEN_INVOICES: 3000, // 3 segundos entre facturas
  DELAY_BETWEEN_BATCHES: 5000, // 5 segundos entre lotes
  DELAY_BETWEEN_PAGES: 2000, // 2 segundos entre páginas de FacturAPI
  MAX_RETRIES: 3, // Reintentos por factura
};

/**
 * Obtiene todas las facturas de FacturAPI con paginación segura
 */
async function getAllFacturapiInvoices(tenantId, tenantName) {
  console.log(`📡 Obteniendo TODAS las facturas de FacturAPI para: ${tenantName}`);

  const facturapi = await facturapIService.getFacturapiClient(tenantId);
  const allInvoices = [];
  let page = 1;

  while (page <= 25) {
    // Max 25 páginas (1250 facturas)
    console.log(`   📄 Consultando página ${page}...`);

    try {
      const response = await Promise.race([
        facturapi.invoices.list({ page, limit: 50 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 20000)),
      ]);

      if (!response.data || response.data.length === 0) {
        console.log(`   ✅ Página ${page}: Sin más facturas`);
        break;
      }

      allInvoices.push(...response.data);
      console.log(
        `   ✅ Página ${page}: ${response.data.length} facturas | Total: ${allInvoices.length}`
      );

      if (response.data.length < 50) {
        console.log(`   🏁 Última página alcanzada`);
        break;
      }

      page++;

      // Pausa entre páginas para no saturar FacturAPI
      await sleep(CONFIG.DELAY_BETWEEN_PAGES);
    } catch (error) {
      console.log(`   ❌ Error en página ${page}: ${error.message}`);

      // Reintentar una vez más
      console.log(`   🔄 Reintentando página ${page}...`);
      await sleep(5000);

      try {
        const response = await facturapi.invoices.list({ page, limit: 50 });
        if (response.data && response.data.length > 0) {
          allInvoices.push(...response.data);
          console.log(`   ✅ Página ${page} (reintento): ${response.data.length} facturas`);
          page++;
        } else {
          break;
        }
      } catch (retryError) {
        console.log(`   ❌ Reintento falló: ${retryError.message}`);
        break;
      }
    }
  }

  console.log(`📊 Total obtenido de FacturAPI: ${allInvoices.length} facturas`);
  return allInvoices;
}

/**
 * Obtiene los IDs de facturas existentes en PostgreSQL
 */
async function getExistingInvoiceIds(tenantId) {
  console.log(`💾 Consultando facturas existentes en PostgreSQL...`);

  const existing = await prisma.tenantInvoice.findMany({
    where: { tenantId },
    select: { facturapiInvoiceId: true },
  });

  const existingIds = new Set(existing.map((inv) => inv.facturapiInvoiceId));
  console.log(`💾 Facturas existentes en PostgreSQL: ${existingIds.size}`);

  return existingIds;
}

/**
 * Identifica facturas faltantes
 */
function findMissingInvoices(facturapiInvoices, existingIds) {
  console.log(`🔍 Identificando facturas faltantes...`);

  const missing = facturapiInvoices.filter((invoice) => !existingIds.has(invoice.id));

  console.log(`🎯 Facturas faltantes identificadas: ${missing.length}`);

  // Ordenar por folio para sincronización ordenada
  missing.sort((a, b) => a.folio_number - b.folio_number);

  if (missing.length > 0) {
    console.log(`\n📋 Rango de facturas faltantes:`);
    console.log(`   • Primera: Folio ${missing[0].folio_number} (${missing[0].id})`);
    console.log(
      `   • Última: Folio ${missing[missing.length - 1].folio_number} (${missing[missing.length - 1].id})`
    );
  }

  return missing;
}

/**
 * Busca customer local para una factura
 */
async function findLocalCustomer(tenantId, facturapiCustomerId) {
  if (!facturapiCustomerId) {
    return null;
  }

  try {
    const customer = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId,
        facturapiCustomerId,
      },
      select: { id: true, legalName: true },
    });

    return customer;
  } catch (error) {
    return null;
  }
}

/**
 * Registra una factura faltante con reintentos
 */
async function registerMissingInvoiceWithRetries(tenantId, invoice, retries = CONFIG.MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Buscar customer local
      const localCustomer = await findLocalCustomer(tenantId, invoice.customer?.id);

      // Registrar usando el servicio probado
      await TenantService.registerInvoice(
        tenantId,
        invoice.id,
        invoice.series || 'GTR',
        invoice.folio_number,
        localCustomer?.id || null,
        parseFloat(invoice.total),
        null // createdById = null (quick fix)
      );

      return {
        success: true,
        customerName: localCustomer?.legalName || 'Sin customer',
        attempt,
      };
    } catch (error) {
      if (attempt === retries) {
        return {
          success: false,
          error: error.message,
          attempts: attempt,
        };
      }

      // Pausa antes del reintento
      await sleep(2000 * attempt);
    }
  }
}

/**
 * Procesa un lote de facturas
 */
async function processBatch(tenantId, batch, batchNumber, totalBatches, dryRun = false) {
  console.log(`\n📦 LOTE ${batchNumber}/${totalBatches} (${batch.length} facturas)`);
  console.log('─'.repeat(50));

  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < batch.length; i++) {
    const invoice = batch[i];
    const overallIndex = (batchNumber - 1) * CONFIG.DEFAULT_BATCH_SIZE + i + 1;

    console.log(`📋 [${overallIndex}] Folio ${invoice.folio_number} ($${invoice.total})`);

    if (dryRun) {
      console.log(`   ✅ [DRY-RUN] Simularía registro`);
      results.success++;
    } else {
      const result = await registerMissingInvoiceWithRetries(tenantId, invoice);

      if (result.success) {
        console.log(
          `   ✅ Registrada${result.attempt > 1 ? ` (intento ${result.attempt})` : ''} - ${result.customerName}`
        );
        results.success++;
      } else {
        console.log(`   ❌ Error: ${result.error}`);
        results.failed++;
        results.errors.push({
          folio: invoice.folio_number,
          id: invoice.id,
          error: result.error,
        });
      }
    }

    // Pausa entre facturas
    if (i < batch.length - 1) {
      await sleep(CONFIG.DELAY_BETWEEN_INVOICES);
    }
  }

  console.log(
    `📊 Lote ${batchNumber}: ✅ ${results.success} exitosas, ❌ ${results.failed} fallidas`
  );

  return results;
}

/**
 * Sincronización masiva con lotes
 */
async function syncMissingInvoicesMassive(tenantId, missingInvoices, batchSize, dryRun = false) {
  console.log(`\n🚀 INICIANDO SINCRONIZACIÓN MASIVA`);
  console.log(`⚙️  Modo: ${dryRun ? 'DRY-RUN (simulación)' : 'REAL (ejecutará cambios)'}`);
  console.log(`📊 Total facturas: ${missingInvoices.length}`);
  console.log(`📦 Tamaño de lote: ${batchSize}`);
  console.log(`⏱️  Estimado: ${Math.ceil((missingInvoices.length * 1.5) / 60)} minutos`);
  console.log('='.repeat(60));

  // Dividir en lotes
  const batches = [];
  for (let i = 0; i < missingInvoices.length; i += batchSize) {
    batches.push(missingInvoices.slice(i, i + batchSize));
  }

  console.log(`📦 ${batches.length} lotes de máximo ${batchSize} facturas cada uno`);

  const globalResults = {
    total: missingInvoices.length,
    success: 0,
    failed: 0,
    errors: [],
    startTime: Date.now(),
  };

  // Procesar lotes secuencialmente
  for (let i = 0; i < batches.length; i++) {
    const batchResults = await processBatch(tenantId, batches[i], i + 1, batches.length, dryRun);

    globalResults.success += batchResults.success;
    globalResults.failed += batchResults.failed;
    globalResults.errors.push(...batchResults.errors);

    // Progreso general
    const processed = globalResults.success + globalResults.failed;
    const percentage = Math.round((processed / globalResults.total) * 100);
    const elapsed = Math.round((Date.now() - globalResults.startTime) / 1000);

    console.log(
      `\n📈 PROGRESO GENERAL: ${processed}/${globalResults.total} (${percentage}%) - ${elapsed}s transcurridos`
    );

    // Pausa entre lotes (excepto el último)
    if (i < batches.length - 1) {
      console.log(`⏸️  Pausa entre lotes (${CONFIG.DELAY_BETWEEN_BATCHES / 1000}s)...`);
      await sleep(CONFIG.DELAY_BETWEEN_BATCHES);
    }
  }

  return globalResults;
}

/**
 * Verificación final
 */
async function finalVerification(tenantId) {
  console.log(`\n🔍 VERIFICACIÓN FINAL...`);

  try {
    // Contar facturas nuevamente
    const postgresqlCount = await prisma.tenantInvoice.count({
      where: { tenantId },
    });

    console.log(`💾 Facturas en PostgreSQL: ${postgresqlCount}`);

    // Obtener conteo de FacturAPI (rápido, solo primera página para estimado)
    const facturapi = await facturapIService.getFacturapiClient(tenantId);
    const response = await facturapi.invoices.list({ page: 1, limit: 50 });

    if (response.data && response.data.length === 50) {
      console.log(`📡 FacturAPI: ~${Math.ceil(response.data.length)} páginas (estimado)`);
    }

    return postgresqlCount;
  } catch (error) {
    console.log(`❌ Error en verificación: ${error.message}`);
    return null;
  }
}

/**
 * Función principal
 */
async function main() {
  const tenantId = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  const batchSizeArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : CONFIG.DEFAULT_BATCH_SIZE;

  if (!tenantId) {
    console.error('❌ Error: Debes proporcionar un tenantId');
    console.log(
      'Uso: node scripts/sync-missing-invoices-massive.js <tenantId> [--dry-run] [--batch-size=10]'
    );
    console.log(
      'Ejemplo: node scripts/sync-missing-invoices-massive.js 3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb --batch-size=5'
    );
    process.exit(1);
  }

  console.log(`🎯 SINCRONIZACIÓN MASIVA DE FACTURAS FALTANTES`);
  console.log('='.repeat(60));
  console.log(`🏢 Tenant: ${tenantId}`);
  console.log(`⚙️  Modo: ${dryRun ? 'SIMULACIÓN' : 'REAL'}`);
  console.log(`📦 Lotes: ${batchSize} facturas por lote`);
  console.log('='.repeat(60));

  try {
    // 1. Validar tenant
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

    // 2. Obtener facturas de FacturAPI
    const facturapiInvoices = await getAllFacturapiInvoices(tenantId, tenant.businessName);

    if (facturapiInvoices.length === 0) {
      console.log('ℹ️  No hay facturas en FacturAPI para este tenant');
      return;
    }

    // 3. Obtener facturas existentes en PostgreSQL
    const existingIds = await getExistingInvoiceIds(tenantId);

    // 4. Identificar facturas faltantes
    const missingInvoices = findMissingInvoices(facturapiInvoices, existingIds);

    if (missingInvoices.length === 0) {
      console.log('✅ ¡Perfecto! No hay facturas faltantes. Todo está sincronizado.');
      return;
    }

    // 5. Confirmar antes de proceder
    if (!dryRun) {
      console.log(`\n⚠️  ¿Proceder con la sincronización de ${missingInvoices.length} facturas?`);
      console.log(
        `   Esto tomará aproximadamente ${Math.ceil((missingInvoices.length * 1.5) / 60)} minutos`
      );
      console.log('   Presiona Ctrl+C para cancelar o Enter para continuar...');

      await new Promise((resolve) => {
        process.stdin.once('data', () => resolve());
      });
    }

    // 6. Sincronización masiva
    const results = await syncMissingInvoicesMassive(tenantId, missingInvoices, batchSize, dryRun);

    // 7. Resultados finales
    const elapsed = Math.round((Date.now() - results.startTime) / 1000);

    console.log('\n' + '='.repeat(60));
    console.log('🏁 SINCRONIZACIÓN COMPLETADA');
    console.log('='.repeat(60));
    console.log(`✅ Facturas exitosas: ${results.success}`);
    console.log(`❌ Facturas con errores: ${results.failed}`);
    console.log(`📊 Total procesadas: ${results.total}`);
    console.log(`⏱️  Tiempo total: ${elapsed} segundos (${Math.round(elapsed / 60)} minutos)`);
    console.log(`📈 Velocidad: ${Math.round(results.success / (elapsed / 60))} facturas/minuto`);

    if (results.errors.length > 0) {
      console.log(`\n❌ Errores encontrados (${results.errors.length}):`);
      results.errors.slice(0, 10).forEach((err) => {
        console.log(`   • Folio ${err.folio}: ${err.error}`);
      });

      if (results.errors.length > 10) {
        console.log(`   ... y ${results.errors.length - 10} errores más`);
      }
    }

    // 8. Verificación final (solo si no es dry-run)
    if (!dryRun && results.success > 0) {
      await finalVerification(tenantId);

      console.log(`\n🎉 ¡${results.success} facturas sincronizadas exitosamente!`);
      console.log(`💡 Recomendación: Ejecuta el diagnóstico para verificar estado final.`);
    }

    if (dryRun) {
      console.log(`\n✅ Simulación completada. El sistema procesaría ${results.success} facturas.`);
      console.log(`💡 Ejecuta sin --dry-run para realizar la sincronización real.`);
    }
  } catch (error) {
    console.error(`\n❌ Error fatal: ${error.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
