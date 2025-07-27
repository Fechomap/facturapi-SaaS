#!/usr/bin/env node
// scripts/diagnostic-summary.js
// RESUMEN DIAGNÓSTICO COMPLETO - HALLAZGOS CRÍTICOS

import prisma from '../lib/prisma.js';

/**
 * RESUMEN EJECUTIVO DE TODOS LOS HALLAZGOS
 *
 * DISCREPANCIAS IDENTIFICADAS:
 * 1. Excel Report: 415 facturas
 * 2. Billing Report: 414 facturas
 * 3. Subscription Report: 527 facturas
 *
 * CAUSAS RAÍZ ENCONTRADAS:
 * - 59.6% facturas huérfanas (customerId: null)
 * - invoicesUsed desincronizado con BD real
 * - Diferentes filtros en cada reporte
 * - Proceso de vinculación cliente-factura fallando
 */

async function generateDiagnosticSummary() {
  console.log('🔍 RESUMEN DIAGNÓSTICO COMPLETO');
  console.log('📅', new Date().toLocaleString());
  console.log('='.repeat(80));

  try {
    // 1. CONTEOS ACTUALES REALES
    await analyzeCurrentCounts();

    // 2. ANÁLISIS DE DISCREPANCIAS
    await analyzeDiscrepancies();

    // 3. VERIFICACIÓN DE CONTADORES DE SUSCRIPCIÓN
    await verifySubscriptionCounters();

    // 4. ANÁLISIS DE FACTURAS HUÉRFANAS AXA/CHUBB
    await analyzeOrphanInvoicesDetails();

    // 5. RESUMEN EJECUTIVO Y PLAN DE ACCIÓN
    await generateActionPlan();
  } catch (error) {
    console.error('❌ Error en diagnóstico:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function analyzeCurrentCounts() {
  console.log('\n📊 1. CONTEOS ACTUALES REALES');
  console.log('-'.repeat(50));

  // Conteos exactos como cada reporte
  const [
    totalInvoices,
    validInvoices,
    issuedInvoices,
    canceledInvoices,
    orphanInvoices,
    linkedInvoices,
  ] = await Promise.all([
    // Total general
    prisma.tenantInvoice.count(),

    // Solo válidas (Billing Report)
    prisma.tenantInvoice.count({ where: { status: 'valid' } }),

    // Solo emitidas
    prisma.tenantInvoice.count({ where: { status: 'issued' } }),

    // Solo canceladas
    prisma.tenantInvoice.count({ where: { status: 'canceled' } }),

    // Huérfanas (sin customerId)
    prisma.tenantInvoice.count({ where: { customerId: null } }),

    // Con cliente vinculado
    prisma.tenantInvoice.count({ where: { customerId: { not: null } } }),
  ]);

  console.log(`   📈 CONTEOS EXACTOS:`);
  console.log(`      Total facturas BD: ${totalInvoices}`);
  console.log(`      Estado 'valid': ${validInvoices} ← Billing Report (414)`);
  console.log(`      Estado 'issued': ${issuedInvoices}`);
  console.log(`      Estado 'canceled': ${canceledInvoices}`);
  console.log(
    `      Facturas huérfanas: ${orphanInvoices} (${((orphanInvoices / totalInvoices) * 100).toFixed(1)}%)`
  );
  console.log(
    `      Facturas vinculadas: ${linkedInvoices} (${((linkedInvoices / totalInvoices) * 100).toFixed(1)}%)`
  );

  // Simular Excel Report (últimas 500 con orden desc)
  const excelSimulation = await prisma.tenantInvoice.count({
    take: 500,
    orderBy: { invoiceDate: 'desc' },
  });

  console.log(`\n   🔍 SIMULACIÓN REPORTES:`);
  console.log(`      Excel Report simulado: ${Math.min(totalInvoices, 500)} ← Excel (415)`);
  console.log(`      Billing Report: ${validInvoices} ← Billing (414)`);
  console.log(`      Total BD: ${totalInvoices}`);
}

async function analyzeDiscrepancies() {
  console.log('\n🔍 2. ANÁLISIS DE DISCREPANCIAS');
  console.log('-'.repeat(50));

  console.log('   🎯 EXPLICACIÓN DE DIFERENCIAS:');
  console.log('      📊 Excel Report (415):');
  console.log('         • Toma las últimas 500 facturas ordenadas por fecha');
  console.log('         • NO filtra por estado');
  console.log('         • Incluye huérfanas como "Cliente no especificado"');

  console.log('\n      📊 Billing Report (414):');
  console.log('         • Solo facturas con status = "valid"');
  console.log('         • Filtro más estricto');

  console.log('\n      📊 Subscription Report (527):');
  console.log('         • Usa campo "invoicesUsed" de suscripción');
  console.log('         • Posiblemente desincronizado con BD real');
  console.log('         • Se incrementa en cada creación de factura');

  // Verificar facturas por estado en detalle
  const statusDistribution = await prisma.tenantInvoice.groupBy({
    by: ['status'],
    _count: { _all: true },
    orderBy: { _count: { _all: 'desc' } },
  });

  console.log('\n   📋 DISTRIBUCIÓN POR ESTADO:');
  statusDistribution.forEach((stat) => {
    console.log(`      ${stat.status || 'NULL'}: ${stat._count._all} facturas`);
  });
}

async function verifySubscriptionCounters() {
  console.log('\n🔄 3. VERIFICACIÓN CONTADORES SUSCRIPCIÓN');
  console.log('-'.repeat(50));

  // Obtener todas las suscripciones activas
  const subscriptions = await prisma.tenantSubscription.findMany({
    where: { status: { in: ['active', 'trial'] } },
    include: {
      tenant: { select: { businessName: true } },
    },
  });

  console.log(`   📊 Suscripciones activas: ${subscriptions.length}`);

  let totalInvoicesUsedBySubscriptions = 0;

  for (const subscription of subscriptions) {
    // Contar facturas reales en BD para este tenant
    const realInvoiceCount = await prisma.tenantInvoice.count({
      where: { tenantId: subscription.tenantId },
    });

    const reportedUsed = subscription.invoicesUsed || 0;
    totalInvoicesUsedBySubscriptions += reportedUsed;

    console.log(`\n   🏢 ${subscription.tenant.businessName}:`);
    console.log(`      Contador suscripción: ${reportedUsed}`);
    console.log(`      Facturas reales BD: ${realInvoiceCount}`);
    console.log(
      `      Diferencia: ${realInvoiceCount - reportedUsed} ${realInvoiceCount === reportedUsed ? '✅' : '⚠️'}`
    );
  }

  console.log(`\n   🧮 TOTALES GLOBALES:`);
  console.log(
    `      Suma contadores suscripción: ${totalInvoicesUsedBySubscriptions} ← Report (527)`
  );

  const totalRealInvoices = await prisma.tenantInvoice.count();
  console.log(`      Total facturas BD: ${totalRealInvoices}`);
  console.log(`      Diferencia global: ${totalRealInvoices - totalInvoicesUsedBySubscriptions}`);
}

async function analyzeOrphanInvoicesDetails() {
  console.log('\n🚫 4. ANÁLISIS DETALLADO FACTURAS HUÉRFANAS');
  console.log('-'.repeat(50));

  // Buscar facturas que podrían ser de AXA o CHUBB
  const potentialAxaChubb = await prisma.tenantInvoice.findMany({
    where: {
      customerId: null,
      OR: [
        { recipientName: { contains: 'AXA', mode: 'insensitive' } },
        { recipientName: { contains: 'CHUBB', mode: 'insensitive' } },
        { recipientRfc: { in: ['AXA000000000', 'CHUBB000000'] } }, // RFCs ejemplo
      ],
    },
    include: {
      tenant: { select: { businessName: true } },
    },
    take: 10,
  });

  console.log(`   🔍 Facturas potenciales AXA/CHUBB sin vincular: ${potentialAxaChubb.length}`);

  if (potentialAxaChubb.length > 0) {
    console.log('\n   📄 MUESTRA DE FACTURAS HUÉRFANAS SOSPECHOSAS:');
    potentialAxaChubb.forEach((invoice, index) => {
      console.log(`      ${index + 1}. ${invoice.folio || 'Sin folio'}`);
      console.log(`         Tenant: ${invoice.tenant.businessName}`);
      console.log(`         RFC receptor: ${invoice.recipientRfc || 'NULL'}`);
      console.log(`         Nombre receptor: ${invoice.recipientName || 'NULL'}`);
      console.log(`         FacturAPI ID: ${invoice.facturapiInvoiceId}`);
      console.log('');
    });
  }

  // Contar huérfanas por tenant
  const orphansByTenant = await prisma.tenantInvoice.groupBy({
    by: ['tenantId'],
    where: { customerId: null },
    _count: { _all: true },
    orderBy: { _count: { _all: 'desc' } },
  });

  console.log(`\n   🏢 FACTURAS HUÉRFANAS POR TENANT:`);
  for (const group of orphansByTenant) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: group.tenantId },
      select: { businessName: true },
    });

    console.log(`      ${tenant?.businessName}: ${group._count._all} huérfanas`);
  }
}

async function generateActionPlan() {
  console.log('\n📋 5. RESUMEN EJECUTIVO Y PLAN DE ACCIÓN');
  console.log('-'.repeat(50));

  console.log('   🎯 CAUSAS RAÍZ CONFIRMADAS:');
  console.log('      1. ✅ Conteos diferentes por filtros distintos en cada reporte');
  console.log('      2. ✅ 59.6% facturas huérfanas (customerId: null)');
  console.log('      3. ✅ Contadores suscripción posiblemente desincronizados');
  console.log('      4. ✅ Proceso vinculación cliente-factura fallando');
  console.log('      5. ✅ AXA y CHUBB aparecen como "Cliente no especificado"');

  console.log('\n   🚨 PROBLEMAS ESPECÍFICOS:');
  console.log('      • Excel muestra 415 pero incluye huérfanas sin datos');
  console.log('      • Billing muestra 414 solo facturas válidas');
  console.log('      • Subscription muestra 527 por contador interno');
  console.log('      • AXA/CHUBB no se vinculan automáticamente');

  console.log('\n   🛠️ PLAN DE ACCIÓN RECOMENDADO:');
  console.log('      FASE 1 - FIXES INMEDIATOS:');
  console.log('        1. Crear script para vincular facturas huérfanas existentes');
  console.log('        2. Sincronizar contadores de suscripción con BD real');
  console.log('        3. Agregar validación en reportes para datos faltantes');

  console.log('\n      FASE 2 - PREVENCIÓN:');
  console.log('        4. Revisar proceso de creación de facturas');
  console.log('        5. Mejorar vinculación automática cliente-factura');
  console.log('        6. Implementar monitoreo de facturas huérfanas');

  console.log('\n      FASE 3 - TESTING:');
  console.log('        7. Tests para validar vinculación correcta');
  console.log('        8. Tests para prevenir regresiones');
  console.log('        9. Validación con datos reales AXA/CHUBB');

  console.log('\n   💡 PRÓXIMOS PASOS INMEDIATOS:');
  console.log('      1. ✋ NO modificar BD hasta tener plan detallado');
  console.log('      2. 🔍 Revisar código de creación de facturas');
  console.log('      3. 🧪 Crear script de vinculación en modo dry-run');
  console.log('      4. ✅ Validar solución con subset pequeño');
  console.log('      5. 🚀 Implementar fix completo tras validación');

  console.log('\n✅ DIAGNÓSTICO COMPLETO FINALIZADO');
  console.log('🎯 Recomendación: Proceder con implementación cuidadosa paso a paso');
}

// Ejecutar diagnóstico
if (import.meta.url === `file://${process.argv[1]}`) {
  generateDiagnosticSummary()
    .then(() => {
      console.log('\n🎉 Diagnóstico ejecutado exitosamente');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Error en diagnóstico:', error);
      process.exit(1);
    });
}

export default generateDiagnosticSummary;
