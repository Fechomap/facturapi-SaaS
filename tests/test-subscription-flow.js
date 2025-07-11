// tests/test-subscription-flow.js
/**
 * Script de prueba para el flujo completo de suscripciones
 *
 * Este script simula:
 * 1. Creación de datos de prueba (tenant, plan, suscripción)
 * 2. Expiración de una suscripción de prueba
 * 3. Ejecución del cron job para procesar suscripciones expiradas
 * 4. Simulación de un evento de pago exitoso de Stripe
 * 5. Verificación del estado final de la suscripción
 * 6. Limpieza de datos de prueba
 */

import prisma from '../lib/prisma.js'; // Corregido: Importación por defecto
import logger from '../core/utils/logger.js';
import NotificationService from '../services/notification.service.js';
import { handleCheckoutSessionCompleted } from '../services/payment.service.js';

// Configurar logger específico para pruebas
const testLogger = logger.child({ module: 'subscription-test' });

// Mock para NotificationService para evitar enviar notificaciones reales
const originalSendTelegramNotification = NotificationService.sendTelegramNotification;
NotificationService.sendTelegramNotification = async (telegramId, message) => {
  testLogger.info({ telegramId, message }, 'MOCK: Notificación Telegram enviada');
  return { success: true, mock: true };
};

// Importar las funciones y el objeto mockeable del cron job
import { mcpUtils, processExpiredSubscriptions } from '../jobs/subscription.job.js';

// Guardar la implementación original
const originalCallStripeMcpTool = mcpUtils.callStripeMcpTool;

// Reemplazar con mock para pruebas
mcpUtils.callStripeMcpTool = async (toolName, args) => {
  testLogger.info({ toolName, args }, 'MOCK: Llamada a Stripe MCP Tool');

  if (toolName === 'create_customer') {
    return {
      id: `cus_mock_${Date.now()}`,
      object: 'customer',
      name: args.name,
      email: args.email || 'test@example.com',
    };
  }

  if (toolName === 'create_payment_link') {
    return {
      id: `pl_mock_${Date.now()}`,
      object: 'payment_link',
      url: `https://mock-stripe-payment-link.com/${args.price}/${Date.now()}`,
    };
  }

  throw new Error(`Mock no implementado para: ${toolName}`);
};

/**
 * Función principal de prueba
 */
async function testSubscriptionFlow() {
  let tenant = null;
  let subscription = null;
  let plan = null;

  try {
    testLogger.info('Iniciando prueba de flujo de suscripción');

    // Paso 1: Obtener o crear un plan de suscripción
    testLogger.info('Buscando plan de suscripción existente...');
    plan = await prisma.subscriptionPlan.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' }, // Asegurar que siempre obtengamos el mismo plan si hay varios
    });

    if (!plan) {
      testLogger.info('No se encontró plan activo, creando uno nuevo...');
      plan = await prisma.subscriptionPlan.create({
        data: {
          name: 'Plan de Prueba',
          description: 'Plan creado para pruebas',
          price: 599.0,
          currency: 'MXN',
          billingPeriod: 'monthly',
          invoiceLimit: 100,
          isActive: true,
          stripeProductId: 'prod_mock_test',
          stripePriceId: 'price_mock_test',
        },
      });
    } else if (!plan.stripePriceId) {
      // Si el plan existe pero no tiene stripePriceId, asignamos uno mock para la prueba
      testLogger.warn(
        { planId: plan.id },
        'El plan existente no tiene stripePriceId. Asignando uno mock para la prueba.'
      );
      plan.stripePriceId = 'price_mock_test_existing';
    }

    testLogger.info(
      { planId: plan.id, planName: plan.name, stripePriceId: plan.stripePriceId },
      'Plan de suscripción listo'
    );

    // Paso 2: Crear tenant de prueba
    const testRFC = `TEST${Date.now().toString().substring(0, 10)}`;
    testLogger.info({ rfc: testRFC }, 'Creando tenant de prueba...');

    tenant = await prisma.tenant.create({
      data: {
        businessName: 'Empresa de Prueba',
        rfc: testRFC,
        email: 'test@example.com',
        phone: '5555555555',
        contactName: 'Usuario de Prueba',
        isActive: true,
      },
    });

    testLogger.info({ tenantId: tenant.id }, 'Tenant de prueba creado');

    // Paso 3: Crear usuario admin para el tenant
    testLogger.info('Creando usuario admin para el tenant...');
    const user = await prisma.tenantUser.create({
      data: {
        tenantId: tenant.id,
        telegramId: 123456789, // ID de Telegram ficticio
        firstName: 'Admin',
        lastName: 'Prueba',
        username: 'admin_test',
        role: 'admin',
        isAuthorized: true,
      },
    });

    testLogger.info({ userId: user.id, telegramId: user.telegramId }, 'Usuario admin creado');

    // Paso 4: Crear suscripción expirada
    testLogger.info('Creando suscripción expirada...');

    // Fecha de hace 1 día para simular que ya expiró
    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 1);

    subscription = await prisma.tenantSubscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: 'trial', // Empezamos con estado trial expirado
        trialEndsAt: expiredDate,
        invoicesUsed: 0,
      },
    });

    testLogger.info(
      {
        subscriptionId: subscription.id,
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
      },
      'Suscripción expirada creada'
    );

    // Paso 5: Ejecutar el cron job para procesar suscripciones expiradas
    testLogger.info('Ejecutando processExpiredSubscriptions...');
    await processExpiredSubscriptions(); // Usar la función importada directamente

    // Paso 6: Verificar que la suscripción cambió a payment_pending
    const updatedSubscription = await prisma.tenantSubscription.findUnique({
      where: { id: subscription.id },
    });

    testLogger.info(
      {
        prevStatus: subscription.status,
        newStatus: updatedSubscription.status,
      },
      'Estado de suscripción actualizado'
    );

    if (updatedSubscription.status !== 'payment_pending') {
      throw new Error(
        `La suscripción no cambió a payment_pending, estado actual: ${updatedSubscription.status}`
      );
    }

    // Paso 7: Simular evento de checkout.session.completed de Stripe
    testLogger.info('Simulando evento checkout.session.completed de Stripe...');

    // Refrescar los datos del tenant para obtener el stripeCustomerId asignado por el job
    const refreshedTenant = await prisma.tenant.findUnique({
      where: { id: tenant.id },
    });
    if (!refreshedTenant || !refreshedTenant.stripeCustomerId) {
      throw new Error(
        `No se pudo obtener el stripeCustomerId para el tenant ${tenant.id} después del job.`
      );
    }

    // Crear un objeto de sesión simulado usando el ID de cliente correcto
    const mockSession = {
      id: `cs_test_${Date.now()}`,
      customer: refreshedTenant.stripeCustomerId, // Usar el ID de cliente actualizado
      payment_status: 'paid',
      amount_total: Number(plan.price) * 100, // Convertir a centavos
      currency: plan.currency.toLowerCase(),
      payment_intent: `pi_mock_${Date.now()}`,
      subscription: `sub_mock_${Date.now()}`, // ID de suscripción ficticio
    };

    // Procesar el evento simulado
    const webhookResult = await handleCheckoutSessionCompleted(mockSession);

    testLogger.info({ webhookResult }, 'Resultado del procesamiento del webhook');

    // Paso 8: Verificar estado final de la suscripción
    const finalSubscription = await prisma.tenantSubscription.findUnique({
      where: { id: subscription.id },
      include: { payments: true },
    });

    testLogger.info(
      {
        id: finalSubscription.id,
        status: finalSubscription.status,
        startDate: finalSubscription.currentPeriodStartsAt,
        endDate: finalSubscription.currentPeriodEndsAt,
        paymentsCount: finalSubscription.payments.length,
      },
      'Estado final de la suscripción'
    );

    // Verificar que la suscripción está activa
    if (finalSubscription.status !== 'active') {
      throw new Error(
        `La suscripción no se activó correctamente, estado actual: ${finalSubscription.status}`
      );
    }

    // Verificar que se registró el pago
    if (finalSubscription.payments.length === 0) {
      throw new Error('No se registró ningún pago para la suscripción');
    }

    // Verificar que las fechas de período se establecieron correctamente
    if (!finalSubscription.currentPeriodStartsAt || !finalSubscription.currentPeriodEndsAt) {
      throw new Error('Las fechas de período no se establecieron correctamente');
    }

    testLogger.info('✅ Prueba completada exitosamente');
  } catch (error) {
    testLogger.error({ error: error.message, stack: error.stack }, '❌ Error en la prueba');
    throw error;
  } finally {
    // Paso 9: Limpieza - Eliminar datos de prueba
    testLogger.info('Limpiando datos de prueba...');

    try {
      // Eliminar en orden para respetar restricciones de clave foránea
      if (subscription) {
        // Eliminar pagos asociados primero
        await prisma.tenantPayment.deleteMany({
          where: { subscriptionId: subscription.id },
        });

        // Luego eliminar la suscripción
        await prisma.tenantSubscription.delete({
          where: { id: subscription.id },
        });
      }

      if (tenant) {
        // Eliminar usuarios asociados
        await prisma.tenantUser.deleteMany({
          where: { tenantId: tenant.id },
        });

        // Luego eliminar el tenant
        await prisma.tenant.delete({
          where: { id: tenant.id },
        });
      }

      testLogger.info('Datos de prueba eliminados correctamente');
    } catch (cleanupError) {
      testLogger.error({ error: cleanupError.message }, 'Error al limpiar datos de prueba');
    }

    // Restaurar funciones originales
    NotificationService.sendTelegramNotification = originalSendTelegramNotification;
    mcpUtils.callStripeMcpTool = originalCallStripeMcpTool; // Restaurar desde el objeto

    // Desconectar Prisma
    await prisma.$disconnect();
  }
}

// Ejecutar la prueba
testSubscriptionFlow()
  .then(() => {
    console.log('\n✨ Prueba de flujo de suscripción completada');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Prueba fallida:', error);
    process.exit(1);
  });
