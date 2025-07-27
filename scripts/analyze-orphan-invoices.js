#!/usr/bin/env node

// scripts/analyze-orphan-invoices.js
// Análisis específico de facturas huérfanas para encontrar AXA y CHUBB

import prisma from '../lib/prisma.js';
import FacturapiService from '../services/facturapi.service.js';

async function analyzeOrphanInvoices() {
  console.log('🔍 ANÁLISIS DE FACTURAS HUÉRFANAS - Búsqueda AXA/CHUBB');
  console.log('=' * 60);

  try {
    // Obtener facturas sin cliente de los últimos 30 días
    const orphanInvoices = await prisma.tenantInvoice.findMany({
      where: {
        customerId: null,
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      include: {
        tenant: {
          select: { id: true, businessName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    console.log(`📊 Facturas huérfanas encontradas: ${orphanInvoices.length}`);

    for (const invoice of orphanInvoices) {
      console.log(`\n📄 Factura: ${invoice.series}${invoice.folioNumber}`);
      console.log(`   Tenant: ${invoice.tenant.businessName}`);
      console.log(`   Total: $${invoice.total}`);
      console.log(`   FacturAPI ID: ${invoice.facturapiInvoiceId}`);

      try {
        // Consultar datos en FacturAPI
        const facturapiClient = await FacturapiService.getFacturapiClient(invoice.tenantId);
        const facturapiData = await facturapiClient.invoices.retrieve(invoice.facturapiInvoiceId);

        const customerName = facturapiData.customer?.legal_name;
        const customerRFC = facturapiData.customer?.tax_id;

        console.log(`   Cliente en FacturAPI: ${customerName}`);
        console.log(`   RFC en FacturAPI: ${customerRFC}`);

        // Verificar si es AXA o CHUBB
        if (customerName && (customerName.includes('AXA') || customerName.includes('CHUBB'))) {
          console.log(`   🎯 ¡CLIENTE OBJETIVO ENCONTRADO!`);

          // Buscar si existe el cliente en BD
          const existingClient = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId: invoice.tenantId,
              OR: [
                { legalName: { contains: 'AXA', mode: 'insensitive' } },
                { legalName: { contains: 'CHUBB', mode: 'insensitive' } },
                { rfc: customerRFC },
              ],
            },
          });

          if (existingClient) {
            console.log(
              `   ✅ Cliente existe en BD: ${existingClient.legalName} (ID: ${existingClient.id})`
            );
            console.log(`   🔗 FacturAPI Customer ID en BD: ${existingClient.facturapiCustomerId}`);
            console.log(`   🔗 FacturAPI Customer ID en API: ${facturapiData.customer?.id}`);

            // Verificar discrepancia
            if (existingClient.facturapiCustomerId !== facturapiData.customer?.id) {
              console.log(`   ⚠️ DISCREPANCIA EN FACTURAPI CUSTOMER ID!`);
            }
          } else {
            console.log(`   ❌ Cliente NO existe en BD para este tenant`);
          }
        }
      } catch (apiError) {
        console.log(`   ❌ Error consultando FacturAPI: ${apiError.message}`);
      }

      console.log('   ' + '-'.repeat(50));
    }
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Función para verificar el mapeo de clientes
async function checkClientMapping() {
  console.log('\n🔗 VERIFICACIÓN DE MAPEO DE CLIENTES AXA/CHUBB:');

  try {
    const axaChubbClients = await prisma.tenantCustomer.findMany({
      where: {
        OR: [
          { legalName: { contains: 'AXA', mode: 'insensitive' } },
          { legalName: { contains: 'CHUBB', mode: 'insensitive' } },
        ],
      },
      include: {
        tenant: {
          select: { businessName: true },
        },
      },
    });

    for (const client of axaChubbClients) {
      console.log(`\n👤 Cliente: ${client.legalName}`);
      console.log(`   Tenant: ${client.tenant.businessName}`);
      console.log(`   RFC: ${client.rfc}`);
      console.log(`   FacturAPI Customer ID: ${client.facturapiCustomerId}`);

      // Buscar facturas que deberían estar asociadas
      if (client.facturapiCustomerId) {
        try {
          const facturapiClient = await FacturapiService.getFacturapiClient(client.tenantId);
          const customer = await facturapiClient.customers.retrieve(client.facturapiCustomerId);
          console.log(`   ✅ Cliente válido en FacturAPI: ${customer.legal_name}`);

          // Buscar facturas de este cliente en FacturAPI (esto no es directo, pero podemos intentar)
        } catch (apiError) {
          console.log(`   ❌ Error verificando cliente en FacturAPI: ${apiError.message}`);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error verificando mapeo:', error);
  }
}

async function main() {
  await analyzeOrphanInvoices();
  await checkClientMapping();
}

main().catch(console.error);
