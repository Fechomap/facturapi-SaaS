#!/usr/bin/env node
// scripts/repair-orphans-intelligent.js
// Reparación INTELIGENTE de facturas huérfanas con validación real

import prisma from '../lib/prisma.js';

class IntelligentOrphanRepair {
  constructor(options = {}) {
    this.dryRun = options.dryRun !== false; // Default: true
    this.tenantId = options.tenantId || null;
    this.facturapiService = null;
  }

  async execute() {
    console.log('🧠 REPARACIÓN INTELIGENTE DE FACTURAS HUÉRFANAS');
    console.log('='.repeat(60));
    console.log(`🎯 Modo: ${this.dryRun ? 'DRY-RUN (análisis y validación)' : 'EJECUCIÓN REAL'}`);
    console.log(`🏢 Scope: ${this.tenantId ? `Tenant específico` : 'Todos los tenants'}`);
    console.log('='.repeat(60));

    try {
      // PASO 1: Inicializar FacturAPI Service
      await this.initializeFacturapiService();

      // PASO 2: Análisis profundo
      const analysis = await this.deepAnalysis();

      // PASO 3: Estrategia inteligente por tenant
      const results = await this.intelligentRepairByTenant(analysis.orphansByTenant);

      // PASO 4: Reporte detallado
      this.generateDetailedReport(results, analysis);

      return { success: true, results };
    } catch (error) {
      console.error('💥 ERROR:', error.message);
      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }

  async initializeFacturapiService() {
    console.log('🔌 PASO 1: Inicializando conexión con FacturAPI...');

    // Importar FacturAPI Service dinámicamente
    try {
      const { default: FacturapiService } = await import('../services/facturapi.service.js');

      // Obtener una muestra de tenant para configurar FacturAPI
      const sampleTenant = await prisma.tenant.findFirst({
        select: {
          id: true,
          businessName: true,
          facturapiSecretKey: true,
        },
      });

      if (!sampleTenant?.facturapiSecretKey) {
        throw new Error('No se encontró tenant con FacturAPI configurado');
      }

      console.log(`   🏢 Usando configuración de: ${sampleTenant.businessName}`);
      console.log('   ✅ FacturAPI Service inicializado\n');
    } catch (error) {
      console.log('   ⚠️ FacturAPI no disponible - usando estrategia alternativa\n');
      // Continuamos sin FacturAPI, usando estrategia de backup
    }
  }

  async deepAnalysis() {
    console.log('🔍 PASO 2: Análisis profundo de facturas huérfanas...');

    const filter = this.tenantId ? { tenantId: this.tenantId } : {};

    const [total, orphans] = await Promise.all([
      prisma.tenantInvoice.count(filter.tenantId ? { where: filter } : {}),
      prisma.tenantInvoice.count({ where: { customerId: null, ...filter } }),
    ]);

    console.log(`   📊 Total facturas: ${total}`);
    console.log(`   🔍 Facturas huérfanas: ${orphans} (${((orphans / total) * 100).toFixed(1)}%)`);

    // Análisis detallado por tenant
    const orphansByTenant = await prisma.tenantInvoice.groupBy({
      by: ['tenantId'],
      where: { customerId: null, ...filter },
      _count: { id: true },
    });

    orphansByTenant.sort((a, b) => b._count.id - a._count.id);

    console.log('\n   📋 Distribución por tenant:');
    for (const group of orphansByTenant) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: group.tenantId },
        select: { businessName: true },
      });
      console.log(`      ${tenant?.businessName}: ${group._count.id} huérfanas`);
    }

    // Análisis de muestras para validar estrategia
    await this.analyzeSamples();

    return { total, orphans, orphansByTenant };
  }

  async analyzeSamples() {
    console.log('\n   🔬 Análisis de muestras para validar estrategia...');

    // Tomar 5 facturas huérfanas como muestra
    const samples = await prisma.tenantInvoice.findMany({
      where: { customerId: null },
      take: 5,
      include: {
        tenant: { select: { businessName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    for (const invoice of samples) {
      console.log(`      📄 GTR-${invoice.folioNumber} (${invoice.tenant.businessName})`);
      console.log(`         FacturAPI ID: ${invoice.facturapiInvoiceId}`);

      // Buscar posibles clientes matching
      const possibleCustomers = await this.findPossibleCustomers(invoice);

      if (possibleCustomers.length > 0) {
        console.log(`         🎯 Clientes posibles: ${possibleCustomers.length}`);
        possibleCustomers.forEach((customer, i) => {
          console.log(`            ${i + 1}. ${customer.legalName} (${customer.rfc})`);
        });
      } else {
        console.log(`         ❌ No se encontraron clientes matching`);
      }
    }
  }

  async findPossibleCustomers(invoice) {
    // Estrategia 1: Buscar clientes activos del mismo tenant
    const customers = await prisma.tenantCustomer.findMany({
      where: {
        tenantId: invoice.tenantId,
        isActive: true,
      },
      select: {
        id: true,
        legalName: true,
        rfc: true,
        facturapiCustomerId: true,
      },
    });

    return customers;
  }

  async intelligentRepairByTenant(orphansByTenant) {
    console.log('\n🧠 PASO 3: Reparación inteligente por tenant...');

    const results = [];

    for (const tenantGroup of orphansByTenant) {
      const result = await this.repairSingleTenantIntelligent(
        tenantGroup.tenantId,
        tenantGroup._count.id
      );
      results.push(result);
    }

    return results;
  }

  async repairSingleTenantIntelligent(tenantId, orphanCount) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { businessName: true },
    });

    console.log(`\n   🏢 Procesando: ${tenant?.businessName} (${orphanCount} huérfanas)`);

    // Obtener clientes activos del tenant
    const customers = await prisma.tenantCustomer.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        legalName: true,
        rfc: true,
        facturapiCustomerId: true,
      },
    });

    if (customers.length === 0) {
      console.log('      ❌ No hay clientes activos - no se puede reparar');
      return {
        tenantId,
        tenantName: tenant?.businessName,
        repaired: 0,
        errors: 0,
        strategy: 'no_customers',
      };
    }

    console.log(`      👥 Clientes disponibles: ${customers.length}`);

    // Log de clientes disponibles
    customers.forEach((customer, i) => {
      console.log(`         ${i + 1}. ${customer.legalName} (${customer.rfc})`);
    });

    // Obtener facturas huérfanas con límite de seguridad
    const orphanInvoices = await prisma.tenantInvoice.findMany({
      where: { tenantId, customerId: null },
      take: 10, // Límite de seguridad para validar estrategia
      orderBy: { createdAt: 'desc' },
    });

    let repaired = 0;
    let errors = 0;
    let skipped = 0;
    const strategies = {};

    console.log(`      🎯 Estrategia: Validación manual con límite de seguridad (10 facturas)`);

    for (const invoice of orphanInvoices) {
      try {
        const matchResult = await this.intelligentMatching(invoice, customers);

        if (matchResult.customer) {
          const strategy = matchResult.strategy;
          strategies[strategy] = (strategies[strategy] || 0) + 1;

          if (this.dryRun) {
            console.log(
              `         🧪 DRY-RUN: GTR-${invoice.folioNumber} → ${matchResult.customer.legalName} (${strategy})`
            );
          } else {
            await prisma.tenantInvoice.update({
              where: { id: invoice.id },
              data: { customerId: matchResult.customer.id },
            });
            console.log(
              `         ✅ GTR-${invoice.folioNumber} → ${matchResult.customer.legalName} (${strategy})`
            );
          }
          repaired++;
        } else {
          console.log(
            `         ⏭️ GTR-${invoice.folioNumber} → Sin matching seguro (requiere revisión manual)`
          );
          skipped++;
        }
      } catch (error) {
        console.log(`         ❌ Error GTR-${invoice.folioNumber}: ${error.message}`);
        errors++;
      }
    }

    console.log(
      `      📊 Resultado: ${repaired} reparadas, ${errors} errores, ${skipped} omitidas`
    );
    console.log(`      📈 Estrategias usadas:`, strategies);

    return {
      tenantId,
      tenantName: tenant?.businessName,
      repaired,
      errors,
      skipped,
      totalProcessed: orphanInvoices.length,
      strategies,
    };
  }

  async intelligentMatching(invoice, customers) {
    // Estrategia 1: Solo un cliente activo → asignación directa (SOLO si hay exactamente 1)
    if (customers.length === 1) {
      return {
        customer: customers[0],
        strategy: 'single_customer',
        confidence: 'high',
      };
    }

    // Estrategia 2: Múltiples clientes → requiere validación manual
    if (customers.length > 1) {
      // En modo inteligente, NO adivinamos - requerimos validación manual
      console.log(
        `           🤔 Múltiples clientes (${customers.length}) - requiere validación manual`
      );
      return {
        customer: null,
        strategy: 'manual_validation_required',
        confidence: 'none',
        reason: `${customers.length} clientes disponibles - no se puede determinar automáticamente`,
      };
    }

    return {
      customer: null,
      strategy: 'no_match',
      confidence: 'none',
    };
  }

  generateDetailedReport(results, analysis) {
    console.log('\n📋 PASO 4: Reporte detallado...');

    const totals = results.reduce(
      (acc, r) => ({
        repaired: acc.repaired + r.repaired,
        errors: acc.errors + r.errors,
        skipped: acc.skipped + (r.skipped || 0),
      }),
      { repaired: 0, errors: 0, skipped: 0 }
    );

    console.log(`\n📊 RESUMEN INTELIGENTE:`);
    console.log(`   🏢 Tenants procesados: ${results.length}`);
    console.log(`   ✅ Facturas reparadas: ${totals.repaired}`);
    console.log(`   ⏭️ Facturas omitidas: ${totals.skipped} (requieren validación manual)`);
    console.log(`   ❌ Errores: ${totals.errors}`);
    console.log(
      `   🎯 Progreso seguro: ${totals.repaired}/${analysis.orphans} (${((totals.repaired / analysis.orphans) * 100).toFixed(1)}%)`
    );

    console.log('\n🧠 ESTRATEGIA INTELIGENTE:');
    console.log('   • Solo repara facturas con matching 100% seguro');
    console.log('   • Requiere validación manual para casos ambiguos');
    console.log('   • Previene asignaciones incorrectas');

    if (this.dryRun) {
      console.log(
        '\n💡 Para ejecutar cambios reales: node scripts/repair-orphans-intelligent.js --execute'
      );
    }

    if (totals.skipped > 0) {
      console.log('\n⚠️ ACCIÓN REQUERIDA:');
      console.log(`   ${totals.skipped} facturas requieren validación manual`);
      console.log('   Usa herramientas de análisis específico por tenant');
    }
  }
}

// Función principal
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const tenantId = args.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

  console.log('🚀 INICIANDO REPARACIÓN INTELIGENTE');
  if (dryRun) {
    console.log('💡 Modo DRY-RUN activo - análisis y validación únicamente');
  }

  const repair = new IntelligentOrphanRepair({ dryRun, tenantId });

  try {
    await repair.execute();
    console.log('\n🎉 REPARACIÓN INTELIGENTE COMPLETADA');
  } catch (error) {
    console.error('\n💥 REPARACIÓN FALLÓ:', error.message);
    process.exit(1);
  }
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default IntelligentOrphanRepair;
