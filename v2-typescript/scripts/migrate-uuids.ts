/**
 * Script de Migración: Poblar UUIDs de Facturas Antiguas
 *
 * Este script obtiene el UUID de FacturAPI para todas las facturas
 * que NO tienen UUID en nuestra base de datos local.
 *
 * Uso:
 *   npx tsx scripts/migrate-uuids.ts              # Ejecutar migración real
 *   npx tsx scripts/migrate-uuids.ts --dry-run    # Modo simulación (no modifica BD)
 *   npx tsx scripts/migrate-uuids.ts --help       # Mostrar ayuda
 */

import prisma from '../src/lib/prisma';
import FacturapiService from '../src/services/facturapi.service';
import { createModuleLogger } from '../src/core/utils/logger';

const logger = createModuleLogger('migrate-uuids');

// Parsear argumentos de línea de comando
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const showHelp = args.includes('--help') || args.includes('-h');

if (showHelp) {
  console.log(`
📋 Script de Migración de UUIDs - Ayuda

USO:
  npx tsx scripts/migrate-uuids.ts [OPCIONES]

OPCIONES:
  --dry-run    Modo simulación - muestra qué se haría sin modificar la BD
  --help, -h   Muestra esta ayuda

EJEMPLOS:
  # Ver qué facturas se migrarían (sin modificar nada)
  npx tsx scripts/migrate-uuids.ts --dry-run

  # Ejecutar migración real
  npx tsx scripts/migrate-uuids.ts

DESCRIPCIÓN:
  Este script obtiene el UUID de FacturAPI para todas las facturas
  que no tienen UUID en la base de datos local.

  Estadísticas actuales:
  - Verifica facturas con uuid NULL o vacío
  - Procesa en chunks de 10 para no saturar API
  - Muestra progreso por tenant
  - Genera reporte completo al finalizar
`);
  process.exit(0);
}

interface MigrationStats {
  totalInvoices: number;
  updated: number;
  errors: number;
  skipped: number;
  byTenant: Map<string, { name: string; updated: number; errors: number }>;
}

async function migrateUUIDs() {
  const startTime = Date.now();

  if (isDryRun) {
    logger.warn('='.repeat(60));
    logger.warn('MODO DRY RUN - NO SE MODIFICARÁ LA BASE DE DATOS');
    logger.warn('='.repeat(60));
  }

  logger.info(`Iniciando migración de UUIDs... (${isDryRun ? 'DRY RUN' : 'MODO REAL'})`);

  const stats: MigrationStats = {
    totalInvoices: 0,
    updated: 0,
    errors: 0,
    skipped: 0,
    byTenant: new Map(),
  };

  try {
    // Debug: verificar que prisma está definido
    if (!prisma) {
      throw new Error('Prisma client no está definido');
    }

    logger.info('Cliente Prisma cargado correctamente');

    // 1. Obtener facturas sin UUID
    const invoicesWithoutUuid = await prisma.tenantInvoice.findMany({
      where: {
        OR: [{ uuid: null }, { uuid: '' }],
      },
      select: {
        id: true,
        tenantId: true,
        facturapiInvoiceId: true,
        tenant: {
          select: {
            businessName: true,
          },
        },
      },
      orderBy: {
        tenantId: 'asc',
      },
    });

    stats.totalInvoices = invoicesWithoutUuid.length;

    logger.info(
      { count: stats.totalInvoices },
      'Facturas sin UUID encontradas'
    );

    if (stats.totalInvoices === 0) {
      logger.info('No hay facturas para migrar. Todas tienen UUID.');
      return stats;
    }

    // 2. Agrupar por tenant para usar su API key
    const byTenant = new Map<string, typeof invoicesWithoutUuid>();
    for (const invoice of invoicesWithoutUuid) {
      if (!byTenant.has(invoice.tenantId)) {
        byTenant.set(invoice.tenantId, []);
      }
      byTenant.get(invoice.tenantId)!.push(invoice);
    }

    logger.info({ tenants: byTenant.size }, 'Tenants a procesar');

    // 3. Procesar cada tenant
    let tenantIndex = 0;
    for (const [tenantId, invoices] of byTenant.entries()) {
      tenantIndex++;
      const tenantName = invoices[0].tenant.businessName;

      logger.info(
        {
          tenant: tenantName,
          tenantId,
          invoices: invoices.length,
          progress: `${tenantIndex}/${byTenant.size}`,
        },
        'Procesando tenant'
      );

      // Inicializar stats del tenant
      if (!stats.byTenant.has(tenantId)) {
        stats.byTenant.set(tenantId, {
          name: tenantName,
          updated: 0,
          errors: 0,
        });
      }
      const tenantStats = stats.byTenant.get(tenantId)!;

      try {
        const facturapiClient = await FacturapiService.getFacturapiClient(tenantId);

        // Procesar en chunks de 10 para no saturar API
        const CHUNK_SIZE = 10;
        for (let i = 0; i < invoices.length; i += CHUNK_SIZE) {
          const chunk = invoices.slice(i, i + CHUNK_SIZE);

          logger.debug(
            {
              tenant: tenantName,
              chunk: `${i + 1}-${Math.min(i + CHUNK_SIZE, invoices.length)}/${invoices.length}`,
            },
            'Procesando chunk'
          );

          const promises = chunk.map(async (invoice) => {
            try {
              // Obtener datos de FacturAPI
              const facturapiData = await facturapiClient.invoices.retrieve(
                invoice.facturapiInvoiceId
              );

              if (!facturapiData.uuid) {
                logger.warn(
                  { invoiceId: invoice.id, facturapiId: invoice.facturapiInvoiceId },
                  'FacturAPI no devolvió UUID'
                );
                stats.errors++;
                tenantStats.errors++;
                return;
              }

              // Actualizar en BD (solo si NO es dry run)
              if (!isDryRun) {
                await prisma.tenantInvoice.update({
                  where: { id: invoice.id },
                  data: { uuid: facturapiData.uuid },
                });
              }

              stats.updated++;
              tenantStats.updated++;

              logger.debug(
                {
                  invoiceId: invoice.id,
                  uuid: facturapiData.uuid,
                  dryRun: isDryRun,
                },
                isDryRun ? 'UUID que se actualizaría' : 'UUID actualizado'
              );
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);

              // Si el error es 404, la factura no existe en FacturAPI
              if (errorMessage.includes('404')) {
                logger.warn(
                  {
                    invoiceId: invoice.id,
                    facturapiId: invoice.facturapiInvoiceId,
                    error: 'Factura no encontrada en FacturAPI (404)',
                  },
                  'Factura no encontrada en FacturAPI'
                );
                stats.skipped++;
              } else {
                logger.error(
                  {
                    invoiceId: invoice.id,
                    facturapiId: invoice.facturapiInvoiceId,
                    error: errorMessage,
                  },
                  'Error obteniendo UUID'
                );
                stats.errors++;
                tenantStats.errors++;
              }
            }
          });

          await Promise.all(promises);

          // Pausa entre chunks para no saturar API
          if (i + CHUNK_SIZE < invoices.length) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }

        logger.info(
          {
            tenant: tenantName,
            updated: tenantStats.updated,
            errors: tenantStats.errors,
          },
          'Tenant procesado'
        );
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          { tenantId, tenantName, error: errorMessage },
          'Error procesando tenant (posiblemente sin API key)'
        );
        // Marcar todas las facturas de este tenant como error
        stats.errors += invoices.length;
        tenantStats.errors = invoices.length;
      }

      // Pausa entre tenants
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const duration = Date.now() - startTime;
    const durationMin = (duration / 60000).toFixed(2);

    logger.info('='.repeat(60));
    if (isDryRun) {
      logger.warn('SIMULACIÓN COMPLETADA (DRY RUN)');
    } else {
      logger.info('MIGRACIÓN COMPLETADA');
    }
    logger.info('='.repeat(60));
    logger.info({ stats: {
      mode: isDryRun ? 'DRY RUN (simulación)' : 'REAL (BD modificada)',
      total: stats.totalInvoices,
      updated: isDryRun ? `${stats.updated} (se actualizarían)` : stats.updated,
      errors: stats.errors,
      skipped: stats.skipped,
      successRate: `${((stats.updated / stats.totalInvoices) * 100).toFixed(2)}%`,
      duration: `${durationMin} minutos`,
    }}, 'Resumen general');

    // Mostrar stats por tenant
    logger.info('');
    logger.info('Resumen por tenant:');
    for (const [tenantId, tenantStats] of stats.byTenant.entries()) {
      logger.info({
        tenant: tenantStats.name,
        updated: tenantStats.updated,
        errors: tenantStats.errors,
      });
    }

    return stats;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, 'Error fatal en migración');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar migración
migrateUUIDs()
  .then((stats) => {
    if (isDryRun) {
      console.log('\n✅ Simulación completada exitosamente (DRY RUN)');
      console.log(`   Facturas que se actualizarían: ${stats.updated}/${stats.totalInvoices}`);
      console.log(`   ⚠️  NOTA: BD NO fue modificada. Ejecuta sin --dry-run para aplicar cambios.`);
    } else {
      console.log('\n✅ Migración completada exitosamente');
      console.log(`   Facturas actualizadas: ${stats.updated}/${stats.totalInvoices}`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error en migración:', error);
    process.exit(1);
  });
