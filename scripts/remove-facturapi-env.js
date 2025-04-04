// scripts/remove-facturapi-env.js
// Script para eliminar la columna facturapi_env de la tabla tenants

import { PrismaClient } from '@prisma/client';
import { config } from '../config/index.js';

// Inicializar Prisma
const prisma = new PrismaClient();

async function removeFacurapiEnvColumn() {
  try {
    console.log('Conectando a la base de datos...');
    console.log(`URL de conexión: ${config.database.url.substring(0, 20)}...`);
    
    // Ejecutar SQL directamente para eliminar la columna
    const result = await prisma.$executeRawUnsafe(`
      ALTER TABLE "tenants" DROP COLUMN IF EXISTS "facturapi_env";
    `);
    
    console.log('Migración completada exitosamente.');
    console.log('La columna facturapi_env ha sido eliminada de la tabla tenants.');
    
    return { success: true, message: 'Columna eliminada correctamente' };
  } catch (error) {
    console.error('Error al ejecutar la migración:', error);
    return { success: false, error: error.message };
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar la función principal
removeFacurapiEnvColumn()
  .then(result => {
    if (result.success) {
      console.log('✅ Operación completada con éxito');
    } else {
      console.error('❌ Error:', result.error);
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('Error inesperado:', err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
