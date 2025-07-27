#!/usr/bin/env node
// scripts/backup-database.js
// Script para crear backup completo de la base de datos antes de reparaciones

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createDatabaseBackup() {
  console.log('💾 CREANDO BACKUP COMPLETO DE LA BASE DE DATOS');
  console.log('='.repeat(60));

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '../backups');
  const backupFile = path.join(backupDir, `backup_${timestamp}.sql`);

  try {
    // Crear directorio de backups si no existe
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log('📁 Directorio de backups creado');
    }

    // Obtener DATABASE_URL del .env
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL no encontrada en variables de entorno');
    }

    console.log('🔍 DATABASE_URL detectada');
    console.log('⏳ Iniciando backup con pg_dump...');

    // Ejecutar pg_dump para crear backup completo
    const pgDumpCommand = `pg_dump "${databaseUrl}" > "${backupFile}"`;

    console.log('📤 Ejecutando backup...');
    execSync(pgDumpCommand, {
      stdio: ['inherit', 'inherit', 'inherit'],
      timeout: 300000, // 5 minutos timeout
    });

    // Verificar que el archivo se creó correctamente
    if (fs.existsSync(backupFile)) {
      const stats = fs.statSync(backupFile);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      console.log('✅ BACKUP COMPLETADO EXITOSAMENTE');
      console.log(`📄 Archivo: ${backupFile}`);
      console.log(`📊 Tamaño: ${fileSizeMB} MB`);
      console.log(`⏰ Timestamp: ${timestamp}`);

      // Crear script de restauración
      const restoreScript = createRestoreScript(backupFile, databaseUrl);
      const restoreFile = path.join(backupDir, `restore_${timestamp}.sh`);
      fs.writeFileSync(restoreFile, restoreScript);
      fs.chmodSync(restoreFile, '755');

      console.log(`🔄 Script de restore creado: ${restoreFile}`);

      return {
        success: true,
        backupFile,
        restoreFile,
        size: fileSizeMB,
        timestamp,
      };
    } else {
      throw new Error('El archivo de backup no se creó correctamente');
    }
  } catch (error) {
    console.error('❌ ERROR EN BACKUP:', error.message);

    if (error.message.includes('pg_dump: command not found')) {
      console.log('\n💡 SOLUCIÓN:');
      console.log('   Instala PostgreSQL client:');
      console.log('   • macOS: brew install postgresql');
      console.log('   • Ubuntu: apt-get install postgresql-client');
      console.log('   • Heroku: heroku pg:backups:capture');
    }

    return {
      success: false,
      error: error.message,
    };
  }
}

function createRestoreScript(backupFile, databaseUrl) {
  return `#!/bin/bash
# Script de restauración automática
# Generado: ${new Date().toISOString()}

echo "🔄 RESTAURANDO BASE DE DATOS DESDE BACKUP"
echo "============================================"
echo "⚠️  ADVERTENCIA: Esto sobrescribirá todos los datos actuales"
echo "📄 Backup: ${backupFile}"
echo ""

read -p "¿Estás seguro de continuar? (yes/NO): " confirm
if [ "$confirm" != "yes" ]; then
    echo "❌ Restauración cancelada"
    exit 1
fi

echo "⏳ Restaurando base de datos..."

# Restaurar desde backup
psql "${databaseUrl}" < "${backupFile}"

if [ $? -eq 0 ]; then
    echo "✅ RESTAURACIÓN COMPLETADA EXITOSAMENTE"
else
    echo "❌ ERROR EN LA RESTAURACIÓN"
    exit 1
fi
`;
}

// Función para crear backup antes de operaciones críticas
async function createPreOperationBackup(operationName) {
  console.log(`🛡️ Creando backup de seguridad antes de: ${operationName}`);

  const result = await createDatabaseBackup();

  if (result.success) {
    console.log('✅ Backup de seguridad completado');
    console.log('💡 Puedes proceder con la operación de manera segura');
    return result;
  } else {
    console.log('❌ FALLO EN BACKUP - NO PROCEDER CON LA OPERACIÓN');
    throw new Error('Backup falló, operación abortada por seguridad');
  }
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  const operationName = process.argv[2] || 'Operación manual';

  createPreOperationBackup(operationName)
    .then((result) => {
      console.log('\n🎉 Script de backup completado');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Error fatal en backup:', error.message);
      process.exit(1);
    });
}

export { createDatabaseBackup, createPreOperationBackup };
