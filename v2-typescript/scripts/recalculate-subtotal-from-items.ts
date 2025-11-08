/**
 * Script de Recálculo: Subtotal desde Items guardados en BD
 *
 * Las facturas históricas YA tienen items guardados, pero el subtotal quedó en NULL
 * porque FacturAPI no devuelve ese campo.
 *
 * Este script calcula subtotal/IVA/retención desde los items que YA ESTÁN en la BD,
 * sin necesidad de llamar a FacturAPI de nuevo (mucho más rápido).
 *
 * Uso:
 *   npx tsx scripts/recalculate-subtotal-from-items.ts           # Real
 *   npx tsx scripts/recalculate-subtotal-from-items.ts --dry-run # Simulación
 */

import prisma from '../src/lib/prisma';
import { Prisma } from '@prisma/client';
import { createModuleLogger } from '../src/core/utils/logger';
import { calculateFinancialDataFromFacturaData } from '../src/bot/utils/invoice-calculation.utils';

const logger = createModuleLogger('recalculate-subtotal');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

async function recalculateSubtotal() {
  const startTime = Date.now();

  console.log('═'.repeat(80));
  if (isDryRun) {
    console.log('🧪 MODO DRY RUN - NO SE MODIFICARÁ LA BASE DE DATOS');
  } else {
    console.log('🚀 RECÁLCULO EN MODO REAL - SE MODIFICARÁ LA BASE DE DATOS');
  }
  console.log('═'.repeat(80));
  console.log('');

  try {
    // Obtener facturas sin subtotal
    const allInvoices = await prisma.tenantInvoice.findMany({
      where: {
        subtotal: null,
      },
      select: {
        id: true,
        items: true,
      },
    });

    // Filtrar las que tienen items (en JS, más simple que Prisma JSON syntax)
    const invoices = allInvoices.filter((inv) => inv.items !== null);

    console.log(`📊 Facturas sin subtotal: ${allInvoices.length}`);
    console.log(`📊 Facturas con items a recalcular: ${invoices.length}\n`);

    if (invoices.length === 0) {
      console.log('✅ Todas las facturas ya tienen subtotal calculado.\n');
      return { updated: 0, errors: 0 };
    }

    let updated = 0;
    let errors = 0;

    // Procesar en chunks de 100 (es rápido porque no hay llamadas HTTP)
    const CHUNK_SIZE = 100;
    for (let i = 0; i < invoices.length; i += CHUNK_SIZE) {
      const chunk = invoices.slice(i, i + CHUNK_SIZE);

      for (const invoice of chunk) {
        try {
          // Calcular desde los items guardados (cast a any para evitar error de tipos con JSON)
          const calculatedData = calculateFinancialDataFromFacturaData({
            items: invoice.items as any,
          });

          // Actualizar en BD
          if (!isDryRun) {
            await prisma.tenantInvoice.update({
              where: { id: invoice.id },
              data: {
                subtotal: calculatedData.subtotal || 0,
                ivaAmount: calculatedData.ivaAmount || 0,
                retencionAmount: calculatedData.retencionAmount || 0,
                discount: calculatedData.discount || 0,
              },
            });
          }

          updated++;
        } catch (error: any) {
          logger.error({ invoiceId: invoice.id, error: error.message }, 'Error recalculando');
          errors++;
        }
      }

      // Progreso
      const processed = Math.min(i + CHUNK_SIZE, invoices.length);
      console.log(`   Progreso: ${processed}/${invoices.length} (${((processed / invoices.length) * 100).toFixed(1)}%)`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('');
    console.log('═'.repeat(80));
    if (isDryRun) {
      console.log('🧪 SIMULACIÓN COMPLETADA');
    } else {
      console.log('✅ RECÁLCULO COMPLETADO');
    }
    console.log('═'.repeat(80));
    console.log(`   Total procesadas: ${invoices.length}`);
    console.log(`   Actualizadas: ${updated} ${isDryRun ? '(se actualizarían)' : '✅'}`);
    console.log(`   Errores: ${errors}`);
    console.log(`   Duración: ${duration}s`);
    console.log('═'.repeat(80));
    console.log('');

    return { updated, errors };
  } catch (error: any) {
    console.error('❌ ERROR FATAL:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
recalculateSubtotal()
  .then((result) => {
    if (isDryRun) {
      console.log('✅ SIMULACIÓN EXITOSA');
      console.log(`   Se recalcularían ${result.updated} facturas\n`);
    } else {
      console.log('✅ RECÁLCULO EXITOSO');
      console.log(`   ${result.updated} facturas actualizadas\n`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ FALLÓ:', error.message);
    process.exit(1);
  });
