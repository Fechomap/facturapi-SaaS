#!/usr/bin/env node
// scripts/database/SAFE-apply-indexes.js
// PRODUCTION-SAFE index creation with monitoring

import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import prisma from '../../lib/prisma.js';
import logger from '../../core/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const migrationLogger = logger.child({ module: 'safe-indexes' });

// SAFETY CONFIGURATIONS
const SAFETY_CONFIG = {
  // Maximum time per index creation (30 minutes)
  INDEX_TIMEOUT: 30 * 60 * 1000,
  
  // Delay between index creations to reduce load
  INDEX_DELAY: 5000, // 5 seconds
  
  // Check database load before proceeding
  MAX_ACTIVE_CONNECTIONS: 80,
  
  // Dry run mode (set to true for testing)
  DRY_RUN: false
};

async function checkDatabaseHealth() {
  try {
    // Check active connections
    const connections = await prisma.$queryRaw`
      SELECT count(*) as active_connections 
      FROM pg_stat_activity 
      WHERE state = 'active'
    `;
    
    const activeConnections = Number(connections[0].active_connections);
    
    // Check database size
    const dbSize = await prisma.$queryRaw`
      SELECT pg_size_pretty(pg_database_size(current_database())) as db_size
    `;
    
    // Check running queries
    const longQueries = await prisma.$queryRaw`
      SELECT count(*) as long_queries
      FROM pg_stat_activity 
      WHERE state = 'active' 
      AND query_start < now() - interval '5 minutes'
      AND query NOT LIKE '%pg_stat_activity%'
    `;
    
    const health = {
      activeConnections,
      dbSize: dbSize[0].db_size,
      longQueries: Number(longQueries[0].long_queries),
      isHealthy: activeConnections < SAFETY_CONFIG.MAX_ACTIVE_CONNECTIONS
    };
    
    migrationLogger.info('🏥 Estado de la base de datos:', health);
    
    return health;
    
  } catch (error) {
    migrationLogger.error('❌ Error al verificar salud de BD:', error.message);
    return { isHealthy: false, error: error.message };
  }
}

async function createIndexSafely(indexStatement, indexName) {
  try {
    migrationLogger.info(`🔨 Creando índice: ${indexName}`);
    
    if (SAFETY_CONFIG.DRY_RUN) {
      migrationLogger.info(`🧪 DRY RUN: ${indexStatement}`);
      return { success: true, dryRun: true };
    }
    
    const startTime = Date.now();
    
    // Set individual timeout for this operation
    await prisma.$executeRaw`SET statement_timeout = '30min'`;
    
    // Execute index creation
    await prisma.$executeRawUnsafe(indexStatement);
    
    const duration = Date.now() - startTime;
    migrationLogger.info(`✅ Índice ${indexName} creado en ${duration}ms`);
    
    return { success: true, duration };
    
  } catch (error) {
    if (error.message.includes('already exists')) {
      migrationLogger.info(`ℹ️ Índice ${indexName} ya existe`);
      return { success: true, alreadyExists: true };
    }
    
    migrationLogger.error(`❌ Error creando ${indexName}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function applySafeIndexes() {
  try {
    migrationLogger.info('🚀 INICIANDO CREACIÓN SEGURA DE ÍNDICES');
    migrationLogger.info(`⚙️ Configuración: DRY_RUN=${SAFETY_CONFIG.DRY_RUN}`);
    
    // 1. Verificar salud de la BD
    const health = await checkDatabaseHealth();
    
    if (!health.isHealthy) {
      throw new Error(`BD no está saludable: ${health.error || 'muchas conexiones activas'}`);
    }
    
    // 2. Definir índices en orden de prioridad (menos impactantes primero)
    const indexes = [
      {
        name: 'idx_tenant_subscriptions_tenant_created',
        statement: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_subscriptions_tenant_created ON tenant_subscriptions(tenant_id, created_at DESC)`,
        priority: 1,
        impact: 'low'
      },
      {
        name: 'idx_tenant_invoices_tenant_folio', 
        statement: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_invoices_tenant_folio ON tenant_invoices(tenant_id, folio_number)`,
        priority: 2,
        impact: 'low'
      },
      {
        name: 'idx_tenant_invoices_tenant_status',
        statement: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_invoices_tenant_status ON tenant_invoices(tenant_id, status)`,
        priority: 3,
        impact: 'medium'
      },
      {
        name: 'idx_tenant_customers_legal_name_search',
        statement: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_customers_legal_name_search ON tenant_customers(tenant_id, legal_name varchar_pattern_ops)`,
        priority: 4,
        impact: 'medium'
      },
      {
        name: 'idx_tenant_invoices_tenant_date',
        statement: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_invoices_tenant_date ON tenant_invoices(tenant_id, created_at DESC)`,
        priority: 5,
        impact: 'high' // Tabla más grande
      }
    ];
    
    const results = [];
    
    // 3. Crear índices uno por uno con monitoreo
    for (const index of indexes) {
      migrationLogger.info(`🎯 Procesando índice ${index.name} (impacto: ${index.impact})`);
      
      // Verificar salud antes de cada índice
      const currentHealth = await checkDatabaseHealth();
      if (!currentHealth.isHealthy) {
        migrationLogger.warn('⚠️ BD bajo presión, pausando...');
        await new Promise(resolve => setTimeout(resolve, 10000)); // Esperar 10s
      }
      
      // Crear índice
      const result = await createIndexSafely(index.statement, index.name);
      results.push({ ...index, ...result });
      
      // Esperar entre índices para reducir carga
      if (index.priority < indexes.length) {
        migrationLogger.info(`⏳ Esperando ${SAFETY_CONFIG.INDEX_DELAY}ms antes del siguiente índice...`);
        await new Promise(resolve => setTimeout(resolve, SAFETY_CONFIG.INDEX_DELAY));
      }
    }
    
    // 4. Verificar índices creados
    const finalIndexes = await prisma.$queryRaw`
      SELECT 
        schemaname,
        tablename,
        indexname,
        pg_size_pretty(pg_relation_size(indexrelid)) as size
      FROM pg_stat_user_indexes 
      WHERE indexrelname LIKE 'idx_tenant_%'
      ORDER BY tablename, indexname
    `;
    
    // 5. Resumen final
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    migrationLogger.info('🎉 MIGRACIÓN COMPLETADA');
    migrationLogger.info(`📊 Resultados: ${successful} exitosos, ${failed} fallidos`);
    migrationLogger.info(`📋 Total índices en BD: ${finalIndexes.length}`);
    
    if (finalIndexes.length > 0) {
      migrationLogger.info('🗃️ Índices de performance:');
      finalIndexes.forEach(idx => {
        migrationLogger.info(`  - ${idx.tablename}.${idx.indexname} (${idx.size})`);
      });
    }
    
    return {
      success: failed === 0,
      successful,
      failed,
      totalIndexes: finalIndexes.length,
      results,
      dryRun: SAFETY_CONFIG.DRY_RUN
    };
    
  } catch (error) {
    migrationLogger.error(`💥 ERROR CRÍTICO: ${error.message}`);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  applySafeIndexes()
    .then(result => {
      console.log('\n✅ Migración segura completada');
      console.log(`📊 ${result.successful} exitosos, ${result.failed} fallidos`);
      if (result.dryRun) {
        console.log('🧪 MODO DRY RUN - No se hicieron cambios reales');
      }
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n❌ Error en migración segura:', error.message);
      process.exit(1);
    });
}

export default applySafeIndexes;