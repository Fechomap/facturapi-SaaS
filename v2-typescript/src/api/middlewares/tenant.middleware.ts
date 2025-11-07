/**
 * Tenant Middleware
 * Middleware for tenant context and subscription validation
 */

import { Response, NextFunction } from 'express';
import { prisma } from '@config/database.js';
import { createModuleLogger } from '@core/utils/logger.js';
import type { TenantRequest } from '../../types/api.types.js';
import type { TenantSubscription } from '@prisma/client';

const logger = createModuleLogger('TenantMiddleware');

// Extend TenantRequest to include subscription
declare module '../../types/api.types.js' {
  interface TenantRequest {
    subscription?: TenantSubscription;
    getApiKey?: () => Promise<string>;
  }
}

/**
 * Middleware to extract and validate tenant information (optional)
 */
function tenantMiddleware(req: TenantRequest, res: Response, next: NextFunction): void {
  (async () => {
    try {
      const tenantId = (req.headers['x-tenant-id'] as string) || (req.query.tenantId as string);

      if (!tenantId) {
        return next();
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          businessName: true,
          email: true,
          facturapiApiKey: true,
          isActive: true,
        },
      });

      if (!tenant) {
        res.status(404).json({
          error: 'TenantNotFound',
          message: 'Specified tenant does not exist',
        });
        return;
      }

      if (!tenant.isActive) {
        logger.warn({ tenantId }, 'Access denied: Tenant marked as inactive administratively');
        res.status(403).json({
          error: 'TenantInactive',
          message: 'Specified tenant is inactive',
        });
        return;
      }

      req.tenant = {
        id: tenant.id,
        businessName: tenant.businessName,
        email: tenant.email,
        facturapiApiKey: tenant.facturapiApiKey,
        isActive: tenant.isActive,
      };

      next();
    } catch (error) {
      logger.error({ error }, 'Error in tenant middleware');
      next(error);
    }
  })();
}

/**
 * Middleware to require tenant with valid subscription
 */
function requireTenant(req: TenantRequest, res: Response, next: NextFunction): void {
  (async () => {
    try {
      const tenantId =
        (req.headers['x-tenant-id'] as string) ||
        (req.query.tenantId as string) ||
        req.body?.tenantId;

      if (!tenantId) {
        res.status(400).json({
          error: 'TenantRequired',
          message: 'Must provide a tenant ID (X-Tenant-ID header, query param, or body)',
        });
        return;
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { plan: true },
          },
        },
      });

      if (!tenant) {
        res.status(404).json({
          error: 'TenantNotFound',
          message: 'Specified tenant does not exist',
        });
        return;
      }

      const subscription = tenant.subscriptions?.[0];
      const now = new Date();
      let allowAccess = false;
      let denialReason = 'NoSubscription';

      if (subscription) {
        logger.debug(
          { tenantId, subscriptionId: subscription.id, status: subscription.status },
          'Checking subscription status'
        );

        switch (subscription.status) {
          case 'trial':
            if (subscription.trialEndsAt && subscription.trialEndsAt > now) {
              allowAccess = true;
              logger.debug({ tenantId }, 'Access allowed: In trial period');
            } else {
              denialReason = 'TrialExpired';
              logger.warn(
                { tenantId, trialEndsAt: subscription.trialEndsAt?.toISOString() },
                'Access denied: Trial period expired'
              );
            }
            break;

          case 'active':
            if (subscription.currentPeriodEndsAt && subscription.currentPeriodEndsAt > now) {
              allowAccess = true;
              logger.debug({ tenantId }, 'Access allowed: Active subscription');
            } else {
              denialReason = 'ActivePeriodEnded';
              const gracePeriodEnd = subscription.currentPeriodEndsAt
                ? new Date(subscription.currentPeriodEndsAt)
                : new Date(0);
              gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 3);

              if (gracePeriodEnd > now) {
                allowAccess = true;
                denialReason = 'InGracePeriod';
                logger.info(
                  { tenantId, gracePeriodEnd: gracePeriodEnd.toISOString() },
                  'Access allowed: In grace period'
                );
              } else {
                logger.warn(
                  { tenantId, gracePeriodEnd: gracePeriodEnd.toISOString() },
                  'Access denied: Grace period expired'
                );
                denialReason = 'GracePeriodExpired';
              }
            }
            break;

          case 'payment_pending': {
            const referenceDateForGrace =
              subscription.currentPeriodEndsAt || subscription.trialEndsAt;
            if (referenceDateForGrace) {
              const gracePeriodEnd = new Date(referenceDateForGrace);
              gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 3);

              if (gracePeriodEnd > now) {
                allowAccess = true;
                denialReason = 'InGracePeriod (Pending)';
                logger.info(
                  { tenantId, gracePeriodEnd: gracePeriodEnd.toISOString() },
                  'Access allowed: In grace period (pending status)'
                );
              } else {
                logger.warn(
                  { tenantId, gracePeriodEnd: gracePeriodEnd.toISOString() },
                  'Access denied: Grace period expired (pending status)'
                );
                denialReason = 'GracePeriodExpired (Pending)';
              }
            } else {
              logger.warn(
                { tenantId },
                'Access denied: Payment pending without reference date for grace'
              );
              denialReason = 'PaymentPendingUnknownGrace';
            }
            break;
          }

          case 'suspended':
          case 'cancelled':
          default:
            allowAccess = false;
            denialReason = `Subscription${subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}`;
            logger.warn(
              { tenantId, status: subscription.status },
              `Access denied: Subscription status ${subscription.status}`
            );
            break;
        }
      } else {
        allowAccess = false;
        logger.warn({ tenantId }, 'Access denied: No subscription found for tenant');
      }

      if (!allowAccess) {
        res.status(403).json({
          error: 'SubscriptionInvalid',
          message: `Access denied. Subscription status: ${denialReason}.`,
          reason: denialReason,
        });
        return;
      }

      if (!req.tenant) {
        req.tenant = {
          id: tenant.id,
          businessName: tenant.businessName,
          email: tenant.email,
          facturapiApiKey: tenant.facturapiApiKey,
          isActive: tenant.isActive,
        };
      }

      req.subscription = subscription;

      next();
    } catch (error) {
      logger.error({ error }, 'Error in requireTenant middleware');
      next(error);
    }
  })();
}

export { tenantMiddleware, requireTenant };
export default { tenantMiddleware, requireTenant };
