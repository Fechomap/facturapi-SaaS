// scripts/invoice-counter-test.js
import { prisma } from '../config/database.js';
import { initConfig } from '../config/index.js';

async function testInvoiceCounter() {
  try {
    // Inicializar configuración
    await initConfig();
    console.log('✅ Configuración inicializada');
    
    // Reemplaza esto con tu ID de tenant real
    const tenantId = '9281aaa0-5b7b-4b75-bae0-bd3486ee8f9d';
    
    // 1. Verificar cuántas facturas hay para este tenant
    const invoiceCount = await prisma.tenantInvoice.count({
      where: { tenantId }
    });
    console.log(`Número total de facturas para este tenant: ${invoiceCount}`);
    
    // 2. Verificar el estado actual del contador en la suscripción
    const subscription = await prisma.tenantSubscription.findFirst({
      where: {
        tenantId,
        OR: [
          { status: 'active' },
          { status: 'trial' }
        ]
      },
      select: {
        id: true,
        invoicesUsed: true,
        status: true
      }
    });
    
    if (!subscription) {
      console.log('❌ No se encontró una suscripción activa para este tenant');
      return;
    }
    
    console.log(`Estado actual de la suscripción:`);
    console.log(`- ID: ${subscription.id}`);
    console.log(`- Estado: ${subscription.status}`);
    console.log(`- Facturas usadas (contador): ${subscription.invoicesUsed}`);
    
    // 3. Actualizar el contador para que coincida con el número real de facturas
    if (subscription.invoicesUsed !== invoiceCount) {
      console.log(`⚠️ El contador no coincide con el número real de facturas.`);
      console.log(`Actualizando contador de ${subscription.invoicesUsed} a ${invoiceCount}...`);
      
      const updated = await prisma.tenantSubscription.update({
        where: { id: subscription.id },
        data: { invoicesUsed: invoiceCount }
      });
      
      console.log(`✅ Contador actualizado correctamente.`);
      console.log(`Nuevo valor: ${updated.invoicesUsed}`);
    } else {
      console.log(`✅ El contador coincide con el número real de facturas.`);
    }
    
    // 4. Probar incremento del contador
    console.log('\nProbando incremento del contador...');
    const incrementResult = await prisma.tenantSubscription.update({
      where: { id: subscription.id },
      data: {
        invoicesUsed: {
          increment: 1
        }
      }
    });
    
    console.log(`✅ Incremento de prueba realizado.`);
    console.log(`Valor anterior: ${subscription.invoicesUsed}`);
    console.log(`Nuevo valor: ${incrementResult.invoicesUsed}`);
    
    // 5. Revertir el incremento de prueba
    const revertResult = await prisma.tenantSubscription.update({
      where: { id: subscription.id },
      data: {
        invoicesUsed: invoiceCount
      }
    });
    
    console.log(`✅ Incremento de prueba revertido.`);
    console.log(`Valor final: ${revertResult.invoicesUsed}`);
    
    console.log('\n📋 Resumen del test:');
    console.log(`- Facturas totales en la base de datos: ${invoiceCount}`);
    console.log(`- Contador antes del test: ${subscription.invoicesUsed}`);
    console.log(`- Contador después del test: ${revertResult.invoicesUsed}`);
    
  } catch (error) {
    console.error('❌ Error en el test:', error);
  } finally {
    // Cerrar conexión a la base de datos
    await prisma.$disconnect();
  }
}

// Ejecutar el test
testInvoiceCounter()
  .then(() => console.log('Test completado'))
  .catch(err => console.error('Error no controlado en el test:', err));