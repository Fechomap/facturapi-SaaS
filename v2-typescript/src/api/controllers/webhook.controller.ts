/**
 * Webhook Controller
 * Controller for webhook operations from external services
 */

import type { Response, NextFunction } from 'express';
import type { TenantInvoice } from '@prisma/client';
import { prisma } from '@config/database.js';
import { createModuleLogger } from '@core/utils/logger.js';
import NotificationService from '@services/notification.service.js';
import type { TenantRequest } from '../../types/api.types.js';

const logger = createModuleLogger('webhook-controller');

// Types for webhook controller
interface FacturapiWebhookPayload {
  type: string;
  data: {
    id: string;
    uuid?: string;
    [key: string]: unknown;
  };
}

interface GenericWebhookPayload {
  [key: string]: unknown;
}

interface WebhookResponse {
  received: boolean;
  processed?: boolean;
  success?: boolean;
  type?: string;
  timestamp?: string;
  error?: string;
}

/**
 * Extended tenant invoice with tenant relation
 */
interface TenantInvoiceWithTenant extends TenantInvoice {
  tenant: {
    id: string;
    businessName: string;
  };
}

/**
 * Controller for webhook-related operations
 */
class WebhookController {
  /**
   * Processes FacturAPI webhooks
   */
  async handleFacturapiWebhook(
    req: TenantRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> {
    try {
      const payload = req.body as FacturapiWebhookPayload;

      // Basic validation
      if (!payload || !payload.type) {
        logger.warn('Invalid webhook received from FacturAPI');
        res.status(400).json({ error: 'Invalid payload' } as WebhookResponse);
        return;
      }

      logger.info(`Webhook received from FacturAPI: ${payload.type}`);

      // Process based on event type
      switch (payload.type) {
        case 'invoice.canceled':
          await this.handleInvoiceCanceled(payload.data);
          break;

        case 'invoice.payment':
          await this.handleInvoicePayment(payload.data);
          break;

        case 'receipt.created':
          await this.handleReceiptCreated(payload.data);
          break;

        default:
          logger.info(`Unhandled event: ${payload.type}`);
      }

      res.json({
        received: true,
        type: payload.type,
        timestamp: new Date().toISOString(),
      } as WebhookResponse);
    } catch (error) {
      logger.error({ error }, 'Error processing FacturAPI webhook');

      // For FacturAPI compatibility, return 200
      res.status(200).json({
        received: true,
        error: error instanceof Error ? error.message : 'Unknown error',
        processed: false,
      } as WebhookResponse);
    }
  }

  /**
   * Processes generic webhooks
   */
  async handleGenericWebhook(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = req.body as GenericWebhookPayload;
      const source = req.params.source as string;

      logger.info({ source, payload }, `Webhook received from ${source}`);

      // Simulation of processing
      res.json({
        received: true,
        source,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Processes invoice cancellation event from FacturAPI
   * @private
   */
  private async handleInvoiceCanceled(data: {
    id: string;
    uuid?: string;
    [key: string]: unknown;
  }): Promise<void> {
    try {
      // Search for the invoice in our database
      const invoice = await prisma.tenantInvoice.findFirst({
        where: {
          facturapiInvoiceId: data.id,
        },
        include: {
          tenant: true,
        },
      });

      if (!invoice) {
        logger.warn({ invoiceId: data.id }, `Invoice not found: ${data.id}`);
        return;
      }

      const invoiceWithTenant = invoice as TenantInvoiceWithTenant;

      // Update status in our database
      await prisma.tenantInvoice.update({
        where: {
          id: invoice.id,
        },
        data: {
          status: 'canceled',
        },
      });

      logger.info({ invoiceId: data.id }, `Invoice ${data.id} marked as canceled`);

      // Notify the tenant
      const message =
        `⚠️ *Factura Cancelada*\n\n` +
        `La factura ${invoice.series}-${invoice.folioNumber} ha sido cancelada en el SAT.\n\n` +
        `*Detalles:*\n` +
        `• Folio fiscal: ${data.uuid || 'N/A'}\n` +
        `• Fecha de cancelación: ${new Date().toISOString()}\n` +
        `• Total: $${Number(invoice.total).toFixed(2)} MXN`;

      await NotificationService.notifyTenantAdmins(invoiceWithTenant.tenantId, message);
    } catch (error) {
      logger.error({ error }, 'Error processing invoice cancellation');
      throw error;
    }
  }

  /**
   * Processes invoice payment event from FacturAPI
   * @private
   */
  private async handleInvoicePayment(data: { id: string; [key: string]: unknown }): Promise<void> {
    try {
      // Search for the invoice in our database
      const invoice = await prisma.tenantInvoice.findFirst({
        where: {
          facturapiInvoiceId: data.id,
        },
      });

      if (!invoice) {
        logger.warn({ invoiceId: data.id }, `Invoice not found: ${data.id}`);
        return;
      }

      // Update payment status
      await prisma.tenantInvoice.update({
        where: {
          id: invoice.id,
        },
        data: {
          paymentStatus: 'paid',
          paymentDate: new Date(),
        },
      });

      logger.info({ invoiceId: data.id }, `Invoice ${data.id} marked as paid`);
    } catch (error) {
      logger.error({ error }, 'Error processing invoice payment');
      throw error;
    }
  }

  /**
   * Processes receipt creation event from FacturAPI
   * @private
   */
  private async handleReceiptCreated(data: { id: string; [key: string]: unknown }): Promise<void> {
    // Implement as needed
    logger.info({ receiptId: data.id }, `Receipt created: ${data.id}`);
  }
}

// Create controller instance
const webhookController = new WebhookController();

export default webhookController;
