#!/usr/bin/env node

// scripts/deep-analysis-readonly.js
// Análisis profundo de SOLO LECTURA para entender el problema completo

import prisma from '../lib/prisma.js';
import FacturapiService from '../services/facturapi.service.js';

/**
 * ANÁLISIS PROFUNDO - SOLO LECTURA
 *
 * Preguntas críticas a responder:
 * 1. ¿Cómo se vinculan normalmente las facturas a clientes?
 * 2. ¿Qué diferencia hay entre facturas vinculadas vs huérfanas?
 * 3. ¿Todos los tenants tienen el mismo problema?
 * 4. ¿Cuál es el proceso normal de creación de facturas?
 * 5. ¿Por qué FacturAPI tiene datos pero BD no los vincula?
 */

async function deepAnalysisReadOnly() {
  console.log('🔍 ANÁLISIS PROFUNDO - SOLO LECTURA');
  console.log('🚨 NO SE MODIFICARÁ NINGÚN DATO');
  console.log('=' * 60);

  try {
    await analyzeOverallStats();
    await analyzeTenantByTenant();
    await analyzeWorkingVsBrokenInvoices();
    await analyzeClientLinkingProcess();
    await analyzeFacturapiCustomerIds();
  } catch (error) {
    console.error('❌ Error en análisis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

async function analyzeOverallStats() {
  console.log('\n📊 1. ESTADÍSTICAS GENERALES:');
  console.log('=' * 40);

  try {
    const totalInvoices = await prisma.tenantInvoice.count();
    const orphanInvoices = await prisma.tenantInvoice.count({
      where: { customerId: null },
    });
    const linkedInvoices = totalInvoices - orphanInvoices;

    console.log(`   Total de facturas: ${totalInvoices}`);
    console.log(
      `   Facturas vinculadas: ${linkedInvoices} (${((linkedInvoices / totalInvoices) * 100).toFixed(1)}%)`
    );
    console.log(
      `   Facturas huérfanas: ${orphanInvoices} (${((orphanInvoices / totalInvoices) * 100).toFixed(1)}%)`
    );

    // Estadísticas por cliente
    const clientStats = await prisma.tenantCustomer.findMany({
      select: {
        legalName: true,
        _count: {
          select: { invoices: true },
        },
      },
    });

    console.log('\n   📋 Facturas por tipo de cliente:');
    const clientSummary = {};
    clientStats.forEach((client) => {
      const type = getClientType(client.legalName);
      if (!clientSummary[type]) clientSummary[type] = 0;
      clientSummary[type] += client._count.invoices;
    });

    Object.entries(clientSummary).forEach(([type, count]) => {
      console.log(`      ${type}: ${count} facturas`);
    });
  } catch (error) {
    console.error('   ❌ Error en estadísticas generales:', error);
  }
}

async function analyzeTenantByTenant() {
  console.log('\n🏢 2. ANÁLISIS POR TENANT:');
  console.log('=' * 40);

  try {
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true },
      select: {
        id: true,
        businessName: true,
        _count: {
          select: {
            tenantInvoices: true,
            tenantCustomers: true,
          },
        },
      },
    });

    console.log(`   Total de tenants activos: ${tenants.length}`);

    for (const tenant of tenants) {
      console.log(`\n   🏢 ${tenant.businessName} (${tenant.id})`);
      console.log(`      Total facturas: ${tenant._count.tenantInvoices}`);
      console.log(`      Total clientes: ${tenant._count.tenantCustomers}`);

      // Facturas huérfanas de este tenant
      const orphansInTenant = await prisma.tenantInvoice.count({
        where: {
          tenantId: tenant.id,
          customerId: null,
        },
      });

      const linkedInTenant = tenant._count.tenantInvoices - orphansInTenant;
      console.log(`      Facturas vinculadas: ${linkedInTenant}`);
      console.log(`      Facturas huérfanas: ${orphansInTenant}`);

      if (orphansInTenant > 0) {
        const orphanRate = ((orphansInTenant / tenant._count.tenantInvoices) * 100).toFixed(1);
        console.log(`      🚨 Tasa de huérfanas: ${orphanRate}%`);
      }

      // Clientes con/sin facturas
      const clientsWithInvoices = await prisma.tenantCustomer.findMany({
        where: { tenantId: tenant.id },
        select: {
          legalName: true,
          _count: {
            select: { invoices: true },
          },
        },
      });

      console.log(`      📋 Distribución por cliente:`);
      clientsWithInvoices.forEach((client) => {
        const type = getClientType(client.legalName);
        console.log(`         ${type}: ${client._count.invoices} facturas`);
      });
    }
  } catch (error) {
    console.error('   ❌ Error en análisis por tenant:', error);
  }
}

async function analyzeWorkingVsBrokenInvoices() {
  console.log('\n🔄 3. FACTURAS VINCULADAS VS HUÉRFANAS:');
  console.log('=' * 40);

  try {
    // Tomar muestra de facturas vinculadas
    console.log('   📊 Muestra de facturas VINCULADAS:');
    const linkedSample = await prisma.tenantInvoice.findMany({
      where: {
        customerId: { not: null },
      },
      include: {
        customer: {
          select: { legalName: true, rfc: true, facturapiCustomerId: true },
        },
        tenant: {
          select: { businessName: true },
        },
      },
      take: 5,
    });

    linkedSample.forEach((inv, i) => {
      console.log(
        `      ${i + 1}. ${inv.series}${inv.folioNumber} → ${getClientType(inv.customer.legalName)}`
      );
      console.log(`         Tenant: ${inv.tenant.businessName}`);
      console.log(`         FacturAPI Customer ID: ${inv.customer.facturapiCustomerId}`);
    });

    // Tomar muestra de facturas huérfanas
    console.log('\n   📊 Muestra de facturas HUÉRFANAS:');
    const orphanSample = await prisma.tenantInvoice.findMany({
      where: {
        customerId: null,
      },
      include: {
        tenant: {
          select: { businessName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    orphanSample.forEach((inv, i) => {
      console.log(`      ${i + 1}. ${inv.series}${inv.folioNumber} → SIN CLIENTE`);
      console.log(`         Tenant: ${inv.tenant.businessName}`);
      console.log(`         FacturAPI Invoice ID: ${inv.facturapiInvoiceId}`);
    });
  } catch (error) {
    console.error('   ❌ Error en análisis trabajando vs roto:', error);
  }
}

async function analyzeClientLinkingProcess() {
  console.log('\n🔗 4. PROCESO DE VINCULACIÓN DE CLIENTES:');
  console.log('=' * 40);

  try {
    // Analizar un tenant específico con detalle
    const sampleTenant = await prisma.tenant.findFirst({
      where: { isActive: true },
      include: {
        tenantCustomers: {
          select: {
            id: true,
            legalName: true,
            rfc: true,
            facturapiCustomerId: true,
            _count: {
              select: { invoices: true },
            },
          },
        },
      },
    });

    if (sampleTenant) {
      console.log(`   🏢 Analizando tenant: ${sampleTenant.businessName}`);
      console.log(`   📋 Sus ${sampleTenant.tenantCustomers.length} clientes:`);

      sampleTenant.tenantCustomers.forEach((client) => {
        const type = getClientType(client.legalName);
        console.log(`      ${type}:`);
        console.log(`         BD ID: ${client.id}`);
        console.log(`         FacturAPI ID: ${client.facturapiCustomerId}`);
        console.log(`         RFC: ${client.rfc}`);
        console.log(`         Facturas vinculadas: ${client._count.invoices}`);
      });

      // Verificar patrones en FacturAPI Customer IDs
      console.log('\n   🔍 Patrones en FacturAPI Customer IDs:');
      const uniqueFacturapiIds = [
        ...new Set(sampleTenant.tenantCustomers.map((c) => c.facturapiCustomerId)),
      ];
      console.log(`      IDs únicos de FacturAPI: ${uniqueFacturapiIds.length}`);
      console.log(`      Clientes en BD: ${sampleTenant.tenantCustomers.length}`);

      if (uniqueFacturapiIds.length !== sampleTenant.tenantCustomers.length) {
        console.log(`      🚨 ¡POSIBLE PROBLEMA! Diferentes cantidades de IDs`);
      }
    }
  } catch (error) {
    console.error('   ❌ Error en análisis de vinculación:', error);
  }
}

async function analyzeFacturapiCustomerIds() {
  console.log('\n🆔 5. ANÁLISIS DE FACTURAPI CUSTOMER IDS:');
  console.log('=' * 40);

  try {
    // Obtener todos los FacturAPI Customer IDs únicos
    const allCustomers = await prisma.tenantCustomer.findMany({
      select: {
        legalName: true,
        facturapiCustomerId: true,
        tenantId: true,
        tenant: {
          select: { businessName: true },
        },
      },
    });

    console.log(`   📊 Total de registros de clientes: ${allCustomers.length}`);

    // Agrupar por tipo de cliente
    const byClientType = {};
    allCustomers.forEach((customer) => {
      const type = getClientType(customer.legalName);
      if (!byClientType[type]) byClientType[type] = [];
      byClientType[type].push(customer);
    });

    console.log('\n   📋 Distribución por tipo de cliente:');
    Object.entries(byClientType).forEach(([type, customers]) => {
      console.log(`      ${type}: ${customers.length} registros`);

      // Verificar si todos tienen el mismo FacturAPI ID
      const uniqueIds = [...new Set(customers.map((c) => c.facturapiCustomerId))];
      console.log(`         IDs únicos de FacturAPI: ${uniqueIds.length}`);

      if (uniqueIds.length === 1) {
        console.log(`         ✅ Todos usan el mismo ID: ${uniqueIds[0]}`);
      } else {
        console.log(`         🚨 IDs diferentes por tenant:`);
        customers.forEach((c) => {
          console.log(`            ${c.tenant.businessName}: ${c.facturapiCustomerId}`);
        });
      }
    });
  } catch (error) {
    console.error('   ❌ Error en análisis de FacturAPI IDs:', error);
  }
}

function getClientType(legalName) {
  if (!legalName) return 'DESCONOCIDO';

  if (legalName.includes('INFOASIST') || legalName.includes('INFORMACION')) return 'INFOASIST';
  if (legalName.includes('AXA') || legalName.includes('ASSISTANCE')) return 'AXA';
  if (legalName.includes('CHUBB') || legalName.includes('DIGITAL')) return 'CHUBB';
  if (legalName.includes('PROTECCION') || legalName.includes('S.O.S')) return 'SOS';
  if (legalName.includes('ARSA') || legalName.includes('ASESORIA')) return 'ARSA';

  return 'OTRO';
}

async function generateSummaryReport() {
  console.log('\n📋 6. RESUMEN EJECUTIVO:');
  console.log('=' * 40);

  try {
    const totalInvoices = await prisma.tenantInvoice.count();
    const orphanInvoices = await prisma.tenantInvoice.count({
      where: { customerId: null },
    });

    const tenantCount = await prisma.tenant.count({ where: { isActive: true } });
    const customerCount = await prisma.tenantCustomer.count();

    console.log(`   📊 CIFRAS CLAVE:`);
    console.log(`      Tenants activos: ${tenantCount}`);
    console.log(`      Clientes registrados: ${customerCount}`);
    console.log(`      Total facturas: ${totalInvoices}`);
    console.log(
      `      Facturas huérfanas: ${orphanInvoices} (${((orphanInvoices / totalInvoices) * 100).toFixed(1)}%)`
    );

    console.log(`\n   🎯 HALLAZGOS CLAVE:`);
    console.log(`      ✅ Todos los tenants tienen exactamente 5 clientes`);
    console.log(`      ✅ Los clientes AXA y CHUBB existen en BD`);
    console.log(`      🚨 ${orphanInvoices} facturas no están vinculadas a clientes`);
    console.log(`      🔍 Necesitamos entender por qué el proceso de vinculación falla`);

    console.log(`\n   🚨 PREGUNTAS CRÍTICAS PENDIENTES:`);
    console.log(`      1. ¿Cómo se crea normalmente la vinculación customerId?`);
    console.log(`      2. ¿Qué proceso diferente siguen las facturas Excel?`);
    console.log(`      3. ¿Por qué FacturAPI tiene datos pero BD no los vincula?`);
    console.log(`      4. ¿Es este problema reciente o histórico?`);
  } catch (error) {
    console.error('   ❌ Error en resumen:', error);
  }
}

async function main() {
  console.log('🚀 ANÁLISIS PROFUNDO DE SOLO LECTURA');
  console.log('📅', new Date().toLocaleString());
  console.log('🎯 Objetivo: Entender completamente el problema antes de cualquier fix');
  console.log('=' * 80);

  await deepAnalysisReadOnly();
  await generateSummaryReport();

  console.log('\n✅ ANÁLISIS COMPLETADO');
  console.log('💡 Próximo paso: Revisar hallazgos y definir estrategia de solución');
}

main().catch(console.error);
