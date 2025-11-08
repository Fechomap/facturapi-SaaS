/**
 * Excel Report Service
 * Servicio principal para generación de reportes Excel de facturas
 */

import ExcelJS from 'exceljs';
import { prisma } from '../config/database.js';
import FacturapiService from './facturapi.service.js';
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
}

interface TaxItem {
  type: string;
  rate?: number;
  withholding?: boolean;
}

interface ProductItem {
  price: number;
  taxes?: TaxItem[];
}

interface InvoiceItem {
  quantity: number;
  product: ProductItem;
}

interface FacturapiInvoiceData {
  uuid: string;
  subtotal?: number;
  currency?: string;
  verification_url?: string;
  items?: InvoiceItem[];
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
   * Enriquecer facturas con datos de FacturAPI
   */
  static async enrichWithFacturapiData(
    tenantId: string,
    invoices: InvoiceWithRelations[],
    _config: ReportConfig
  ): Promise<EnrichedInvoice[]> {
    logger.info(
      { tenantId, count: invoices.length },
      'Enriqueciendo facturas con datos de FacturAPI'
    );

    const facturapiClient = await FacturapiService.getFacturapiClient(tenantId);

    // OPTIMIZACIÓN: Procesar en paralelo con chunks de 20 para no saturar API
    const CHUNK_SIZE = 20;
    const enrichedInvoices: EnrichedInvoice[] = [];

    for (let chunkStart = 0; chunkStart < invoices.length; chunkStart += CHUNK_SIZE) {
      const chunk = invoices.slice(chunkStart, chunkStart + CHUNK_SIZE);

      logger.debug(
        {
          chunk: Math.floor(chunkStart / CHUNK_SIZE) + 1,
          total: Math.ceil(invoices.length / CHUNK_SIZE),
          invoices: chunk.length,
        },
        'Procesando chunk en paralelo'
      );

      // Procesar chunk en PARALELO con Promise.all()
      const chunkPromises = chunk.map(async (invoice, idx) => {
        try {
          const actualIndex = chunkStart + idx;
          logger.debug(
            { current: actualIndex + 1, total: invoices.length, id: invoice.facturapiInvoiceId },
            'Procesando factura'
          );

          // OPTIMIZACIÓN: Solo llamar a FacturAPI si NO tenemos UUID en BD
          let facturapiData: FacturapiInvoiceData | null = null;
          if (!invoice.uuid) {
            logger.debug(
              { id: invoice.facturapiInvoiceId },
              'UUID no disponible en BD, obteniendo de FacturAPI (factura antigua)'
            );
            facturapiData = (await facturapiClient.invoices.retrieve(
              invoice.facturapiInvoiceId
            )) as FacturapiInvoiceData;
          }

          // Combinar datos
          const enrichedInvoice: EnrichedInvoice = {
            // Datos de BD
            id: invoice.id,
            facturapiInvoiceId: invoice.facturapiInvoiceId,
            series: invoice.series,
            folioNumber: invoice.folioNumber,
            total: parseFloat(invoice.total.toString()),
            status: invoice.status,
            createdAt: invoice.createdAt,
            invoiceDate: invoice.invoiceDate,

            // Usar PostgreSQL como fuente única de fechas
            realEmissionDate: invoice.invoiceDate,

            // Datos del cliente
            customer: {
              legalName: invoice.customer?.legalName || 'Cliente no especificado',
              rfc: invoice.customer?.rfc || 'RFC no disponible',
              email: invoice.customer?.email || '',
            },

            // Datos del tenant emisor
            tenant: {
              businessName: invoice.tenant?.businessName || 'Empresa',
              rfc: invoice.tenant?.rfc || 'RFC Emisor',
            },

            // UUID: Preferir BD, fallback a FacturAPI
            uuid: invoice.uuid || facturapiData?.uuid || 'No disponible',
            // Para otros datos, usar FacturAPI solo si hicimos la llamada
            subtotal:
              facturapiData?.subtotal ||
              this.calculateSubtotal(facturapiData || ({} as FacturapiInvoiceData)),
            currency: facturapiData?.currency || 'MXN',
            verificationUrl: facturapiData?.verification_url || '',

            // Datos calculados
            folio: `${invoice.series}${invoice.folioNumber}`,
            folioFiscal: invoice.uuid || facturapiData?.uuid || 'No disponible',
            ivaAmount: facturapiData ? this.calculateIVA(facturapiData) : 0,
            retencionAmount: facturapiData ? this.calculateRetencion(facturapiData) : 0,

            // Metadatos
            processedAt: new Date().toISOString(),
          };

          return enrichedInvoice;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
          logger.error(
            { error, invoiceId: invoice.facturapiInvoiceId },
            'Error enriqueciendo factura'
          );

          // Retornar factura con datos de BD si falla FacturAPI
          return {
            id: invoice.id,
            facturapiInvoiceId: invoice.facturapiInvoiceId,
            series: invoice.series,
            folioNumber: invoice.folioNumber,
            total: parseFloat(invoice.total.toString()),
            status: invoice.status,
            createdAt: invoice.createdAt,
            invoiceDate: invoice.invoiceDate,
            realEmissionDate: invoice.invoiceDate,
            customer: {
              legalName: invoice.customer?.legalName || 'Cliente no especificado',
              rfc: invoice.customer?.rfc || 'RFC no disponible',
              email: invoice.customer?.email || '',
            },
            tenant: {
              businessName: invoice.tenant?.businessName || 'Empresa',
              rfc: invoice.tenant?.rfc || 'RFC Emisor',
            },
            folio: `${invoice.series}${invoice.folioNumber}`,
            uuid: invoice.uuid || 'Error al obtener',
            subtotal: 0,
            ivaAmount: 0,
            retencionAmount: 0,
            verificationUrl: '',
            currency: 'MXN',
            folioFiscal: invoice.uuid || 'Error al obtener',
            processedAt: new Date().toISOString(),
            error: errorMessage,
          } as EnrichedInvoice;
        }
      });

      // Esperar a que termine el chunk completo en PARALELO
      const chunkResults = await Promise.all(chunkPromises);
      enrichedInvoices.push(...chunkResults);

      // Pequeña pausa entre chunks para no saturar completamente la API
      if (chunkStart + CHUNK_SIZE < invoices.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    logger.info(
      { total: enrichedInvoices.length, duration: Date.now() },
      'Enriquecimiento completado'
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
   * Calcular subtotal desde datos de FacturAPI
   */
  static calculateSubtotal(facturapiData: FacturapiInvoiceData): number {
    if (facturapiData.subtotal) return facturapiData.subtotal;

    return (
      facturapiData.items?.reduce((sum, item) => {
        return sum + item.quantity * item.product.price;
      }, 0) || 0
    );
  }

  /**
   * Calcular IVA
   */
  static calculateIVA(facturapiData: FacturapiInvoiceData): number {
    if (!facturapiData.items) return 0;

    return facturapiData.items.reduce((total, item) => {
      const ivaTax = item.product.taxes?.find((tax) => tax.type === 'IVA' && !tax.withholding);

      if (ivaTax) {
        const base = item.quantity * item.product.price;
        return total + base * (ivaTax.rate || 0);
      }

      return total;
    }, 0);
  }

  /**
   * Calcular retención
   */
  static calculateRetencion(facturapiData: FacturapiInvoiceData): number {
    if (!facturapiData.items) return 0;

    return facturapiData.items.reduce((total, item) => {
      const retencionTax = item.product.taxes?.find((tax) => tax.withholding === true);

      if (retencionTax) {
        const base = item.quantity * item.product.price;
        return total + base * (retencionTax.rate || 0);
      }

      return total;
    }, 0);
  }

  /**
   * Formatear moneda
   */
  static formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
    }).format(amount || 0);
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
   * Convertir fecha UTC a hora local de México para Excel
   */
  static convertToMexicoTime(utcDate: Date | string | null): Date | null {
    if (!utcDate) return null;

    // Asegurar que tenemos un Date object
    const dateObj = utcDate instanceof Date ? utcDate : new Date(utcDate);

    // Verificar que es una fecha válida
    if (isNaN(dateObj.getTime())) {
      logger.warn({ utcDate }, 'Fecha inválida en convertToMexicoTime');
      return null;
    }

    // Convertir a timezone de México automáticamente
    const mexicoDateString = dateObj.toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
    const mexicoDate = new Date(mexicoDateString);

    return mexicoDate;
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
