// core/subscription/subscription.service.js
import { prisma } from '../../config/database.js';
import logger from '../utils/logger.js';
import { withTransaction, auditLog } from '../utils/transaction.js';

// Logger específico para el servicio de suscripción
const subscriptionLogger = logger.child({ module: 'subscription-service' });

/**
 * Servicio para gestión de suscripciones
 */
class SubscriptionService {
  /**
   * Obtiene todos los planes de suscripción disponibles
   * @param {boolean} activeOnly - Si true, devuelve solo planes activos
   * @returns {Promise<Array>} - Lista de planes
   */
  static async getPlans(activeOnly = true) {
    subscriptionLogger.debug({ activeOnly }, 'Obteniendo planes de suscripción');

    try {
      const plans = await prisma.subscriptionPlan.findMany({
        where: activeOnly ? { isActive: true } : {},
        orderBy: { price: 'asc' },
      });

      subscriptionLogger.debug({ count: plans.length }, 'Planes obtenidos correctamente');
      return plans;
    } catch (error) {
      subscriptionLogger.error({ error }, 'Error al obtener planes de suscripción');
      throw error;
    }
  }

  /**
   * Obtiene un plan específico por ID
   * @param {number} planId - ID del plan
   * @returns {Promise<Object|null>} - Plan o null si no se encuentra
   */
  static async getPlan(planId) {
    subscriptionLogger.debug({ planId }, 'Obteniendo plan de suscripción');

    try {
      const plan = await prisma.subscriptionPlan.findUnique({
        where: { id: planId },
      });

      if (!plan) {
        subscriptionLogger.warn({ planId }, 'Plan no encontrado');
      } else {
        subscriptionLogger.debug({ planId, planName: plan.name }, 'Plan obtenido correctamente');
      }

      return plan;
    } catch (error) {
      subscriptionLogger.error({ error, planId }, 'Error al obtener plan de suscripción');
      throw error;
    }
  }

  /**
   * Crea un nuevo plan de suscripción
   * @param {Object} planData - Datos del plan
   * @returns {Promise<Object>} - Plan creado
   */
  static async createPlan(planData) {
    subscriptionLogger.info({ planName: planData.name }, 'Creando nuevo plan de suscripción');

    // Validación básica
    if (!planData.name) throw new Error('El nombre del plan es requerido');
    if (!planData.price) throw new Error('El precio del plan es requerido');
    if (!planData.invoiceLimit) throw new Error('El límite de facturas es requerido');

    return withTransaction(
      async (tx) => {
        try {
          const plan = await tx.subscriptionPlan.create({
            data: {
              name: planData.name,
              description: planData.description,
              price: planData.price,
              currency: planData.currency || 'MXN',
              billingPeriod: planData.billingPeriod || 'monthly',
              invoiceLimit: planData.invoiceLimit,
              isActive: planData.isActive !== undefined ? planData.isActive : true,
            },
          });

          subscriptionLogger.info(
            { planId: plan.id, planName: plan.name },
            'Plan de suscripción creado correctamente'
          );

          return plan;
        } catch (error) {
          subscriptionLogger.error({ error, planData }, 'Error al crear plan de suscripción');
          throw error;
        }
      },
      { description: 'Crear plan de suscripción' }
    );
  }

  /**
   * Crea una suscripción para un tenant
   * @param {string} tenantId - ID del tenant
   * @param {number} planId - ID del plan
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<Object>} - Suscripción creada
   */
  static async createSubscription(tenantId, planId, options = {}) {
    const {
      trialDays = 14,
      stripeCustomerId = null,
      stripeSubscriptionId = null,
      status = 'trial',
    } = options;

    subscriptionLogger.info({ tenantId, planId, trialDays, status }, 'Creando suscripción');

    return withTransaction(
      async (tx) => {
        // Verificar si el tenant ya tiene una suscripción activa
        const existingSubscription = await tx.tenantSubscription.findFirst({
          where: {
            tenantId,
            status: { in: ['active', 'trial'] },
          },
        });

        if (existingSubscription) {
          subscriptionLogger.warn(
            { tenantId, existingSubscriptionId: existingSubscription.id },
            'El tenant ya tiene una suscripción activa'
          );
          throw new Error('El tenant ya tiene una suscripción activa');
        }

        // Verificar que el plan existe
        const plan = await tx.subscriptionPlan.findUnique({
          where: { id: planId },
        });

        if (!plan) {
          subscriptionLogger.error({ planId }, 'El plan seleccionado no existe');
          throw new Error('El plan seleccionado no existe');
        }

        // Calcular fechas
        const now = new Date();
        let trialEndsAt = null;
        let currentPeriodEndsAt = null;

        if (status === 'trial' && trialDays > 0) {
          trialEndsAt = new Date(now);
          trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);
          currentPeriodEndsAt = trialEndsAt;
        } else if (status === 'active') {
          // Para suscripciones activas, el período actual depende del billingPeriod
          currentPeriodEndsAt = new Date(now);

          if (plan.billingPeriod === 'monthly') {
            currentPeriodEndsAt.setMonth(currentPeriodEndsAt.getMonth() + 1);
          } else if (plan.billingPeriod === 'yearly') {
            currentPeriodEndsAt.setFullYear(currentPeriodEndsAt.getFullYear() + 1);
          }
        }

        // Crear la suscripción
        const subscription = await tx.tenantSubscription.create({
          data: {
            tenantId,
            planId,
            status,
            stripeCustomerId,
            stripeSubscriptionId,
            trialEndsAt,
            currentPeriodStartsAt: now,
            currentPeriodEndsAt,
            invoicesUsed: 0,
          },
          include: {
            plan: true,
          },
        });

        // Registrar en auditoría
        await auditLog(tx, {
          tenantId,
          action: 'subscription:create',
          entityType: 'tenant_subscription',
          entityId: subscription.id.toString(),
          details: {
            planId: planId,
            planName: plan.name,
            status,
            trialDays,
          },
        });

        subscriptionLogger.info(
          {
            subscriptionId: subscription.id,
            tenantId,
            planId,
            status,
          },
          'Suscripción creada exitosamente'
        );

        return subscription;
      },
      { description: 'Crear suscripción' }
    );
  }

  /**
   * Actualiza el estado de una suscripción
   * @param {number} subscriptionId - ID de la suscripción
   * @param {Object} updateData - Datos a actualizar
   * @returns {Promise<Object>} - Suscripción actualizada
   */
  static async updateSubscription(subscriptionId, updateData) {
    subscriptionLogger.info({ subscriptionId, ...updateData }, 'Actualizando suscripción');

    return withTransaction(
      async (tx) => {
        // Verificar que la suscripción existe
        const subscription = await tx.tenantSubscription.findUnique({
          where: { id: subscriptionId },
          include: { plan: true },
        });

        if (!subscription) {
          subscriptionLogger.error({ subscriptionId }, 'Suscripción no encontrada');
          throw new Error('Suscripción no encontrada');
        }

        // Filtrar solo campos permitidos
        const allowedFields = [
          'status',
          'trialEndsAt',
          'currentPeriodStartsAt',
          'currentPeriodEndsAt',
          'stripeCustomerId',
          'stripeSubscriptionId',
          'invoicesUsed',
        ];

        const filteredData = {};
        Object.keys(updateData).forEach((key) => {
          if (allowedFields.includes(key)) {
            filteredData[key] = updateData[key];
          }
        });

        // Actualizar la suscripción
        const updatedSubscription = await tx.tenantSubscription.update({
          where: { id: subscriptionId },
          data: filteredData,
          include: { plan: true },
        });

        // Registrar en auditoría
        await auditLog(tx, {
          tenantId: subscription.tenantId,
          action: 'subscription:update',
          entityType: 'tenant_subscription',
          entityId: subscription.id.toString(),
          details: filteredData,
        });

        subscriptionLogger.info(
          { subscriptionId, tenantId: subscription.tenantId },
          'Suscripción actualizada correctamente'
        );

        return updatedSubscription;
      },
      { description: 'Actualizar suscripción' }
    );
  }

  /**
   * Cambia el plan de una suscripción
   * @param {number} subscriptionId - ID de la suscripción
   * @param {number} newPlanId - ID del nuevo plan
   * @returns {Promise<Object>} - Suscripción actualizada
   */
  static async changePlan(subscriptionId, newPlanId) {
    subscriptionLogger.info({ subscriptionId, newPlanId }, 'Cambiando plan de suscripción');

    return withTransaction(
      async (tx) => {
        // Verificar que la suscripción existe
        const subscription = await tx.tenantSubscription.findUnique({
          where: { id: subscriptionId },
          include: { plan: true },
        });

        if (!subscription) {
          subscriptionLogger.error({ subscriptionId }, 'Suscripción no encontrada');
          throw new Error('Suscripción no encontrada');
        }

        // Verificar que el nuevo plan existe
        const newPlan = await tx.subscriptionPlan.findUnique({
          where: { id: newPlanId },
        });

        if (!newPlan) {
          subscriptionLogger.error({ newPlanId }, 'El nuevo plan no existe');
          throw new Error('El nuevo plan no existe');
        }

        // Actualizar el plan de la suscripción
        const updatedSubscription = await tx.tenantSubscription.update({
          where: { id: subscriptionId },
          data: { planId: newPlanId },
          include: { plan: true },
        });

        // Registrar en auditoría
        await auditLog(tx, {
          tenantId: subscription.tenantId,
          action: 'subscription:change_plan',
          entityType: 'tenant_subscription',
          entityId: subscription.id.toString(),
          details: {
            oldPlanId: subscription.planId,
            oldPlanName: subscription.plan.name,
            newPlanId: newPlan.id,
            newPlanName: newPlan.name,
          },
        });

        subscriptionLogger.info(
          {
            subscriptionId,
            tenantId: subscription.tenantId,
            oldPlanId: subscription.planId,
            newPlanId,
          },
          'Plan de suscripción cambiado correctamente'
        );

        return updatedSubscription;
      },
      { description: 'Cambiar plan de suscripción' }
    );
  }

  /**
   * Cancela una suscripción
   * @param {number} subscriptionId - ID de la suscripción
   * @param {string} reason - Motivo de la cancelación
   * @returns {Promise<Object>} - Suscripción cancelada
   */
  static async cancelSubscription(subscriptionId, reason) {
    subscriptionLogger.info({ subscriptionId, reason }, 'Cancelando suscripción');

    return withTransaction(
      async (tx) => {
        // Verificar que la suscripción existe
        const subscription = await tx.tenantSubscription.findUnique({
          where: { id: subscriptionId },
        });

        if (!subscription) {
          subscriptionLogger.error({ subscriptionId }, 'Suscripción no encontrada');
          throw new Error('Suscripción no encontrada');
        }

        // Actualizar el estado de la suscripción
        const cancelledSubscription = await tx.tenantSubscription.update({
          where: { id: subscriptionId },
          data: { status: 'cancelled' },
        });

        // Registrar en auditoría
        await auditLog(tx, {
          tenantId: subscription.tenantId,
          action: 'subscription:cancel',
          entityType: 'tenant_subscription',
          entityId: subscription.id.toString(),
          details: { reason },
        });

        subscriptionLogger.info(
          {
            subscriptionId,
            tenantId: subscription.tenantId,
          },
          'Suscripción cancelada correctamente'
        );

        return cancelledSubscription;
      },
      { description: 'Cancelar suscripción' }
    );
  }

  /**
   * Obtiene la suscripción actual de un tenant
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object|null>} - Suscripción actual o null
   */
  static async getCurrentSubscription(tenantId) {
    subscriptionLogger.debug({ tenantId }, 'Obteniendo suscripción actual');

    try {
      const subscription = await prisma.tenantSubscription.findFirst({
        where: { tenantId },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!subscription) {
        subscriptionLogger.debug({ tenantId }, 'No se encontró suscripción para el tenant');
        return null;
      }

      subscriptionLogger.debug(
        {
          tenantId,
          subscriptionId: subscription.id,
          status: subscription.status,
          planName: subscription.plan.name,
          invoicesUsed: subscription.invoicesUsed, // Asegúrate que este valor se está registrando
        },
        'Suscripción obtenida correctamente'
      );

      return subscription;
    } catch (error) {
      subscriptionLogger.error({ error, tenantId }, 'Error al obtener suscripción actual');
      throw error;
    }
  }
}

export default SubscriptionService;
