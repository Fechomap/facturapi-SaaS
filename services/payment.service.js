// services/payment.service.js
import Stripe from 'stripe';
import prisma from '../lib/prisma.js';

// Inicializar cliente de Stripe (configurado en variables de entorno)
let stripeClient = null;

/**
 * Inicializa el cliente de Stripe con la configuración adecuada
 * @param {string} secretKey - Clave secreta de Stripe
 */
function initializeStripe(secretKey) {
  if (!secretKey) {
    console.warn('No se ha proporcionado una clave secreta de Stripe');
    return null;
  }
  
  try {
    stripeClient = new Stripe(secretKey, {
      apiVersion: '2023-10-16',
    });
    return stripeClient;
  } catch (error) {
    console.error('Error al inicializar Stripe:', error);
    throw error;
  }
}

/**
 * Obtiene el cliente de Stripe, inicializándolo si es necesario
 * @param {string} secretKey - Clave secreta de Stripe (opcional)
 * @returns {Object} - Cliente de Stripe
 */
function getStripeClient(secretKey) {
  if (!stripeClient && secretKey) {
    return initializeStripe(secretKey);
  }
  
  if (!stripeClient) {
    throw new Error('Cliente de Stripe no inicializado. Proporcione una clave secreta.');
  }
  
  return stripeClient;
}

/**
 * Crea un cliente en Stripe
 * @param {string} email - Email del cliente
 * @param {string} name - Nombre del cliente
 * @param {Object} metadata - Metadatos asociados
 * @param {string} secretKey - Clave secreta (opcional)
 * @returns {Promise<Object>} - Cliente creado
 */
async function createCustomer(email, name, metadata, secretKey) {
  const stripe = getStripeClient(secretKey);
  
  return stripe.customers.create({
    email,
    name,
    metadata
  });
}

/**
 * Crea una suscripción en Stripe
 * @param {string} customerId - ID del cliente
 * @param {string} priceId - ID del precio/plan
 * @param {string} paymentMethodId - ID del método de pago (opcional)
 * @param {Object} metadata - Metadatos asociados
 * @param {string} secretKey - Clave secreta (opcional)
 * @returns {Promise<Object>} - Suscripción creada
 */
async function createSubscription(customerId, priceId, paymentMethodId, metadata, secretKey) {
  const stripe = getStripeClient(secretKey);
  
  const subscriptionData = {
    customer: customerId,
    items: [{ price: priceId }],
    expand: ['latest_invoice.payment_intent'],
    metadata
  };

  // Si se proporciona un método de pago, adjuntarlo al cliente
  if (paymentMethodId) {
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    // Establecer como método de pago predeterminado
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    subscriptionData.default_payment_method = paymentMethodId;
  }

  return stripe.subscriptions.create(subscriptionData);
}

/**
 * Actualiza una suscripción existente
 * @param {string} subscriptionId - ID de la suscripción
 * @param {Object} data - Datos a actualizar
 * @param {string} secretKey - Clave secreta (opcional)
 * @returns {Promise<Object>} - Suscripción actualizada
 */
async function updateSubscription(subscriptionId, data, secretKey) {
  const stripe = getStripeClient(secretKey);
  return stripe.subscriptions.update(subscriptionId, data);
}

/**
 * Cancela una suscripción
 * @param {string} subscriptionId - ID de la suscripción
 * @param {string} secretKey - Clave secreta (opcional)
 * @returns {Promise<Object>} - Suscripción cancelada
 */
async function cancelSubscription(subscriptionId, secretKey) {
  const stripe = getStripeClient(secretKey);
  return stripe.subscriptions.cancel(subscriptionId);
}

/**
 * Crea una sesión de checkout para suscripción
 * @param {string} customerId - ID del cliente (opcional)
 * @param {string} priceId - ID del precio/plan
 * @param {string} successUrl - URL de éxito
 * @param {string} cancelUrl - URL de cancelación
 * @param {Object} metadata - Metadatos asociados
 * @param {string} secretKey - Clave secreta (opcional)
 * @returns {Promise<Object>} - Sesión de checkout
 */
async function createSubscriptionCheckoutSession(
  customerId,
  priceId,
  successUrl,
  cancelUrl,
  metadata,
  secretKey
) {
  const stripe = getStripeClient(secretKey);
  
  const sessionData = {
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata
  };
  
  // Añadir cliente si se proporciona
  if (customerId) {
    sessionData.customer = customerId;
  }
  
  return stripe.checkout.sessions.create(sessionData);
}

/**
 * Crea una sesión del portal de clientes
 * @param {string} customerId - ID del cliente
 * @param {string} returnUrl - URL de retorno
 * @param {string} secretKey - Clave secreta (opcional)
 * @returns {Promise<Object>} - Sesión del portal
 */
async function createCustomerPortalSession(customerId, returnUrl, secretKey) {
  const stripe = getStripeClient(secretKey);
  
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl
  });
}

/**
 * Registra un pago en la base de datos
 * @param {string} tenantId - ID del tenant
 * @param {number} subscriptionId - ID de la suscripción
 * @param {string} stripePaymentId - ID del pago en Stripe
 * @param {string} stripeInvoiceId - ID de la factura en Stripe
 * @param {number} amount - Monto del pago
 * @param {string} currency - Moneda (por defecto 'MXN')
 * @param {string} paymentMethod - Método de pago
 * @param {string} status - Estado del pago
 * @returns {Promise<Object>} - Pago registrado
 */
async function savePayment(
  tenantId,
  subscriptionId,
  stripePaymentId,
  stripeInvoiceId,
  amount,
  currency = 'MXN',
  paymentMethod,
  status = 'succeeded'
) {
  return prisma.tenantPayment.create({
    data: {
      tenantId,
      subscriptionId,
      stripePaymentId,
      stripeInvoiceId,
      amount,
      currency,
      paymentMethod,
      status,
      paymentDate: new Date()
    }
  });
}

/**
 * Procesa un evento de webhook de Stripe
 * @param {Buffer|string} payload - Cuerpo del webhook
 * @param {string} signature - Firma del webhook
 * @param {string} webhookSecret - Secreto del webhook
 * @param {string} secretKey - Clave secreta (opcional)
 * @returns {Promise<Object>} - Resultado del procesamiento
 */
async function handleWebhookEvent(payload, signature, webhookSecret, secretKey) {
  const stripe = getStripeClient(secretKey);

  if (!webhookSecret) {
    throw new Error('Se requiere el secreto del webhook');
  }

  try {
    // Verificar y construir el evento
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret
    );

    // Manejar tipos de eventos específicos
    let result;
    
    switch (event.type) {
      case 'customer.subscription.created':
        result = await handleSubscriptionCreated(event.data.object);
        break;
      case 'customer.subscription.updated':
        result = await handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        result = await handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_succeeded':
        result = await handleInvoicePaymentSucceeded(event.data.object);
        break;
      case 'invoice.payment_failed':
        result = await handleInvoicePaymentFailed(event.data.object);
        break;
      default:
        console.log(`Evento no manejado: ${event.type}`);
        result = { handled: false, eventType: event.type };
    }

    return { 
      status: 'success', 
      message: 'Webhook procesado correctamente',
      result
    };
  } catch (err) {
    console.error(`Error al procesar webhook: ${err.message}`);
    throw err;
  }
}

/**
 * Maneja evento de creación de suscripción
 * @param {Object} subscription - Objeto de suscripción
 * @returns {Promise<Object>} - Resultado del manejo
 */
async function handleSubscriptionCreated(subscription) {
  // Obtener el tenantId desde los metadatos
  const tenantId = subscription.metadata?.tenantId;
  if (!tenantId) {
    console.error('No se encontró tenantId en los metadatos de la suscripción');
    return { success: false, error: 'TenantID no encontrado' };
  }

  // Buscar la suscripción en nuestra base de datos
  const dbSubscription = await prisma.tenantSubscription.findFirst({
    where: {
      tenantId,
      stripeSubscriptionId: subscription.id
    }
  });

  if (dbSubscription) {
    // Actualizar la suscripción existente
    await prisma.tenantSubscription.update({
      where: { id: dbSubscription.id },
      data: {
        status: mapStripeStatusToDbStatus(subscription.status),
        currentPeriodStartsAt: new Date(subscription.current_period_start * 1000),
        currentPeriodEndsAt: new Date(subscription.current_period_end * 1000),
        updatedAt: new Date()
      }
    });
    
    return { success: true, action: 'updated', subscriptionId: dbSubscription.id };
  } else {
    // Crear una nueva suscripción
    // Primero, determinar el planId - necesitamos buscar por precio
    const stripePriceId = subscription.items.data[0]?.price?.id;
    
    if (!stripePriceId) {
      console.error('No se pudo determinar el ID de precio de Stripe');
      return { success: false, error: 'Price ID no encontrado' };
    }
    
    // Buscar plan por precio
    const plan = await prisma.subscriptionPlan.findFirst({
      where: { stripePriceId }
    });
    
    if (!plan) {
      console.error(`No se encontró un plan para el precio de Stripe: ${stripePriceId}`);
      // Buscar el primer plan activo como fallback
      const fallbackPlan = await prisma.subscriptionPlan.findFirst({
        where: { isActive: true }
      });
      
      if (!fallbackPlan) {
        return { success: false, error: 'No se encontró un plan adecuado' };
      }
      
      const newSubscription = await prisma.tenantSubscription.create({
        data: {
          tenantId,
          planId: fallbackPlan.id,
          stripeCustomerId: subscription.customer,
          stripeSubscriptionId: subscription.id,
          status: mapStripeStatusToDbStatus(subscription.status),
          currentPeriodStartsAt: new Date(subscription.current_period_start * 1000),
          currentPeriodEndsAt: new Date(subscription.current_period_end * 1000),
          invoicesUsed: 0
        }
      });
      
      return { success: true, action: 'created_fallback', subscriptionId: newSubscription.id };
    }
    
    const newSubscription = await prisma.tenantSubscription.create({
      data: {
        tenantId,
        planId: plan.id,
        stripeCustomerId: subscription.customer,
        stripeSubscriptionId: subscription.id,
        status: mapStripeStatusToDbStatus(subscription.status),
        currentPeriodStartsAt: new Date(subscription.current_period_start * 1000),
        currentPeriodEndsAt: new Date(subscription.current_period_end * 1000),
        invoicesUsed: 0
      }
    });
    
    return { success: true, action: 'created', subscriptionId: newSubscription.id };
  }
}

/**
 * Maneja evento de actualización de suscripción
 * @param {Object} subscription - Objeto de suscripción
 * @returns {Promise<Object>} - Resultado del manejo
 */
async function handleSubscriptionUpdated(subscription) {
  const dbSubscription = await prisma.tenantSubscription.findFirst({
    where: {
      stripeSubscriptionId: subscription.id
    }
  });

  if (!dbSubscription) {
    console.error(`No se encontró la suscripción con ID ${subscription.id} en la base de datos`);
    return { success: false, error: 'Suscripción no encontrada' };
  }

  await prisma.tenantSubscription.update({
    where: { id: dbSubscription.id },
    data: {
      status: mapStripeStatusToDbStatus(subscription.status),
      currentPeriodStartsAt: new Date(subscription.current_period_start * 1000),
      currentPeriodEndsAt: new Date(subscription.current_period_end * 1000),
      updatedAt: new Date()
    }
  });
  
  return { success: true, action: 'updated', subscriptionId: dbSubscription.id };
}

/**
 * Maneja evento de eliminación de suscripción
 * @param {Object} subscription - Objeto de suscripción
 * @returns {Promise<Object>} - Resultado del manejo
 */
async function handleSubscriptionDeleted(subscription) {
  const dbSubscription = await prisma.tenantSubscription.findFirst({
    where: {
      stripeSubscriptionId: subscription.id
    }
  });

  if (!dbSubscription) {
    console.error(`No se encontró la suscripción con ID ${subscription.id} en la base de datos`);
    return { success: false, error: 'Suscripción no encontrada' };
  }

  // Actualizar a estado 'cancelled'
  await prisma.tenantSubscription.update({
    where: { id: dbSubscription.id },
    data: {
      status: 'cancelled',
      updatedAt: new Date()
    }
  });
  
  return { success: true, action: 'cancelled', subscriptionId: dbSubscription.id };
}

/**
 * Maneja evento de pago exitoso de factura
 * @param {Object} invoice - Objeto de factura de Stripe
 * @returns {Promise<Object>} - Resultado del manejo
 */
async function handleInvoicePaymentSucceeded(invoice) {
    // Verificar si esta factura está asociada a una suscripción
    if (!invoice.subscription) {
      console.log('Factura sin suscripción asociada, ignorando');
      return { success: true, action: 'ignored', reason: 'no_subscription' };
    }
  
    // Obtener la suscripción de nuestra base de datos
    const dbSubscription = await prisma.tenantSubscription.findFirst({
      where: {
        stripeSubscriptionId: invoice.subscription
      }
    });
  
    if (!dbSubscription) {
      console.error(`No se encontró la suscripción con ID ${invoice.subscription} en la base de datos`);
      return { success: false, error: 'Suscripción no encontrada' };
    }
  
    // Registrar el pago
    const payment = await savePayment(
      dbSubscription.tenantId,
      dbSubscription.id,
      invoice.payment_intent,
      invoice.id,
      invoice.amount_paid / 100, // Convertir de centavos a la moneda base
      invoice.currency.toUpperCase(),
      invoice.payment_method_details?.type || 'unknown',
      'succeeded'
    );
  
    // Si la suscripción estaba en estado 'payment_pending', actualizarla a 'active'
    if (dbSubscription.status === 'payment_pending') {
      await prisma.tenantSubscription.update({
        where: { id: dbSubscription.id },
        data: {
          status: 'active',
          updatedAt: new Date()
        }
      });
    }
    
    return { 
      success: true, 
      action: 'payment_recorded', 
      paymentId: payment.id,
      subscriptionUpdated: dbSubscription.status === 'payment_pending'
    };
}
  
/**
 * Maneja evento de pago fallido de factura
 * @param {Object} invoice - Objeto de factura de Stripe
 * @returns {Promise<Object>} - Resultado del manejo
 */
async function handleInvoicePaymentFailed(invoice) {
// Verificar si esta factura está asociada a una suscripción
if (!invoice.subscription) {
    console.log('Factura sin suscripción asociada, ignorando');
    return { success: true, action: 'ignored', reason: 'no_subscription' };
}

// Obtener la suscripción de nuestra base de datos
const dbSubscription = await prisma.tenantSubscription.findFirst({
    where: {
    stripeSubscriptionId: invoice.subscription
    }
});

if (!dbSubscription) {
    console.error(`No se encontró la suscripción con ID ${invoice.subscription} en la base de datos`);
    return { success: false, error: 'Suscripción no encontrada' };
}

// Registrar el intento de pago fallido
const payment = await savePayment(
    dbSubscription.tenantId,
    dbSubscription.id,
    invoice.payment_intent,
    invoice.id,
    invoice.amount_due / 100, // Convertir de centavos a la moneda base
    invoice.currency.toUpperCase(),
    invoice.payment_method_details?.type || 'unknown',
    'failed'
);

// Actualizar el estado de la suscripción a 'payment_pending'
await prisma.tenantSubscription.update({
    where: { id: dbSubscription.id },
    data: {
    status: 'payment_pending',
    updatedAt: new Date()
    }
});

return { 
    success: true, 
    action: 'payment_failed_recorded', 
    paymentId: payment.id,
    subscriptionUpdated: true
};
}

/**
 * Mapea el estado de Stripe a nuestro formato interno
 * @param {string} stripeStatus - Estado de suscripción en Stripe
 * @returns {string} - Estado en formato interno
 */
function mapStripeStatusToDbStatus(stripeStatus) {
switch (stripeStatus) {
    case 'active':
    return 'active';
    case 'past_due':
    return 'payment_pending';
    case 'unpaid':
    return 'suspended';
    case 'canceled':
    return 'cancelled';
    case 'trialing':
    return 'trial';
    default:
    return 'payment_pending';
}
}

export {
initializeStripe,
getStripeClient,
createCustomer,
createSubscription,
updateSubscription,
cancelSubscription,
createSubscriptionCheckoutSession,
createCustomerPortalSession,
savePayment,
handleWebhookEvent
};