#!/usr/bin/env node
// scripts/quick-orphan-analysis.js
// Análisis rápido de facturas huérfanas

import prisma from '../lib/prisma.js';

async function quickAnalysis() {
  try {
    console.log('🔍 ANÁLISIS RÁPIDO DE FACTURAS HUÉRFANAS');
    console.log('='.repeat(50));

    // 1. Estadísticas básicas
    const [totalInvoices, orphanInvoices] = await Promise.all([
      prisma.tenantInvoice.count(),
      prisma.tenantInvoice.count({ where: { customerId: null } }),
    ]);

    console.log(`📊 Total facturas: ${totalInvoices}`);
    console.log(
      `🔍 Facturas huérfanas: ${orphanInvoices} (${((orphanInvoices / totalInvoices) * 100).toFixed(1)}%)`
    );

    // 2. Distribución por tenant
    const orphansByTenant = await prisma.tenantInvoice.groupBy({
      by: ['tenantId'],
      where: { customerId: null },
      _count: { id: true },
    });

    console.log('\n📋 Distribución por tenant:');
    for (const group of orphansByTenant.slice(0, 5)) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: group.tenantId },
        select: { businessName: true },
      });
      console.log(`   ${tenant?.businessName}: ${group._count.id} huérfanas`);
    }

    // 3. Muestra de facturas huérfanas
    const samples = await prisma.tenantInvoice.findMany({
      where: { customerId: null },
      take: 3,
      select: {
        id: true,
        folioNumber: true,
        facturapiInvoiceId: true,
        total: true,
        status: true,
        createdAt: true,
      },
    });

    console.log('\n📄 Muestra de facturas huérfanas:');
    samples.forEach((invoice) => {
      console.log(`   GTR-${invoice.folioNumber}: $${invoice.total} (${invoice.status})`);
    });

    console.log('\n✅ Análisis completado');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

quickAnalysis();
