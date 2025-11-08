/**
 * Script para obtener estadísticas generales de UUIDs en el sistema
 */

import { prisma } from '../src/config/database.js';

async function checkUuidStats() {
  try {
    console.log('📊 Consultando estadísticas de UUIDs en el sistema...\n');

    const withoutUuid = await prisma.tenantInvoice.count({
      where: {
        OR: [{ uuid: null }, { uuid: '' }],
      },
    });

    const totalInvoices = await prisma.tenantInvoice.count();
    const withUuid = totalInvoices - withoutUuid;

    console.log('📈 Estado general de UUIDs:');
    console.log('─'.repeat(60));
    console.log(`Total de facturas en el sistema: ${totalInvoices}`);
    console.log(`   ✅ Con UUID: ${withUuid} (${totalInvoices > 0 ? ((withUuid / totalInvoices) * 100).toFixed(1) : 0}%)`);
    console.log(`   ❌ Sin UUID: ${withoutUuid} (${totalInvoices > 0 ? ((withoutUuid / totalInvoices) * 100).toFixed(1) : 0}%)`);
    console.log('─'.repeat(60));
    console.log('');

    if (withoutUuid > 0) {
      console.log('⚠️  ACCIÓN REQUERIDA:');
      console.log(`   Se encontraron ${withoutUuid} facturas antiguas sin UUID.`);
      console.log('   Se recomienda ejecutar el script de migración:');
      console.log('   $ npx tsx scripts/migrate-uuids.ts');
      console.log('');

      // Obtener una muestra de facturas sin UUID
      const sampleWithoutUuid = await prisma.tenantInvoice.findMany({
        where: {
          OR: [{ uuid: null }, { uuid: '' }],
        },
        take: 5,
        select: {
          id: true,
          series: true,
          folioNumber: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      console.log('📋 Ejemplos de facturas sin UUID:');
      sampleWithoutUuid.forEach((inv) => {
        console.log(`   - #${inv.id} (${inv.series}${inv.folioNumber}) - Creada: ${inv.createdAt.toISOString().substring(0, 10)}`);
      });
      console.log('');
    } else {
      console.log('✅ SISTEMA EN ÓPTIMAS CONDICIONES:');
      console.log('   Todas las facturas tienen UUID guardado correctamente.');
      console.log('   No se requiere migración.');
      console.log('');
    }
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUuidStats();
