import prisma from '../lib/prisma.js';
import logger from '../core/utils/logger.js';

// Logger específico para el servicio de tenants
const tenantServiceLogger = logger.child({ module: 'tenant-service' });

/**
 * Servicio para gestión de tenants
 */
class TenantService {
  /**
   * Busca un cliente por nombre para un tenant específico
   * @param {string} tenantId - ID del tenant
   * @param {string} namePattern - Patrón de nombre a buscar (puede ser parcial)
   * @returns {Promise<Object>} - Cliente encontrado
   */
  static async getCustomerByName(tenantId, namePattern) {
    try {
      return await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          legalName: { contains: namePattern },
        },
      });
    } catch (error) {
      tenantServiceLogger.error(
        { tenantId, namePattern, error: error.message },
        'Error al buscar cliente por nombre'
      );
      return null;
    }
  }
  /**
   * Busca un usuario por su ID de Telegram
   * @param {number} telegramId - ID de Telegram del usuario
   * @returns {Promise<Object>} - Usuario encontrado con su tenant
   */
  static async findUserByTelegramId(telegramId) {
    return prisma.tenantUser.findUnique({
      where: { telegramId },
      include: {
        tenant: true,
      },
    });
  }

  /**
   * Obtiene el próximo folio disponible para un tenant
   * VERSIÓN OPTIMIZADA: Una sola query atómica
   * @param {string} tenantId - ID del tenant
   * @param {string} series - Serie del folio (default: 'A')
   * @returns {Promise<number>} - Próximo número de folio
   */
  static async getNextFolio(tenantId, series = 'A') {
    try {
      // OPTIMIZACIÓN: SQL directo para operación atómica
      const result = await prisma.$queryRaw`
        INSERT INTO tenant_folios (tenant_id, series, current_number, created_at, updated_at)
        VALUES (${tenantId}::uuid, ${series}, 801, NOW(), NOW())
        ON CONFLICT (tenant_id, series) 
        DO UPDATE SET 
          current_number = tenant_folios.current_number + 1,
          updated_at = NOW()
        RETURNING current_number - 1 as folio;
      `;

      return result[0]?.folio || 800;
    } catch (error) {
      tenantServiceLogger.error(
        { tenantId, series, error: error.message },
        'Error al obtener próximo folio'
      );

      // Fallback al método anterior si falla
      const folio = await prisma.tenantFolio.findUnique({
        where: { tenantId_series: { tenantId, series } },
      });

      if (!folio) {
        await prisma.tenantFolio.create({
          data: { tenantId, series, currentNumber: 801 },
        });
        return 800;
      }

      await prisma.tenantFolio.update({
        where: { id: folio.id },
        data: { currentNumber: { increment: 1 } },
      });

      return folio.currentNumber - 1;
    }
  }

  /**
   * Verifica si un tenant puede generar más facturas según su plan
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<{canGenerate: boolean, reason?: string, subscriptionStatus?: string, paymentLink?: string}>} - Resultado de la verificación
   */
  static async canGenerateInvoice(tenantId) {
    try {
      const tenant = await this.findTenantWithSubscription(tenantId);

      if (!tenant) {
        return { canGenerate: false, reason: 'Tenant no encontrado.' };
      }

      const subscription = tenant.subscriptions?.[0]; // La más reciente

      if (!subscription) {
        // Considerar si un tenant sin suscripción puede operar (quizás un plan gratuito implícito)
        // Por ahora, asumimos que se requiere una suscripción.
        return {
          canGenerate: false,
          reason: 'No se encontró una suscripción activa.',
          subscriptionStatus: 'none',
        };
      }

      const status = subscription.status;
      const plan = subscription.plan;
      const paymentLink =
        tenant.paymentLink || 'https://mock-stripe-payment-link.com/pricemockdefault/1745906401125'; // Usar link del tenant o fallback

      // 1. Verificar Estado de la Suscripción
      const isActiveStatus = status === 'active' || status === 'trial'; // Cambiado 'trialing' por 'trial'
      if (!isActiveStatus) {
        let reason = 'Suscripción inactiva.';
        if (status === 'pending_payment') reason = 'Suscripción pendiente de pago.';
        else if (status === 'expired') reason = 'Suscripción expirada.';
        else if (status === 'canceled') reason = 'Suscripción cancelada.';

        return {
          canGenerate: false,
          reason: reason,
          subscriptionStatus: status,
          paymentLink: paymentLink,
        };
      }

      // 2. Verificar Límite de Facturas (si el plan tiene uno)
      if (plan && plan.invoiceLimit !== null && plan.invoiceLimit > 0) {
        // Asumiendo 0 o null significa ilimitado
        const invoicesUsed = subscription.invoicesUsed || 0;
        if (invoicesUsed >= plan.invoiceLimit) {
          return {
            canGenerate: false,
            reason: `Límite de ${plan.invoiceLimit} facturas alcanzado para el plan ${plan.name}.`,
            subscriptionStatus: status,
            paymentLink: paymentLink,
          };
        }
      }

      // Si pasa todas las verificaciones
      return { canGenerate: true, subscriptionStatus: status };
    } catch (error) {
      tenantServiceLogger.error(
        { tenantId, error: error.message },
        'Error al verificar capacidad de generar factura'
      );
      return { canGenerate: false, reason: 'Error interno al verificar la suscripción.' };
    }
  }

  /**
   * Registra una factura generada
   * @param {string} tenantId - ID del tenant
   * @param {string} facturapiInvoiceId - ID de la factura en FacturAPI
   * @param {string} series - Serie de la factura
   * @param {number} folioNumber - Número de folio
   * @param {number} customerId - ID del cliente (opcional)
   * @param {number} total - Monto total de la factura
   * @param {number} createdById - ID del usuario que generó la factura (opcional)
   * @returns {Promise<Object>} - Factura registrada
   */
  static async registerInvoice(
    tenantId,
    facturapiInvoiceId,
    series,
    folioNumber,
    customerId,
    total,
    createdById
  ) {
    tenantServiceLogger.info({ tenantId, series, folioNumber }, 'Registrando factura');

    try {
      // Guardar realmente en la base de datos usando Prisma
      const invoice = await prisma.tenantInvoice.create({
        data: {
          tenantId,
          facturapiInvoiceId,
          series,
          folioNumber,
          customerId, // Si es null, Prisma lo manejará adecuadamente
          total,
          status: 'valid',
          createdById, // Si es null, Prisma lo manejará
          invoiceDate: new Date(),
        },
      });

      console.log(`Factura guardada en base de datos con ID: ${invoice.id}`);

      // Incrementar el contador de facturas (mantener esta funcionalidad)
      await this.incrementInvoiceCount(tenantId);

      return invoice;
    } catch (error) {
      console.error(`Error al registrar factura en base de datos: ${error.message}`);
      // En caso de error, devolver un objeto con los datos básicos para mantener compatibilidad
      return {
        tenantId,
        facturapiInvoiceId,
        series,
        folioNumber,
        customerId,
        total,
        createdById,
        status: 'valid',
        createdAt: new Date(),
      };
    }
  }

  /**
   * Crea una suscripción para un tenant
   * @param {string} tenantId - ID del tenant
   * @param {number} planId - ID del plan
   * @returns {Promise<Object>} - Suscripción creada
   */
  static async createSubscription(tenantId, planId) {
    // Simular la creación de una suscripción
    console.log(`Creando suscripción para tenant ${tenantId} con plan ${planId}`);

    // En un caso real, aquí se guardaría en la base de datos
    return {
      tenantId,
      planId,
      status: 'trial',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 días
      invoicesUsed: 0,
    };
  }

  /**
   * Encuentra un tenant con su suscripción
   * @param {string} id - ID del tenant
   * @returns {Promise<Object>} - Tenant con suscripción
   */
  static async findTenantWithSubscription(id) {
    try {
      return await prisma.tenant.findUnique({
        where: { id },
        include: {
          subscriptions: {
            include: {
              plan: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
            take: 1,
          },
        },
      });
    } catch (error) {
      console.error(`Error al buscar tenant con suscripción: ${error.message}`);
      throw error;
    }
  }

  /**
   * Genera un enlace de pago para un tenant
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Enlace de pago generado
   */
  static async generatePaymentLink(tenantId) {
    try {
      // Obtener el tenant con su suscripción y plan
      const tenant = await this.findTenantWithSubscription(tenantId);

      if (!tenant) {
        throw new Error('Tenant no encontrado');
      }

      const subscription = tenant.subscriptions?.[0];

      if (!subscription) {
        throw new Error('No se encontró una suscripción para este tenant');
      }

      const plan = subscription.plan;

      if (!plan || !plan.stripePriceId) {
        throw new Error('El plan no tiene un ID de precio de Stripe configurado');
      }

      // Importar el servicio de Stripe
      const StripeService = (await import('../services/stripe.service.js')).default;

      // Generar el enlace de pago
      const paymentLink = await StripeService.createPaymentLink({
        priceId: plan.stripePriceId,
        quantity: 1,
        metadata: {
          tenant_id: tenantId,
          subscription_id: subscription.id,
          plan_name: plan.name,
        },
      });

      return paymentLink;
    } catch (error) {
      console.error(`Error al generar enlace de pago para tenant ${tenantId}:`, error);
      throw error;
    }
  }

  /**
   * Incrementa el contador de facturas usadas en la suscripción actual
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Suscripción actualizada
   */
  static async incrementInvoiceCount(tenantId) {
    console.log(`Incrementando contador de facturas para tenant ${tenantId}`);

    try {
      // Obtener la suscripción activa
      const subscription = await prisma.tenantSubscription.findFirst({
        where: {
          tenantId,
          OR: [{ status: 'active' }, { status: 'trial' }],
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!subscription) {
        console.warn(`No se encontró suscripción activa para tenant ${tenantId}`);
        return null;
      }

      // Incrementar el contador
      const updatedSubscription = await prisma.tenantSubscription.update({
        where: { id: subscription.id },
        data: {
          invoicesUsed: {
            increment: 1,
          },
        },
      });

      console.log(
        `Contador incrementado para tenant ${tenantId}: ${updatedSubscription.invoicesUsed} facturas`
      );
      return updatedSubscription;
    } catch (error) {
      console.error(`Error al incrementar contador de facturas para tenant ${tenantId}:`, error);
      throw error;
    }
  }
}

export default TenantService;
