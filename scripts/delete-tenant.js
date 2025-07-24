// Script para eliminar tenant específico de manera segura
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import readline from 'readline';

// Configuración de entorno
const NODE_ENV = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${NODE_ENV}` });

const prisma = new PrismaClient();

// Crear interfaz para preguntas en terminal
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Función para hacer preguntas
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function deleteTenant() {
  console.log('🗑️ Script de eliminación segura de tenant');
  console.log('==========================================');
  console.log(`Entorno: ${NODE_ENV}`);

  try {
    // Solicitar ID del tenant
    const tenantId = await question('\nIngresa el ID del tenant a eliminar: ');
    
    if (!tenantId || tenantId.trim() === '') {
      console.log('❌ ID de tenant requerido');
      return;
    }

    console.log(`\n🔍 Verificando tenant: ${tenantId}`);
    
    // Verificar que el tenant existe y obtener información completa
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        users: true,
        invoices: true,
        customers: true,
        subscriptions: true,
        folios: true,
        settings: true,
        documents: true,
        payments: true,
        auditLogs: true
      }
    });

    if (!tenant) {
      console.log(`❌ Tenant ${tenantId} no encontrado`);
      return;
    }

    // Mostrar información detallada del tenant
    console.log(`\n📊 Información del tenant encontrado:`);
    console.log(`  • Empresa: ${tenant.businessName}`);
    console.log(`  • RFC: ${tenant.rfc}`);
    console.log(`  • Email: ${tenant.email}`);
    console.log(`  • Usuarios: ${tenant.users.length}`);
    console.log(`  • Facturas: ${tenant.invoices.length}`);
    console.log(`  • Clientes: ${tenant.customers.length}`);
    console.log(`  • Suscripciones: ${tenant.subscriptions.length}`);
    console.log(`  • Folios: ${tenant.folios.length}`);
    console.log(`  • Configuraciones: ${tenant.settings.length}`);
    console.log(`  • Documentos: ${tenant.documents.length}`);
    console.log(`  • Pagos: ${tenant.payments.length}`);
    console.log(`  • Logs de auditoría: ${tenant.auditLogs.length}`);

    // Calcular total de registros que serán afectados
    const totalRecords = tenant.users.length + 
                        tenant.invoices.length + 
                        tenant.customers.length + 
                        tenant.subscriptions.length + 
                        tenant.folios.length + 
                        tenant.settings.length + 
                        tenant.documents.length + 
                        tenant.payments.length + 
                        tenant.auditLogs.length + 1; // +1 por el tenant mismo

    console.log(`\n⚠️ ADVERTENCIA: Esta operación eliminará PERMANENTEMENTE:`);
    console.log(`  • El tenant y TODOS sus ${totalRecords} registros relacionados`);
    console.log(`  • Esta acción NO se puede deshacer`);

    // Solicitar confirmación doble
    const confirmation1 = await question('\n¿Estás seguro de eliminar este tenant? (escribe "SI" para continuar): ');
    
    if (confirmation1.toUpperCase() !== 'SI') {
      console.log('❌ Operación cancelada por el usuario');
      return;
    }

    const confirmation2 = await question(`\n¿Confirmas eliminar "${tenant.businessName}" (${tenant.rfc})? (escribe "ELIMINAR" para confirmar): `);
    
    if (confirmation2.toUpperCase() !== 'ELIMINAR') {
      console.log('❌ Operación cancelada por el usuario');
      return;
    }

    console.log(`\n🗑️ Eliminando tenant ${tenantId}...`);
    
    // Gracias a las configuraciones CASCADE en el schema de Prisma,
    // solo necesitamos eliminar el tenant principal y todos los registros
    // relacionados se eliminarán automáticamente
    const deletedTenant = await prisma.tenant.delete({
      where: { id: tenantId }
    });

    console.log(`\n✅ Tenant eliminado exitosamente:`);
    console.log(`  • ID: ${deletedTenant.id}`);
    console.log(`  • Empresa: ${deletedTenant.businessName}`);
    console.log(`  • RFC: ${deletedTenant.rfc}`);
    
    console.log(`\n🎯 Eliminación completada exitosamente.`);
    console.log(`   Todos los registros relacionados fueron eliminados automáticamente por CASCADE.`);
    
  } catch (error) {
    console.error(`\n❌ Error durante la eliminación:`, error);
    
    if (error.code === 'P2025') {
      console.log('   El tenant no existe o ya fue eliminado.');
    } else if (error.code === 'P2003') {
      console.log('   Error de restricción de clave foránea.');
    } else {
      console.log('   Error inesperado durante la operación.');
    }
    
    throw error;
  } finally {
    await prisma.$disconnect();
    rl.close();
  }
}

// Ejecutar función principal con manejo de errores
deleteTenant()
  .then(() => {
    console.log('\n✅ Script completado exitosamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script terminado con errores:', error.message);
    process.exit(1);
  });