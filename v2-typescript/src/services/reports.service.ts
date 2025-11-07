// services/reports.service.ts
import { prisma } from '../config/database';
import logger from '../core/utils/logger';
import NotificationService from './notification.service';

// Logger específico para el servicio de reportes
const reportsLogger = logger.child({ module: 'reports-service' });

interface MonthlyReportOptions {
  year?: number;
  month?: number;
  format?: 'text' | 'json' | 'html';
}

interface SubscriptionReportOptions {
  format?: 'text' | 'json';
}

interface ReportData {
  tenant: {
    id: string;
    name: string;
  };
  [key: string]: any;
}

interface MonthlyReportResult {
  data: ReportData;
  formatted?: string;
  format: string;
}

interface SubscriptionReportResult {
  data: ReportData;
  formatted?: string;
  format: string;
}

interface TelegramSendResult {
  success: boolean;
  totalRecipients?: number;
  successCount?: number;
  results?: Array<{ telegramId: string; success: boolean; error?: string }>;
  error?: string;
}

/**
 * Servicio para generación y envío de reportes
 */
class ReportsService {
  /**
   * Genera un reporte mensual de facturación
   */
  static async generateMonthlyInvoiceReport(
    tenantId: string,
    options: MonthlyReportOptions = {}
  ): Promise<MonthlyReportResult> {
    const {
      year = new Date().getFullYear(),
      month = new Date().getMonth(),
      format = 'text',
    } = options;

    reportsLogger.info({ tenantId, year, month }, 'Generando reporte mensual de facturación');

    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!tenant) {
        throw new Error(`Tenant no encontrado: ${tenantId}`);
      }

      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0);
      endDate.setHours(23, 59, 59, 999);

      const invoices = await prisma.tenantInvoice.findMany({
        where: {
          tenantId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          customer: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      const totalInvoices = invoices.length;
      const totalAmount = invoices.reduce((sum, inv) => sum + Number(inv.total), 0);

      const validInvoices = invoices.filter((inv) => inv.status === 'valid');
      const canceledInvoices = invoices.filter((inv) => inv.status === 'canceled');
      const validAmount = validInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);

      const clientInvoices: Record<string, { count: number; total: number }> = {};
      invoices.forEach((inv) => {
        const clientName = inv.customer?.legalName || 'Cliente Desconocido';

        if (!clientInvoices[clientName]) {
          clientInvoices[clientName] = {
            count: 0,
            total: 0,
          };
        }

        if (inv.status === 'valid') {
          clientInvoices[clientName].count++;
          clientInvoices[clientName].total += Number(inv.total);
        }
      });

      const topClients = Object.entries(clientInvoices)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      const reportData: ReportData = {
        tenant: {
          id: tenant.id,
          name: tenant.businessName,
        },
        period: {
          year,
          month: month + 1,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        summary: {
          totalInvoices,
          validInvoices: validInvoices.length,
          canceledInvoices: canceledInvoices.length,
          totalAmount,
          validAmount,
        },
        topClients,
        invoices: format === 'json' ? invoices : undefined,
      };

      if (format === 'text') {
        const monthNames = [
          'Enero',
          'Febrero',
          'Marzo',
          'Abril',
          'Mayo',
          'Junio',
          'Julio',
          'Agosto',
          'Septiembre',
          'Octubre',
          'Noviembre',
          'Diciembre',
        ];

        const formatNumber = (num: number | string) => {
          const value = typeof num === 'string' ? parseFloat(num) : num;
          return new Intl.NumberFormat('es-MX').format(value);
        };

        const formatClientName = (name: string) => {
          const nameMap: Record<string, string> = {
            'AXA ASSISTANCE MEXICO': 'AXA Assistance México',
            'INFOASIST INFORMACION Y ASISTENCIA': 'InfoAsist Información y Asistencia',
            'CHUBB DIGITAL SERVICES': 'Chubb Digital Services',
            'ARSA ASESORIA INTEGRAL PROFESIONAL': 'ARSA Asesoría Integral Profesional',
            'PROTECCION S.O.S. JURIDICO AUTOMOVILISTICO LAS VEINTICUATRO HORAS DEL DIA':
              'Protección S.O.S. Jurídico Automovilístico 24H',
          };
          return nameMap[name] || name;
        };

        const textReport =
          `📊 *Reporte Mensual de Facturación*\n\n` +
          `🧾 *Empresa:* ${tenant.businessName}\n` +
          `📅 *Período:* ${monthNames[month]} ${year}\n\n` +
          `⸻\n\n` +
          `📌 *Resumen*\n` +
          `    •    Facturas emitidas: ${totalInvoices}\n` +
          `    •    Facturas válidas: ${validInvoices.length}\n` +
          `    •    Facturas canceladas: ${canceledInvoices.length}\n` +
          `    •    💰 Monto total: $${formatNumber(totalAmount.toFixed(2))} MXN\n` +
          `    •    💵 Monto válido: $${formatNumber(validAmount.toFixed(2))} MXN\n\n` +
          `⸻\n\n` +
          `👥 *Top Clientes*\n` +
          topClients
            .map(
              (c, index) =>
                `    ${index + 1}.    ${formatClientName(c.name)}\n` +
                `• *${c.count}* facturas\n` +
                `• *$${formatNumber(c.total.toFixed(2))} MXN*\n`
            )
            .join('\n');

        return {
          data: reportData,
          formatted: textReport,
          format: 'text',
        };
      } else if (format === 'html') {
        return {
          data: reportData,
          format: 'json',
        };
      } else {
        return {
          data: reportData,
          format: 'json',
        };
      }
    } catch (error: any) {
      reportsLogger.error({ error, tenantId }, 'Error al generar reporte mensual');
      throw error;
    }
  }

  /**
   * Genera un reporte de suscripción
   */
  static async generateSubscriptionReport(
    tenantId: string,
    options: SubscriptionReportOptions = {}
  ): Promise<SubscriptionReportResult> {
    const { format = 'text' } = options;

    reportsLogger.info({ tenantId }, 'Generando reporte de suscripción');

    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
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

      if (!tenant) {
        throw new Error(`Tenant no encontrado: ${tenantId}`);
      }

      if (!tenant.subscriptions || tenant.subscriptions.length === 0) {
        throw new Error(`El tenant ${tenantId} no tiene suscripción activa`);
      }

      const subscription = tenant.subscriptions[0];
      const plan = subscription.plan;

      const now = new Date();

      const status = subscription.status;
      let endDate: Date | null = null;
      let daysLeft = 0;

      if (status === 'trial') {
        endDate = subscription.trialEndsAt;
      } else {
        endDate = subscription.currentPeriodEndsAt;
      }

      if (endDate) {
        daysLeft = Math.ceil((new Date(endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }

      const invoicesUsed = await prisma.tenantInvoice.count({
        where: {
          tenantId,
        },
      });
      const invoicesLimit = plan.invoiceLimit || 0;
      const invoicesLeft = Math.max(0, invoicesLimit - invoicesUsed);
      const usagePercentage = invoicesLimit > 0 ? (invoicesUsed / invoicesLimit) * 100 : 0;

      const reportData: ReportData = {
        tenant: {
          id: tenant.id,
          name: tenant.businessName,
        },
        subscription: {
          id: subscription.id,
          status,
          startDate: subscription.currentPeriodStartsAt?.toISOString(),
          endDate: endDate?.toISOString(),
          daysLeft,
          trial: status === 'trial',
        },
        plan: {
          id: plan.id,
          name: plan.name,
          price: plan.price,
          currency: plan.currency,
          billingPeriod: plan.billingPeriod,
          invoiceLimit: plan.invoiceLimit,
        },
        usage: {
          invoicesUsed,
          invoicesLeft,
          invoicesLimit,
          usagePercentage: Math.round(usagePercentage),
        },
      };

      if (format === 'text') {
        const statusEmoji: Record<string, string> = {
          trial: '🔍',
          active: '✅',
          payment_pending: '⚠️',
          suspended: '❌',
          cancelled: '🚫',
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
          format: 'text',
        };
      } else {
        return {
          data: reportData,
          format: 'json',
        };
      }
    } catch (error: any) {
      reportsLogger.error({ error, tenantId }, 'Error al generar reporte de suscripción');
      throw error;
    }
  }

  /**
   * Envía un reporte por Telegram
   */
  static async sendReportByTelegram(
    tenantId: string,
    reportType: string,
    options: any = {}
  ): Promise<TelegramSendResult> {
    reportsLogger.info({ tenantId, reportType }, 'Enviando reporte por Telegram');

    try {
      let reportResult: MonthlyReportResult | SubscriptionReportResult;

      switch (reportType) {
        case 'monthly_invoice':
          reportResult = await this.generateMonthlyInvoiceReport(tenantId, {
            ...options,
            format: 'text',
          });
          break;

        case 'subscription':
          reportResult = await this.generateSubscriptionReport(tenantId, {
            ...options,
            format: 'text',
          });
          break;

        default:
          throw new Error(`Tipo de reporte no soportado: ${reportType}`);
      }

      const admins = await prisma.tenantUser.findMany({
        where: {
          tenantId,
          role: 'admin',
        },
      });

      if (admins.length === 0) {
        reportsLogger.warn(
          { tenantId },
          'No se encontraron administradores para enviar el reporte'
        );
        return {
          success: false,
          error: 'No hay administradores para enviar el reporte',
        };
      }

      const results = [];

      for (const admin of admins) {
        try {
          const result = await NotificationService.sendTelegramNotification(
            Number(admin.telegramId),
            reportResult.formatted || '',
            { parse_mode: 'Markdown' }
          );

          results.push({
            telegramId: admin.telegramId.toString(),
            success: result.success,
          });
        } catch (error: any) {
          reportsLogger.error(
            { error, tenantId, adminId: admin.id },
            'Error al enviar reporte a administrador'
          );

          results.push({
            telegramId: admin.telegramId.toString(),
            success: false,
            error: error.message,
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;

      return {
        success: successCount > 0,
        totalRecipients: admins.length,
        successCount,
        results,
      };
    } catch (error: any) {
      reportsLogger.error({ error, tenantId, reportType }, 'Error al enviar reporte');
      throw error;
    }
  }
}

export default ReportsService;
