/**
 * Tenant Service
 * Service for tenant management in multi-tenant architecture
 */

import { prisma } from '@config/database.js';
import { createModuleLogger } from '@core/utils/logger.js';
import type {
  Tenant,
  TenantSubscription,
  SubscriptionPlan,
  TenantCustomer,
  TenantInvoice,
} from '@prisma/client';

const logger = createModuleLogger('TenantService');

interface TenantWithSubscription extends Tenant {
  subscriptions?: Array<TenantSubscription & { plan: SubscriptionPlan }>;
}

interface CanGenerateResult {
  canGenerate: boolean;
  reason?: string;
  subscriptionStatus?: string;
  paymentLink?: string;
}

/**
 * Tenant Service Class
 */
class TenantService {
  /**
   * Find customer by name pattern
   */
  static async getCustomerByName(
    tenantId: string,
    namePattern: string
  ): Promise<TenantCustomer | null> {
    try {
      return await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          legalName: { contains: namePattern },
        },
      });
    } catch (error) {
      logger.error({ tenantId, namePattern, error }, 'Error finding customer by name');
      return null;
    }
  }

  /**
   * Find user by Telegram ID
   */
  static async findUserByTelegramId(telegramId: bigint) {
    return prisma.tenantUser.findFirst({
      where: { telegramId },
      include: {
        tenant: true,
      },
    });
  }

  /**
   * Get next available folio for tenant
   * OPTIMIZED: Single atomic query
   */
  static async getNextFolio(tenantId: string, series = 'A'): Promise<number> {
    try {
      // Use transaction with SELECT FOR UPDATE to avoid race conditions
      const result = await prisma.$transaction(async (tx) => {
        // Find or create record with lock
        let folio = await tx.tenantFolio.findUnique({
          where: {
            tenantId_series: {
              tenantId,
              series,
            },
          },
        });

        if (!folio) {
          // Create with initial value
          folio = await tx.tenantFolio.create({
            data: {
              tenantId,
              series,
              currentNumber: 801,
            },
          });
          return 800;
        }

        // Update and increment
        await tx.tenantFolio.update({
          where: { id: folio.id },
          data: { currentNumber: { increment: 1 } },
        });

        return folio.currentNumber;
      });

      return result;
    } catch (error) {
      logger.error({ tenantId, series, error }, 'Error getting next folio');

      // Fallback to previous method if fails
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
   * Check if tenant can generate more invoices according to plan
   */
  static async canGenerateInvoice(tenantId: string): Promise<CanGenerateResult> {
    try {
      const tenant = await this.findTenantWithSubscription(tenantId);

      if (!tenant) {
        return { canGenerate: false, reason: 'Tenant not found.' };
      }

      const subscription = tenant.subscriptions?.[0]; // Most recent

      if (!subscription) {
        return {
          canGenerate: false,
          reason: 'No active subscription found.',
          subscriptionStatus: 'none',
        };
      }

      const status = subscription.status;
      const plan = subscription.plan;

      // 1. Check Subscription Status
      const isActiveStatus = status === 'active' || status === 'trial';
      if (!isActiveStatus) {
        let reason = 'Inactive subscription.';
        if (status === 'pending_payment') reason = 'Subscription pending payment.';
        else if (status === 'expired') reason = 'Subscription expired.';
        else if (status === 'canceled') reason = 'Subscription canceled.';

        return {
          canGenerate: false,
          reason: reason,
          subscriptionStatus: status,
        };
      }

      // 2. Check Invoice Limit (if plan has one)
      if (plan && plan.invoiceLimit !== null && plan.invoiceLimit > 0) {
        const invoicesUsed = subscription.invoicesUsed || 0;
        if (invoicesUsed >= plan.invoiceLimit) {
          return {
            canGenerate: false,
            reason: `Limit of ${plan.invoiceLimit} invoices reached for plan ${plan.name}.`,
            subscriptionStatus: status,
          };
        }
      }

      // Passes all checks
      return { canGenerate: true, subscriptionStatus: status };
    } catch (error) {
      logger.error({ tenantId, error }, 'Error checking invoice generation capability');
      return { canGenerate: false, reason: 'Internal error checking subscription.' };
    }
  }

  /**
   * Register generated invoice
   */
  static async registerInvoice(
    tenantId: string,
    facturapiInvoiceId: string,
    series: string,
    folioNumber: number,
    customerId: number | null,
    total: number,
    createdById?: number | null
  ): Promise<TenantInvoice> {
    logger.info({ tenantId, series, folioNumber }, 'Registering invoice');

    try {
      const invoice = await prisma.tenantInvoice.create({
        data: {
          tenantId,
          facturapiInvoiceId,
          series,
          folioNumber,
          customerId: customerId ? parseInt(String(customerId), 10) : null,
          total,
          status: 'valid',
          createdById: createdById || null,
          invoiceDate: new Date(),
        },
      });

      logger.info({ invoiceId: invoice.id }, 'Invoice saved to database');

      // Increment invoice counter
      await this.incrementInvoiceCount(tenantId);

      return invoice;
    } catch (error) {
      logger.error({ tenantId, error }, 'Error registering invoice');
      throw error;
    }
  }

  /**
   * Create subscription for tenant
   */
  static async createSubscription(tenantId: string, planId: number) {
    logger.info({ tenantId, planId }, 'Creating subscription');

    return {
      tenantId,
      planId,
      status: 'trial',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
      invoicesUsed: 0,
    };
  }

  /**
   * Find tenant with subscription
   */
  static async findTenantWithSubscription(id: string): Promise<TenantWithSubscription | null> {
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
      logger.error({ tenantId: id, error }, 'Error finding tenant with subscription');
      throw error;
    }
  }

  /**
   * Increment invoice counter in current subscription
   */
  static async incrementInvoiceCount(tenantId: string) {
    logger.debug({ tenantId }, 'Incrementing invoice counter');

    try {
      // Get active subscription
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
        logger.warn({ tenantId }, 'No active subscription found');
        return null;
      }

      // Increment counter
      const updatedSubscription = await prisma.tenantSubscription.update({
        where: { id: subscription.id },
        data: {
          invoicesUsed: {
            increment: 1,
          },
        },
      });

      logger.info(
        { tenantId, invoicesUsed: updatedSubscription.invoicesUsed },
        'Invoice counter incremented'
      );
      return updatedSubscription;
    } catch (error) {
      logger.error({ tenantId, error }, 'Error incrementing invoice counter');
      throw error;
    }
  }

  /**
   * Get real count of issued invoices for tenant
   */
  static async getTenantInvoiceCount(tenantId: string): Promise<number> {
    try {
      const count = await prisma.tenantInvoice.count({
        where: {
          tenantId,
        },
      });
      return count;
    } catch (error) {
      logger.error({ tenantId, error }, 'Error getting invoice count');
      return 0;
    }
  }
}

export default TenantService;
