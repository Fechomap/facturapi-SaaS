/**
 * Script de Migración: Poblar Datos Completos de Facturas Históricas
 *
 * Este script obtiene los datos completos (subtotal, IVA, items, etc.)
 * desde FacturAPI para todas las facturas que no los tienen en BD.
 *
 * IMPORTANTE:
 * - Solo actualiza facturas SIN datos completos (subtotal IS NULL)
 * - NO modifica facturas que ya tienen datos
 * - Procesa en chunks para no saturar FacturAPI
 * - Soporta modo --dry-run para simulación
 *
 * Uso:
 *   npx tsx scripts/migrate-invoice-complete-data.ts              # Migración real
 *   npx tsx scripts/migrate-invoice-complete-data.ts --dry-run    # Simulación
 *   npx tsx scripts/migrate-invoice-complete-data.ts --tenant <id> # Solo un tenant
 */

import prisma from '../src/lib/prisma';
import FacturapiService from '../src/services/facturapi.service';
import { createModuleLogger } from '../src/core/utils/logger';
import { calculateFinancialDataFromFacturaData } from '../src/bot/utils/invoice-calculation.utils';

const logger = createModuleLogger('migrate-invoice-data');

// Argumentos de línea de comandos
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const specificTenantIndex = args.indexOf('--tenant');
const specificTenantId = specificTenantIndex !== -1 ? args[specificTenantIndex + 1] : null;

interface MigrationStats {
  totalInvoices: number;
  updated: number;
  errors: number;
  skipped: number;
  alreadyComplete: number;
}

/**
 * Función principal de migración
 */
async function migrateCompleteData() {
  const startTime = Date.now();

  logger.info('='.repeat(80));
  if (isDryRun) {
    logger.warn('🧪 MODO DRY RUN - NO SE MODIFICARÁ LA BASE DE DATOS');
  } else {
    logger.info('🚀 MIGRACIÓN EN MODO REAL - SE MODIFICARÁ LA BASE DE DATOS');
  }
  if (specificTenantId) {
    logger.info(`🎯 Procesando solo tenant: ${specificTenantId}`);
  }
  logger.info('='.repeat(80));

  const stats: MigrationStats = {
    totalInvoices: 0,
    updated: 0,
    errors: 0,
    skipped: 0,
    alreadyComplete: 0,
  };

  try {
    // 1. Obtener facturas sin datos completos (subtotal es NULL)
    const whereCondition: any = {
      subtotal: null, // Si subtotal es null, asumimos que faltan todos los datos
    };

    if (specificTenantId) {
      whereCondition.tenantId = specificTenantId;
    }

    const invoicesWithoutData = await prisma.tenantInvoice.findMany({
      where: whereCondition,
      select: {
        id: true,
        tenantId: true,
        facturapiInvoiceId: true,
        uuid: true,
        series: true,
        folioNumber: true,
      },
      orderBy: {
        tenantId: 'asc',
      },
    });

    stats.totalInvoices = invoicesWithoutData.length;

    logger.info(
      { count: stats.totalInvoices, dryRun: isDryRun },
      'Facturas sin datos completos encontradas'
    );

    if (stats.totalInvoices === 0) {
      logger.info('✅ No hay facturas para migrar. Todas tienen datos completos.');
      return stats;
    }

    // 2. Agrupar por tenant
    const byTenant = new Map<string, typeof invoicesWithoutData>();
    for (const invoice of invoicesWithoutData) {
      if (!byTenant.has(invoice.tenantId)) {
        byTenant.set(invoice.tenantId, []);
      }
      byTenant.get(invoice.tenantId)!.push(invoice);
    }

    logger.info({ tenants: byTenant.size }, 'Tenants a procesar');

    // 3. Procesar cada tenant
    for (const [tenantId, invoices] of byTenant.entries()) {
      logger.info({ tenantId, invoices: invoices.length }, 'Procesando tenant');

      try {
        const facturapiClient = await FacturapiService.getFacturapiClient(tenantId);

        // Procesar en chunks de 10 para no saturar FacturAPI
        const CHUNK_SIZE = 10;
        for (let i = 0; i < invoices.length; i += CHUNK_SIZE) {
          const chunk = invoices.slice(i, i + CHUNK_SIZE);

          const promises = chunk.map(async (invoice) => {
            try {
              // Obtener datos completos de FacturAPI
              const facturapiData = await facturapiClient.invoices.retrieve(
                invoice.facturapiInvoiceId
              );

              if (!facturapiData) {
                logger.warn({ invoiceId: invoice.id }, 'FacturAPI no devolvió datos');
                stats.errors++;
                return;
              }

              // Calcular datos financieros desde los items de FacturAPI
              const calculatedData = calculateFinancialDataFromFacturaData(facturapiData);

              // Actualizar en BD (solo si NO es dry run)
              if (!isDryRun) {
                await prisma.tenantInvoice.update({
                  where: { id: invoice.id },
                  data: {
                    subtotal: calculatedData.subtotal,
                    ivaAmount: calculatedData.ivaAmount,
                    retencionAmount: calculatedData.retencionAmount,
                    discount: calculatedData.discount,
                    currency: (facturapiData as any).currency || 'MXN',
                    paymentForm: (facturapiData as any).payment_form,
                    paymentMethod: (facturapiData as any).payment_method,
                    verificationUrl: (facturapiData as any).verification_url,
                    satCertNumber: (facturapiData as any).stamp?.sat_cert_number,
                    usoCfdi: (facturapiData as any).use,
                    tipoComprobante: (facturapiData as any).type,
                    exportacion: (facturapiData as any).export,
                    items: (facturapiData as any).items,
                  },
                });
              }

              stats.updated++;

              logger.debug(
                {
                  invoiceId: invoice.id,
                  folio: `${invoice.series}${invoice.folioNumber}`,
                  dryRun: isDryRun,
                },
                isDryRun ? 'Datos que se actualizarían' : 'Datos actualizados'
              );
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);

              // Manejar errores 404 (factura no encontrada en FacturAPI)
              if (errorMessage.includes('404') || errorMessage.includes('not found')) {
                logger.warn(
                  { invoiceId: invoice.id, facturapiId: invoice.facturapiInvoiceId },
                  'Factura no encontrada en FacturAPI (posiblemente cancelada o antigua)'
                );
                stats.skipped++;
              } else {
                logger.error(
                  { invoiceId: invoice.id, error: errorMessage },
                  'Error obteniendo datos de FacturAPI'
                );
                stats.errors++;
              }
            }
          });

          await Promise.all(promises);

          // Pausa entre chunks para no saturar FacturAPI
          if (i + CHUNK_SIZE < invoices.length) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }

          // Progreso
          const processed = Math.min(i + CHUNK_SIZE, invoices.length);
          logger.info(
            { tenant: tenantId, processed, total: invoices.length },
            `Progreso: ${processed}/${invoices.length}`
          );
        }

        logger.info({ tenantId }, 'Tenant procesado exitosamente');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ tenantId, error: errorMessage }, 'Error procesando tenant');
        stats.errors += invoices.length;
      }

      // Pausa entre tenants
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const duration = Date.now() - startTime;
    const durationMin = (duration / 60000).toFixed(2);

    // Reporte final
    logger.info('='.repeat(80));
    if (isDryRun) {
      logger.warn('🧪 SIMULACIÓN COMPLETADA (DRY RUN)');
    } else {
      logger.info('✅ MIGRACIÓN COMPLETADA');
    }
    logger.info('='.repeat(80));
    logger.info('📊 Estadísticas Finales:');
    logger.info(`   Modo: ${isDryRun ? 'DRY RUN (simulación)' : 'REAL (BD modificada)'}`);
    logger.info(`   Total facturas: ${stats.totalInvoices}`);
    logger.info(
      `   Actualizadas: ${stats.updated} ${isDryRun ? '(se actualizarían)' : '✅'}`
    );
    logger.info(`   Errores: ${stats.errors}`);
    logger.info(`   Omitidas (404): ${stats.skipped}`);
    logger.info(`   Tasa de éxito: ${((stats.updated / stats.totalInvoices) * 100).toFixed(2)}%`);
    logger.info(`   Duración: ${durationMin} minutos`);
    logger.info('='.repeat(80));

    return stats;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, 'Error fatal en migración');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// ========== EJECUCIÓN DEL SCRIPT ==========

migrateCompleteData()
  .then((stats) => {
    if (isDryRun) {
      console.log('\n✅ SIMULACIÓN COMPLETADA EXITOSAMENTE (DRY RUN)');
      console.log(`   Facturas que se actualizarían: ${stats.updated}/${stats.totalInvoices}`);
      console.log(`   Errores: ${stats.errors}`);
      console.log(`   Omitidas (404): ${stats.skipped}`);
      console.log('\n⚠️  NOTA: La base de datos NO fue modificada.');
      console.log('   Ejecuta sin --dry-run para aplicar los cambios.\n');
    } else {
      console.log('\n✅ MIGRACIÓN COMPLETADA EXITOSAMENTE');
      console.log(`   Facturas actualizadas: ${stats.updated}/${stats.totalInvoices}`);
      console.log(`   Errores: ${stats.errors}`);
      console.log(`   Omitidas (404): ${stats.skipped}`);
      console.log(`   Base de datos modificada: SÍ ✅\n`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ ERROR EN MIGRACIÓN:', error.message || error);
    console.error('   La migración falló. Revisa los logs para más detalles.\n');
    process.exit(1);
  });
