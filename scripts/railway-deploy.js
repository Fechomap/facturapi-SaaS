// Script para ejecutar migraciones de Prisma de forma segura en Railway
import { execSync } from 'child_process';

console.log('🚂 Iniciando script de despliegue para Railway...');

try {
  // Verificar si tenemos acceso a la base de datos
  if (!process.env.DATABASE_URL) {
    console.log('⚠️ No se encontró DATABASE_URL. Generando cliente de Prisma sin migraciones.');
    // Solo generamos el cliente sin ejecutar migraciones
    execSync('npx prisma generate', { stdio: 'inherit' });
  } else {
    console.log('✅ DATABASE_URL encontrado. Ejecutando migraciones y generando cliente...');
    // Ejecutamos las migraciones y generamos el cliente
    execSync('npx prisma migrate deploy && npx prisma generate', { stdio: 'inherit' });
    
    // Inicializar la base de datos con datos de suscripción
    console.log('🔄 Inicializando datos de suscripción...');
    try {
      execSync('node scripts/init-railway-db.js', { stdio: 'inherit' });
      console.log('✅ Datos de suscripción inicializados correctamente.');
    } catch (initError) {
      console.error('⚠️ No se pudieron inicializar los datos de suscripción:', initError.message);
      // No fallamos el despliegue si la inicialización falla
    }
  }
  
  console.log('🎉 Proceso de despliegue completado con éxito.');
} catch (error) {
  console.error('❌ Error durante el despliegue:', error.message);
  process.exit(1);
}
