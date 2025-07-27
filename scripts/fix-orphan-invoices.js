#!/usr/bin/env node

// scripts/fix-orphan-invoices.js
// Script para vincular facturas huérfanas de AXA y CHUBB a sus clientes correctos

import prisma from '../lib/prisma.js';
import FacturapiService from '../services/facturapi.service.js';

/**
 * Script para arreglar el problema de facturas huérfanas de AXA y CHUBB
 * El problema: Las facturas están en BD pero no vinculadas a sus clientes (customerId: null)
 * La solución: Consultar FacturAPI, identificar cliente, y vincular en BD
 */

async function fixOrphanInvoices() {
  console.log('🔧 SCRIPT DE REPARACIÓN - Vinculando facturas huérfanas AXA/CHUBB');
  console.log('=' * 70);

  const stats = {
    totalProcessed: 0,
    fixed: 0,
    errors: 0,
    skipped: 0,
  };

  try {
    // PASO 1: Obtener todas las facturas huérfanas (sin cliente)
    console.log('\n📊 PASO 1: Obteniendo facturas huérfanas...');

    const orphanInvoices = await prisma.tenantInvoice.findMany({
      where: {
        customerId: null,
      },
      include: {
        tenant: {
          select: { id: true, businessName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`   Facturas huérfanas encontradas: ${orphanInvoices.length}`);
    stats.totalProcessed = orphanInvoices.length;

    // PASO 2: Procesar cada factura
    console.log('\n🔄 PASO 2: Procesando facturas...');

    for (let i = 0; i < orphanInvoices.length; i++) {
      const invoice = orphanInvoices[i];

      console.log(
        `\n[${i + 1}/${orphanInvoices.length}] Procesando: ${invoice.series}${invoice.folioNumber}`
      );
      console.log(`   Tenant: ${invoice.tenant.businessName}`);

      try {
        // Consultar datos en FacturAPI
        const facturapiClient = await FacturapiService.getFacturapiClient(invoice.tenantId);
        const facturapiData = await facturapiClient.invoices.retrieve(invoice.facturapiInvoiceId);

        const customerName = facturapiData.customer?.legal_name;
        const customerRFC = facturapiData.customer?.tax_id;
        const facturapiCustomerId = facturapiData.customer?.id;

        console.log(`   Cliente en FacturAPI: ${customerName}`);
        console.log(`   RFC: ${customerRFC}`);

        // PASO 3: Solo procesar si es AXA o CHUBB
        if (customerName && (customerName.includes('AXA') || customerName.includes('CHUBB'))) {
          console.log(`   🎯 Cliente objetivo detectado!`);

          // Buscar el cliente correspondiente en BD
          const matchingClient = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId: invoice.tenantId,
              facturapiCustomerId: facturapiCustomerId,
            },
          });

          if (matchingClient) {
            console.log(
              `   ✅ Cliente encontrado en BD: ${matchingClient.legalName} (ID: ${matchingClient.id})`
            );

            // PASO 4: Vincular la factura al cliente
            await prisma.tenantInvoice.update({
              where: { id: invoice.id },
              data: { customerId: matchingClient.id },
            });

            console.log(`   🔗 Factura vinculada exitosamente!`);
            stats.fixed++;
          } else {
            console.log(`   ❌ Cliente no encontrado en BD`);
            console.log(`   🔍 Buscando por RFC...`);

            // Intentar buscar por RFC como backup
            const clientByRFC = await prisma.tenantCustomer.findFirst({
              where: {
                tenantId: invoice.tenantId,
                rfc: customerRFC,
              },
            });

            if (clientByRFC) {
              console.log(`   ✅ Cliente encontrado por RFC: ${clientByRFC.legalName}`);

              await prisma.tenantInvoice.update({
                where: { id: invoice.id },
                data: { customerId: clientByRFC.id },
              });

              console.log(`   🔗 Factura vinculada por RFC!`);
              stats.fixed++;
            } else {
              console.log(`   ❌ Cliente no encontrado por ningún método`);
              stats.errors++;
            }
          }
        } else {
          console.log(`   ⏭️ Factura no es de AXA/CHUBB, omitiendo...`);
          stats.skipped++;
        }
      } catch (error) {
        console.log(`   ❌ Error procesando factura: ${error.message}`);
        stats.errors++;
      }

      // Pausa pequeña para no sobrecargar la API
      if (i % 10 === 0 && i > 0) {
        console.log('   ⏸️ Pausa para no sobrecargar API...');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } catch (error) {
    console.error('❌ Error general:', error);
  }

  // PASO 5: Mostrar estadísticas finales
  console.log('\n📈 ESTADÍSTICAS FINALES:');
  console.log(`   Facturas procesadas: ${stats.totalProcessed}`);
  console.log(`   Facturas reparadas: ${stats.fixed}`);
  console.log(`   Facturas omitidas: ${stats.skipped}`);
  console.log(`   Errores: ${stats.errors}`);

  const successRate =
    stats.totalProcessed > 0 ? ((stats.fixed / stats.totalProcessed) * 100).toFixed(2) : 0;
  console.log(`   Tasa de éxito: ${successRate}%`);

  return stats;
}

async function verifyFix() {
  console.log('\n🔍 VERIFICACIÓN DEL FIX:');

  try {
    // Verificar cuántas facturas de AXA/CHUBB están ahora vinculadas
    const axaChubbClients = await prisma.tenantCustomer.findMany({
      where: {
        OR: [
          { legalName: { contains: 'AXA', mode: 'insensitive' } },
          { legalName: { contains: 'CHUBB', mode: 'insensitive' } },
        ],
      },
      include: {
        _count: {
          select: { invoices: true },
        },
        tenant: {
          select: { businessName: true },
        },
      },
    });

    console.log('\n👥 Clientes AXA/CHUBB después del fix:');
    axaChubbClients.forEach((client) => {
      console.log(
        `   ${client.legalName} (${client.tenant.businessName}): ${client._count.invoices} facturas`
      );
    });

    // Verificar cuántas facturas huérfanas quedan
    const remainingOrphans = await prisma.tenantInvoice.count({
      where: { customerId: null },
    });

    console.log(`\n📊 Facturas huérfanas restantes: ${remainingOrphans}`);
  } catch (error) {
    console.error('❌ Error verificando fix:', error);
  }
}

async function main() {
  console.log('🚀 INICIANDO REPARACIÓN DE FACTURAS HUÉRFANAS');
  console.log('🎯 Objetivo: Vincular facturas de AXA y CHUBB a sus clientes');
  console.log('📅', new Date().toLocaleString());
  console.log('=' * 80);

  const stats = await fixOrphanInvoices();
  await verifyFix();

  console.log('\n✅ PROCESO COMPLETADO');

  if (stats.fixed > 0) {
    console.log(`🎉 ${stats.fixed} facturas reparadas exitosamente!`);
    console.log(
      '💡 Los reportes Excel ahora deberían mostrar correctamente los clientes AXA y CHUBB'
    );
  }

  await prisma.$disconnect();
}

// Función de solo verificación (no modifica datos)
async function dryRun() {
  console.log('🧪 MODO DRY RUN - Solo análisis, sin modificaciones');
  console.log('=' * 60);

  try {
    const orphanInvoices = await prisma.tenantInvoice.findMany({
      where: { customerId: null },
      include: {
        tenant: { select: { businessName: true } },
      },
      take: 10, // Solo primeras 10 para análisis
    });

    console.log(`📊 Muestra de facturas huérfanas: ${orphanInvoices.length}`);

    for (const invoice of orphanInvoices) {
      console.log(`\n📄 ${invoice.series}${invoice.folioNumber} - ${invoice.tenant.businessName}`);

      try {
        const facturapiClient = await FacturapiService.getFacturapiClient(invoice.tenantId);
        const facturapiData = await facturapiClient.invoices.retrieve(invoice.facturapiInvoiceId);
        const customerName = facturapiData.customer?.legal_name;

        if (customerName && (customerName.includes('AXA') || customerName.includes('CHUBB'))) {
          console.log(`   🎯 SERÍA REPARADA: ${customerName}`);
        } else {
          console.log(`   ⏭️ No es AXA/CHUBB: ${customerName}`);
        }
      } catch (error) {
        console.log(`   ❌ Error consultando: ${error.message}`);
      }
    }
  } catch (error) {
    console.error('❌ Error en dry run:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar según argumentos
const mode = process.argv[2];
if (mode === 'dry-run') {
  dryRun().catch(console.error);
} else {
  main().catch(console.error);
}

export default { fixOrphanInvoices, verifyFix };
