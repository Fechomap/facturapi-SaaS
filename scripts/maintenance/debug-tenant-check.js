#!/usr/bin/env node
/**
 * DEBUG: Verificar si el tenant existe y tiene facturas
 */

import prisma from '../../lib/prisma.js';

async function debugTenant() {
  const tenantId = process.argv[2] || '3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb';
  
  try {
    console.log('🔍 Verificando tenant:', tenantId);
    
    // 1. Verificar si el tenant existe
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true,
        rfc: true,
        facturapiApiKey: true,
        isActive: true,
      },
    });

    if (!tenant) {
      console.log('❌ Tenant NO EXISTE');
      return;
    }

    console.log('✅ Tenant encontrado:', {
      name: tenant.businessName,
      rfc: tenant.rfc,
      active: tenant.isActive,
      hasApiKey: !!tenant.facturapiApiKey,
    });

    // 2. Contar todas las facturas del tenant
    const totalInvoices = await prisma.tenantInvoice.count({
      where: { tenantId }
    });

    console.log('📊 Total facturas del tenant:', totalInvoices);

    // 3. Buscar facturas del 27/07/2025 en adelante
    const suspiciousDate = new Date('2025-07-27T00:00:00Z');
    const suspiciousInvoices = await prisma.tenantInvoice.findMany({
      where: {
        tenantId,
        invoiceDate: {
          gte: suspiciousDate
        }
      },
      select: {
        id: true,
        facturapiInvoiceId: true,
        invoiceDate: true,
        createdAt: true,
        folioNumber: true,
        series: true,
      },
      orderBy: { invoiceDate: 'asc' },
      take: 10
    });

    console.log('📅 Facturas desde 27/07/2025:', suspiciousInvoices.length);

    if (suspiciousInvoices.length > 0) {
      console.log('📋 Primeras facturas sospechosas:');
      suspiciousInvoices.forEach(inv => {
        console.log(`   ${inv.series}${inv.folioNumber}: ${inv.invoiceDate.toISOString().split('T')[0]} (FacturAPI: ${inv.facturapiInvoiceId})`);
      });
    }

    // 4. Verificar facturas por día
    const dateGroups = await prisma.tenantInvoice.groupBy({
      by: ['invoiceDate'],
      where: { tenantId },
      _count: { invoiceDate: true },
      orderBy: { invoiceDate: 'desc' },
      take: 10
    });

    console.log('\n📈 Top 10 fechas con más facturas:');
    dateGroups.forEach(group => {
      console.log(`   ${group.invoiceDate.toISOString().split('T')[0]}: ${group._count.invoiceDate} facturas`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

debugTenant();