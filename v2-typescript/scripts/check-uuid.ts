/**
 * Script para verificar si las facturas recientes tienen UUID guardado
 */

import { prisma } from '../src/config/database.js';

async function checkRecentInvoices() {
  try {
    console.log('📊 Consultando facturas más recientes...\n');

    const recentInvoices = await prisma.tenantInvoice.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
      select: {
        id: true,
        tenantId: true,
        facturapiInvoiceId: true,
        series: true,
        folioNumber: true,
        total: true,
        uuid: true,
        invoiceDate: true,
        createdAt: true,
      },
    });

    console.log(`Total de facturas encontradas: ${recentInvoices.length}\n`);

    if (recentInvoices.length === 0) {
      console.log('❌ No se encontraron facturas en el sistema.');
      return;
    }

    // Contar facturas con y sin UUID
    const withUuid = recentInvoices.filter((inv) => inv.uuid !== null && inv.uuid !== '');
    const withoutUuid = recentInvoices.filter((inv) => inv.uuid === null || inv.uuid === '');

    console.log('📈 Estadísticas:');
    console.log(`   ✅ Con UUID: ${withUuid.length} (${((withUuid.length / recentInvoices.length) * 100).toFixed(1)}%)`);
    console.log(`   ❌ Sin UUID: ${withoutUuid.length} (${((withoutUuid.length / recentInvoices.length) * 100).toFixed(1)}%)`);
    console.log('\n');

    // Mostrar detalles de las facturas más recientes
    console.log('📋 Facturas más recientes:');
    console.log('─'.repeat(120));
    console.log(
      'ID'.padEnd(8) +
        'Serie-Folio'.padEnd(15) +
        'Total'.padEnd(12) +
        'Fecha'.padEnd(22) +
        'UUID'.padEnd(40) +
        'Estado'
    );
    console.log('─'.repeat(120));

    recentInvoices.forEach((invoice) => {
      const id = invoice.id.toString().padEnd(8);
      const folio = `${invoice.series}${invoice.folioNumber}`.padEnd(15);
      const total = `$${invoice.total.toString()}`.padEnd(12);
      const fecha = (invoice.invoiceDate || invoice.createdAt).toISOString().substring(0, 19).replace('T', ' ').padEnd(22);
      const uuid = invoice.uuid ? invoice.uuid.substring(0, 36) : 'SIN UUID';
      const estado = invoice.uuid ? '✅' : '❌';

      console.log(`${id}${folio}${total}${fecha}${uuid.padEnd(40)}${estado}`);
    });

    console.log('─'.repeat(120));
    console.log('\n');

    // Verificación específica de las 3 más recientes
    console.log('🔍 Verificación detallada de las 3 facturas más recientes:');
    console.log('');

    recentInvoices.slice(0, 3).forEach((invoice, index) => {
      console.log(`\n${index + 1}. Factura #${invoice.id} (${invoice.series}${invoice.folioNumber})`);
      console.log(`   ├─ FacturAPI ID: ${invoice.facturapiInvoiceId}`);
      console.log(`   ├─ Total: $${invoice.total}`);
      console.log(`   ├─ Fecha: ${invoice.invoiceDate?.toISOString() || 'N/A'}`);
      console.log(`   ├─ Creada: ${invoice.createdAt.toISOString()}`);
      console.log(`   └─ UUID: ${invoice.uuid || '❌ NO GUARDADO (PROBLEMA CRÍTICO)'}`);
    });

    console.log('\n');

    // Conclusión
    if (withoutUuid.length > 0) {
      console.log('⚠️  PROBLEMA DETECTADO:');
      console.log(`   ${withoutUuid.length} facturas NO tienen UUID guardado.`);
      console.log('   Esto confirma la DEUDA TÉCNICA descrita en DEUDA_TECNICA_UUID.md');
      console.log('   Se requiere implementar las fases 1 y 2 del plan de corrección.');
    } else {
      console.log('✅ EXCELENTE:');
      console.log('   Todas las facturas recientes tienen UUID guardado correctamente.');
      console.log('   El problema ha sido resuelto.');
    }

    console.log('\n');
  } catch (error) {
    console.error('❌ Error consultando facturas:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkRecentInvoices();
