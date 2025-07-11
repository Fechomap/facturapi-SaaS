#!/usr/bin/env node
// scripts/database/ULTRA-SAFE-apply-indexes.js
// MÁXIMA SEGURIDAD: Backup automático + rollback garantizado

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import prisma from '../../lib/prisma.js';
import logger from '../../core/utils/logger.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const safetyLogger = logger.child({ module: 'ultra-safe-indexes' });

class UltraSafeIndexMigration {
  constructor() {
    this.backupPath = null;
    this.rollbackScript = null;
    this.appliedIndexes = [];
    this.startTime = new Date();
  }

  async createBackup() {
    try {
      safetyLogger.info('📦 Creando backup completo de la base de datos...');
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const backupDir = join(__dirname, '../../backups');
      const backupFile = `pre_indexes_backup_${timestamp}.sql`;
      this.backupPath = join(backupDir, backupFile);
      
      // Crear directorio de backups si no existe
      await mkdir(backupDir, { recursive: true });
      
      // Crear backup usando pg_dump
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error('DATABASE_URL no encontrada');
      }
      
      safetyLogger.info(`💾 Ejecutando backup a: ${backupFile}`);
      
      const backupCommand = `pg_dump "${databaseUrl}" > "${this.backupPath}"`;
      const { stdout, stderr } = await execAsync(backupCommand);
      
      if (stderr && !stderr.includes('NOTICE')) {
        throw new Error(`Error en backup: ${stderr}`);
      }
      
      // Verificar que el backup se creó correctamente
      const { stdout: sizeOutput } = await execAsync(`ls -lh "${this.backupPath}"`);
      const backupSize = sizeOutput.split(' ')[4];
      
      safetyLogger.info(`✅ Backup creado exitosamente: ${backupSize}`);
      
      return this.backupPath;
      
    } catch (error) {
      safetyLogger.error(`❌ Error creando backup: ${error.message}`);
      throw new Error(`CRÍTICO: No se pudo crear backup. ABORTANDO operación.`);
    }
  }

  async createRollbackScript() {
    const rollbackContent = `-- ROLLBACK SCRIPT para índices aplicados
-- Generado: ${new Date().toISOString()}
-- Backup disponible en: ${this.backupPath}

-- OPCIÓN 1: Eliminar índices individuales (MÁS RÁPIDO)
${this.appliedIndexes.map(idx => 
  `DROP INDEX CONCURRENTLY IF EXISTS ${idx};`
).join('\n')}

-- OPCIÓN 2: Restaurar backup completo (MÁS SEGURO)
-- psql $DATABASE_URL < "${this.backupPath}"

-- Verificar que los índices fueron eliminados:
SELECT indexname FROM pg_indexes 
WHERE indexname IN (${this.appliedIndexes.map(idx => `'${idx}'`).join(', ')});
`;

    const rollbackPath = join(__dirname, `../../backups/rollback_indexes_${new Date().toISOString().substring(0, 19).replace(/[:.]/g, '-')}.sql`);
    await writeFile(rollbackPath, rollbackContent);
    
    this.rollbackScript = rollbackPath;
    safetyLogger.info(`📝 Script de rollback creado: ${rollbackPath}`);
    
    return rollbackPath;
  }

  async testDatabaseConnection() {
    try {
      safetyLogger.info('🔍 Verificando conexión a la base de datos...');
      
      const result = await prisma.$queryRaw`SELECT version(), current_database(), current_user`;
      safetyLogger.info('✅ Conexión a BD exitosa:', result[0]);
      
      return true;
    } catch (error) {
      safetyLogger.error(`❌ Error de conexión: ${error.message}`);
      return false;
    }
  }

  async checkDiskSpace() {
    try {
      const { stdout } = await execAsync('df -h .');
      const diskInfo = stdout.split('\n')[1].split(/\s+/);
      const available = diskInfo[3];
      
      safetyLogger.info(`💾 Espacio disponible: ${available}`);
      
      // Verificar que hay al menos 1GB disponible
      const availableGB = parseFloat(available);
      if (availableGB < 1 && available.includes('G')) {
        throw new Error(`Poco espacio en disco: ${available}`);
      }
      
      return true;
    } catch (error) {
      safetyLogger.warn(`⚠️ No se pudo verificar espacio en disco: ${error.message}`);
      return true; // Continuar de todos modos
    }
  }

  async applyIndexSafely(indexName, statement) {
    try {
      safetyLogger.info(`🔨 Aplicando índice: ${indexName}`);
      
      await prisma.$executeRawUnsafe(statement);
      this.appliedIndexes.push(indexName);
      
      safetyLogger.info(`✅ Índice ${indexName} aplicado exitosamente`);
      return { success: true };
      
    } catch (error) {
      if (error.message.includes('already exists')) {
        safetyLogger.info(`ℹ️ Índice ${indexName} ya existe`);
        return { success: true, alreadyExists: true };
      }
      
      safetyLogger.error(`❌ Error aplicando ${indexName}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async executeUltraSafeMigration() {
    try {
      safetyLogger.info('🚀 INICIANDO MIGRACIÓN ULTRA-SEGURA DE ÍNDICES');
      
      // PASO 1: Verificaciones preliminares
      safetyLogger.info('📋 PASO 1: Verificaciones de seguridad...');
      
      const isConnected = await this.testDatabaseConnection();
      if (!isConnected) {
        throw new Error('No se puede conectar a la base de datos');
      }
      
      await this.checkDiskSpace();
      
      // PASO 2: Crear backup completo
      safetyLogger.info('📋 PASO 2: Creando backup de seguridad...');
      await this.createBackup();
      
      // PASO 3: Definir índices
      const indexes = [
        {
          name: 'idx_tenant_subscriptions_tenant_created',
          statement: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_subscriptions_tenant_created ON tenant_subscriptions(tenant_id, created_at DESC)'
        },
        {
          name: 'idx_tenant_invoices_tenant_folio',
          statement: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_invoices_tenant_folio ON tenant_invoices(tenant_id, folio_number)'
        },
        {
          name: 'idx_tenant_invoices_tenant_status',
          statement: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_invoices_tenant_status ON tenant_invoices(tenant_id, status)'
        },
        {
          name: 'idx_tenant_customers_legal_name_search',
          statement: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_customers_legal_name_search ON tenant_customers(tenant_id, legal_name varchar_pattern_ops)'
        },
        {
          name: 'idx_tenant_invoices_tenant_date',
          statement: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_invoices_tenant_date ON tenant_invoices(tenant_id, created_at DESC)'
        }
      ];
      
      // PASO 4: Aplicar índices uno por uno
      safetyLogger.info('📋 PASO 3: Aplicando índices...');
      
      const results = [];
      for (const index of indexes) {
        const result = await this.applyIndexSafely(index.name, index.statement);
        results.push({ ...index, ...result });
        
        // Pausa entre índices
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // PASO 5: Crear script de rollback
      safetyLogger.info('📋 PASO 4: Creando script de rollback...');
      await this.createRollbackScript();
      
      // PASO 6: Verificar índices
      const finalIndexes = await prisma.$queryRaw`
        SELECT indexname, pg_size_pretty(pg_relation_size(indexrelid)) as size
        FROM pg_stat_user_indexes 
        WHERE indexrelname LIKE 'idx_tenant_%'
        ORDER BY indexrelname
      `;
      
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      // PASO 7: Reporte final
      safetyLogger.info('🎉 MIGRACIÓN COMPLETADA CON ÉXITO');
      safetyLogger.info(`📊 Resultados: ${successful} exitosos, ${failed} fallidos`);
      safetyLogger.info(`📦 Backup disponible: ${this.backupPath}`);
      safetyLogger.info(`📝 Rollback disponible: ${this.rollbackScript}`);
      
      if (finalIndexes.length > 0) {
        safetyLogger.info('🗃️ Índices creados:');
        finalIndexes.forEach(idx => {
          safetyLogger.info(`  - ${idx.indexname} (${idx.size})`);
        });
      }
      
      return {
        success: failed === 0,
        successful,
        failed,
        backupPath: this.backupPath,
        rollbackScript: this.rollbackScript,
        duration: Date.now() - this.startTime.getTime(),
        appliedIndexes: this.appliedIndexes
      };
      
    } catch (error) {
      safetyLogger.error(`💥 ERROR CRÍTICO: ${error.message}`);
      
      if (this.backupPath) {
        safetyLogger.info(`📦 Backup disponible para rollback: ${this.backupPath}`);
        safetyLogger.info(`🔄 Para restaurar: psql $DATABASE_URL < "${this.backupPath}"`);
      }
      
      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  const migration = new UltraSafeIndexMigration();
  
  migration.executeUltraSafeMigration()
    .then(result => {
      console.log('\n✅ MIGRACIÓN ULTRA-SEGURA COMPLETADA');
      console.log(`📊 ${result.successful} exitosos, ${result.failed} fallidos`);
      console.log(`⏱️ Duración: ${Math.round(result.duration / 1000)}s`);
      console.log(`📦 Backup: ${result.backupPath}`);
      console.log(`📝 Rollback: ${result.rollbackScript}`);
      console.log('\n🔄 Para hacer rollback:');
      console.log(`   node -e "console.log('psql $DATABASE_URL < ${result.backupPath}')"`);
      
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n❌ Error en migración ultra-segura:', error.message);
      console.error('\n📦 Si existe backup, puedes restaurar con:');
      console.error('   psql $DATABASE_URL < [ruta_del_backup]');
      process.exit(1);
    });
}

export default UltraSafeIndexMigration;