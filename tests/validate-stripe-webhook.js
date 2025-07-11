// tests/validate-stripe-webhook.js
import axios from 'axios';
import crypto from 'crypto';
import { config, initConfig } from '../config/index.js';
import logger from '../core/utils/logger.js';

const testLogger = logger.child({ module: 'stripe-webhook-validation' });

// Función para firmar el payload según la especificación de Stripe
function generateStripeSignature(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  return `t=${timestamp},v1=${signature}`;
}

async function validateStripeWebhook() {
  testLogger.info('Iniciando validación de webhook de Stripe');

  try {
    // Inicializar configuración
    await initConfig();

    // Obtener el webhook secret de la configuración
    const webhookSecret = config.stripe.webhookSecret;

    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET no está configurado');
    }

    // Crear un evento de prueba simulando un pago exitoso
    const eventPayload = JSON.stringify({
      id: `evt_test_${Date.now()}`,
      object: 'event',
      api_version: '2023-10-16',
      created: Math.floor(Date.now() / 1000),
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: `in_test_${Date.now()}`,
          object: 'invoice',
          amount_paid: 100000, // en centavos, 1000.00
          currency: 'mxn',
          customer: 'cus_test123456',
          subscription: 'sub_test123456',
          status: 'paid',
          payment_intent: 'pi_test123456',
        },
      },
    });

    // Generar firma para el webhook
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = generateStripeSignature(eventPayload, webhookSecret, timestamp);

    console.log('Enviando solicitud al webhook...');

    // Enviar solicitud al webhook
    const webhookUrl = `${config.apiBaseUrl}/api/webhooks/stripe`;
    const response = await axios({
      method: 'POST',
      url: webhookUrl,
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signature,
      },
      data: eventPayload,
    });

    console.log(`✅ Solicitud enviada correctamente (Status: ${response.status})`);
    console.log('Respuesta:', response.data);

    console.log('✅ Validación de webhook de Stripe completada');
  } catch (error) {
    testLogger.error({ error }, 'Error al validar webhook de Stripe');
    console.error('❌ Error en la validación de webhook de Stripe:', error.message);

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Datos:', error.response.data);
    }
  }
}

validateStripeWebhook()
  .then(() => {
    console.log('Script de validación finalizado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error en el script de validación:', error);
    process.exit(1);
  });
