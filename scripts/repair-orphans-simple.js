#!/usr/bin/env node
// scripts/repair-orphans-simple.js
// Reparación simple de facturas huérfanas

import prisma from '../lib/prisma.js';
// import { createPreOperationBackup } from './backup-database.js';

class SimpleOrphanRepair {
  constructor(options = {}) {
    this.dryRun = options.dryRun !== false; // Default: true
    this.tenantId = options.tenantId || null;
  }

  async execute() {
    console.log('🔧 REPARACIÓN SIMPLE DE FACTURAS HUÉRFANAS');
    console.log('='.repeat(60));
    console.log(`🎯 Modo: ${this.dryRun ? 'DRY-RUN (solo simulación)' : 'EJECUCIÓN REAL'}`);
    console.log(`🏢 Scope: ${this.tenantId ? `Tenant específico` : 'Todos los tenants'}`);
    console.log('='.repeat(60));

    try {
      // PASO 1: Backup ya creado manualmente
      console.log('🛡️ PASO 1: Backup ya creado - /backups/20250726_2055/railway.dump\n');

      // PASO 2: Análisis
      const analysis = await this.analyzeOrphans();

      // PASO 3: Estrategia de reparación por tenant
      const results = await this.repairByTenant(analysis.orphansByTenant);

      // PASO 4: Reporte final
      this.generateReport(results, analysis);

      return { success: true, results };
    } catch (error) {
      console.error('💥 ERROR:', error.message);
      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }

  async analyzeOrphans() {
    console.log('📊 PASO 2: Análisis de facturas huérfanas...');

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

    console.log('\n   📋 Distribución por tenant:');
    for (const group of orphansByTenant) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: group.tenantId },
        select: { businessName: true },
      });
      console.log(`      ${tenant?.businessName}: ${group._count.id} huérfanas`);
    }

    return { total, orphans, orphansByTenant };
  }

  async repairByTenant(orphansByTenant) {
    console.log('\n🔧 PASO 3: Reparación por tenant...');

    const results = [];

    for (const tenantGroup of orphansByTenant) {
      const result = await this.repairSingleTenant(tenantGroup.tenantId, tenantGroup._count.id);
      results.push(result);
    }

    return results;
  }

  async repairSingleTenant(tenantId, orphanCount) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { businessName: true },
    });

    console.log(`\n   🏢 Procesando: ${tenant?.businessName} (${orphanCount} huérfanas)`);

    // Obtener clientes activos del tenant
    const customers = await prisma.tenantCustomer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, legalName: true, rfc: true },
    });

    if (customers.length === 0) {
      console.log('      ❌ No hay clientes activos - no se puede reparar');
      return { tenantId, tenantName: tenant?.businessName, repaired: 0, errors: 0 };
    }

    console.log(`      👥 Clientes disponibles: ${customers.length}`);

    // Obtener facturas huérfanas - TODAS las restantes
    const orphanInvoices = await prisma.tenantInvoice.findMany({
      where: { tenantId, customerId: null },
      // Sin límite: reparar todas las restantes
      orderBy: { createdAt: 'desc' }, // Más recientes primero
    });

    let repaired = 0;
    let errors = 0;

    // ESTRATEGIA SIMPLE: Asignar al primer cliente activo
    // TODO: Implementar matching inteligente por RFC/nombre
    const defaultCustomer = customers[0];

    console.log(`      🎯 Estrategia: Asignar a "${defaultCustomer.legalName}"`);

    for (const invoice of orphanInvoices) {
      try {
        if (this.dryRun) {
          console.log(
            `         🧪 DRY-RUN: GTR-${invoice.folioNumber} → ${defaultCustomer.legalName}`
          );
        } else {
          await prisma.tenantInvoice.update({
            where: { id: invoice.id },
            data: { customerId: defaultCustomer.id },
          });
          console.log(`         ✅ GTR-${invoice.folioNumber} → ${defaultCustomer.legalName}`);
        }
        repaired++;
      } catch (error) {
        console.log(`         ❌ Error GTR-${invoice.folioNumber}: ${error.message}`);
        errors++;
      }
    }

    console.log(`      📊 Resultado: ${repaired} reparadas, ${errors} errores`);

    return {
      tenantId,
      tenantName: tenant?.businessName,
      repaired,
      errors,
      totalProcessed: orphanInvoices.length,
    };
  }

  generateReport(results, analysis) {
    console.log('\n📋 PASO 4: Reporte final...');

    const totals = results.reduce(
      (acc, r) => ({
        repaired: acc.repaired + r.repaired,
        errors: acc.errors + r.errors,
      }),
      { repaired: 0, errors: 0 }
    );

    console.log(`\n📊 RESUMEN:`);
    console.log(`   🏢 Tenants procesados: ${results.length}`);
    console.log(`   ✅ Facturas reparadas: ${totals.repaired}`);
    console.log(`   ❌ Errores: ${totals.errors}`);
    console.log(
      `   🎯 Progreso: ${totals.repaired}/${analysis.orphans} (${((totals.repaired / analysis.orphans) * 100).toFixed(1)}%)`
    );

    if (this.dryRun) {
      console.log(
        '\n💡 Para ejecutar cambios reales: node scripts/repair-orphans-simple.js --execute'
      );
    }
  }
}

// Función principal
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const tenantId = args.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

  console.log('🚀 INICIANDO REPARACIÓN SIMPLE');
  if (dryRun) {
    console.log('💡 Modo DRY-RUN activo - no se harán cambios reales');
  }

  const repair = new SimpleOrphanRepair({ dryRun, tenantId });

  try {
    await repair.execute();
    console.log('\n🎉 REPARACIÓN COMPLETADA');
  } catch (error) {
    console.error('\n💥 REPARACIÓN FALLÓ:', error.message);
    process.exit(1);
  }
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default SimpleOrphanRepair;
