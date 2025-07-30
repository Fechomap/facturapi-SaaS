#!/usr/bin/env node
/**
 * SIMPLE: Verificar fechas de facturas vs FacturAPI
 */

import prisma from '../../lib/prisma.js';
import axios from 'axios';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function checkInvoiceDates() {
  const tenantId = process.argv[2];
  const limit = parseInt(process.argv[3]) || 3;

  if (!tenantId) {
    console.log('Uso: node scripts/check-invoice-dates-simple.js [tenantId] [limit]');
    process.exit(1);
  }

  try {
    console.log(`🔍 Verificando fechas para tenant: ${tenantId}`);
    console.log(`📊 Límite: ${limit} facturas`);

    // 1. Obtener tenant y API key
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        businessName: true,
        facturapiApiKey: true,
      },
    });

    if (!tenant) {
      console.log('❌ Tenant no encontrado');
      return;
    }

    console.log(`🏢 Empresa: ${tenant.businessName}`);

    // 2. Obtener facturas sospechosas (desde 27/07/2025)
    const suspiciousInvoices = await prisma.tenantInvoice.findMany({
      where: {
        tenantId,
        invoiceDate: {
          gte: new Date('2025-07-27T00:00:00Z'),
        },
      },
      select: {
        id: true,
        facturapiInvoiceId: true,
        invoiceDate: true,
        folioNumber: true,
        series: true,
      },
      orderBy: { invoiceDate: 'asc' },
      take: limit,
    });

    console.log(`📅 Facturas encontradas: ${suspiciousInvoices.length}`);

    // 3. Verificar cada factura con FacturAPI
    for (const invoice of suspiciousInvoices) {
      try {
        console.log(`\n🔍 Verificando: ${invoice.series}${invoice.folioNumber}`);
        console.log(`   ID FacturAPI: ${invoice.facturapiInvoiceId}`);
        console.log(`   Fecha en BD: ${invoice.invoiceDate.toISOString().split('T')[0]}`);

        // Consultar FacturAPI
        const response = await axios.get(
          `https://www.facturapi.io/v2/invoices/${invoice.facturapiInvoiceId}`,
          {
            headers: {
              Authorization: `Bearer ${tenant.facturapiApiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        );

        const facturapiData = response.data;
        const realDate = new Date(facturapiData.date);

        console.log(`   Fecha en FacturAPI: ${realDate.toISOString().split('T')[0]}`);

        // Comparar fechas
        const bdDate = invoice.invoiceDate.toISOString().split('T')[0];
        const apiDate = realDate.toISOString().split('T')[0];

        if (bdDate !== apiDate) {
          const daysDiff = Math.round(
            (invoice.invoiceDate.getTime() - realDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          console.log(`   ⚠️  DIFERENCIA: ${daysDiff} días`);
          console.log(`   ❌ NECESITA CORRECCIÓN: ${bdDate} → ${apiDate}`);
        } else {
          console.log(`   ✅ FECHA CORRECTA`);
        }

        // Rate limiting
        await sleep(3000);
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }
  } catch (error) {
    console.error('❌ Error fatal:', error.message);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

checkInvoiceDates();
