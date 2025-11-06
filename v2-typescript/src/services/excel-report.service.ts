// services/excel-report.service.ts
import { prisma } from '../config/database';
import logger from '../core/utils/logger';

const excelLogger = logger.child({ module: 'excel-report-service' });

interface ReportConfig {
  limit?: number;
  includeDetails?: boolean;
  format?: string;
  dateRange?: any;
  clientIds?: string[] | null;
}

interface ReportResult {
  success: boolean;
  error?: string;
  buffer?: Buffer;
  stats?: {
    totalInvoices: number;
  };
}

/**
 * Servicio para generación de reportes Excel
 * TODO: Migrar implementación completa desde excel-report.service.js (~28KB)
 */
class ExcelReportService {
  static async generateInvoiceReport(
    tenantId: string,
    config: ReportConfig = {}
  ): Promise<ReportResult> {
    excelLogger.info({ tenantId, config }, 'Generando reporte de facturas');

    try {
      // TODO: Implementar generación completa de Excel
      return {
        success: false,
        error: 'Servicio en migración a TypeScript',
      };
    } catch (error: any) {
      excelLogger.error({ error, tenantId }, 'Error generando reporte');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  static async getTenantCustomers(tenantId: string) {
    try {
      return await prisma.tenantCustomer.findMany({
        where: { tenantId },
        select: {
          id: true,
          legalName: true,
          facturapiCustomerId: true,
        },
        orderBy: { legalName: 'asc' },
      });
    } catch (error: any) {
      excelLogger.error({ error, tenantId }, 'Error obteniendo clientes');
      return [];
    }
  }

  static async estimateReportGeneration(tenantId: string, filters: any = {}) {
    try {
      const count = await prisma.tenantInvoice.count({
        where: { tenantId },
      });

      return {
        totalAvailable: count,
        willGenerate: Math.min(count, filters.limit || 5000),
        hasMoreThanLimit: count > (filters.limit || 5000),
      };
    } catch (error: any) {
      excelLogger.error({ error, tenantId }, 'Error estimando reporte');
      return {
        totalAvailable: 0,
        willGenerate: 0,
        hasMoreThanLimit: false,
      };
    }
  }
}

export default ExcelReportService;
