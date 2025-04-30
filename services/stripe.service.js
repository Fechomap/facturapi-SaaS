// services/stripe.service.js
import Stripe from 'stripe';
import config from '../config/index.js';
import logger from '../core/utils/logger.js';

// Logger específico para el servicio de Stripe
const stripeLogger = logger.child({ module: 'stripe-service' });

// Inicializar el cliente de Stripe con la clave secreta
// Usar directamente la variable de entorno si la configuración no está disponible
const stripeSecretKey = config.stripe?.secretKey || process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  throw new Error('STRIPE_SECRET_KEY no está configurada. La integración con Stripe no funcionará.');
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: config.stripe?.apiVersion || '2023-10-16',
});

// Registrar información sobre la inicialización (sin mostrar la clave completa)
stripeLogger.info({
  secretKeyConfigured: Boolean(stripeSecretKey),
  secretKeyPrefix: stripeSecretKey ? stripeSecretKey.substring(0, 7) : null,
  apiVersion: config.stripe?.apiVersion || '2023-10-16'
}, 'Cliente de Stripe inicializado');

/**
 * Servicio para interactuar con la API de Stripe
 */
class StripeService {
  /**
   * Crea un cliente en Stripe
   * @param {Object} customerData - Datos del cliente
   * @param {string} customerData.name - Nombre del cliente
   * @param {string} [customerData.email] - Email del cliente (opcional)
   * @param {Object} [customerData.metadata] - Metadatos adicionales (opcional)
   * @returns {Promise<Object>} - Cliente creado en Stripe
   */
  async createCustomer(customerData) {
    try {
      stripeLogger.info({ customerData }, 'Creando cliente en Stripe');
      const customer = await stripe.customers.create(customerData);
      stripeLogger.info({ customerId: customer.id }, 'Cliente creado en Stripe');
      return customer;
    } catch (error) {
      stripeLogger.error({ error: error.message, customerData }, 'Error al crear cliente en Stripe');
      throw error;
    }
  }

  /**
   * Crea un enlace de pago en Stripe
   * @param {Object} paymentLinkData - Datos del enlace de pago
   * @param {string} paymentLinkData.priceId - ID del precio en Stripe
   * @param {number} [paymentLinkData.quantity=1] - Cantidad (opcional, por defecto 1)
   * @param {Object} [paymentLinkData.metadata] - Metadatos adicionales (opcional)
   * @returns {Promise<Object>} - Enlace de pago creado en Stripe
   */
  async createPaymentLink(paymentLinkData) {
    try {
      const { priceId, quantity = 1, metadata = {} } = paymentLinkData;
      
      stripeLogger.info({ priceId, quantity }, 'Creando enlace de pago en Stripe');
      
      const paymentLink = await stripe.paymentLinks.create({
        line_items: [
          {
            price: priceId,
            quantity: quantity,
          },
        ],
        metadata: metadata,
      });
      
      stripeLogger.info({ paymentLinkId: paymentLink.id, url: paymentLink.url }, 'Enlace de pago creado en Stripe');
      return paymentLink;
    } catch (error) {
      stripeLogger.error({ error: error.message, paymentLinkData }, 'Error al crear enlace de pago en Stripe');
      throw error;
    }
  }

  /**
   * Obtiene un cliente de Stripe por su ID
   * @param {string} customerId - ID del cliente en Stripe
   * @returns {Promise<Object>} - Cliente de Stripe
   */
  async getCustomer(customerId) {
    try {
      stripeLogger.info({ customerId }, 'Obteniendo cliente de Stripe');
      const customer = await stripe.customers.retrieve(customerId);
      return customer;
    } catch (error) {
      stripeLogger.error({ error: error.message, customerId }, 'Error al obtener cliente de Stripe');
      throw error;
    }
  }

  /**
   * Obtiene un precio de Stripe por su ID
   * @param {string} priceId - ID del precio en Stripe
   * @returns {Promise<Object>} - Precio de Stripe
   */
  async getPrice(priceId) {
    try {
      stripeLogger.info({ priceId }, 'Obteniendo precio de Stripe');
      const price = await stripe.prices.retrieve(priceId);
      return price;
    } catch (error) {
      stripeLogger.error({ error: error.message, priceId }, 'Error al obtener precio de Stripe');
      throw error;
    }
  }

  /**
   * Verifica que la clave API de Stripe sea válida
   * @returns {Promise<boolean>} - true si la clave es válida, false en caso contrario
   */
  async verifyApiKey() {
    try {
      stripeLogger.info('Verificando clave API de Stripe');
      // Intentar una operación simple para verificar que la clave API funciona
      await stripe.balance.retrieve();
      stripeLogger.info('Clave API de Stripe verificada correctamente');
      return true;
    } catch (error) {
      stripeLogger.error({ error: error.message }, 'Error al verificar clave API de Stripe');
      return false;
    }
  }
}

// Exportar una instancia del servicio
export default new StripeService();
