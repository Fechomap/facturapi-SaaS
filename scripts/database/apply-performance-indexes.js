#!/usr/bin/env node
// scripts/database/apply-performance-indexes.js
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import prisma from '../../lib/prisma.js';
import logger from '../../core/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const migrationLogger = logger.child({ module: 'performance-indexes' });

async function applyPerformanceIndexes() {
  try {
    migrationLogger.info('🚀 Iniciando aplicación de índices de performance...');

    // Leer el archivo SQL
    const sqlFilePath = join(__dirname, '../../prisma/migrations/add_performance_indexes.sql');
    const sqlContent = await readFile(sqlFilePath, 'utf-8');

    // Dividir en statements individuales
    const statements = sqlContent
      .split(';')
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.length > 0 && !stmt.startsWith('--') && !stmt.startsWith('/*'));

    migrationLogger.info(`📝 Encontrados ${statements.length} statements para ejecutar`);

    let successCount = 0;
    let errorCount = 0;

    // Ejecutar cada statement
    for (const [index, statement] of statements.entries()) {
      try {
        if (statement.toLowerCase().includes('create index')) {
          const indexName = statement.match(/CREATE INDEX\s+(?:IF NOT EXISTS\s+)?(\w+)/i)?.[1];
          migrationLogger.info(`📊 Creando índice: ${indexName || `statement-${index + 1}`}`);
        }

        const result = await prisma.$executeRawUnsafe(statement);
        migrationLogger.debug(`✅ Statement ${index + 1} ejecutado exitosamente`);
        successCount++;
      } catch (error) {
        // Los errores de "already exists" son OK
        if (error.message.includes('already exists')) {
          migrationLogger.info(`ℹ️ Índice ya existe (saltando): statement ${index + 1}`);
          successCount++;
        } else {
          migrationLogger.error(`❌ Error en statement ${index + 1}: ${error.message}`);
          errorCount++;
        }
      }
    }

    // Verificar índices creados
    const indexQuery = `
      SELECT 
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE indexname LIKE 'idx_%tenant%'
      ORDER BY tablename, indexname;
    `;

    const indexes = await prisma.$queryRawUnsafe(indexQuery);

    migrationLogger.info('📋 Índices de performance existentes:');
    indexes.forEach((idx) => {
      migrationLogger.info(`  - ${idx.tablename}.${idx.indexname}`);
    });

    // Análisis de tamaño de índices
    const sizeQuery = `
      SELECT 
        schemaname,
        tablename,
        indexname,
        pg_size_pretty(pg_relation_size(indexrelid)) as size
      FROM pg_stat_user_indexes 
      WHERE indexrelname LIKE 'idx_%tenant%'
      ORDER BY pg_relation_size(indexrelid) DESC;
    `;

    const indexSizes = await prisma.$queryRawUnsafe(sizeQuery);

    if (indexSizes.length > 0) {
      migrationLogger.info('📊 Tamaño de índices:');
      indexSizes.forEach((idx) => {
        migrationLogger.info(`  - ${idx.indexname}: ${idx.size}`);
      });
    }

    migrationLogger.info(
      `🎉 Migración completada: ${successCount} exitosos, ${errorCount} errores`
    );

    return {
      success: true,
      successCount,
      errorCount,
      totalIndexes: indexes.length,
    };
  } catch (error) {
    migrationLogger.error(`💥 Error crítico en migración: ${error.message}`);
    throw error;
  }
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  applyPerformanceIndexes()
    .then((result) => {
      console.log('\n✅ Migración de índices completada');
      console.log(`📊 Resultados: ${result.successCount} exitosos, ${result.errorCount} errores`);
      console.log(`📋 Total de índices: ${result.totalIndexes}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error en migración:', error.message);
      process.exit(1);
    });
}

export default applyPerformanceIndexes;
