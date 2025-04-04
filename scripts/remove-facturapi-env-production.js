// scripts/remove-facturapi-env-production.js
// Script para eliminar la columna facturapi_env de la tabla tenants en la base de datos de producción

import { PrismaClient } from '@prisma/client';

// Inicializar Prisma con la URL de la base de datos de producción
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgres://uevg5uanv9qbbq:pce6ccd9538c636892c1d1c4b852cc2ad40f202101176e6e798de72b2287bf42f@c3cj4hehegopde.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com:5432/dmbe4ekvsb6ed'
    }
  }
});

async function removeFacurapiEnvColumn() {
  try {
    console.log('Conectando a la base de datos de PRODUCCIÓN...');
    
    // Ejecutar SQL directamente para eliminar la columna
    const result = await prisma.$executeRawUnsafe(`
      ALTER TABLE "tenants" DROP COLUMN IF EXISTS "facturapi_env";
    `);
    
    console.log('Migración completada exitosamente en la base de datos de PRODUCCIÓN.');
    console.log('La columna facturapi_env ha sido eliminada de la tabla tenants.');
    
    return { success: true, message: 'Columna eliminada correctamente en PRODUCCIÓN' };
  } catch (error) {
    console.error('Error al ejecutar la migración en PRODUCCIÓN:', error);
    return { success: false, error: error.message };
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar la función principal
removeFacurapiEnvColumn()
  .then(result => {
    if (result.success) {
      console.log('✅ Operación completada con éxito en la base de datos de PRODUCCIÓN');
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
