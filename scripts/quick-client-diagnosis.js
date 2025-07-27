#!/usr/bin/env node

// scripts/quick-client-diagnosis.js
// Diagnóstico rápido para clientes AXA y CHUBB

import prisma from '../lib/prisma.js';

async function quickDiagnosis() {
  console.log('🔍 DIAGNÓSTICO RÁPIDO - Clientes AXA y CHUBB');
  console.log('=' * 50);

  try {
    // 1. Buscar facturas sin cliente
    console.log('\n📊 1. FACTURAS SIN CLIENTE ASOCIADO:');
    const orphanInvoices = await prisma.tenantInvoice.count({
      where: { customerId: null },
    });
    console.log(`   Total: ${orphanInvoices} facturas`);

    // 2. Buscar clientes AXA/CHUBB en la BD
    console.log('\n👥 2. CLIENTES AXA/CHUBB EN BASE DE DATOS:');
    const axaChubbClients = await prisma.tenantCustomer.findMany({
      where: {
        OR: [
          { legalName: { contains: 'AXA', mode: 'insensitive' } },
          { legalName: { contains: 'CHUBB', mode: 'insensitive' } },
          { legalName: { contains: 'ASSISTANCE', mode: 'insensitive' } },
          { legalName: { contains: 'DIGITAL', mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        tenantId: true,
        legalName: true,
        rfc: true,
        facturapiCustomerId: true,
        _count: {
          select: { invoices: true },
        },
      },
    });

    console.log(`   Encontrados: ${axaChubbClients.length} clientes`);
    axaChubbClients.forEach((client) => {
      console.log(
        `   - ${client.legalName} | RFC: ${client.rfc} | Facturas: ${client._count.invoices} | Tenant: ${client.tenantId}`
      );
    });

    // 3. Buscar facturas recientes problemáticas
    console.log('\n📄 3. FACTURAS RECIENTES CON PROBLEMAS (últimos 10 días):');
    const recentProblematic = await prisma.tenantInvoice.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        },
        customerId: null,
      },
      select: {
        id: true,
        tenantId: true,
        series: true,
        folioNumber: true,
        facturapiInvoiceId: true,
        total: true,
        createdAt: true,
        tenant: {
          select: { businessName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    console.log(`   Encontradas: ${recentProblematic.length} facturas`);
    recentProblematic.forEach((inv) => {
      console.log(
        `   - ${inv.series}${inv.folioNumber} | $${inv.total} | ${inv.tenant.businessName} | ${inv.createdAt.toDateString()}`
      );
    });

    // 4. Verificar si hay facturas con customer pero datos null
    console.log('\n⚠️  4. FACTURAS CON CLIENTE PERO DATOS NULOS:');
    const badClientData = await prisma.tenantInvoice.findMany({
      where: {
        customerId: { not: null },
        customer: {
          OR: [{ legalName: null }, { rfc: null }],
        },
      },
      include: {
        customer: true,
      },
      take: 5,
    });

    console.log(`   Encontradas: ${badClientData.length} facturas`);
    badClientData.forEach((inv) => {
      console.log(`   - Factura: ${inv.series}${inv.folioNumber} | Cliente ID: ${inv.customerId}`);
      console.log(
        `     Cliente: ${inv.customer?.legalName || 'NULL'} | RFC: ${inv.customer?.rfc || 'NULL'}`
      );
    });

    // 5. Obtener un tenant específico para análisis detallado
    console.log('\n🏢 5. ANÁLISIS POR TENANT:');
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
      take: 3,
    });

    for (const tenant of tenants) {
      console.log(`\n   Tenant: ${tenant.businessName}`);
      console.log(`   - Facturas: ${tenant._count.tenantInvoices}`);
      console.log(`   - Clientes: ${tenant._count.tenantCustomers}`);

      // Facturas huérfanas de este tenant
      const orphans = await prisma.tenantInvoice.count({
        where: {
          tenantId: tenant.id,
          customerId: null,
        },
      });
      console.log(`   - Facturas sin cliente: ${orphans}`);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
quickDiagnosis().catch(console.error);
