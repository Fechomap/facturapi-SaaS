// services/reports.service.js
import { prisma } from '../config/database.js';
import logger from '../core/utils/logger.js';
import NotificationService from './notification.service.js';

// Logger específico para el servicio de reportes
const reportsLogger = logger.child({ module: 'reports-service' });

/**
 * Servicio para generación y envío de reportes
 */
class ReportsService {
  /**
   * Genera un reporte mensual de facturación
   * @param {string} tenantId - ID del tenant
   * @param {Object} options - Opciones para el reporte
   * @returns {Promise<Object>} - Datos del reporte
   */
  static async generateMonthlyInvoiceReport(tenantId, options = {}) {
    const {
      year = new Date().getFullYear(),
      month = new Date().getMonth(), // 0-11
      format = 'text' // 'text', 'json', 'html'
    } = options;
    
    reportsLogger.info({ tenantId, year, month }, 'Generando reporte mensual de facturación');
    
    try {
      // Obtener información del tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId }
      });
      
      if (!tenant) {
        throw new Error(`Tenant no encontrado: ${tenantId}`);
      }
      
      // Establecer fechas de inicio y fin del mes
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0); // Último día del mes
      endDate.setHours(23, 59, 59, 999);
      
      // Obtener facturas del mes
      const invoices = await prisma.tenantInvoice.findMany({
        where: {
          tenantId,
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        },
        include: {
          customer: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      });
      
      // Calcular totales
      const totalInvoices = invoices.length;
      const totalAmount = invoices.reduce((sum, inv) => sum + Number(inv.total), 0);
      
      // Calcular por estado
      const validInvoices = invoices.filter(inv => inv.status === 'valid');
      const canceledInvoices = invoices.filter(inv => inv.status === 'canceled');
      const validAmount = validInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
      
      // Calcular por cliente (top 5)
      const clientInvoices = {};
      invoices.forEach(inv => {
        const clientName = inv.customer?.legalName || 'Cliente Desconocido';
        
        if (!clientInvoices[clientName]) {
          clientInvoices[clientName] = {
            count: 0,
            total: 0
          };
        }
        
        if (inv.status === 'valid') {
          clientInvoices[clientName].count++;
          clientInvoices[clientName].total += Number(inv.total);
        }
      });
      
      // Ordenar clientes por total
      const topClients = Object.entries(clientInvoices)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);
      
      // Preparar respuesta
      const reportData = {
        tenant: {
          id: tenant.id,
          name: tenant.businessName
        },
        period: {
          year,
          month: month + 1, // 1-12 para humanos
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        },
        summary: {
          totalInvoices,
          validInvoices: validInvoices.length,
          canceledInvoices: canceledInvoices.length,
          totalAmount,
          validAmount
        },
        topClients,
        invoices: format === 'json' ? invoices : undefined
      };
      
      // Formatear según el formato solicitado
      if (format === 'text') {
        const monthNames = [
          'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
          'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];
        
        const textReport = 
          `📊 *Reporte Mensual de Facturación*\n\n` +
          `*Empresa:* ${tenant.businessName}\n` +
          `*Período:* ${monthNames[month]} ${year}\n\n` +
          
          `*Resumen:*\n` +
          `• Facturas emitidas: ${totalInvoices}\n` +
          `• Facturas válidas: ${validInvoices.length}\n` +
          `• Facturas canceladas: ${canceledInvoices.length}\n` +
          `• Monto total: $${totalAmount.toFixed(2)} MXN\n` +
          `• Monto facturas válidas: $${validAmount.toFixed(2)} MXN\n\n` +
          
          `*Top Clientes:*\n` +
          topClients.map(c => `• ${c.name}: ${c.count} facturas, $${c.total.toFixed(2)} MXN`).join('\n');
        
        return { 
          data: reportData, 
          formatted: textReport,
          format: 'text'
        };
      } else if (format === 'html') {
        // Implementar formato HTML si es necesario
        return { 
          data: reportData, 
          format: 'json' // Por ahora solo devuelve JSON
        };
      } else {
        return { 
          data: reportData, 
          format: 'json'
        };
      }
    } catch (error) {
      reportsLogger.error({ error, tenantId }, 'Error al generar reporte mensual');
      throw error;
    }
  }
  
  /**
   * Genera un reporte de suscripción
   * @param {string} tenantId - ID del tenant
   * @param {Object} options - Opciones para el reporte
   * @returns {Promise<Object>} - Datos del reporte
   */
  static async generateSubscriptionReport(tenantId, options = {}) {
    const { format = 'text' } = options;
    
    reportsLogger.info({ tenantId }, 'Generando reporte de suscripción');
    
    try {
      // Obtener información del tenant con su suscripción
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          subscriptions: {
            include: {
              plan: true
            },
            orderBy: {
              createdAt: 'desc'
            },
            take: 1
          }
        }
      });
      
      if (!tenant) {
        throw new Error(`Tenant no encontrado: ${tenantId}`);
      }
      
      // Verificar que tenga suscripción
      if (!tenant.subscriptions || tenant.subscriptions.length === 0) {
        throw new Error(`El tenant ${tenantId} no tiene suscripción activa`);
      }
      
      const subscription = tenant.subscriptions[0];
      const plan = subscription.plan;
      
      // Calcular fechas importantes
      const now = new Date();
      
      // Calcular estado y fechas relevantes
      let status = subscription.status;
      let endDate = null;
      let daysLeft = 0;
      
      if (status === 'trial') {
        endDate = subscription.trialEndsAt;
      } else {
        endDate = subscription.currentPeriodEndsAt;
      }
      
      if (endDate) {
        daysLeft = Math.ceil((new Date(endDate) - now) / (1000 * 60 * 60 * 24));
      }
      
      // Calcular uso de facturas
      const invoicesUsed = subscription.invoicesUsed || 0;
      const invoicesLimit = plan.invoiceLimit || 0;
      const invoicesLeft = Math.max(0, invoicesLimit - invoicesUsed);
      const usagePercentage = invoicesLimit > 0 ? (invoicesUsed / invoicesLimit) * 100 : 0;
      
      // Construir datos del reporte
      const reportData = {
        tenant: {
          id: tenant.id,
          name: tenant.businessName
        },
        subscription: {
          id: subscription.id,
          status,
          startDate: subscription.currentPeriodStartsAt?.toISOString(),
          endDate: endDate?.toISOString(),
          daysLeft,
          trial: status === 'trial'
        },
        plan: {
          id: plan.id,
          name: plan.name,
          price: plan.price,
          currency: plan.currency,
          billingPeriod: plan.billingPeriod,
          invoiceLimit: plan.invoiceLimit
        },
        usage: {
          invoicesUsed,
          invoicesLeft,
          invoicesLimit,
          usagePercentage: Math.round(usagePercentage)
        }
      };
      
      // Formatear según el formato solicitado
      if (format === 'text') {
        const statusEmoji = {
          'trial': '🔍',
          'active': '✅',
          'payment_pending': '⚠️',
          'suspended': '❌',
          'cancelled': '🚫'
        };
        
        const textReport = 
          `📊 *Reporte de Suscripción*\n\n` +
          `*Empresa:* ${tenant.businessName}\n\n` +
          
          `*Estado:* ${statusEmoji[status] || ''} ${status}\n` +
          `*Plan:* ${plan.name}\n` +
          `*Precio:* ${Number(plan.price).toFixed(2)} ${plan.currency}/${plan.billingPeriod === 'monthly' ? 'mes' : 'año'}\n` +
          (endDate ? `*Vence:* ${new Date(endDate).toLocaleDateString()}\n` : '') +
          (daysLeft > 0 ? `*Días restantes:* ${daysLeft}\n\n` : '\n') +
          
          `*Uso de Facturas:*\n` +
          `• Facturas emitidas: ${invoicesUsed} de ${invoicesLimit}\n` +
          `• Facturas disponibles: ${invoicesLeft}\n` +
          `• Porcentaje utilizado: ${Math.round(usagePercentage)}%\n`;
        
        return { 
          data: reportData, 
          formatted: textReport,
          format: 'text'
        };
      } else {
        return { 
          data: reportData, 
          format: 'json'
        };
      }
    } catch (error) {
      reportsLogger.error({ error, tenantId }, 'Error al generar reporte de suscripción');
      throw error;
    }
  }
  
  /**
   * Envía un reporte por Telegram
   * @param {string} tenantId - ID del tenant
   * @param {string} reportType - Tipo de reporte ('monthly_invoice', 'subscription')
   * @param {Object} options - Opciones para el reporte
   * @returns {Promise<Object>} - Resultado del envío
   */
  static async sendReportByTelegram(tenantId, reportType, options = {}) {
    reportsLogger.info({ tenantId, reportType }, 'Enviando reporte por Telegram');
    
    try {
      let reportResult;
      
      // Generar el reporte según su tipo
      switch (reportType) {
        case 'monthly_invoice':
          reportResult = await this.generateMonthlyInvoiceReport(tenantId, {
            ...options,
            format: 'text'
          });
          break;
          
        case 'subscription':
          reportResult = await this.generateSubscriptionReport(tenantId, {
            ...options,
            format: 'text'
          });
          break;
          
        default:
          throw new Error(`Tipo de reporte no soportado: ${reportType}`);
      }
      
      // Obtener administradores del tenant
      const admins = await prisma.tenantUser.findMany({
        where: {
          tenantId,
          role: 'admin'
        }
      });
      
      if (admins.length === 0) {
        reportsLogger.warn({ tenantId }, 'No se encontraron administradores para enviar el reporte');
        return {
          success: false,
          error: 'No hay administradores para enviar el reporte'
        };
      }
      
      // Enviar a cada administrador
      const results = [];
      
      for (const admin of admins) {
        try {
          const result = await NotificationService.sendTelegramNotification(
            admin.telegramId,
            reportResult.formatted,
            { parse_mode: 'Markdown' }
          );
          
          results.push({
            telegramId: admin.telegramId.toString(),
            success: result.success
          });
        } catch (error) {
          reportsLogger.error(
            { error, tenantId, adminId: admin.id },
            'Error al enviar reporte a administrador'
          );
          
          results.push({
            telegramId: admin.telegramId.toString(),
            success: false,
            error: error.message
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      
      return {
        success: successCount > 0,
        totalRecipients: admins.length,
        successCount,
        results
      };
    } catch (error) {
      reportsLogger.error({ error, tenantId, reportType }, 'Error al enviar reporte');
      throw error;
    }
  }
}

export default ReportsService;