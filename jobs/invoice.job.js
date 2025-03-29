// jobs/invoice.job.js - Jobs relacionados con facturas
import { prisma } from '../config/database.js';
import logger from '../core/utils/logger.js';
import facturapIService from '../services/facturapi.service.js';
import NotificationService from '../services/notification.service.js';
import { withRetry } from '../services/retry.service.js';

// Logger específico para jobs de facturas
const invoiceLogger = logger.child({ module: 'invoice-jobs' });

/**
 * Sincroniza el estado de las facturas con FacturAPI
 * @returns {Promise<void>}
 */
async function syncInvoiceStatus() {
  invoiceLogger.info('Iniciando sincronización de estados de facturas');
  
  try {
    // Obtener facturas que necesitan sincronización (últimos 30 días)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const invoices = await prisma.tenantInvoice.findMany({
      where: {
        status: 'valid', // Solo facturas válidas
        createdAt: {
          gte: thirtyDaysAgo
        }
      },
      include: {
        tenant: true
      }
    });
    
    invoiceLogger.info(`Encontradas ${invoices.length} facturas para sincronizar`);
    
    // Recorrer cada factura y verificar su estado en FacturAPI
    for (const invoice of invoices) {
      try {
        const tenantId = invoice.tenantId;
        const facturapiId = invoice.facturapiInvoiceId;
        
        // Obtener factura de FacturAPI con reintentos
        const facturapiInvoice = await withRetry(async () => {
          const facturapi = await facturapIService.getFacturapiClient(tenantId);
          return facturapi.invoices.retrieve(facturapiId);
        }, {
          maxRetries: 3,
          retryDelay: 1000,
          description: `Obtener factura ${facturapiId} de FacturAPI`
        });
        
        // Si el estado ha cambiado, actualizar en nuestra base de datos
        if (facturapiInvoice.status !== invoice.status) {
          invoiceLogger.info(
            `Cambio de estado detectado para factura ${invoice.series}-${invoice.folioNumber}: ${invoice.status} → ${facturapiInvoice.status}`
          );
          
          // Actualizar estado en base de datos
          await prisma.tenantInvoice.update({
            where: { id: invoice.id },
            data: { status: facturapiInvoice.status }
          });
          
          // Si la factura fue cancelada, notificar
          if (facturapiInvoice.status === 'canceled') {
            // Buscar al administrador para notificar
            const adminUsers = await prisma.tenantUser.findMany({
              where: {
                tenantId: invoice.tenantId,
                role: 'admin'
              }
            });
            
            // Crear mensaje de notificación
            const message = `⚠️ *Factura Cancelada*\n\n` +
              `La factura ${invoice.series}-${invoice.folioNumber} ha sido cancelada en el sistema del SAT.\n\n` +
              `Fecha de cancelación: ${new Date().toLocaleDateString()}\n` +
              `Tenant: ${invoice.tenant.businessName}\n`;
            
            // Enviar notificación a administradores
            for (const admin of adminUsers) {
              await NotificationService.sendTelegramNotification(admin.telegramId, message);
            }
          }
        }
      } catch (error) {
        invoiceLogger.error(
          { error, invoiceId: invoice.id, tenantId: invoice.tenantId },
          'Error al sincronizar factura con FacturAPI'
        );
      }
    }
    
    invoiceLogger.info('Sincronización de estados de facturas completada');
  } catch (error) {
    invoiceLogger.error({ error }, 'Error general en sincronización de facturas');
  }
}

/**
 * Genera informes diarios de facturación por tenant
 * @returns {Promise<void>}
 */
async function generateDailyInvoiceReports() {
  invoiceLogger.info('Generando informes diarios de facturación');
  
  try {
    // Obtener todos los tenants activos
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true },
      include: {
        users: {
          where: { role: 'admin' }
        }
      }
    });
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Generar informe para cada tenant
    for (const tenant of tenants) {
      try {
        // Obtener facturas del día anterior
        const invoices = await prisma.tenantInvoice.findMany({
          where: {
            tenantId: tenant.id,
            createdAt: {
              gte: yesterday,
              lt: today
            }
          }
        });
        
        // Si no hay facturas, no generar informe
        if (invoices.length === 0) continue;
        
        // Calcular total facturado
        const total = invoices.reduce((sum, invoice) => sum + Number(invoice.total), 0);
        
        // Generar mensaje de informe
        const report = `📊 *Informe Diario de Facturación*\n\n` +
          `Empresa: ${tenant.businessName}\n` +
          `Fecha: ${yesterday.toLocaleDateString()}\n\n` +
          `Facturas emitidas: ${invoices.length}\n` +
          `Total facturado: $${total.toFixed(2)} MXN\n\n` +
          `Detalles por factura:\n` +
          invoices.map(inv => `• ${inv.series}-${inv.folioNumber}: $${Number(inv.total).toFixed(2)}`).join('\n');
        
        // Enviar a cada administrador
        for (const admin of tenant.users) {
          await NotificationService.sendTelegramNotification(admin.telegramId, report);
        }
        
        invoiceLogger.info(`Informe enviado para tenant ${tenant.id} (${tenant.businessName})`);
      } catch (error) {
        invoiceLogger.error(
          { error, tenantId: tenant.id },
          'Error al generar informe diario para tenant'
        );
      }
    }
    
    invoiceLogger.info('Generación de informes diarios completada');
  } catch (error) {
    invoiceLogger.error({ error }, 'Error general en generación de informes diarios');
  }
}

// Exportar las tareas programadas
export const invoiceJobs = {
  // Cada 6 horas sincronizar estados de facturas
  syncInvoiceStatus: {
    schedule: '0 */6 * * *',
    task: syncInvoiceStatus
  },
  
  // Diariamente a las 8:00 AM generar informes de facturación
  generateDailyInvoiceReports: {
    schedule: '0 8 * * *',
    task: generateDailyInvoiceReports
  }
};