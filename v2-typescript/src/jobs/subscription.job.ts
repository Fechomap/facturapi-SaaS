// jobs/subscription.job.ts
import { prisma } from '../config/database';
import logger from '../core/utils/logger';
import NotificationService from '../services/notification.service';

const subscriptionLogger = logger.child({ module: 'subscription-jobs' });

/**
 * Verifica suscripciones que están por expirar y envía notificaciones
 */
export async function checkExpiringSubscriptions(): Promise<void> {
  subscriptionLogger.info('Verificando suscripciones próximas a expirar');

  try {
    const now = new Date();
    const expiryLimit = new Date();
    expiryLimit.setDate(now.getDate() + 3);

    const expiringSubscriptions = await prisma.tenantSubscription.findMany({
      where: {
        OR: [
          {
            status: 'trial',
            trialEndsAt: {
              gte: now,
              lte: expiryLimit,
            },
          },
          {
            status: 'active',
            currentPeriodEndsAt: {
              gte: now,
              lte: expiryLimit,
            },
          },
        ],
      },
      include: {
        tenant: {
          include: {
            users: {
              where: {
                role: 'admin',
              },
            },
          },
        },
        plan: true,
      },
    });

    subscriptionLogger.info(
      `Se encontraron ${expiringSubscriptions.length} suscripciones próximas a expirar`
    );

    for (const subscription of expiringSubscriptions) {
      try {
        const tenant = subscription.tenant;
        const adminUsers = tenant.users;

        if (adminUsers.length === 0) {
          subscriptionLogger.warn(`No se encontraron usuarios admin para el tenant ${tenant.id}`);
          continue;
        }

        const endDate =
          subscription.status === 'trial'
            ? subscription.trialEndsAt
            : subscription.currentPeriodEndsAt;

        if (!endDate) {
          subscriptionLogger.warn(
            { subscriptionId: subscription.id },
            'Subscription end date is null, skipping notification.'
          );
          continue;
        }

        const daysLeft = Math.max(
          0,
          Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        );

        const message =
          `⚠️ *Alerta de Suscripción*\n\n` +
          `Tu ${subscription.status === 'trial' ? 'período de prueba' : 'suscripción'} para *${tenant.businessName}* ` +
          `expirará en *${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}*.\n\n` +
          `Plan actual: ${subscription.plan.name}\n` +
          `Fecha de expiración: ${endDate.toLocaleDateString()}\n\n` +
          `Prepara tu método de pago para continuar disfrutando del servicio sin interrupciones.`;

        for (const admin of adminUsers) {
          await NotificationService.sendTelegramNotification(Number(admin.telegramId), message);
          subscriptionLogger.info(
            `Notificación de expiración próxima enviada a ${admin.telegramId} para tenant ${tenant.id}`
          );
        }
      } catch (error: any) {
        subscriptionLogger.error(
          { error, tenantId: subscription.tenantId, subscriptionId: subscription.id },
          'Error al procesar notificación de suscripción próxima a expirar'
        );
      }
    }

    subscriptionLogger.info('Verificación de suscripciones próximas a expirar completada');
  } catch (error: any) {
    subscriptionLogger.error(
      { error },
      'Error general al verificar suscripciones próximas a expirar'
    );
  }
}

/**
 * Procesa suscripciones expiradas (sin Stripe)
 */
export async function processExpiredSubscriptions(): Promise<void> {
  subscriptionLogger.info('Procesando suscripciones expiradas');

  try {
    const now = new Date();

    const expiredSubscriptions = await prisma.tenantSubscription.findMany({
      where: {
        OR: [
          {
            status: 'trial',
            trialEndsAt: {
              lt: now,
            },
          },
          {
            status: 'active',
            currentPeriodEndsAt: {
              lt: now,
            },
          },
        ],
      },
      include: {
        tenant: {
          include: {
            users: {
              where: { role: 'admin' },
            },
          },
        },
        plan: true,
      },
    });

    subscriptionLogger.info(`Se encontraron ${expiredSubscriptions.length} suscripciones expiradas`);

    for (const subscription of expiredSubscriptions) {
      try {
        await prisma.tenantSubscription.update({
          where: { id: subscription.id },
          data: { status: 'suspended' },
        });

        const message =
          `❌ *Suscripción Expirada*\n\n` +
          `Tu suscripción para *${subscription.tenant.businessName}* ha expirado.\n\n` +
          `Plan: ${subscription.plan.name}\n\n` +
          `Contacta con soporte para renovar tu suscripción.`;

        for (const admin of subscription.tenant.users) {
          await NotificationService.sendTelegramNotification(Number(admin.telegramId), message);
        }
      } catch (error: any) {
        subscriptionLogger.error(
          { error, subscriptionId: subscription.id },
          'Error procesando suscripción expirada'
        );
      }
    }
  } catch (error: any) {
    subscriptionLogger.error({ error }, 'Error procesando suscripciones expiradas');
  }
}

export const subscriptionJobs = {
  checkExpiringSubscriptions: {
    schedule: '0 9 * * *',
    task: checkExpiringSubscriptions,
    description: 'Verificar suscripciones próximas a expirar diariamente a las 9 AM',
  },
  processExpiredSubscriptions: {
    schedule: '0 0 * * *',
    task: processExpiredSubscriptions,
    description: 'Procesar suscripciones expiradas diariamente a medianoche',
  },
};

export default subscriptionJobs;
