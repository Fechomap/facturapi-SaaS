#!/usr/bin/env node
// scripts/fix-invoice-counters.js
// SCRIPT CRÍTICO: Sincronización de contadores de facturas

import prisma from '../lib/prisma.js';
import logger from '../core/utils/logger.js';

const scriptLogger = logger.child({ module: 'fix-invoice-counters' });

/**
 * Script para sincronizar contadores invoicesUsed con la realidad de la BD
 * 
 * PROBLEMA IDENTIFICADO:
 * - Campo invoicesUsed muestra 530+ facturas
 * - Conteo real en BD: ~415 facturas válidas
 * - Causa: Contador se incrementa siempre, no se decrementa por cancelaciones
 * - Solución: Recalcular basado en facturas reales válidas y LIVE
 */

// Configuración del script
const CONFIG = {
  DRY_RUN: process.argv.includes('--dry-run'), // Modo simulación
  FIX_ORPHAN_INVOICES: process.argv.includes('--fix-orphans'), // Arreglar huérfanas
  VERBOSE: process.argv.includes('--verbose'), // Logs detallados
  ONLY_TENANT: process.argv.find(arg => arg.startsWith('--tenant='))?.split('=')[1], // Solo un tenant específico
};

async function main() {
  console.log('🔧 SCRIPT DE SINCRONIZACIÓN DE CONTADORES DE FACTURAS');
  console.log('📅', new Date().toLocaleString());
  console.log('='.repeat(80));
  
  if (CONFIG.DRY_RUN) {
    console.log('🔍 MODO DRY-RUN: Solo simulación, no se modificará la BD');
  }
  
  if (CONFIG.ONLY_TENANT) {
    console.log(`🎯 TENANT ESPECÍFICO: ${CONFIG.ONLY_TENANT}`);
  }
  
  console.log('');

  try {
    // 1. Obtener todas las suscripciones a sincronizar
    const subscriptions = await getSubscriptionsToSync();
    
    if (subscriptions.length === 0) {
      console.log('ℹ️ No se encontraron suscripciones para sincronizar');
      return;
    }

    console.log(`📊 SUSCRIPCIONES ENCONTRADAS: ${subscriptions.length}`);
    console.log('');

    // 2. Analizar discrepancias antes de la corrección
    await analyzeDiscrepancies(subscriptions);

    // 3. Procesar cada suscripción
    const results = {
      processed: 0,
      updated: 0,
      unchanged: 0,
      errors: 0,
      totalDifference: 0,
    };

    for (const subscription of subscriptions) {
      try {
        const result = await processSingleSubscription(subscription);
        
        results.processed++;
        if (result.updated) {
          results.updated++;
          results.totalDifference += result.difference;
        } else {
          results.unchanged++;
        }

        if (CONFIG.VERBOSE) {
          console.log(`✅ ${subscription.tenant.businessName}: ${result.oldCount} → ${result.newCount} (${result.difference >= 0 ? '+' : ''}${result.difference})`);
        }
      } catch (error) {
        results.errors++;
        console.error(`❌ Error en ${subscription.tenant.businessName}:`, error.message);
      }
    }

    // 4. Resumen final
    await showFinalSummary(results, subscriptions);

    // 5. Verificación post-corrección
    if (!CONFIG.DRY_RUN && results.updated > 0) {
      console.log('\n🔍 VERIFICACIÓN POST-CORRECCIÓN:');
      await verifyResults();
    }

  } catch (error) {
    scriptLogger.error({ error }, 'Error crítico en script de sincronización');
    console.error('💥 ERROR CRÍTICO:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Obtiene las suscripciones que necesitan sincronización
 */
async function getSubscriptionsToSync() {
  const whereClause = CONFIG.ONLY_TENANT 
    ? { tenantId: CONFIG.ONLY_TENANT }
    : { status: { in: ['active', 'trial'] } };

  return await prisma.tenantSubscription.findMany({
    where: whereClause,
    include: {
      tenant: {
        select: {
          id: true,
          businessName: true,
          facturapiApiKey: true,
        },
      },
      plan: {
        select: {
          name: true,
          invoiceLimit: true,
        },
      },
    },
    orderBy: {
      tenant: {
        businessName: 'asc',
      },
    },
  });
}

/**
 * Analiza las discrepancias actuales antes de corregir
 */
async function analyzeDiscrepancies(subscriptions) {
  console.log('📊 ANÁLISIS DE DISCREPANCIAS ACTUALES:');
  console.log('');
  
  let totalReportedUsed = 0;
  let totalRealValid = 0;
  let tenantsWithDiscrepancies = 0;

  for (const subscription of subscriptions) {
    const realCount = await countRealValidInvoices(subscription.tenantId);
    const reportedCount = subscription.invoicesUsed || 0;
    const difference = reportedCount - realCount;

    totalReportedUsed += reportedCount;
    totalRealValid += realCount;

    if (Math.abs(difference) > 0) {
      tenantsWithDiscrepancies++;
    }

    if (CONFIG.VERBOSE || Math.abs(difference) > 10) {
      console.log(`${subscription.tenant.businessName}:`);
      console.log(`  📊 Reportado: ${reportedCount} facturas`);
      console.log(`  ✅ Real válido: ${realCount} facturas`);
      console.log(`  📈 Diferencia: ${difference > 0 ? '+' : ''}${difference}`);
      console.log('');
    }
  }

  console.log('📈 RESUMEN GLOBAL:');
  console.log(`• Total reportado (invoicesUsed): ${totalReportedUsed}`);
  console.log(`• Total real válido en BD: ${totalRealValid}`);
  console.log(`• Diferencia global: ${totalReportedUsed - totalRealValid}`);
  console.log(`• Tenants con discrepancias: ${tenantsWithDiscrepancies}/${subscriptions.length}`);
  console.log('');
}

/**
 * Cuenta facturas reales válidas para un tenant
 */
async function countRealValidInvoices(tenantId) {
  return await prisma.tenantInvoice.count({
    where: {
      tenantId,
      status: 'valid',
      // Excluir facturas de TEST (si las identificamos por prefijo)
      NOT: [
        { facturapiInvoiceId: { startsWith: 'test_' } },
        { facturapiInvoiceId: { startsWith: 'demo_' } },
      ],
    },
  });
}

/**
 * Procesa una suscripción individual
 */
async function processSingleSubscription(subscription) {
  const tenantId = subscription.tenantId;
  const oldCount = subscription.invoicesUsed || 0;
  const newCount = await countRealValidInvoices(tenantId);
  const difference = newCount - oldCount;

  // Solo actualizar si hay diferencia significativa
  if (Math.abs(difference) === 0) {
    return {
      updated: false,
      oldCount,
      newCount,
      difference: 0,
    };
  }

  // Ejecutar actualización si no es dry-run
  if (!CONFIG.DRY_RUN) {
    await prisma.tenantSubscription.update({
      where: { id: subscription.id },
      data: { invoicesUsed: newCount },
    });

    scriptLogger.info(
      { tenantId, oldCount, newCount, difference },
      'Contador de facturas sincronizado'
    );
  }

  return {
    updated: true,
    oldCount,
    newCount,
    difference,
  };
}

/**
 * Muestra resumen final de la operación
 */
async function showFinalSummary(results, subscriptions) {
  console.log('\n📋 RESUMEN FINAL:');
  console.log('='.repeat(50));
  console.log(`📊 Suscripciones procesadas: ${results.processed}`);
  console.log(`✅ Actualizadas: ${results.updated}`);
  console.log(`➖ Sin cambios: ${results.unchanged}`);
  console.log(`❌ Errores: ${results.errors}`);
  console.log(`📈 Diferencia total corregida: ${results.totalDifference}`);
  
  if (CONFIG.DRY_RUN) {
    console.log('\n🔍 MODO DRY-RUN: No se realizaron cambios reales');
    console.log('📝 Para ejecutar los cambios, ejecuta: node scripts/fix-invoice-counters.js');
  } else if (results.updated > 0) {
    console.log('\n✅ SINCRONIZACIÓN COMPLETADA');
    console.log('📊 Los contadores han sido actualizados con los valores reales de la BD');
  } else {
    console.log('\n✅ TODOS LOS CONTADORES YA ESTÁN SINCRONIZADOS');
  }
}

/**
 * Verifica los resultados después de la corrección
 */
async function verifyResults() {
  const subscriptions = await getSubscriptionsToSync();
  let allSynced = true;

  for (const subscription of subscriptions) {
    const realCount = await countRealValidInvoices(subscription.tenantId);
    const reportedCount = subscription.invoicesUsed || 0;
    
    if (realCount !== reportedCount) {
      console.log(`⚠️ Discrepancia persistente en ${subscription.tenant.businessName}: ${reportedCount} vs ${realCount}`);
      allSynced = false;
    }
  }

  if (allSynced) {
    console.log('✅ VERIFICACIÓN EXITOSA: Todos los contadores están sincronizados');
  } else {
    console.log('⚠️ VERIFICACIÓN: Se detectaron discrepancias persistentes');
  }
}

// Manejo de argumentos y ayuda
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
🔧 SCRIPT DE SINCRONIZACIÓN DE CONTADORES DE FACTURAS

USO:
  node scripts/fix-invoice-counters.js [opciones]

OPCIONES:
  --dry-run              Solo simular, no modificar BD
  --verbose              Mostrar logs detallados
  --tenant=TENANT_ID     Solo procesar un tenant específico
  --fix-orphans          También corregir facturas huérfanas (próximamente)
  --help, -h             Mostrar esta ayuda

EJEMPLOS:
  node scripts/fix-invoice-counters.js --dry-run --verbose
  node scripts/fix-invoice-counters.js --tenant=3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb
  node scripts/fix-invoice-counters.js

DESCRIPCIÓN:
  Este script corrige la discrepancia entre el campo 'invoicesUsed' en 
  las suscripciones y el conteo real de facturas válidas en la base de datos.
  
  PROBLEMA: invoicesUsed se incrementa siempre al crear facturas, pero no
  se decrementa al cancelarlas, causando conteos inflados.
  
  SOLUCIÓN: Recalcula invoicesUsed basado en facturas con status='valid'
  y excluye facturas de TEST.
`);
  process.exit(0);
}

// Ejecutar script
main().catch((error) => {
  console.error('💥 Error no manejado:', error);
  process.exit(1);
});