// Script simple para eliminar tenant específico
import prisma from './lib/prisma.js';

const TENANT_ID = '3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb';

async function deleteTenant() {
  console.log(`🔍 Verificando tenant: ${TENANT_ID}`);
  
  try {
    // Verificar que el tenant existe
    const tenant = await prisma.tenant.findUnique({
      where: { id: TENANT_ID },
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
      console.log(`❌ Tenant ${TENANT_ID} no encontrado`);
      return;
    }

    console.log(`📊 Datos del tenant encontrado:`);
    console.log(`  - Empresa: ${tenant.businessName}`);
    console.log(`  - RFC: ${tenant.rfc}`);
    console.log(`  - Email: ${tenant.email}`);
    console.log(`  - Usuarios: ${tenant.users.length}`);
    console.log(`  - Facturas: ${tenant.invoices.length}`);
    console.log(`  - Clientes: ${tenant.customers.length}`);
    console.log(`  - Suscripciones: ${tenant.subscriptions.length}`);
    console.log(`  - Folios: ${tenant.folios.length}`);
    console.log(`  - Configuraciones: ${tenant.settings.length}`);
    console.log(`  - Documentos: ${tenant.documents.length}`);
    console.log(`  - Pagos: ${tenant.payments.length}`);
    console.log(`  - Logs de auditoría: ${tenant.auditLogs.length}`);

    console.log(`\n🗑️ Eliminando tenant ${TENANT_ID}...`);
    
    // Gracias a CASCADE, solo necesitamos eliminar el tenant
    const result = await prisma.tenant.delete({
      where: { id: TENANT_ID }
    });

    console.log(`✅ Tenant eliminado exitosamente:`);
    console.log(`  - ID: ${result.id}`);
    console.log(`  - Empresa: ${result.businessName}`);
    console.log(`  - RFC: ${result.rfc}`);
    
    console.log(`\n🎯 Eliminación completada. Todos los registros relacionados fueron eliminados automáticamente por CASCADE.`);
    
  } catch (error) {
    console.error(`❌ Error al eliminar tenant:`, error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

deleteTenant()
  .then(() => {
    console.log('✅ Script completado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error en script:', error);
    process.exit(1);
  });