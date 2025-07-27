#!/usr/bin/env node
// scripts/repair-orphans-facturapi.js
// Reparación usando FacturAPI para obtener customer data real

import prisma from '../lib/prisma.js';

class FacturapiOrphanRepair {
  constructor(options = {}) {
    this.dryRun = options.dryRun !== false; // Default: true
    this.tenantId = options.tenantId || null;
    this.batchSize = options.batchSize || 5; // Pequeños lotes para no sobrecargar FacturAPI
  }

  async execute() {
    console.log('🔌 REPARACIÓN CON FACTURAPI');
    console.log('='.repeat(60));
    console.log(`🎯 Modo: ${this.dryRun ? 'DRY-RUN (análisis y validación)' : 'EJECUCIÓN REAL'}`);
    console.log(`🏢 Scope: ${this.tenantId ? `Tenant específico` : 'Todos los tenants'}`);
    console.log(`📦 Batch size: ${this.batchSize} facturas`);
    console.log('='.repeat(60));

    try {
      // PASO 1: Análisis inicial
      const analysis = await this.analyzeOrphans();

      // PASO 2: Reparación usando FacturAPI
      const results = await this.repairUsingFacturapi(analysis.orphansByTenant);

      // PASO 3: Reporte detallado
      this.generateDetailedReport(results, analysis);

      return { success: true, results };
    } catch (error) {
      console.error('💥 ERROR:', error.message);
      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }

  async analyzeOrphans() {
    console.log('📊 PASO 1: Análisis de facturas huérfanas...');

    const filter = this.tenantId ? { tenantId: this.tenantId } : {};

    const [total, orphans] = await Promise.all([
      prisma.tenantInvoice.count(filter.tenantId ? { where: filter } : {}),
      prisma.tenantInvoice.count({ where: { customerId: null, ...filter } }),
    ]);

    console.log(`   📊 Total facturas: ${total}`);
    console.log(`   🔍 Facturas huérfanas: ${orphans} (${((orphans / total) * 100).toFixed(1)}%)`);

    // Agrupar por tenant
    const orphansByTenant = await prisma.tenantInvoice.groupBy({
      by: ['tenantId'],
      where: { customerId: null, ...filter },
      _count: { id: true },
    });

    orphansByTenant.sort((a, b) => b._count.id - a._count.id);

    console.log('\\n   📋 Distribución por tenant:');
    for (const group of orphansByTenant) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: group.tenantId },
        select: { businessName: true },
      });
      console.log(`      ${tenant?.businessName}: ${group._count.id} huérfanas`);
    }

    return { total, orphans, orphansByTenant };
  }

  async repairUsingFacturapi(orphansByTenant) {
    console.log('\\n🔌 PASO 2: Reparación usando FacturAPI...');

    const results = [];

    for (const tenantGroup of orphansByTenant) {
      const result = await this.repairSingleTenantWithFacturapi(
        tenantGroup.tenantId,
        tenantGroup._count.id
      );
      results.push(result);
    }

    return results;
  }

  async repairSingleTenantWithFacturapi(tenantId, orphanCount) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        businessName: true,
        facturapiApiKey: true,
      },
    });

    console.log(`\\n   🏢 Procesando: ${tenant?.businessName} (${orphanCount} huérfanas)`);

    if (!tenant?.facturapiApiKey) {
      console.log('      ❌ No tiene FacturAPI configurado - saltando');
      return {
        tenantId,
        tenantName: tenant?.businessName,
        repaired: 0,
        errors: 0,
        skipped: orphanCount,
        reason: 'no_facturapi_key',
      };
    }

    // Obtener clientes del tenant con sus facturapiCustomerId
    const customers = await prisma.tenantCustomer.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        legalName: true,
        rfc: true,
        facturapiCustomerId: true,
      },
    });

    console.log(`      👥 Clientes disponibles: ${customers.length}`);

    // Obtener TODAS las facturas huérfanas del tenant
    const orphanInvoices = await prisma.tenantInvoice.findMany({
      where: { tenantId, customerId: null },
      // Sin límite: procesar todas las huérfanas
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        folioNumber: true,
        series: true,
        facturapiInvoiceId: true,
        total: true,
        status: true,
      },
    });

    console.log(
      `      📄 Procesando ${orphanInvoices.length} facturas (TODAS con 1s entre cada una)`
    );

    let repaired = 0;
    let errors = 0;
    let skipped = 0;
    const matchStrategies = {};

    for (let i = 0; i < orphanInvoices.length; i++) {
      const invoice = orphanInvoices[i];
      console.log(
        `         [${i + 1}/${orphanInvoices.length}] Procesando ${invoice.series}-${invoice.folioNumber}...`
      );
      try {
        const matchResult = await this.matchInvoiceWithFacturapi(
          invoice,
          customers,
          tenant.facturapiApiKey
        );

        if (matchResult.customer) {
          const strategy = matchResult.strategy;
          matchStrategies[strategy] = (matchStrategies[strategy] || 0) + 1;

          if (this.dryRun) {
            console.log(
              `         🧪 DRY-RUN: ${invoice.series}-${invoice.folioNumber} → ${matchResult.customer.legalName} (${strategy})`
            );
          } else {
            await prisma.tenantInvoice.update({
              where: { id: invoice.id },
              data: { customerId: matchResult.customer.id },
            });
            console.log(
              `         ✅ ${invoice.series}-${invoice.folioNumber} → ${matchResult.customer.legalName} (${strategy})`
            );
          }
          repaired++;
        } else {
          console.log(
            `         ⏭️ ${invoice.series}-${invoice.folioNumber} → ${matchResult.reason || 'Sin matching'}`
          );
          skipped++;
        }

        // Pausa de 1 segundo entre cada factura
        await this.sleep(1000);
      } catch (error) {
        console.log(`         ❌ Error ${invoice.series}-${invoice.folioNumber}: ${error.message}`);
        errors++;
      }
    }

    console.log(
      `      📊 Resultado: ${repaired} reparadas, ${errors} errores, ${skipped} omitidas`
    );
    if (Object.keys(matchStrategies).length > 0) {
      console.log(`      📈 Estrategias:`, matchStrategies);
    }

    return {
      tenantId,
      tenantName: tenant?.businessName,
      repaired,
      errors,
      skipped,
      totalProcessed: orphanInvoices.length,
      strategies: matchStrategies,
    };
  }

  async matchInvoiceWithFacturapi(invoice, customers, facturapiKey) {
    try {
      // PASO 1: Consultar FacturAPI para obtener la factura
      const facturapiInvoice = await this.fetchInvoiceFromFacturapi(
        invoice.facturapiInvoiceId,
        facturapiKey
      );

      if (!facturapiInvoice) {
        return {
          customer: null,
          strategy: 'facturapi_not_found',
          reason: 'Factura no encontrada en FacturAPI',
        };
      }

      // PASO 2: Obtener customer_id de FacturAPI
      const facturapiCustomerId =
        typeof facturapiInvoice.customer === 'object'
          ? facturapiInvoice.customer.id || facturapiInvoice.customer
          : facturapiInvoice.customer;

      if (!facturapiCustomerId) {
        return {
          customer: null,
          strategy: 'no_customer_in_facturapi',
          reason: 'FacturAPI no tiene customer asociado',
        };
      }

      // PASO 3: Buscar customer local por facturapiCustomerId
      const matchingCustomer = customers.find((c) => c.facturapiCustomerId === facturapiCustomerId);

      if (matchingCustomer) {
        return {
          customer: matchingCustomer,
          strategy: 'facturapi_customer_match',
          confidence: 'high',
          facturapiCustomerId,
        };
      }

      return {
        customer: null,
        strategy: 'customer_not_in_local_db',
        reason: `FacturAPI customer ${facturapiCustomerId} no encontrado en BD local`,
      };
    } catch (error) {
      return {
        customer: null,
        strategy: 'facturapi_error',
        reason: `Error consultando FacturAPI: ${error.message}`,
      };
    }
  }

  async fetchInvoiceFromFacturapi(invoiceId, apiKey) {
    try {
      console.log(`           🔍 Consultando FacturAPI: ${invoiceId}`);

      // Implementar llamada real a FacturAPI
      const response = await fetch(`https://www.facturapi.io/v2/invoices/${invoiceId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.log(`           ⚠️ FacturAPI HTTP ${response.status}: ${response.statusText}`);
        return null;
      }

      const invoiceData = await response.json();
      const customerId =
        typeof invoiceData.customer === 'object'
          ? invoiceData.customer.id || invoiceData.customer
          : invoiceData.customer;
      console.log(`           ✅ FacturAPI respondió: customer=${customerId}`);

      return invoiceData;
    } catch (error) {
      console.log(`           ❌ Error FacturAPI: ${error.message}`);
      return null;
    }
  }

  generateDetailedReport(results, analysis) {
    console.log('\\n📋 PASO 3: Reporte detallado...');

    const totals = results.reduce(
      (acc, r) => ({
        repaired: acc.repaired + r.repaired,
        errors: acc.errors + r.errors,
        skipped: acc.skipped + (r.skipped || 0),
      }),
      { repaired: 0, errors: 0, skipped: 0 }
    );

    console.log(`\\n📊 RESUMEN FACTURAPI:`);
    console.log(`   🏢 Tenants procesados: ${results.length}`);
    console.log(`   ✅ Facturas reparadas: ${totals.repaired}`);
    console.log(`   ⏭️ Facturas omitidas: ${totals.skipped}`);
    console.log(`   ❌ Errores: ${totals.errors}`);
    console.log(
      `   🎯 Progreso: ${totals.repaired}/${analysis.orphans} (${((totals.repaired / analysis.orphans) * 100).toFixed(1)}%)`
    );

    console.log('\\n🔌 ESTRATEGIA FACTURAPI:');
    console.log('   • Consulta FacturAPI por cada factura huérfana');
    console.log('   • Obtiene customer_id real de FacturAPI');
    console.log('   • Hace matching con facturapiCustomerId local');
    console.log('   • Garantiza vinculación correcta');

    if (this.dryRun) {
      console.log(
        '\\n💡 Para ejecutar cambios reales: node scripts/repair-orphans-facturapi.js --execute'
      );
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Función principal
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const tenantId = args.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];
  const batchSize = parseInt(args.find((arg) => arg.startsWith('--batch='))?.split('=')[1]) || 5;

  console.log('🚀 INICIANDO REPARACIÓN CON FACTURAPI');
  if (dryRun) {
    console.log('💡 Modo DRY-RUN activo - análisis únicamente');
  }

  const repair = new FacturapiOrphanRepair({ dryRun, tenantId, batchSize });

  try {
    await repair.execute();
    console.log('\\n🎉 REPARACIÓN CON FACTURAPI COMPLETADA');
  } catch (error) {
    console.error('\\n💥 REPARACIÓN FALLÓ:', error.message);
    process.exit(1);
  }
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default FacturapiOrphanRepair;
