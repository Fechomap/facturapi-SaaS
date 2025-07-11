#!/usr/bin/env node
// scripts/database/EMERGENCY-ROLLBACK.js
// Script de emergencia para revertir cambios en índices

import { exec } from 'child_process';
import { promisify } from 'util';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import prisma from '../../lib/prisma.js';
import logger from '../../core/utils/logger.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const emergencyLogger = logger.child({ module: 'emergency-rollback' });

class EmergencyRollback {
  async listAvailableBackups() {
    try {
      const backupDir = join(__dirname, '../../backups');
      const files = await readdir(backupDir);
      
      const backups = files
        .filter(f => f.includes('pre_indexes_backup') && f.endsWith('.sql'))
        .sort()
        .reverse(); // Más recientes primero
      
      return backups.map(backup => ({
        file: backup,
        path: join(backupDir, backup),
        timestamp: backup.match(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/)?.[0] || 'unknown'
      }));
      
    } catch (error) {
      emergencyLogger.error('Error listando backups:', error.message);
      return [];
    }
  }

  async removeIndexesOnly() {
    try {
      emergencyLogger.info('🗑️ OPCIÓN 1: Eliminando solo los índices creados...');
      
      // Lista de índices que creamos
      const indexesToRemove = [
        'idx_tenant_subscriptions_tenant_created',
        'idx_tenant_invoices_tenant_folio', 
        'idx_tenant_invoices_tenant_status',
        'idx_tenant_customers_legal_name_search',
        'idx_tenant_invoices_tenant_date'
      ];
      
      const results = [];
      
      for (const indexName of indexesToRemove) {
        try {
          emergencyLogger.info(`🔨 Eliminando índice: ${indexName}`);
          
          await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS ${indexName}`);
          
          emergencyLogger.info(`✅ Índice ${indexName} eliminado`);
          results.push({ index: indexName, success: true });
          
        } catch (error) {
          emergencyLogger.error(`❌ Error eliminando ${indexName}: ${error.message}`);
          results.push({ index: indexName, success: false, error: error.message });
        }
      }
      
      // Verificar que se eliminaron
      const remainingIndexes = await prisma.$queryRaw`
        SELECT indexname FROM pg_indexes 
        WHERE indexname IN (${indexesToRemove.map(idx => `'${idx}'`).join(', ')})
      `;
      
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      emergencyLogger.info(`📊 Eliminación de índices: ${successful} exitosos, ${failed} fallidos`);
      emergencyLogger.info(`🔍 Índices restantes: ${remainingIndexes.length}`);
      
      return {
        method: 'index_removal',
        successful,
        failed,
        remainingIndexes: remainingIndexes.length,
        details: results
      };
      
    } catch (error) {
      emergencyLogger.error('Error en eliminación de índices:', error.message);
      throw error;
    }
  }

  async restoreFromBackup(backupPath) {
    try {
      emergencyLogger.info('📦 OPCIÓN 2: Restaurando desde backup completo...');
      emergencyLogger.warn('⚠️ ADVERTENCIA: Esto revertirá TODOS los cambios desde el backup');
      
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error('DATABASE_URL no encontrada');
      }
      
      emergencyLogger.info(`🔄 Restaurando desde: ${backupPath}`);
      
      // Comando de restauración
      const restoreCommand = `psql "${databaseUrl}" < "${backupPath}"`;
      
      emergencyLogger.info('⏳ Ejecutando restauración... (esto puede tardar varios minutos)');
      
      const { stdout, stderr } = await execAsync(restoreCommand);
      
      if (stderr && !stderr.includes('NOTICE')) {
        throw new Error(`Error en restauración: ${stderr}`);
      }
      
      emergencyLogger.info('✅ Restauración completada exitosamente');
      
      // Verificar que los índices fueron removidos
      const indexes = await prisma.$queryRaw`
        SELECT indexname FROM pg_indexes 
        WHERE indexname LIKE 'idx_tenant_%'
      `;
      
      return {
        method: 'full_restore',
        success: true,
        backupPath,
        remainingIndexes: indexes.length
      };
      
    } catch (error) {
      emergencyLogger.error('Error en restauración:', error.message);
      throw error;
    }
  }

  async executeEmergencyRollback(method = 'auto', backupPath = null) {
    try {
      emergencyLogger.info('🚨 INICIANDO ROLLBACK DE EMERGENCIA');
      emergencyLogger.info(`📋 Método: ${method}`);
      
      // Verificar conexión
      await prisma.$queryRaw`SELECT 1`;
      emergencyLogger.info('✅ Conexión a BD verificada');
      
      let result;
      
      if (method === 'indexes' || method === 'auto') {
        // Intentar eliminación de índices primero (más rápido)
        result = await this.removeIndexesOnly();
        
        if (result.failed === 0) {
          emergencyLogger.info('🎉 Rollback completado con eliminación de índices');
          return result;
        } else {
          emergencyLogger.warn('⚠️ Eliminación parcial de índices. Considerar backup completo.');
        }
      }
      
      if (method === 'backup' || (method === 'auto' && result.failed > 0)) {
        // Buscar backup más reciente si no se especifica
        if (!backupPath) {
          const backups = await this.listAvailableBackups();
          if (backups.length === 0) {
            throw new Error('No se encontraron backups disponibles');
          }
          backupPath = backups[0].path;
          emergencyLogger.info(`📦 Usando backup más reciente: ${backups[0].file}`);
        }
        
        result = await this.restoreFromBackup(backupPath);
      }
      
      return result;
      
    } catch (error) {
      emergencyLogger.error(`💥 Error crítico en rollback: ${error.message}`);
      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }
}

// CLI Interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const method = process.argv[2] || 'auto'; // auto, indexes, backup
  const backupPath = process.argv[3] || null;
  
  const rollback = new EmergencyRollback();
  
  console.log('🚨 EMERGENCY ROLLBACK SCRIPT');
  console.log('=============================');
  console.log(`Método: ${method}`);
  
  if (method === 'list') {
    // Listar backups disponibles
    rollback.listAvailableBackups()
      .then(backups => {
        console.log('\n📦 Backups disponibles:');
        backups.forEach((backup, i) => {
          console.log(`${i + 1}. ${backup.file} (${backup.timestamp})`);
          console.log(`   Ruta: ${backup.path}`);
        });
        
        if (backups.length === 0) {
          console.log('❌ No se encontraron backups');
        }
      })
      .catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
      });
  } else {
    // Ejecutar rollback
    rollback.executeEmergencyRollback(method, backupPath)
      .then(result => {
        console.log('\n✅ ROLLBACK COMPLETADO');
        console.log(`📊 Método usado: ${result.method}`);
        
        if (result.method === 'index_removal') {
          console.log(`📊 ${result.successful} índices eliminados, ${result.failed} fallidos`);
        }
        
        console.log(`🔍 Índices restantes: ${result.remainingIndexes}`);
        process.exit(0);
      })
      .catch(error => {
        console.error('\n❌ Error en rollback:', error.message);
        console.error('\n📞 Contactar a DBA inmediatamente si persiste');
        process.exit(1);
      });
  }
}

export default EmergencyRollback;