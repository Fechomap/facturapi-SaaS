// jobs/subscription.job.js - Jobs relacionados con suscripciones
import { prisma } from '../config/database.js';
import logger from '../core/utils/logger.js';
import NotificationService from '../services/notification.service.js';

// Logger específico para jobs de suscripción
const subscriptionLogger = logger.child({ module: 'subscription-jobs' });

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
        ]
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
        const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
        
        // Crear mensaje de notificación
        const message = `⚠️ *Alerta de Suscripción*\n\n` +
          `Tu ${subscription.status === 'trial' ? 'período de prueba' : 'suscripción'} para *${tenant.businessName}* ` +
          `expirará en *${daysLeft} días*.\n\n` +
          `Plan actual: ${subscription.plan.name}\n` +
          `Fecha de expiración: ${endDate.toLocaleDateString()}\n\n` +
          `Para continuar usando el servicio, por favor actualiza tu suscripción.`;
        
        // Enviar notificación a todos los administradores
        for (const admin of adminUsers) {
          await NotificationService.sendTelegramNotification(admin.telegramId, message);
          subscriptionLogger.info(`Notificación enviada a ${admin.telegramId} para tenant ${tenant.id}`);
        }
        
      } catch (error) {
        subscriptionLogger.error(
          { error, tenantId: subscription.tenantId, subscriptionId: subscription.id },
          'Error al procesar notificación de suscripción'
        );
      }
    }
    
    subscriptionLogger.info('Verificación de suscripciones completada');
  } catch (error) {
    subscriptionLogger.error({ error }, 'Error al verificar suscripciones próximas a expirar');
  }
}

/**
 * Actualiza estados de suscripciones expiradas
 * @returns {Promise<void>}
 */
async function updateExpiredSubscriptions() {
  subscriptionLogger.info('Actualizando suscripciones expiradas');
  
  try {
    const now = new Date();
    
    // Buscar suscripciones de prueba expiradas
    const expiredTrials = await prisma.tenantSubscription.updateMany({
      where: {
        status: 'trial',
        trialEndsAt: {
          lt: now
        }
      },
      data: {
        status: 'payment_pending'
      }
    });
    
    // Buscar suscripciones activas expiradas
    const expiredSubscriptions = await prisma.tenantSubscription.updateMany({
      where: {
        status: 'active',
        currentPeriodEndsAt: {
          lt: now
        }
      },
      data: {
        status: 'payment_pending'
      }
    });
    
    subscriptionLogger.info(`Actualizadas ${expiredTrials.count} suscripciones de prueba y ${expiredSubscriptions.count} suscripciones activas expiradas`);
    
    // Obtener detalles de las suscripciones actualizadas para enviar notificaciones
    const updatedSubscriptions = await prisma.tenantSubscription.findMany({
      where: {
        status: 'payment_pending',
        updatedAt: {
          gte: new Date(Date.now() - 10 * 60 * 1000) // Últimos 10 minutos
        }
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
    
    // Enviar notificaciones para cada suscripción
    for (const subscription of updatedSubscriptions) {
      try {
        const tenant = subscription.tenant;
        const adminUsers = tenant.users;
        
        if (adminUsers.length === 0) continue;
        
        const message = `🚨 *Suscripción Vencida*\n\n` +
          `Tu ${subscription.trialEndsAt ? 'período de prueba' : 'suscripción'} para *${tenant.businessName}* ` +
          `ha vencido.\n\n` +
          `Plan: ${subscription.plan.name}\n` +
          `Estado: Pago pendiente\n\n` +
          `Para continuar usando todos los servicios, por favor actualiza tu método de pago.`;
        
        // Enviar notificación a todos los administradores
        for (const admin of adminUsers) {
          await NotificationService.sendTelegramNotification(admin.telegramId, message);
        }
        
      } catch (error) {
        subscriptionLogger.error(
          { error, tenantId: subscription.tenantId },
          'Error al enviar notificación de suscripción expirada'
        );
      }
    }
    
  } catch (error) {
    subscriptionLogger.error({ error }, 'Error al actualizar suscripciones expiradas');
  }
}

// Exportar las tareas programadas
export const subscriptionJobs = {
  // Diariamente a las 9:00 AM verificar suscripciones próximas a expirar
  checkExpiringSubscriptions: {
    schedule: '0 9 * * *',
    task: checkExpiringSubscriptions
  },
  
  // Cada hora actualizar estados de suscripciones expiradas
  updateExpiredSubscriptions: {
    schedule: '0 * * * *',
    task: updateExpiredSubscriptions
  }
};