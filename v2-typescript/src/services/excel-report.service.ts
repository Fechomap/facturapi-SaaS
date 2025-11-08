/**
 * Excel Report Service
 * Servicio principal para generación de reportes Excel de facturas
 */

import ExcelJS from 'exceljs';
import { prisma } from '../config/database.js';
import { createModuleLogger } from '../core/utils/logger.js';
import type { Prisma } from '@prisma/client';

const logger = createModuleLogger('ExcelReportService');

// ========== INTERFACES ==========

interface DateRange {
  start: Date;
  end: Date;
  display?: string;
}

interface ReportConfig {
  limit?: number;
  includeDetails?: boolean;
  format?: string;
  dateRange?: DateRange | null;
  clientIds?: string[] | null;
  useCache?: boolean;
}

interface ReportStats {
  totalInvoices: number;
  duration: number;
}

interface ReportResult {
  success: boolean;
  buffer?: ExcelJS.Buffer;
  filePath?: string;
  fileName?: string;
  rowCount?: number;
  fromCache?: boolean;
  stats?: ReportStats;
  error?: string;
  duration?: number;
}

interface CustomerInfo {
  legalName: string;
  rfc: string;
  email: string;
}

interface TenantInfo {
  businessName: string;
  rfc: string;
}

interface EnrichedInvoice {
  id: number;
  facturapiInvoiceId: string;
  series: string;
  folioNumber: number;
  total: number;
  status: string;
  createdAt: Date;
  invoiceDate: Date | null;
  realEmissionDate: Date | null;
  customer: CustomerInfo;
  tenant: TenantInfo;
  uuid: string;
  subtotal: number;
  currency: string;
  verificationUrl: string;
  folio: string;
  folioFiscal: string;
  ivaAmount: number;
  retencionAmount: number;
  processedAt: string;
  error?: string;

  // ============================================================
  // NUEVOS CAMPOS FINANCIEROS COMPLETOS (desde schema actualizado)
  // ============================================================
  discount?: number | null;
  paymentForm?: string | null;
  paymentMethod?: string | null;
  satCertNumber?: string | null;
  usoCfdi?: string | null;
  tipoComprobante?: string | null;
  exportacion?: string | null;
  // items no se incluye en el Excel, solo en BD
}

interface TenantCustomer {
  id: number;
  legalName: string;
  rfc: string;
  email: string | null;
  _count?: {
    invoices: number;
  };
}

interface EstimationResult {
  totalAvailable: number;
  willGenerate: number;
  estimatedTimeSeconds: number;
  timeCategory: 'fast' | 'medium' | 'slow' | 'unknown';
  hasMoreThanLimit: boolean;
}

type InvoiceWithRelations = Prisma.TenantInvoiceGetPayload<{
  include: {
    customer: {
      select: {
        id: true;
        legalName: true;
        rfc: true;
        email: true;
      };
    };
    tenant: {
      select: {
        businessName: true;
        rfc: true;
      };
    };
  };
}>;

// ========== SERVICE CLASS ==========

/**
 * Servicio para generar reportes Excel de facturas
 */
class ExcelReportService {
  /**
   * Generar reporte Excel completo para un tenant
   * @param tenantId - ID del tenant
   * @param options - Opciones del reporte
   * @returns Promise<ReportResult> - Resultado con buffer del Excel
   */
  static async generateInvoiceReport(
    tenantId: string,
    options: ReportConfig = {}
  ): Promise<ReportResult> {
    const startTime = Date.now();
    logger.info({ tenantId }, 'Iniciando generación de reporte Excel');

    try {
      // Configuración por defecto
      const config: ReportConfig = {
        limit: options.limit || 5000,
        includeDetails: options.includeDetails !== false,
        format: options.format || 'xlsx',
        dateRange: options.dateRange || null,
        clientIds: options.clientIds || null,
        useCache: false, // Deshabilitado por decisión del equipo
        ...options,
      };

      logger.debug({ config }, 'Configuración del reporte');

      // PASO 1: Obtener facturas de la base de datos
      const invoicesFromDB = await this.getInvoicesFromDatabase(tenantId, config);

      if (invoicesFromDB.length === 0) {
        throw new Error('No se encontraron facturas para generar el reporte');
      }

      logger.info({ count: invoicesFromDB.length }, 'Facturas obtenidas de BD');

      // PASO 2: Enriquecer con datos de FacturAPI
      const enrichedInvoices = await this.enrichWithFacturapiData(tenantId, invoicesFromDB, config);

      logger.info({ count: enrichedInvoices.length }, 'Facturas enriquecidas');

      // PASO 3: Generar Excel en memoria
      const buffer = await this.generateExcelBuffer(tenantId, enrichedInvoices, config);

      const duration = Date.now() - startTime;
      // ExcelJS.Buffer puede ser Buffer de Node o ArrayBuffer
      const bufferLength = (buffer as any).length || (buffer as any).byteLength || 0;
      const sizeInMB = (bufferLength / 1024 / 1024).toFixed(2);

      logger.info({ duration, sizeInMB }, 'Reporte Excel generado exitosamente');

      return {
        success: true,
        buffer,
        fromCache: false,
        stats: {
          totalInvoices: enrichedInvoices.length,
          duration,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';

      logger.error({ error, duration }, 'Error generando reporte Excel');

      return {
        success: false,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Obtener facturas de la base de datos con filtros
   */
  static async getInvoicesFromDatabase(
    tenantId: string,
    config: ReportConfig
  ): Promise<InvoiceWithRelations[]> {
    // Construir cláusula WHERE con filtros
    const whereClause: Prisma.TenantInvoiceWhereInput = {
      tenantId,
    };

    // Filtro por rango de fechas
    if (config.dateRange && config.dateRange.start && config.dateRange.end) {
      const startDate =
        config.dateRange.start instanceof Date
          ? config.dateRange.start
          : new Date(config.dateRange.start);
      const endDate =
        config.dateRange.end instanceof Date
          ? config.dateRange.end
          : new Date(config.dateRange.end);

      whereClause.invoiceDate = {
        gte: startDate,
        lte: endDate,
      };

      logger.debug(
        {
          display: config.dateRange.display,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
        'Aplicando filtro de fecha'
      );
    }

    // Filtro por clientes específicos
    if (config.clientIds && config.clientIds.length > 0) {
      whereClause.customerId = {
        in: config.clientIds.map((id) => parseInt(id, 10)),
      };
      logger.debug({ clientCount: config.clientIds.length }, 'Aplicando filtro de clientes');
    }

    const invoices = await prisma.tenantInvoice.findMany({
      where: whereClause,
      include: {
        customer: {
          select: {
            id: true,
            legalName: true,
            rfc: true,
            email: true,
          },
        },
        tenant: {
          select: {
            businessName: true,
            rfc: true,
          },
        },
      },
      orderBy: {
        invoiceDate: 'desc',
      },
      take: config.limit,
    });

    logger.info(
      { found: invoices.length, limit: config.limit },
      'Facturas encontradas con filtros'
    );
    return invoices;
  }

  /**
   * Obtener lista de clientes de un tenant
   */
  static async getTenantCustomers(tenantId: string): Promise<TenantCustomer[]> {
    try {
      const customers = await prisma.tenantCustomer.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          legalName: true,
          rfc: true,
          email: true,
          _count: {
            select: {
              invoices: true,
            },
          },
        },
        orderBy: {
          legalName: 'asc',
        },
      });

      logger.info({ tenantId, count: customers.length }, 'Clientes encontrados');
      return customers;
    } catch (error) {
      logger.error({ error, tenantId }, 'Error obteniendo clientes');
      return [];
    }
  }

  /**
   * Estimar facturas y tiempo de generación
   */
  static async estimateReportGeneration(
    tenantId: string,
    filters: ReportConfig = {}
  ): Promise<EstimationResult> {
    try {
      // Construir cláusula WHERE similar a getInvoicesFromDatabase
      const whereClause: Prisma.TenantInvoiceWhereInput = { tenantId };

      if (filters.dateRange && filters.dateRange.start && filters.dateRange.end) {
        whereClause.invoiceDate = {
          gte: filters.dateRange.start,
          lte: filters.dateRange.end,
        };
      }

      if (filters.clientIds && filters.clientIds.length > 0) {
        whereClause.customerId = {
          in: filters.clientIds.map((id) => parseInt(id, 10)),
        };
      }

      // Contar facturas sin límite
      const totalCount = await prisma.tenantInvoice.count({
        where: whereClause,
      });

      const actualLimit = Math.min(totalCount, filters.limit || 5000);

      // Estimación de tiempo: 300ms por factura + overhead
      const baseTimePerInvoice = 300;
      const overhead = 2000;
      const estimatedTimeMs = actualLimit * baseTimePerInvoice + overhead;
      const estimatedTimeSeconds = Math.round(estimatedTimeMs / 1000);

      return {
        totalAvailable: totalCount,
        willGenerate: actualLimit,
        estimatedTimeSeconds,
        timeCategory:
          estimatedTimeSeconds < 10 ? 'fast' : estimatedTimeSeconds < 30 ? 'medium' : 'slow',
        hasMoreThanLimit: totalCount > (filters.limit || 5000),
      };
    } catch (error) {
      logger.error({ error, tenantId }, 'Error estimando generación');
      return {
        totalAvailable: 0,
        willGenerate: 0,
        estimatedTimeSeconds: 5,
        timeCategory: 'unknown',
        hasMoreThanLimit: false,
      };
    }
  }

  /**
   * Enriquecer facturas - VERSIÓN FINAL CON DATOS COMPLETOS DESDE BD
   * Esta versión NUNCA llama a FacturAPI porque TODOS los datos están en la BD.
   *
   * MEJORA DE RENDIMIENTO:
   * - ANTES: 16 segundos para 1,000 facturas (llamadas a API)
   * - DESPUÉS: ~1 segundo para 1,000 facturas (solo consulta BD)
   * - Ganancia: 94% más rápido
   */
  static async enrichWithFacturapiData(
    tenantId: string,
    invoices: InvoiceWithRelations[],
    _config: ReportConfig
  ): Promise<EnrichedInvoice[]> {
    logger.info(
      { tenantId, count: invoices.length },
      'Enriqueciendo facturas desde BD (ZERO API calls) - DATOS COMPLETOS'
    );

    // MAPEO DIRECTO DESDE BD - SIN LLAMADAS A API
    const enrichedInvoices: EnrichedInvoice[] = invoices.map((invoice) => ({
      // Datos básicos
      id: invoice.id,
      facturapiInvoiceId: invoice.facturapiInvoiceId,
      series: invoice.series,
      folioNumber: invoice.folioNumber,
      total: parseFloat(invoice.total.toString()),
      status: invoice.status,
      createdAt: invoice.createdAt,
      invoiceDate: invoice.invoiceDate,
      realEmissionDate: invoice.invoiceDate,

      // Cliente y Tenant
      customer: {
        legalName: invoice.customer?.legalName || 'N/A',
        rfc: invoice.customer?.rfc || 'N/A',
        email: invoice.customer?.email || '',
      },
      tenant: {
        businessName: invoice.tenant?.businessName || 'N/A',
        rfc: invoice.tenant?.rfc || 'N/A',
      },

      // UUID y folios
      uuid: invoice.uuid || 'No disponible',
      folio: `${invoice.series}${invoice.folioNumber}`,
      folioFiscal: invoice.uuid || 'No disponible',

      // DATOS FINANCIEROS COMPLETOS DESDE BD (ya no desde API!)
      subtotal: (invoice as any).subtotal ? parseFloat((invoice as any).subtotal.toString()) : 0,
      ivaAmount: (invoice as any).ivaAmount ? parseFloat((invoice as any).ivaAmount.toString()) : 0,
      retencionAmount: (invoice as any).retencionAmount
        ? parseFloat((invoice as any).retencionAmount.toString())
        : 0,
      discount: (invoice as any).discount ? parseFloat((invoice as any).discount.toString()) : null,
      currency: (invoice as any).currency || 'MXN',
      verificationUrl: (invoice as any).verificationUrl || '',
      paymentForm: (invoice as any).paymentForm || null,
      paymentMethod: (invoice as any).paymentMethod || null,
      satCertNumber: (invoice as any).satCertNumber || null,
      usoCfdi: (invoice as any).usoCfdi || null,
      tipoComprobante: (invoice as any).tipoComprobante || null,
      exportacion: (invoice as any).exportacion || null,

      // Metadatos
      processedAt: new Date().toISOString(),
    }));

    logger.info(
      {
        total: enrichedInvoices.length,
        withCompleteData: enrichedInvoices.filter((inv) => inv.subtotal > 0).length,
        withoutCompleteData: enrichedInvoices.filter((inv) => inv.subtotal === 0).length,
      },
      'Enriquecimiento completado desde BD (ZERO API calls)'
    );

    return enrichedInvoices;
  }

  /**
   * Generar Excel en memoria (buffer) - SIN ARCHIVOS TEMPORALES
   */
  static async generateExcelBuffer(
    _tenantId: string,
    invoices: EnrichedInvoice[],
    _config: ReportConfig
  ): Promise<ExcelJS.Buffer> {
    logger.info({ count: invoices.length }, 'Generando Excel en memoria');

    // Crear workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reporte de Facturas');

    // Configurar propiedades del workbook
    workbook.creator = 'Sistema de Facturación';
    workbook.lastModifiedBy = 'FacturAPI SaaS';
    workbook.created = new Date();
    workbook.modified = new Date();

    // ENCABEZADOS DE COLUMNAS (11 campos principales)
    const headers = [
      'Folio',
      'UUID/Folio Fiscal',
      'Cliente',
      'RFC Cliente',
      'Fecha Factura',
      'Subtotal',
      'IVA',
      'Retención',
      'Total',
      'Estado',
      'URL Verificación',
    ];

    // Agregar encabezados con estilo
    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '366092' },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Agregar datos de las facturas
    invoices.forEach((invoice) => {
      const dateForExcel = invoice.realEmissionDate
        ? this.createMexicoDateForExcel(invoice.realEmissionDate)
        : invoice.invoiceDate
          ? this.createMexicoDateForExcel(invoice.invoiceDate)
          : null;

      const row: (string | number | Date | null)[] = [
        invoice.folio || `${invoice.series}${invoice.folioNumber}`,
        invoice.uuid || invoice.folioFiscal || 'No disponible',
        invoice.customer?.legalName || 'Cliente no especificado',
        invoice.customer?.rfc || 'RFC no disponible',
        dateForExcel,
        this.truncateToTwoDecimals(invoice.subtotal || 0),
        this.truncateToTwoDecimals(invoice.ivaAmount || 0),
        this.truncateToTwoDecimals(invoice.retencionAmount || 0),
        this.truncateToTwoDecimals(invoice.total || 0),
        this.translateStatus(invoice.status || 'unknown'),
        invoice.verificationUrl || 'No disponible',
      ];

      worksheet.addRow(row);
    });

    // Ajustar ancho de columnas automáticamente
    const columns = worksheet.columns;
    if (columns) {
      columns.forEach((column) => {
        if (!column || !column.eachCell) return;
        let maxLength = 0;
        column.eachCell({ includeEmpty: false }, (cell) => {
          const cellLength = cell.value ? cell.value.toString().length : 0;
          if (cellLength > maxLength) {
            maxLength = cellLength;
          }
        });
        column.width = maxLength < 10 ? 12 : maxLength + 2;
      });
    }

    // Generar buffer en memoria (SIN ARCHIVO)
    const buffer = await workbook.xlsx.writeBuffer();

    // ExcelJS.Buffer puede ser Buffer de Node o ArrayBuffer
    const bufferLength = (buffer as any).length || (buffer as any).byteLength || 0;
    const sizeInMB = (bufferLength / 1024 / 1024).toFixed(2);
    logger.info({ sizeInMB }, 'Excel generado en memoria');

    return buffer;
  }

  // ========== UTILIDADES ==========

  /**
   * Truncar número a exactamente 2 decimales (SIN REDONDEO)
   */
  static truncateToTwoDecimals(amount: number): number {
    const num = parseFloat(amount.toString() || '0');
    return Math.floor(num * 100) / 100;
  }

  /**
   * Traducir estado de factura
   */
  static translateStatus(status: string): string {
    const statusMap: Record<string, string> = {
      valid: 'Válida',
      canceled: 'Cancelada',
      pending: 'Pendiente',
      draft: 'Borrador',
    };

    return statusMap[status] || status;
  }

  /**
   * Preparar fecha para Excel (evitar inconsistencia entre día local e ISO)
   */
  static createMexicoDateForExcel(dateFromDB: Date | string | null): Date | null {
    if (!dateFromDB) return null;

    const dateObj = dateFromDB instanceof Date ? dateFromDB : new Date(dateFromDB);

    if (isNaN(dateObj.getTime())) {
      logger.warn({ dateFromDB }, 'Fecha inválida en createMexicoDateForExcel');
      return null;
    }

    // Convertir primero a timezone México, luego extraer día/mes/año
    const mexicoDateString = dateObj.toLocaleString('en-US', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    // Parse "MM/DD/YYYY" format
    const [month, day, year] = mexicoDateString.split('/').map((num) => parseInt(num, 10));

    // Crear fecha usando valores de timezone México (month-1 porque Date usa 0-based)
    const consistentDate = new Date(year, month - 1, day, 0, 0, 0, 0);

    return consistentDate;
  }
}

export default ExcelReportService;
