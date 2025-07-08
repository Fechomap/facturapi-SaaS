// services/payment.service.js
import Stripe from 'stripe';
import prisma from '../lib/prisma.js';
import logger from '../core/utils/logger.js'; // Added logger
import NotificationService from './notification.service.js'; // Added for notifications

// Logger específico para payment service
const paymentLogger = logger.child({ module: 'payment-service' });


// Inicializar cliente de Stripe (configurado en variables de entorno)
let stripeClient = null;

/**
 * Inicializa el cliente de Stripe con la configuración adecuada
 * @param {string} secretKey - Clave secreta de Stripe
 */
function initializeStripe(secretKey) {
  if (!secretKey) {
    paymentLogger.warn('No se ha proporcionado una clave secreta de Stripe');
    return null;
  }
  
  try {
    // Check if already initialized with the same key potentially
    if (stripeClient && stripeClient.key === secretKey) {
        return stripeClient;
    }
    stripeClient = new Stripe(secretKey, {
      apiVersion: '2023-10-16', // Use a recent, fixed API version
    });
    paymentLogger.info('Cliente de Stripe inicializado correctamente.');
    return stripeClient;
  } catch (error) {
    paymentLogger.error({ error }, 'Error al inicializar Stripe');
    throw error;
  }
}

/**
 * Obtiene el cliente de Stripe, inicializándolo si es necesario
 * @param {string} secretKey - Clave secreta de Stripe (opcional)
 * @returns {Stripe} - Cliente de Stripe
 */
function getStripeClient(secretKey) {
  if (!stripeClient && secretKey) {
    return initializeStripe(secretKey);
  }
  
  if (!stripeClient) {
    paymentLogger.error('Cliente de Stripe no inicializado. Proporcione una clave secreta.');
    throw new Error('Cliente de Stripe no inicializado.');
  }
  
  return stripeClient;
}

// --- Funciones existentes (createCustomer, createSubscription, etc.) sin cambios ---
// ... (Se omiten las funciones existentes para brevedad, se asume que están aquí) ...
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
  paymentLogger.info({ email, name }, 'Creando cliente en Stripe');
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
  paymentLogger.info({ customerId, priceId }, 'Creando suscripción en Stripe');
  
  const subscriptionData = {
    customer: customerId,
    items: [{ price: priceId }],
    expand: ['latest_invoice.payment_intent'],
    metadata
  };

  // Si se proporciona un método de pago, adjuntarlo al cliente
  if (paymentMethodId) {
    paymentLogger.info({ customerId, paymentMethodId }, 'Adjuntando método de pago a cliente');
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    // Establecer como método de pago predeterminado
    paymentLogger.info({ customerId }, 'Estableciendo método de pago predeterminado');
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
  paymentLogger.info({ subscriptionId }, 'Actualizando suscripción en Stripe');
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
  paymentLogger.info({ subscriptionId }, 'Cancelando suscripción en Stripe');
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
  paymentLogger.info({ customerId, priceId }, 'Creando sesión de checkout de suscripción');
  
  const sessionData = {
    payment_method_types: ['card'], // Considerar añadir 'oxxo' si es relevante en MX
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
  } else {
    // Permitir creación de cliente si no se proporciona ID
    sessionData.customer_creation = 'if_required'; 
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
  paymentLogger.info({ customerId }, 'Creando sesión del portal de clientes');
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl
  });
}

/**
 * Registra un pago en la base de datos
 * @param {string} tenantId - ID del tenant
 * @param {number} subscriptionId - ID de la suscripción
 * @param {string} stripePaymentId - ID del pago en Stripe (PaymentIntent ID)
 * @param {string} stripeInvoiceId - ID de la factura en Stripe (puede ser null para checkout)
 * @param {number} amount - Monto del pago (en la unidad base, ej. 599.00)
 * @param {string} currency - Moneda (por defecto 'MXN')
 * @param {string} paymentMethod - Método de pago (ej. 'card')
 * @param {string} status - Estado del pago ('succeeded', 'failed', etc.)
 * @returns {Promise<Object>} - Pago registrado
 */
async function savePayment(
  tenantId,
  subscriptionId,
  stripePaymentId,
  stripeInvoiceId, // Puede ser null si el pago viene de Checkout y no de una Invoice directa
  amount,
  currency = 'MXN',
  paymentMethod,
  status = 'succeeded'
) {
  paymentLogger.info({ tenantId, subscriptionId, stripePaymentId, status }, 'Guardando registro de pago');
  // Ensure amount is a number before saving
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(numericAmount)) {
      paymentLogger.error({ amount }, 'Invalid amount provided for payment record');
      throw new Error('Invalid amount for payment record');
  }

  return prisma.tenantPayment.create({
    data: {
      tenantId,
      subscriptionId,
      stripePaymentId,
      stripeInvoiceId, // Permitir null
      amount: numericAmount, // Usar el valor numérico
      currency: currency.toUpperCase(),
      paymentMethod,
      status,
      paymentDate: new Date()
    }
  });
}

/**
 * Calcula la fecha de fin del período de suscripción según la lógica especial.
 * @param {Date} startDate - La fecha de inicio del período (fecha de pago).
 * @returns {Date} - La fecha de fin del período calculada.
 */
function calculateNextBillingDate(startDate) {
    const paymentDate = startDate.getDate();
    const nextBillingDate = new Date(startDate);

    // Avanzar un mes
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

    // Lógica especial para días 28-31
    if (paymentDate >= 28) {
        // Establecer al día 1 del mes siguiente al calculado
        nextBillingDate.setDate(1);
        // Si el mes original era diciembre, el cálculo anterior ya pasó a enero del siguiente año.
        // Si no, necesitamos asegurarnos de que el mes también avance si caemos en febrero, etc.
        // La línea `nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);` ya lo hizo.
        // Solo necesitamos ajustar el día a 1.
    } else {
        // Para días 1-27, simplemente mantenemos el día del mes siguiente.
        // `setMonth` maneja correctamente los desbordamientos (ej. 31 de marzo + 1 mes = 30 de abril)
        // Pero si el mes siguiente es más corto (ej. pagar 31 enero -> ¿28/29 feb?), setMonth puede ajustar.
        // Para asegurar el mismo día (si existe), podemos hacer:
        // nextBillingDate.setDate(paymentDate); // Esto podría fallar si el día no existe.
        // Es más seguro dejar que setMonth haga su trabajo y luego aplicar la regla 28-31.
        // La lógica actual ya cubre esto: si pagas el 30 de enero, nextBillingDate será ~2 de marzo (ajustado por setMonth),
        // pero como paymentDate (30) >= 28, se ajustará al 1 de marzo. Correcto.
        // Si pagas el 15 de enero, nextBillingDate será 15 de febrero. Correcto.
    }
    paymentLogger.info({ startDate: startDate.toISOString(), paymentDay: paymentDate, calculatedEndDate: nextBillingDate.toISOString() }, 'Calculando fecha de próximo cobro');
    return nextBillingDate;
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
    paymentLogger.error('Secreto del webhook no configurado');
    throw new Error('Se requiere el secreto del webhook');
  }

  let event;
  try {
    // Verificar y construir el evento
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret
    );
    paymentLogger.info({ eventType: event.type, eventId: event.id }, 'Evento de Stripe recibido y verificado');

  } catch (err) {
    paymentLogger.error({ error: err.message }, `Error al verificar firma del webhook`);
    // Devolver un error específico para que el controlador sepa que fue un fallo de firma
    err.type = 'StripeSignatureVerificationError'; 
    throw err;
  }

  // Manejar tipos de eventos específicos
  let result;
  
  try {
      switch (event.type) {
        case 'checkout.session.completed': // Evento clave para Payment Links
          result = await handleCheckoutSessionCompleted(event.data.object);
          break;
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
          // Este evento también puede ocurrir para el primer pago de una suscripción creada por Payment Link
          // O para renovaciones automáticas.
          result = await handleInvoicePaymentSucceeded(event.data.object);
          break;
        case 'invoice.payment_failed':
          result = await handleInvoicePaymentFailed(event.data.object);
          break;
        default:
          paymentLogger.info(`Evento no manejado explícitamente: ${event.type}`);
          result = { handled: false, eventType: event.type, action: 'ignored' };
      }
      
      // Asegurarse de que result siempre tenga eventType para consistencia
      if (result && !result.eventType) {
          result.eventType = event.type;
      }
      
      paymentLogger.info({ eventType: event.type, result }, 'Procesamiento de evento completado');
      return { 
        status: 'success', 
        message: 'Webhook procesado correctamente',
        result // Contiene { success, action, details, notifyAdmins, etc. }
      };

  } catch (processingError) {
      paymentLogger.error({ error: processingError.message, eventType: event.type, eventId: event.id }, 'Error al procesar evento de webhook');
      // Lanzar el error para que el controlador lo capture
      throw processingError; 
  }
}

/**
 * Maneja el evento checkout.session.completed.
 * @param {Object} session - El objeto Checkout Session de Stripe.
 * @returns {Promise<Object>} - Resultado del manejo.
 */
async function handleCheckoutSessionCompleted(session) {
    paymentLogger.info({ sessionId: session.id, customerId: session.customer, subscriptionId: session.subscription }, 'Procesando checkout.session.completed');

    // 1. Verificar si el pago fue exitoso
    if (session.payment_status !== 'paid') {
        paymentLogger.warn({ sessionId: session.id, payment_status: session.payment_status }, 'Checkout session no tuvo pago exitoso, ignorando.');
        return { success: true, action: 'ignored', reason: 'payment_not_paid' };
    }

    // 2. Obtener ID de cliente de Stripe
    const stripeCustomerId = session.customer;
    if (!stripeCustomerId) {
        paymentLogger.error({ sessionId: session.id }, 'No se encontró Stripe Customer ID en la sesión de checkout.');
        // Esto no debería pasar si el cron job crea el cliente antes del link.
        return { success: false, error: 'Customer ID faltante en la sesión' };
    }

    // 3. Encontrar nuestro Tenant usando el Stripe Customer ID
    // Usamos findFirst en lugar de findUnique porque stripeCustomerId no tiene @unique en el schema
    const tenant = await prisma.tenant.findFirst({
        where: { stripeCustomerId: stripeCustomerId },
    });

    if (!tenant) {
        paymentLogger.error({ stripeCustomerId, sessionId: session.id }, 'No se encontró un Tenant para el Stripe Customer ID.');
        // Podríamos intentar buscar por email si está en la sesión, como fallback.
        return { success: false, error: 'Tenant no encontrado' };
    }
    paymentLogger.info({ tenantId: tenant.id }, 'Tenant encontrado');

    // 4. Encontrar la suscripción del Tenant que está esperando pago
    // Asumimos que solo una suscripción debería estar en 'payment_pending' para este tenant.
    const dbSubscription = await prisma.tenantSubscription.findFirst({
        where: {
            tenantId: tenant.id,
            status: 'payment_pending',
        },
        include: { plan: true } // Incluir plan para verificar precio
    });

    if (!dbSubscription) {
        paymentLogger.warn({ tenantId: tenant.id, stripeCustomerId }, 'No se encontró una suscripción en payment_pending para este tenant. ¿Quizás ya se procesó o es un pago inesperado?');
        // Podría ser una renovación procesada por 'invoice.payment_succeeded' si el link creó una suscripción.
        // O podría ser un pago único si el Price no era recurrente.
        // Verificar si existe una suscripción activa reciente podría ser una opción.
        const activeSub = await prisma.tenantSubscription.findFirst({
            where: { tenantId: tenant.id, status: 'active' },
            orderBy: { updatedAt: 'desc' }
        });
        if (activeSub && (new Date().getTime() - activeSub.updatedAt.getTime()) < 5 * 60 * 1000) { // 5 minutos margen
             paymentLogger.info('Se encontró una suscripción activa recientemente actualizada, asumiendo que este evento ya fue procesado.');
             return { success: true, action: 'ignored', reason: 'already_processed_likely' };
        }
        
        return { success: true, action: 'ignored', reason: 'no_pending_subscription_found' };
    }
    paymentLogger.info({ subscriptionId: dbSubscription.id }, 'Suscripción pendiente encontrada');

    // 5. (Opcional) Verificar monto y moneda
    const expectedAmount = Number(dbSubscription.plan.price) * 100; // Convertir Decimal a centavos
    const expectedCurrency = dbSubscription.plan.currency.toLowerCase();
    if (session.amount_total !== expectedAmount || session.currency !== expectedCurrency) {
        paymentLogger.error({
            sessionId: session.id,
            expectedAmount, gotAmount: session.amount_total,
            expectedCurrency, gotCurrency: session.currency
        }, 'Discrepancia en el monto/moneda del pago.');
        // Decidir si continuar o fallar. Por ahora, continuamos pero logueamos el error.
        // return { success: false, error: 'Discrepancia en monto/moneda' };
    }

    // 6. Calcular nuevas fechas de período
    const paymentDate = new Date(); // Usar fecha actual como inicio
    const nextBillingDate = calculateNextBillingDate(paymentDate);

    // 7. Actualizar la suscripción en la base de datos
    await prisma.tenantSubscription.update({
        where: { id: dbSubscription.id },
        data: {
            status: 'active',
            stripeSubscriptionId: session.subscription || dbSubscription.stripeSubscriptionId, // Guardar ID si el link creó una suscripción
            currentPeriodStartsAt: paymentDate,
            currentPeriodEndsAt: nextBillingDate,
            updatedAt: new Date(),
        },
    });
    paymentLogger.info({ subscriptionId: dbSubscription.id }, 'Suscripción actualizada a activa con nuevas fechas.');

    // 8. Registrar el pago
    // Necesitamos el Payment Intent ID y el método de pago.
    // A veces están directamente en la sesión, otras veces hay que recuperarlo.
    const paymentIntentId = session.payment_intent;
    const paymentMethodDetails = { type: 'unknown', brand: 'unknown' }; // Default values
    let paymentMethodType = 'unknown';

    if (paymentIntentId) {
        try {
            const stripe = getStripeClient(); // Asume que ya está inicializado
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['payment_method'] });
            paymentMethodType = paymentIntent.payment_method?.type || 'unknown';
            if (paymentIntent.payment_method?.card) {
                 paymentMethodDetails.brand = paymentIntent.payment_method.card.brand;
            }
             paymentLogger.info({ paymentIntentId }, 'Payment Intent recuperado');
        } catch (piError) {
            paymentLogger.warn({ error: piError.message, paymentIntentId }, 'No se pudo recuperar el Payment Intent, usando datos limitados.');
        }
    } else {
         paymentLogger.warn({ sessionId: session.id }, 'No se encontró Payment Intent ID en la sesión.');
         // Intentar obtener tipo de método de pago de la sesión si está disponible
         paymentMethodType = session.payment_method_types?.[0] || 'unknown';
    }

    const payment = await savePayment(
        tenant.id,
        dbSubscription.id,
        paymentIntentId, // ID del Payment Intent (puede ser null)
        session.invoice, // ID de la factura (puede ser null en checkout)
        session.amount_total / 100, // Monto en unidad base
        session.currency,
        paymentMethodDetails.brand || paymentMethodType, // Método de pago (ej. 'visa' o 'card')
        'succeeded'
    );
    paymentLogger.info({ paymentId: payment.id }, 'Pago registrado en la base de datos.');

    // 9. (Opcional) Enviar notificación de éxito al usuario/admin
     try {
        const adminUsers = await prisma.tenantUser.findMany({
            where: { tenantId: tenant.id, role: 'admin' },
            select: { telegramId: true }
        });
        const successMessage = `✅ *¡Pago Confirmado!*\n\n` +
            `Gracias por tu pago. Tu suscripción para *${tenant.businessName}* ha sido activada.\n\n` +
            `Próxima fecha de renovación: ${nextBillingDate.toLocaleDateString()}\n` +
            `Monto: $${(session.amount_total / 100).toFixed(2)} ${session.currency.toUpperCase()}`;
        
        for (const admin of adminUsers) {
            // Ensure telegramId is a string if the service expects it
            await NotificationService.sendTelegramNotification(admin.telegramId.toString(), successMessage);
        }
        paymentLogger.info({ tenantId: tenant.id }, 'Notificación de pago exitoso enviada.');
     } catch (notifyError) {
         paymentLogger.warn({ error: notifyError.message, tenantId: tenant.id }, 'Error al enviar notificación de pago exitoso.');
     }


    return {
        success: true,
        action: 'subscription_activated',
        tenantId: tenant.id,
        subscriptionId: dbSubscription.id,
        paymentId: payment.id,
        notifyAdmins: true, // Indicar al controlador que notifique (opcional)
        details: `Suscripción activada hasta ${nextBillingDate.toISOString()}`
    };
}


/**
 * Maneja evento de creación de suscripción
 * @param {Object} subscription - Objeto de suscripción
 * @returns {Promise<Object>} - Resultado del manejo
 */
async function handleSubscriptionCreated(subscription) {
  paymentLogger.info({ subscriptionId: subscription.id, customerId: subscription.customer }, 'Procesando customer.subscription.created');
  // Obtener el tenantId desde los metadatos o buscando por customerId
  let tenantId = subscription.metadata?.tenantId;
  let tenant;

  if (!tenantId && subscription.customer) {
      tenant = await prisma.tenant.findUnique({ where: { stripeCustomerId: subscription.customer } });
      if (tenant) tenantId = tenant.id;
  }

  if (!tenantId) {
    paymentLogger.error({ subscriptionId: subscription.id }, 'No se pudo determinar el TenantID para la suscripción creada.');
    return { success: false, error: 'TenantID no encontrado', eventType: 'customer.subscription.created' };
  }

  // Buscar si ya existe una suscripción en nuestra base de datos para este ID de Stripe
  const dbSubscription = await prisma.tenantSubscription.findFirst({
    where: {
      stripeSubscriptionId: subscription.id
    }
  });

  const subscriptionData = {
      status: mapStripeStatusToDbStatus(subscription.status),
      currentPeriodStartsAt: new Date(subscription.current_period_start * 1000),
      currentPeriodEndsAt: new Date(subscription.current_period_end * 1000),
      stripeCustomerId: subscription.customer, // Asegurar que esté guardado
      updatedAt: new Date()
  };

  if (dbSubscription) {
    // Actualizar la suscripción existente
    paymentLogger.info({ dbSubscriptionId: dbSubscription.id }, 'Actualizando suscripción existente en DB.');
    await prisma.tenantSubscription.update({
      where: { id: dbSubscription.id },
      data: subscriptionData
    });
    
    return { success: true, action: 'updated', subscriptionId: dbSubscription.id, eventType: 'customer.subscription.created' };
  } else {
    // Crear una nueva suscripción si no existe (podría pasar si el webhook llega antes que la respuesta de la creación inicial)
    paymentLogger.info('Suscripción no encontrada en DB, creando una nueva.');
    // Primero, determinar el planId - necesitamos buscar por precio
    const stripePriceId = subscription.items.data[0]?.price?.id;
    
    if (!stripePriceId) {
      paymentLogger.error({ subscriptionId: subscription.id }, 'No se pudo determinar el ID de precio de Stripe en la suscripción creada.');
      return { success: false, error: 'Price ID no encontrado', eventType: 'customer.subscription.created' };
    }
    
    // Buscar plan por precio
    const plan = await prisma.subscriptionPlan.findFirst({
      where: { stripePriceId }
    });
    
    if (!plan) {
      paymentLogger.error(`No se encontró un plan para el precio de Stripe: ${stripePriceId}`);
      // Considerar una acción de fallback o error
      return { success: false, error: `Plan no encontrado para Price ID ${stripePriceId}`, eventType: 'customer.subscription.created' };
    }
    
    const newSubscription = await prisma.tenantSubscription.create({
      data: {
        tenantId,
        planId: plan.id,
        stripeSubscriptionId: subscription.id,
        ...subscriptionData, // Incluye status, fechas, customerId
        invoicesUsed: 0 // Valor inicial
      }
    });
    paymentLogger.info({ newSubscriptionId: newSubscription.id }, 'Nueva suscripción creada en DB.');
    
    return { success: true, action: 'created', subscriptionId: newSubscription.id, eventType: 'customer.subscription.created' };
  }
}

/**
 * Maneja evento de actualización de suscripción
 * @param {Object} subscription - Objeto de suscripción
 * @returns {Promise<Object>} - Resultado del manejo
 */
async function handleSubscriptionUpdated(subscription) {
  paymentLogger.info({ subscriptionId: subscription.id, status: subscription.status }, 'Procesando customer.subscription.updated');
  const dbSubscription = await prisma.tenantSubscription.findFirst({
    where: {
      stripeSubscriptionId: subscription.id
    },
    include: { tenant: true } // Include tenant to check isActive status
  });

  if (!dbSubscription) {
    paymentLogger.error(`No se encontró la suscripción con ID ${subscription.id} en la base de datos`);
    // Podría ser una suscripción que no manejamos, o un error.
    return { success: false, error: 'Suscripción no encontrada', eventType: 'customer.subscription.updated' };
  }

  const newStatus = mapStripeStatusToDbStatus(subscription.status);
  paymentLogger.info({ dbSubscriptionId: dbSubscription.id, oldStatus: dbSubscription.status, newStatus }, 'Actualizando estado de suscripción en DB.');

  await prisma.tenantSubscription.update({
    where: { id: dbSubscription.id },
    data: {
      status: newStatus,
      currentPeriodStartsAt: new Date(subscription.current_period_start * 1000),
      currentPeriodEndsAt: new Date(subscription.current_period_end * 1000),
      updatedAt: new Date()
    }
  });
  
  // Lógica adicional si cambia a suspendido o se reactiva
  if (newStatus === 'suspended' && dbSubscription.status !== 'suspended') {
      await prisma.tenant.update({ where: { id: dbSubscription.tenantId }, data: { isActive: false } });
      paymentLogger.info({ tenantId: dbSubscription.tenantId }, 'Tenant marcado como inactivo debido a suscripción suspendida.');
      // Considerar enviar notificación de suspensión
  } else if (newStatus === 'active' && (dbSubscription.status === 'suspended' || !dbSubscription.tenant.isActive)) {
      // Reactivate if suspended OR if tenant was inactive for some reason
      await prisma.tenant.update({ where: { id: dbSubscription.tenantId }, data: { isActive: true } });
      paymentLogger.info({ tenantId: dbSubscription.tenantId }, 'Tenant reactivado.');
      // Considerar enviar notificación de reactivación
  }
  
  return { success: true, action: 'updated', subscriptionId: dbSubscription.id, eventType: 'customer.subscription.updated' };
}

/**
 * Maneja evento de eliminación de suscripción
 * @param {Object} subscription - Objeto de suscripción
 * @returns {Promise<Object>} - Resultado del manejo
 */
async function handleSubscriptionDeleted(subscription) {
  paymentLogger.info({ subscriptionId: subscription.id }, 'Procesando customer.subscription.deleted');
  const dbSubscription = await prisma.tenantSubscription.findFirst({
    where: {
      stripeSubscriptionId: subscription.id
    }
  });

  if (!dbSubscription) {
    paymentLogger.error(`No se encontró la suscripción con ID ${subscription.id} en la base de datos`);
    return { success: false, error: 'Suscripción no encontrada', eventType: 'customer.subscription.deleted' };
  }

  // Actualizar a estado 'cancelled'
  paymentLogger.info({ dbSubscriptionId: dbSubscription.id }, 'Actualizando estado a cancelled en DB.');
  await prisma.tenantSubscription.update({
    where: { id: dbSubscription.id },
    data: {
      status: 'cancelled',
      // Podríamos limpiar las fechas de período si es relevante
      // currentPeriodStartsAt: null,
      // currentPeriodEndsAt: null,
      updatedAt: new Date()
    }
  });
  
  // Considerar si el tenant debe desactivarse inmediatamente o tras un período de gracia
  // await prisma.tenant.update({ where: { id: dbSubscription.tenantId }, data: { isActive: false } });
  // paymentLogger.info({ tenantId: dbSubscription.tenantId }, 'Tenant marcado como inactivo debido a cancelación.');
  // Considerar enviar notificación de cancelación

  return { success: true, action: 'cancelled', subscriptionId: dbSubscription.id, eventType: 'customer.subscription.deleted' };
}

/**
 * Maneja evento de pago exitoso de factura (renovaciones o primer pago de suscripción)
 * @param {Object} invoice - Objeto de factura de Stripe
 * @returns {Promise<Object>} - Resultado del manejo
 */
async function handleInvoicePaymentSucceeded(invoice) {
    paymentLogger.info({ invoiceId: invoice.id, subscriptionId: invoice.subscription, customerId: invoice.customer }, 'Procesando invoice.payment_succeeded');
    // Verificar si esta factura está asociada a una suscripción
    if (!invoice.subscription) {
      paymentLogger.info('Factura sin suscripción asociada, ignorando (posiblemente pago único).');
      return { success: true, action: 'ignored', reason: 'no_subscription', eventType: 'invoice.payment_succeeded' };
    }
  
    // Obtener la suscripción de nuestra base de datos
    const dbSubscription = await prisma.tenantSubscription.findFirst({
      where: {
        stripeSubscriptionId: invoice.subscription
      },
      include: { tenant: true } // Incluir tenant para reactivación
    });
  
    if (!dbSubscription) {
      paymentLogger.error(`No se encontró la suscripción con ID ${invoice.subscription} en la base de datos para la factura ${invoice.id}`);
      // Podría ser una suscripción creada pero cuyo webhook 'created' aún no llega/procesa.
      // Podríamos reintentar o esperar. Por ahora, marcamos como error.
      return { success: false, error: 'Suscripción no encontrada', eventType: 'invoice.payment_succeeded' };
    }
  
    // Registrar el pago
    const payment = await savePayment(
      dbSubscription.tenantId,
      dbSubscription.id,
      invoice.payment_intent, // ID del Payment Intent
      invoice.id, // ID de la Factura
      invoice.amount_paid / 100, // Convertir de centavos a la moneda base
      invoice.currency, // Usar la moneda de la factura
      invoice.payment_settings?.payment_method_details?.card?.brand || invoice.payment_settings?.payment_method_type || 'card', // Método de pago
      'succeeded'
    );
    paymentLogger.info({ paymentId: payment.id }, 'Pago de factura registrado.');
  
    // Actualizar el período de la suscripción y asegurar que esté activa
    // Stripe ya actualiza las fechas en el evento customer.subscription.updated,
    // pero podemos asegurarnos aquí también por si acaso o si estaba pendiente.
    const newStatus = 'active';
    const needsReactivation = dbSubscription.status !== 'active' || !dbSubscription.tenant.isActive;

    // Calcular las fechas basadas en la factura si es una renovación ('subscription_cycle')
    // Si es 'subscription_create', las fechas ya deberían estar bien por handleSubscriptionCreated/Updated
    let startDate = dbSubscription.currentPeriodStartsAt;
    let endDate = dbSubscription.currentPeriodEndsAt;
    if (invoice.billing_reason === 'subscription_cycle' || invoice.billing_reason === 'subscription_update') {
        startDate = invoice.period_start ? new Date(invoice.period_start * 1000) : startDate;
        endDate = invoice.period_end ? new Date(invoice.period_end * 1000) : endDate;
         paymentLogger.info({ startDate, endDate }, 'Usando fechas de período de la factura para actualización.');
    } else {
         paymentLogger.info({ startDate, endDate }, 'Manteniendo fechas de período existentes o de evento de suscripción.');
    }


    await prisma.tenantSubscription.update({
      where: { id: dbSubscription.id },
      data: {
        status: newStatus,
        currentPeriodStartsAt: startDate,
        currentPeriodEndsAt: endDate,
        updatedAt: new Date()
      }
    });
    paymentLogger.info({ dbSubscriptionId: dbSubscription.id, newStatus }, 'Estado y fechas de suscripción (re)confirmados.');

    // Reactivar tenant si estaba inactivo
    if (needsReactivation) {
        await prisma.tenant.update({ where: { id: dbSubscription.tenantId }, data: { isActive: true } });
        paymentLogger.info({ tenantId: dbSubscription.tenantId }, 'Tenant reactivado por pago de factura.');
        // Considerar notificación de reactivación
    }
    
    return { 
      success: true, 
      action: 'invoice_payment_recorded', 
      paymentId: payment.id,
      subscriptionUpdated: true,
      eventType: 'invoice.payment_succeeded'
    };
}
  
/**
 * Maneja evento de pago fallido de factura
 * @param {Object} invoice - Objeto de factura de Stripe
 * @returns {Promise<Object>} - Resultado del manejo
 */
async function handleInvoicePaymentFailed(invoice) {
    paymentLogger.warn({ invoiceId: invoice.id, subscriptionId: invoice.subscription, customerId: invoice.customer }, 'Procesando invoice.payment_failed');
    // Verificar si esta factura está asociada a una suscripción
    if (!invoice.subscription) {
        paymentLogger.info('Factura fallida sin suscripción asociada, ignorando.');
        return { success: true, action: 'ignored', reason: 'no_subscription', eventType: 'invoice.payment_failed' };
    }

    // Obtener la suscripción de nuestra base de datos
    const dbSubscription = await prisma.tenantSubscription.findFirst({
        where: {
        stripeSubscriptionId: invoice.subscription
        },
        include: { tenant: true } // Incluir tenant para nombre en notificación
    });

    if (!dbSubscription) {
        paymentLogger.error(`No se encontró la suscripción con ID ${invoice.subscription} en la base de datos para la factura fallida ${invoice.id}`);
        return { success: false, error: 'Suscripción no encontrada', eventType: 'invoice.payment_failed' };
    }

    // Registrar el intento de pago fallido
    const payment = await savePayment(
        dbSubscription.tenantId,
        dbSubscription.id,
        invoice.payment_intent, // ID del Payment Intent (si existe)
        invoice.id, // ID de la Factura
        invoice.amount_due / 100, // Monto que se intentó cobrar
        invoice.currency,
        invoice.payment_settings?.payment_method_details?.card?.brand || invoice.payment_settings?.payment_method_type || 'card', // Método de pago usado
        'failed'
    );
    paymentLogger.info({ paymentId: payment.id }, 'Registro de pago fallido guardado.');

    // Actualizar el estado de la suscripción a 'payment_pending' (o 'suspended' según reglas de negocio)
    // Stripe puede moverla a 'past_due' o 'unpaid'. Mapeamos a 'payment_pending' o 'suspended'.
    // Usar el estado de la suscripción si está disponible en la factura, si no, inferir.
    const stripeSubStatus = invoice.subscription_details?.status || 'past_due'; 
    const newStatus = mapStripeStatusToDbStatus(stripeSubStatus); 
    
    await prisma.tenantSubscription.update({
        where: { id: dbSubscription.id },
        data: {
        status: newStatus, // 'payment_pending' o 'suspended'
        updatedAt: new Date()
        }
    });
    paymentLogger.info({ dbSubscriptionId: dbSubscription.id, newStatus }, 'Estado de suscripción actualizado por fallo de pago.');

    // Considerar desactivar tenant si el estado es 'suspended'
    if (newStatus === 'suspended') {
        await prisma.tenant.update({ where: { id: dbSubscription.tenantId }, data: { isActive: false } });
        paymentLogger.info({ tenantId: dbSubscription.tenantId }, 'Tenant marcado como inactivo por fallo de pago final.');
        // Enviar notificación de suspensión
         try {
            const adminUsers = await prisma.tenantUser.findMany({ where: { tenantId: dbSubscription.tenantId, role: 'admin' }, select: { telegramId: true } });
            const failMessage = `❌ *Pago Fallido y Suspensión*\n\n` +
                `El pago de tu suscripción para *${dbSubscription.tenant.businessName}* no pudo ser procesado.\n\n` +
                `Estado: Suspendido\n` +
                `Monto: $${(invoice.amount_due / 100).toFixed(2)} ${invoice.currency.toUpperCase()}\n\n` +
                `Por favor, actualiza tu método de pago en el portal de cliente para reactivar tu servicio. Contacta a soporte si necesitas ayuda.`;
            for (const admin of adminUsers) { await NotificationService.sendTelegramNotification(admin.telegramId.toString(), failMessage); }
         } catch (notifyError) { paymentLogger.warn({ error: notifyError.message }, 'Error al notificar suspensión.'); }

    } else { // Si es 'payment_pending'
        // Enviar notificación de fallo de pago (pero aún no suspendido)
         try {
            const adminUsers = await prisma.tenantUser.findMany({ where: { tenantId: dbSubscription.tenantId, role: 'admin' }, select: { telegramId: true } });
            const failMessage = `⚠️ *Fallo en el Pago de Renovación*\n\n` +
                `Hubo un problema al procesar el pago de tu suscripción para *${dbSubscription.tenant.businessName}*.\n\n` +
                `Estado: Pago Pendiente\n` +
                `Monto: $${(invoice.amount_due / 100).toFixed(2)} ${invoice.currency.toUpperCase()}\n\n` +
                `Por favor, revisa o actualiza tu método de pago pronto para evitar la suspensión del servicio. Stripe intentará cobrar de nuevo.`;
            for (const admin of adminUsers) { await NotificationService.sendTelegramNotification(admin.telegramId.toString(), failMessage); }
         } catch (notifyError) { paymentLogger.warn({ error: notifyError.message }, 'Error al notificar fallo de pago.'); }
    }


    return { 
        success: true, 
        action: 'payment_failed_recorded', 
        paymentId: payment.id,
        subscriptionUpdated: true,
        notifyAdmins: true, // Indicar al controlador que notifique
        details: `Pago fallido registrado. Estado de suscripción: ${newStatus}`,
        eventType: 'invoice.payment_failed'
    };
}

/**
 * Mapea el estado de Stripe a nuestro formato interno
 * @param {string} stripeStatus - Estado de suscripción en Stripe
 * @returns {string} - Estado en formato interno
 */
function mapStripeStatusToDbStatus(stripeStatus) {
  // Mapeo más granular basado en estados comunes de Stripe Subscription
  switch (stripeStatus) {
    case 'active':
      return 'active';
    case 'trialing': 
      // Mantenemos 'trial' si el estado de Stripe es 'trialing'
      return 'trial'; 
    case 'past_due': // Pago fallido, Stripe reintentará
      return 'payment_pending';
    case 'unpaid': // Reintentos agotados, requiere acción manual
    case 'incomplete': // Requiere acción del cliente para completar el pago inicial
    case 'incomplete_expired': // Tiempo para completar acción expiró
      return 'suspended'; // O un estado más específico como 'incomplete' si se maneja
    case 'canceled': // Cancelado por usuario o admin
      return 'cancelled';
    default:
      paymentLogger.warn(`Estado de Stripe no mapeado encontrado: ${stripeStatus}, usando 'payment_pending' por defecto.`);
      return 'payment_pending'; // Estado por defecto seguro
  }
}

// Exportar funciones necesarias
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
  handleWebhookEvent,
  // Exportar handlers individuales puede ser útil para pruebas o lógica específica
  handleCheckoutSessionCompleted, 
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed
};
