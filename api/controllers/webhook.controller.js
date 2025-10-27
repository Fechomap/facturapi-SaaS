// api/controllers/webhook.controller.js
import logger from '../../core/utils/logger.js';
import NotificationService from '../../services/notification.service.js';
import prisma from '../../lib/prisma.js';

// Logger específico para webhooks
const webhookLogger = logger.child({ module: 'webhook-controller' });

/**
 * Controlador para webhooks de servicios externos
 */
class WebhookController {
  /**
   * Procesa webhooks de FacturAPI
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async handleFacturapiWebhook(req, res, _next) {
    try {
      const payload = req.body;

      // Validación básica
      if (!payload || !payload.type) {
        webhookLogger.warn('Se recibió webhook inválido de FacturAPI');
        return res.status(400).json({ error: 'Payload inválido' });
      }

      webhookLogger.info(`Webhook recibido de FacturAPI: ${payload.type}`);

      // Procesar según el tipo de evento
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
          webhookLogger.info(`Evento no manejado: ${payload.type}`);
      }

      res.json({
        received: true,
        type: payload.type,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      webhookLogger.error('Error al procesar webhook de FacturAPI:', error);

      // Por compatibilidad con FacturAPI, devolvemos un 200
      res.status(200).json({
        received: true,
        error: error.message,
        processed: false,
      });
    }
  }

  /**
   * Procesa webhooks genéricos
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async handleGenericWebhook(req, res, next) {
    try {
      const payload = req.body;
      const source = req.params.source;

      webhookLogger.info(`Webhook recibido de ${source}:`, payload);

      // Simulación de procesamiento
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
   * Procesa evento de cancelación de factura de FacturAPI
   * @param {Object} data - Datos del evento
   * @private
   */
  async handleInvoiceCanceled(data) {
    try {
      // Buscar la factura en nuestra base de datos
      const invoice = await prisma.tenantInvoice.findFirst({
        where: {
          facturapiInvoiceId: data.id,
        },
        include: {
          tenant: true,
        },
      });

      if (!invoice) {
        webhookLogger.warn(`Factura no encontrada: ${data.id}`);
        return;
      }

      // Actualizar estado en nuestra base de datos
      await prisma.tenantInvoice.update({
        where: {
          id: invoice.id,
        },
        data: {
          status: 'canceled',
        },
      });

      webhookLogger.info(`Factura ${data.id} marcada como cancelada`);

      // Notificar al tenant
      const message =
        `⚠️ *Factura Cancelada*\n\n` +
        `La factura ${invoice.series}-${invoice.folioNumber} ha sido cancelada en el SAT.\n\n` +
        `*Detalles:*\n` +
        `• Folio fiscal: ${data.uuid || 'N/A'}\n` +
        `• Fecha de cancelación: ${new Date().toISOString()}\n` +
        `• Total: $${Number(invoice.total).toFixed(2)} MXN`;

      await NotificationService.notifyTenantAdmins(invoice.tenantId, message);
    } catch (error) {
      webhookLogger.error('Error al procesar cancelación de factura:', error);
      throw error;
    }
  }

  /**
   * Procesa evento de pago de factura de FacturAPI
   * @param {Object} data - Datos del evento
   * @private
   */
  async handleInvoicePayment(data) {
    try {
      // Buscar la factura en nuestra base de datos
      const invoice = await prisma.tenantInvoice.findFirst({
        where: {
          facturapiInvoiceId: data.id,
        },
      });

      if (!invoice) {
        webhookLogger.warn(`Factura no encontrada: ${data.id}`);
        return;
      }

      // Actualizar estado de pago
      await prisma.tenantInvoice.update({
        where: {
          id: invoice.id,
        },
        data: {
          paymentStatus: 'paid',
          paymentDate: new Date(),
        },
      });

      webhookLogger.info(`Factura ${data.id} marcada como pagada`);
    } catch (error) {
      webhookLogger.error('Error al procesar pago de factura:', error);
      throw error;
    }
  }

  /**
   * Procesa evento de creación de recibo de FacturAPI
   * @param {Object} data - Datos del evento
   * @private
   */
  async handleReceiptCreated(data) {
    // Implementar según sea necesario
    webhookLogger.info(`Recibo creado: ${data.id}`);
  }
}

// Crear instancia del controlador
const webhookController = new WebhookController();

export default webhookController;
