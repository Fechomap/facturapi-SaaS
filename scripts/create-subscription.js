// scripts/create-subscription.js
import { prisma } from '../config/database.js';
import { initConfig } from '../config/index.js';

async function createSubscription() {
  try {
    // Inicializar configuración
    await initConfig();
    console.log('✅ Configuración inicializada');
    
    // Reemplaza esto con tu ID de tenant real
    const tenantId = '9281aaa0-5b7b-4b75-bae0-bd3486ee8f9d';
    
    // 1. Verificar si ya existe una suscripción
    const existingSubscription = await prisma.tenantSubscription.findFirst({
      where: { tenantId }
    });
    
    if (existingSubscription) {
      console.log('Ya existe una suscripción para este tenant:');
      console.log(existingSubscription);
      return;
    }
    
    // 2. Buscar un plan activo para asignar
    const plan = await prisma.subscriptionPlan.findFirst({
      where: { isActive: true }
    });
    
    if (!plan) {
      console.log('❌ No se encontró ningún plan activo. Creando uno default...');
      // Crear plan básico si no existe ninguno
      const newPlan = await prisma.subscriptionPlan.create({
        data: {
          name: 'Plan Básico',
          description: 'Plan básico para pruebas',
          price: 299.00,
          currency: 'MXN',
          billingPeriod: 'monthly',
          invoiceLimit: 100,
          isActive: true
        }
      });
      console.log('✅ Plan creado:', newPlan);
      plan = newPlan;
    }
    
    // 3. Calcular fechas para el período de prueba (14 días)
    const now = new Date();
    const trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);
    
    // 4. Crear la suscripción
    const subscription = await prisma.tenantSubscription.create({
      data: {
        tenantId,
        planId: plan.id,
        status: 'trial',
        trialEndsAt,
        currentPeriodStartsAt: now,
        currentPeriodEndsAt: trialEndsAt,
        invoicesUsed: 7 // Asignar el número real de facturas
      }
    });
    
    console.log('✅ Suscripción creada exitosamente:');
    console.log(subscription);
    
  } catch (error) {
    console.error('❌ Error al crear suscripción:', error);
  } finally {
    // Cerrar conexión a la base de datos
    await prisma.$disconnect();
  }
}

// Ejecutar el script
createSubscription()
  .then(() => console.log('Script completado'))
  .catch(err => console.error('Error no controlado:', err));