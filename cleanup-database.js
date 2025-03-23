// cleanup-database.js
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
  output: process.stdout
});

// Función para hacer preguntas
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function cleanupDatabase() {
  console.log('🧹 Script de limpieza de base de datos para Prisma');
  console.log('================================================');
  console.log(`Entorno: ${NODE_ENV}`);

  try {
    // Mostrar estadísticas antes de la limpieza
    const stats = await getDatabaseStats();
    console.log('\n📊 Estadísticas actuales de la base de datos:');
    displayStats(stats);

    // Opciones de limpieza
    console.log('\n🔄 Opciones de limpieza:');
    console.log('1. Limpieza completa (mantiene planes de suscripción)');
    console.log('2. Limpiar solo datos de facturas y clientes');
    console.log('3. Limpiar solo datos de tenants específicos (por ID)');
    console.log('4. Cancelar');
    
    const option = await question('\nSelecciona una opción (1-4): ');
    
    switch (option) {
      case '1':
        await fullCleanup();
        break;
      case '2':
        await cleanupInvoicesAndCustomers();
        break;
      case '3':
        await cleanupSpecificTenants();
        break;
      case '4':
      default:
        console.log('❌ Operación cancelada.');
        return;
    }
    
    // Mostrar estadísticas después de la limpieza
    console.log('\n📊 Estadísticas de la base de datos después de la limpieza:');
    const newStats = await getDatabaseStats();
    displayStats(newStats);
    
    console.log('\n✨ Limpieza completada exitosamente!');
    
  } catch (error) {
    console.error('❌ Error durante la limpieza:', error);
  } finally {
    // Cerrar la conexión a la base de datos y la interfaz de readline
    await prisma.$disconnect();
    rl.close();
  }
}

// Función para limpieza completa
async function fullCleanup() {
  // Pedir confirmación
  const answer = await question('\n⚠️ ¿Estás seguro de que deseas realizar una limpieza completa? (escribe "SI" para confirmar): ');
  
  if (answer.toUpperCase() !== 'SI') {
    console.log('❌ Operación cancelada por el usuario.');
    return;
  }

  console.log('\n🔄 Iniciando limpieza completa...');
  
  // Eliminar datos en orden para respetar las restricciones de claves foráneas
  
  // 1. Eliminar documentos
  const deletedDocuments = await prisma.tenantDocument.deleteMany({});
  console.log(`✅ Eliminados ${deletedDocuments.count} documentos`);
  
  // 2. Eliminar facturas
  const deletedInvoices = await prisma.tenantInvoice.deleteMany({});
  console.log(`✅ Eliminadas ${deletedInvoices.count} facturas`);
  
  // 3. Eliminar clientes
  const deletedCustomers = await prisma.tenantCustomer.deleteMany({});
  console.log(`✅ Eliminados ${deletedCustomers.count} clientes`);
  
  // 4. Eliminar pagos (manteniendo relación con suscripciones)
  const deletedPayments = await prisma.tenantPayment.deleteMany({});
  console.log(`✅ Eliminados ${deletedPayments.count} pagos`);
  
  // 5. Eliminar suscripciones de tenant (pero no los planes)
  const deletedSubscriptions = await prisma.tenantSubscription.deleteMany({});
  console.log(`✅ Eliminadas ${deletedSubscriptions.count} suscripciones`);
  
  // 6. Eliminar folios
  const deletedFolios = await prisma.tenantFolio.deleteMany({});
  console.log(`✅ Eliminados ${deletedFolios.count} folios`);
  
  // 7. Eliminar configuraciones
  const deletedSettings = await prisma.tenantSetting.deleteMany({});
  console.log(`✅ Eliminadas ${deletedSettings.count} configuraciones`);
  
  // 8. Eliminar logs de auditoría
  const deletedAuditLogs = await prisma.auditLog.deleteMany({});
  console.log(`✅ Eliminados ${deletedAuditLogs.count} registros de auditoría`);
  
  // 9. Eliminar sesiones de usuario
  const deletedSessions = await prisma.userSession.deleteMany({});
  console.log(`✅ Eliminadas ${deletedSessions.count} sesiones de usuario`);
  
  // 10. Eliminar usuarios de tenant
  const deletedUsers = await prisma.tenantUser.deleteMany({});
  console.log(`✅ Eliminados ${deletedUsers.count} usuarios`);
  
  // 11. Finalmente, eliminar tenants
  const deletedTenants = await prisma.tenant.deleteMany({});
  console.log(`✅ Eliminados ${deletedTenants.count} tenants`);
}

// Función para limpiar solo facturas y clientes
async function cleanupInvoicesAndCustomers() {
  // Pedir confirmación
  const answer = await question('\n⚠️ ¿Estás seguro de que deseas eliminar facturas y clientes? (escribe "SI" para confirmar): ');
  
  if (answer.toUpperCase() !== 'SI') {
    console.log('❌ Operación cancelada por el usuario.');
    return;
  }

  console.log('\n🔄 Iniciando limpieza de facturas y clientes...');
  
  // 1. Eliminar documentos
  const deletedDocuments = await prisma.tenantDocument.deleteMany({});
  console.log(`✅ Eliminados ${deletedDocuments.count} documentos`);
  
  // 2. Eliminar facturas
  const deletedInvoices = await prisma.tenantInvoice.deleteMany({});
  console.log(`✅ Eliminadas ${deletedInvoices.count} facturas`);
  
  // 3. Eliminar clientes
  const deletedCustomers = await prisma.tenantCustomer.deleteMany({});
  console.log(`✅ Eliminados ${deletedCustomers.count} clientes`);
}

// Función para limpiar tenants específicos
async function cleanupSpecificTenants() {
  const tenantId = await question('\nIngresa el ID del tenant a eliminar (o deja vacío para cancelar): ');
  
  if (!tenantId) {
    console.log('❌ Operación cancelada por el usuario.');
    return;
  }
  
  // Verificar si el tenant existe
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { businessName: true }
  });
  
  if (!tenant) {
    console.log(`❌ No se encontró ningún tenant con ID: ${tenantId}`);
    return;
  }
  
  // Pedir confirmación
  const answer = await question(`\n⚠️ ¿Estás seguro de que deseas eliminar el tenant "${tenant.businessName}" (${tenantId})? (escribe "SI" para confirmar): `);
  
  if (answer.toUpperCase() !== 'SI') {
    console.log('❌ Operación cancelada por el usuario.');
    return;
  }

  console.log(`\n🔄 Iniciando limpieza del tenant ${tenantId}...`);
  
  // Eliminar todos los datos asociados a este tenant
  
  // 1. Eliminar documentos
  const deletedDocuments = await prisma.tenantDocument.deleteMany({
    where: { tenantId }
  });
  console.log(`✅ Eliminados ${deletedDocuments.count} documentos`);
  
  // 2. Eliminar facturas
  const deletedInvoices = await prisma.tenantInvoice.deleteMany({
    where: { tenantId }
  });
  console.log(`✅ Eliminadas ${deletedInvoices.count} facturas`);
  
  // 3. Eliminar clientes
  const deletedCustomers = await prisma.tenantCustomer.deleteMany({
    where: { tenantId }
  });
  console.log(`✅ Eliminados ${deletedCustomers.count} clientes`);
  
  // 4. Eliminar folios
  const deletedFolios = await prisma.tenantFolio.deleteMany({
    where: { tenantId }
  });
  console.log(`✅ Eliminados ${deletedFolios.count} folios`);
  
  // 5. Eliminar configuraciones
  const deletedSettings = await prisma.tenantSetting.deleteMany({
    where: { tenantId }
  });
  console.log(`✅ Eliminadas ${deletedSettings.count} configuraciones`);
  
  // 6. Eliminar pagos
  const deletedPayments = await prisma.tenantPayment.deleteMany({
    where: { tenantId }
  });
  console.log(`✅ Eliminados ${deletedPayments.count} pagos`);
  
  // 7. Buscar usuarios asociados al tenant
  const users = await prisma.tenantUser.findMany({
    where: { tenantId },
    select: { telegramId: true }
  });
  
  // 8. Eliminar suscripciones
  const deletedSubscriptions = await prisma.tenantSubscription.deleteMany({
    where: { tenantId }
  });
  console.log(`✅ Eliminadas ${deletedSubscriptions.count} suscripciones`);
  
  // 9. Eliminar logs de auditoría
  const deletedAuditLogs = await prisma.auditLog.deleteMany({
    where: { tenantId }
  });
  console.log(`✅ Eliminados ${deletedAuditLogs.count} registros de auditoría`);
  
  // 10. Eliminar usuarios de tenant
  const deletedUsers = await prisma.tenantUser.deleteMany({
    where: { tenantId }
  });
  console.log(`✅ Eliminados ${deletedUsers.count} usuarios`);
  
  // 11. Eliminar sesiones de usuario de Telegram
  if (users.length > 0) {
    const telegramIds = users.map(user => user.telegramId);
    const deletedSessions = await prisma.userSession.deleteMany({
      where: {
        telegramId: {
          in: telegramIds
        }
      }
    });
    console.log(`✅ Eliminadas ${deletedSessions.count} sesiones de usuario`);
  }
  
  // 12. Finalmente, eliminar el tenant
  const deletedTenant = await prisma.tenant.delete({
    where: { id: tenantId }
  });
  console.log(`✅ Eliminado tenant: ${deletedTenant.businessName}`);
}

// Función para obtener estadísticas de la base de datos
async function getDatabaseStats() {
  return {
    tenants: await prisma.tenant.count(),
    users: await prisma.tenantUser.count(),
    invoices: await prisma.tenantInvoice.count(),
    customers: await prisma.tenantCustomer.count(),
    documents: await prisma.tenantDocument.count(),
    subscriptions: await prisma.tenantSubscription.count(),
    plans: await prisma.subscriptionPlan.count(),
    folios: await prisma.tenantFolio.count(),
    settings: await prisma.tenantSetting.count(),
    payments: await prisma.tenantPayment.count(),
    auditLogs: await prisma.auditLog.count(),
    sessions: await prisma.userSession.count()
  };
}

// Función para mostrar estadísticas
function displayStats(stats) {
  for (const [key, value] of Object.entries(stats)) {
    console.log(`  - ${key}: ${value}`);
  }
}

// Ejecutar función principal
cleanupDatabase();