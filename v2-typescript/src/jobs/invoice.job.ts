// jobs/invoice.job.ts
import { prisma } from '../config/database';
import logger from '../core/utils/logger';
import facturapIService from '../services/facturapi.service';
import NotificationService from '../services/notification.service';
import { withRetry } from '../services/retry.service';

const invoiceLogger = logger.child({ module: 'invoice-jobs' });

/**
 * Sincroniza el estado de las facturas con FacturAPI
 */
export async function syncInvoiceStatus(): Promise<void> {
  invoiceLogger.info('Iniciando sincronización de estados de facturas');

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const invoices = await prisma.tenantInvoice.findMany({
      where: {
        status: 'valid',
        createdAt: {
          gte: thirtyDaysAgo,
        },
      },
      include: {
        tenant: true,
      },
    });

    invoiceLogger.info(`Encontradas ${invoices.length} facturas para sincronizar`);

    for (const invoice of invoices) {
      try {
        const tenantId = invoice.tenantId;
        const facturapiId = invoice.facturapiInvoiceId;

        const facturapiInvoice = await withRetry(
          async () => {
            const facturapi = await facturapIService.getFacturapiClient(tenantId);
            return facturapi.invoices.retrieve(facturapiId);
          },
          {
            maxRetries: 3,
            retryDelay: 1000,
            description: `Obtener factura ${facturapiId} de FacturAPI`,
          }
        );

        if (facturapiInvoice.status !== invoice.status) {
          invoiceLogger.info(
            `Cambio de estado detectado para factura ${invoice.series}-${invoice.folioNumber}: ${invoice.status} → ${facturapiInvoice.status}`
          );

          await prisma.tenantInvoice.update({
            where: { id: invoice.id },
            data: { status: facturapiInvoice.status },
          });

          if (facturapiInvoice.status === 'canceled') {
            const adminUsers = await prisma.tenantUser.findMany({
              where: {
                tenantId: invoice.tenantId,
                role: 'admin',
              },
            });

            const message =
              `⚠️ *Factura Cancelada*\n\n` +
              `La factura ${invoice.series}-${invoice.folioNumber} ha sido cancelada en el sistema del SAT.\n\n` +
              `Fecha de cancelación: ${new Date().toLocaleDateString()}\n` +
              `Tenant: ${invoice.tenant.businessName}\n`;

            for (const admin of adminUsers) {
              await NotificationService.sendTelegramNotification(
                Number(admin.telegramId),
                message
              );
            }
          }
        }
      } catch (error: any) {
        invoiceLogger.error(
          { error, invoiceId: invoice.id, tenantId: invoice.tenantId },
          'Error al sincronizar factura con FacturAPI'
        );
      }
    }

    invoiceLogger.info('Sincronización de estados de facturas completada');
  } catch (error: any) {
    invoiceLogger.error({ error }, 'Error en sincronización de estados de facturas');
  }
}

export const invoiceJobs = {
  syncInvoiceStatus: {
    schedule: '0 */6 * * *',
    task: syncInvoiceStatus,
    description: 'Sincronizar estados de facturas cada 6 horas',
  },
};

export default invoiceJobs;
