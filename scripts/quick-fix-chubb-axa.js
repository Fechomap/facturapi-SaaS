#!/usr/bin/env node

// scripts/quick-fix-chubb-axa.js
// Fix rápido y dirigido solo para facturas de CHUBB y AXA

import prisma from '../lib/prisma.js';
import FacturapiService from '../services/facturapi.service.js';

async function quickFixChubAxaInvoices() {
  console.log('🔧 FIX RÁPIDO - Solo facturas AXA y CHUBB');
  console.log('=' * 50);

  const stats = { fixed: 0, errors: 0, processed: 0 };

  try {
    // Obtener muestra de facturas huérfanas recientes
    const orphanInvoices = await prisma.tenantInvoice.findMany({
      where: {
        customerId: null,
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Últimos 30 días
        },
      },
      include: {
        tenant: { select: { businessName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50, // Procesar las 50 más recientes
    });

    console.log(`📊 Facturas a procesar: ${orphanInvoices.length}`);

    for (const invoice of orphanInvoices) {
      stats.processed++;
      console.log(
        `\n[${stats.processed}] ${invoice.series}${invoice.folioNumber} - ${invoice.tenant.businessName}`
      );

      try {
        const facturapiClient = await FacturapiService.getFacturapiClient(invoice.tenantId);
        const facturapiData = await facturapiClient.invoices.retrieve(invoice.facturapiInvoiceId);

        const customerName = facturapiData.customer?.legal_name;
        const facturapiCustomerId = facturapiData.customer?.id;

        // Solo procesar AXA y CHUBB
        if (customerName && (customerName.includes('AXA') || customerName.includes('CHUBB'))) {
          console.log(`   🎯 ${customerName} detectado!`);

          // Buscar cliente en BD
          const client = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId: invoice.tenantId,
              facturapiCustomerId: facturapiCustomerId,
            },
          });

          if (client) {
            // Vincular factura
            await prisma.tenantInvoice.update({
              where: { id: invoice.id },
              data: { customerId: client.id },
            });

            console.log(`   ✅ Vinculada a ${client.legalName}`);
            stats.fixed++;
          } else {
            console.log(`   ❌ Cliente no encontrado en BD`);
            stats.errors++;
          }
        } else {
          console.log(`   ⏭️ ${customerName || 'Otro cliente'} - omitiendo`);
        }
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        stats.errors++;
      }
    }

    console.log('\n📈 RESULTADOS:');
    console.log(`   Procesadas: ${stats.processed}`);
    console.log(`   Reparadas: ${stats.fixed}`);
    console.log(`   Errores: ${stats.errors}`);

    // Verificación
    if (stats.fixed > 0) {
      console.log('\n🔍 VERIFICACIÓN:');
      const axaChubbWithInvoices = await prisma.tenantCustomer.findMany({
        where: {
          OR: [
            { legalName: { contains: 'AXA', mode: 'insensitive' } },
            { legalName: { contains: 'CHUBB', mode: 'insensitive' } },
          ],
        },
        include: {
          _count: { select: { invoices: true } },
          tenant: { select: { businessName: true } },
        },
      });

      axaChubbWithInvoices.forEach((client) => {
        if (client._count.invoices > 0) {
          console.log(
            `   ✅ ${client.legalName} (${client.tenant.businessName}): ${client._count.invoices} facturas`
          );
        }
      });
    }
  } catch (error) {
    console.error('❌ Error general:', error);
  } finally {
    await prisma.$disconnect();
  }

  return stats;
}

async function main() {
  console.log('🚀 INICIANDO FIX RÁPIDO PARA AXA Y CHUBB');
  console.log('📅', new Date().toLocaleString());
  console.log('=' * 60);

  const stats = await quickFixChubAxaInvoices();

  if (stats.fixed > 0) {
    console.log('\n🎉 ¡ÉXITO! Facturas reparadas.');
    console.log('💡 Los reportes Excel ahora deberían mostrar correctamente AXA y CHUBB.');
    console.log('🔄 Prueba generar un nuevo reporte Excel para verificar.');
  } else {
    console.log('\n⚠️ No se encontraron facturas de AXA/CHUBB para reparar.');
  }
}

main().catch(console.error);
