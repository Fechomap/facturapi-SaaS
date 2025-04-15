// jobs/subscription.job.js - Jobs relacionados con suscripciones
import { prisma } from '../config/database.js';
import logger from '../core/utils/logger.js';
import NotificationService from '../services/notification.service.js';
// Import a conceptual MCP client/wrapper is needed here
// For example: import { callStripeMcpTool } from '../lib/mcpClient.js'; 
// Since I cannot directly implement the MCP client call, 
// I will assume 'callStripeMcpTool' exists and works as expected.
// In a real implementation, you'd use the actual mechanism 
// to communicate with the running MCP server process.

// Logger específico para jobs de suscripción
const subscriptionLogger = logger.child({ module: 'subscription-jobs' });

/**
 * Placeholder for calling the Stripe MCP tool.
 * In a real scenario, this would interact with the running MCP server.
 * @param {string} toolName - The name of the MCP tool (e.g., 'create_customer', 'create_payment_link').
 * @param {object} args - The arguments for the tool.
 * @returns {Promise<object>} - The result from the MCP tool.
 */
async function callStripeMcpTool(toolName, args) {
  subscriptionLogger.info({ toolName, args }, `Calling Stripe MCP tool: ${toolName}`);
  // This is a placeholder. Replace with actual MCP client implementation.
  // Example: Use axios, gRPC, or another method to call the MCP server endpoint/process.
  // Throwing an error here to indicate it needs implementation.
  // You would need to replace this with your actual MCP communication logic.
  
  // --- Mock Implementation (REMOVE IN PRODUCTION) ---
  if (toolName === 'create_customer') {
      // Ensure email is passed if available, Stripe uses it for matching
      const customerData = { id: `cus_mock_${Date.now()}`, object: 'customer', name: args.name };
      if (args.email) {
          customerData.email = args.email;
      }
      return customerData;
  }
  if (toolName === 'create_payment_link') {
      // Note: The real MCP tool might not support associating a customer directly.
      // The webhook needs to handle customer matching/creation robustly.
      // It only takes price and quantity per the known schema.
      return { id: `pl_mock_${Date.now()}`, object: 'payment_link', url: `https://mock-stripe-payment-link.com/${args.price}/${Date.now()}` };
  }
  // --- End Mock Implementation ---

  throw new Error(`MCP tool call not implemented in placeholder: ${toolName}`);
  // If implemented, it should return the actual response object from Stripe via MCP.
}

// Exportar la función dentro de un objeto para poder mockearla
const mcpUtils = {
  callStripeMcpTool
};

/**
 * Verifica suscripciones que están por expirar y envía notificaciones
 * @returns {Promise<void>}
 */
async function checkExpiringSubscriptions() {
  subscriptionLogger.info('Verificando suscripciones próximas a expirar');
  
  try {
    // Obtener fecha actual y fecha límite (3 días en el futuro)
    const now = new Date();
    const expiryLimit = new Date();
    expiryLimit.setDate(now.getDate() + 3); // 3 días antes de expirar
    
    // Buscar suscripciones próximas a expirar
    const expiringSubscriptions = await prisma.tenantSubscription.findMany({
      where: {
        OR: [
          // Suscripciones de prueba que están por expirar
          {
            status: 'trial',
            trialEndsAt: {
              gte: now,
              lte: expiryLimit
            }
          },
          // Suscripciones activas que están por expirar su período actual
          {
            status: 'active',
            currentPeriodEndsAt: {
              gte: now,
              lte: expiryLimit
            }
          }
        ],
        // Ensure we only notify once per relevant period if job runs often
        // notifiedExpiresSoon: false // Example: Add a flag if needed
      },
      include: {
        tenant: {
          include: {
            users: {
              where: {
                role: 'admin'
              }
            }
          }
        },
        plan: true
      }
    });
    
    subscriptionLogger.info(`Se encontraron ${expiringSubscriptions.length} suscripciones próximas a expirar`);
    
    // Procesar cada suscripción
    for (const subscription of expiringSubscriptions) {
      try {
        const tenant = subscription.tenant;
        const adminUsers = tenant.users;
        
        if (adminUsers.length === 0) {
          subscriptionLogger.warn(`No se encontraron usuarios admin para el tenant ${tenant.id}`);
          continue;
        }
        
        // Calcular días restantes
        const endDate = subscription.status === 'trial' ? subscription.trialEndsAt : subscription.currentPeriodEndsAt;
        // Ensure endDate is valid before calculation
        if (!endDate) {
            subscriptionLogger.warn({ subscriptionId: subscription.id }, 'Subscription end date is null, skipping notification.');
            continue;
        }
        const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        
        // Crear mensaje de notificación
        const message = `⚠️ *Alerta de Suscripción*\n\n` +
          `Tu ${subscription.status === 'trial' ? 'período de prueba' : 'suscripción'} para *${tenant.businessName}* ` +
          `expirará en *${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}*.\n\n` +
          `Plan actual: ${subscription.plan.name}\n` +
          `Fecha de expiración: ${endDate.toLocaleDateString()}\n\n` +
          `Prepara tu método de pago para continuar disfrutando del servicio sin interrupciones.`;
        
        // Enviar notificación a todos los administradores
        for (const admin of adminUsers) {
          await NotificationService.sendTelegramNotification(admin.telegramId.toString(), message); // Ensure telegramId is string
          subscriptionLogger.info(`Notificación de expiración próxima enviada a ${admin.telegramId} para tenant ${tenant.id}`);
        }
        
        // Optional: Mark subscription as notified to prevent duplicates
        // await prisma.tenantSubscription.update({ where: { id: subscription.id }, data: { notifiedExpiresSoon: true } });

      } catch (error) {
        subscriptionLogger.error(
          { error, tenantId: subscription.tenantId, subscriptionId: subscription.id },
          'Error al procesar notificación de suscripción próxima a expirar'
        );
      }
    }
    
    subscriptionLogger.info('Verificación de suscripciones próximas a expirar completada');
  } catch (error) {
    subscriptionLogger.error({ error }, 'Error general al verificar suscripciones próximas a expirar');
  }
}

/**
 * Encuentra suscripciones expiradas, genera link de pago y notifica.
 * @returns {Promise<void>}
 */
async function processExpiredSubscriptions() {
  subscriptionLogger.info('Procesando suscripciones expiradas para generar link de pago');
  const now = new Date();

  try {
    // 1. Encontrar suscripciones candidatas (trial expirado o active expirado) que AÚN NO están 'payment_pending'
    const candidates = await prisma.tenantSubscription.findMany({
      where: {
        OR: [
          {
            status: 'trial',
            trialEndsAt: { lt: now }
          },
          {
            status: 'active',
            currentPeriodEndsAt: { lt: now }
          }
        ],
        // Asegurarse de no procesar las que ya están pendientes de pago
        NOT: {
          status: 'payment_pending' 
        }
      },
      include: {
        tenant: { // Incluir tenant para obtener stripeCustomerId, email, name
          select: { 
            id: true, 
            stripeCustomerId: true, 
            email: true, 
            businessName: true,
            users: { // Incluir usuarios admin para notificar
              where: { role: 'admin' },
              select: { telegramId: true }
            }
          }
        },
        plan: { // Incluir plan para obtener stripePriceId
          select: { id: true, name: true, stripePriceId: true }
        }
      }
    });

    subscriptionLogger.info(`Se encontraron ${candidates.length} suscripciones expiradas para procesar.`);

    if (candidates.length === 0) {
      subscriptionLogger.info('No hay suscripciones expiradas nuevas para procesar.');
      return;
    }

    // 2. Procesar cada candidata
    for (const subscription of candidates) {
      const tenant = subscription.tenant;
      const plan = subscription.plan;
      const adminUsers = tenant.users;

      if (adminUsers.length === 0) {
        subscriptionLogger.warn({ tenantId: tenant.id, subscriptionId: subscription.id }, 'No se encontraron usuarios admin para notificar.');
        // Considerar si igual se debe actualizar el estado a payment_pending
        // await prisma.tenantSubscription.update({ where: { id: subscription.id }, data: { status: 'payment_pending' } });
        continue; 
      }

      // Usar el stripePriceId del plan o uno mock si no existe (para pruebas)
      const stripePriceIdToUse = plan.stripePriceId || 'price_mock_default';
      if (!plan.stripePriceId) {
          subscriptionLogger.warn({ tenantId: tenant.id, planId: plan.id }, 'Plan sin stripePriceId, usando mock: price_mock_default');
      }

      let stripeCustomerId = tenant.stripeCustomerId;

      try {
        // 3. Obtener/Crear Stripe Customer ID
        if (!stripeCustomerId) {
          subscriptionLogger.info({ tenantId: tenant.id }, 'Stripe Customer ID no encontrado, creando uno nuevo.');
          // Ensure email is provided if available, as Stripe uses it for matching/communication
          const customerArgs = {
            name: tenant.businessName,
            // Add email if it exists on the tenant model
            ...(tenant.email && { email: tenant.email }),
            // Podríamos añadir metadata útil aquí
            metadata: { tenant_id: tenant.id } 
          };
          // Remove email from args if it's null/undefined to avoid sending empty value
          if (!customerArgs.email) delete customerArgs.email; 

          const newStripeCustomer = await callStripeMcpTool('create_customer', customerArgs);
          stripeCustomerId = newStripeCustomer.id;
          
          // Guardar el nuevo ID en la base de datos
          await prisma.tenant.update({
            where: { id: tenant.id },
            data: { stripeCustomerId: stripeCustomerId }
          });
          subscriptionLogger.info({ tenantId: tenant.id, stripeCustomerId }, 'Stripe Customer ID creado y guardado.');
        }

        // 4. Crear Stripe Payment Link
        subscriptionLogger.info({ tenantId: tenant.id, priceId: stripePriceIdToUse }, 'Creando Stripe Payment Link.');
        // El schema del MCP tool 'create_payment_link' SÓLO acepta 'price' y 'quantity'.
        const paymentLinkArgs = {
            price: stripePriceIdToUse, // Usar el ID real o el mock
            quantity: 1
        };
        const paymentLink = await mcpUtils.callStripeMcpTool('create_payment_link', paymentLinkArgs); // Usar mcpUtils
        
        if (!paymentLink || !paymentLink.url) {
           throw new Error('No se pudo generar la URL del link de pago desde el MCP.');
        }
        subscriptionLogger.info({ tenantId: tenant.id, paymentLinkId: paymentLink.id }, 'Stripe Payment Link creado.');

        // 5. Actualizar estado de la suscripción en DB
        await prisma.tenantSubscription.update({
          where: { id: subscription.id },
          data: { status: 'payment_pending' }
        });
        subscriptionLogger.info({ tenantId: tenant.id, subscriptionId: subscription.id }, 'Estado de suscripción actualizado a payment_pending.');

        // 6. Enviar notificación con el link de pago
        const expirationType = subscription.trialEndsAt ? 'período de prueba' : 'suscripción';
        const message = `🚨 *Suscripción Vencida*\n\n` +
          `Tu ${expirationType} para *${tenant.businessName}* ha vencido.\n\n` +
          `Plan: ${plan.name}\n` +
          `Estado: Pago pendiente\n\n` +
          `Para reactivar tu servicio y continuar usándolo, por favor realiza tu pago a través del siguiente enlace:\n` +
          `${paymentLink.url}\n\n` +
          `Si tienes alguna duda, contáctanos.`;

        for (const admin of adminUsers) {
          await NotificationService.sendTelegramNotification(admin.telegramId.toString(), message);
          subscriptionLogger.info(`Notificación de pago pendiente con link enviada a ${admin.telegramId} para tenant ${tenant.id}`);
        }

      } catch (error) {
        subscriptionLogger.error(
          { error, tenantId: tenant.id, subscriptionId: subscription.id },
          'Error al procesar suscripción expirada (crear cliente/link, notificar)'
        );
        // Considerar si se debe reintentar o marcar la suscripción con error
      }
    }

    subscriptionLogger.info('Procesamiento de suscripciones expiradas completado.');

  } catch (error) {
    subscriptionLogger.error({ error }, 'Error general al procesar suscripciones expiradas');
  }
}


// Exportar las tareas programadas
export const subscriptionJobs = {
  // Diariamente a las 9:00 AM verificar suscripciones próximas a expirar
  checkExpiringSubscriptions: {
    schedule: '0 9 * * *', // Corre una vez al día a las 9:00 AM
    task: checkExpiringSubscriptions
  },
  
  // Cada hora procesar suscripciones expiradas para generar links de pago
  processExpiredSubscriptions: {
    schedule: '0 * * * *', // Corre al inicio de cada hora
    task: processExpiredSubscriptions 
  }
  // Se elimina la tarea original 'updateExpiredSubscriptions' ya que su lógica
  // se ha integrado y mejorado en 'processExpiredSubscriptions'.
};

// Exportar las funciones y el objeto mockeable
export { mcpUtils, processExpiredSubscriptions, checkExpiringSubscriptions };
