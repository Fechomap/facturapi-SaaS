#!/usr/bin/env node
// scripts/verify-customers.js
// Verificar si CHUBB y AXA aparecen en lista de clientes para reportes

import prisma from '../lib/prisma.js';

async function verifyCustomers() {
  const tenantId = '3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb';

  console.log('🔍 VERIFICANDO CLIENTES PARA REPORTES');
  console.log('='.repeat(50));

  try {
    // Obtener clientes como lo hace el sistema de reportes
    const customers = await prisma.tenantCustomer.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        legalName: true,
        rfc: true,
        email: true,
        _count: {
          select: {
            invoices: true,
          },
        },
      },
      orderBy: {
        legalName: 'asc',
      },
    });

    console.log(`📊 Total clientes activos: ${customers.length}`);
    console.log('\n👥 LISTA DE CLIENTES:');

    customers.forEach((customer, index) => {
      console.log(`   ${index + 1}. ${customer.legalName}`);
      console.log(`      ID: ${customer.id}`);
      console.log(`      RFC: ${customer.rfc}`);
      console.log(`      Facturas: ${customer._count.invoices}`);
      console.log('');
    });

    // Verificar facturas recientes con customerId
    console.log('\n📄 FACTURAS RECIENTES CON CLIENTE:');
    const recentInvoices = await prisma.tenantInvoice.findMany({
      where: {
        tenantId,
        customerId: { not: null },
      },
      include: {
        customer: {
          select: {
            legalName: true,
            rfc: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
    });

    recentInvoices.forEach((invoice, index) => {
      console.log(`   ${index + 1}. GTR-${invoice.folioNumber} → ${invoice.customer?.legalName}`);
    });

    // Buscar específicamente CHUBB y AXA
    console.log('\n🔍 BÚSQUEDA ESPECÍFICA AXA/CHUBB:');
    const axaChubb = await prisma.tenantCustomer.findMany({
      where: {
        tenantId,
        OR: [
          { legalName: { contains: 'CHUBB', mode: 'insensitive' } },
          { legalName: { contains: 'AXA', mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        legalName: true,
        isActive: true,
        _count: {
          select: {
            invoices: true,
          },
        },
      },
    });

    console.log(`   AXA/CHUBB encontrados: ${axaChubb.length}`);
    axaChubb.forEach((client) => {
      console.log(`   • ${client.legalName} (ID: ${client.id})`);
      console.log(`     Activo: ${client.isActive ? '✅' : '❌'}`);
      console.log(`     Facturas: ${client._count.invoices}`);
    });
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyCustomers();
