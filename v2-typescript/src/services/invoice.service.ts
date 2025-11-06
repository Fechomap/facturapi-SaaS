/**
 * Invoice Service
 * Service for invoice management
 */

import { prisma } from '@config/database.js';
import { createModuleLogger } from '@core/utils/logger.js';
import TenantService from './tenant.service.js';
import FacturapiService from './facturapi.service.js';
import type { TenantInvoice } from '@prisma/client';

const logger = createModuleLogger('InvoiceService');

interface InvoiceData {
  clienteId: string;
  clienteNombre?: string;
  numeroPedido: string;
  claveProducto: string;
  monto: string | number;
  localCustomerDbId?: number | null;
}

interface SearchCriteria {
  tenantId: string;
  startDate?: Date;
  endDate?: Date;
  customerId?: number;
  status?: string;
  minAmount?: number;
  maxAmount?: number;
  page?: number;
  limit?: number;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface SearchResult {
  data: TenantInvoice[];
  pagination: PaginationInfo;
}

/**
 * Invoice Service Class
 */
class InvoiceService {
  /**
   * Generate new invoice
   */
  static async generateInvoice(data: InvoiceData, tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID is required to generate invoice');
    }

    if (!data || !data.clienteId) {
      throw new Error('Client ID is required');
    }

    if (!data.numeroPedido) throw new Error('Order number is required');
    if (!data.claveProducto) throw new Error('Product key is required');
    if (!data.monto) throw new Error('Amount is required');

    try {
      // Get FacturAPI client
      logger.debug({ tenantId }, 'Getting FacturAPI client');
      const facturapi = await FacturapiService.getFacturapiClient(tenantId);

      // Check if clienteId is a short code or hexadecimal ID
      let facturapiClienteId = data.clienteId;
      let localCustomerDbId = data.localCustomerDbId || null;
      const hexRegex = /^[0-9a-f]{24}$/i;

      // If clienteId is not a valid hexadecimal ID, search for client by name
      if (!hexRegex.test(facturapiClienteId)) {
        logger.debug(
          { clienteId: facturapiClienteId },
          'Client ID is not hexadecimal, searching by name'
        );

        // Map short codes to full names
        const clientMap: Record<string, string> = {
          SOS: 'PROTECCION S.O.S. JURIDICO',
          ARSA: 'ARSA ASESORIA INTEGRAL PROFESIONAL',
          INFO: 'INFOASIST INFORMACION Y ASISTENCIA',
        };

        const nombreBusqueda =
          clientMap[facturapiClienteId] || data.clienteNombre || facturapiClienteId;

        try {
          // Search in local DB first (faster)
          logger.debug({ nombreBusqueda }, 'Searching client in local DB');
          const localCustomer = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId,
              OR: [
                { legalName: { contains: nombreBusqueda, mode: 'insensitive' } },
                { legalName: clientMap[facturapiClienteId] },
              ],
            },
          });

          if (localCustomer) {
            facturapiClienteId = localCustomer.facturapiCustomerId;
            localCustomerDbId = localCustomer.id;
            logger.info(
              { legalName: localCustomer.legalName, facturapiClienteId, localCustomerDbId },
              'Client found in local DB'
            );
          } else {
            // Fallback: search in FacturAPI
            logger.warn({ nombreBusqueda }, 'Client not found in local DB, searching in FacturAPI');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const clientes = await (facturapi.customers as any).list({
              q: nombreBusqueda,
            });

            if (clientes && clientes.data && clientes.data.length > 0) {
              facturapiClienteId = clientes.data[0].id;
              localCustomerDbId = null;
              logger.info(
                { facturapiClienteId, legalName: clientes.data[0].legal_name },
                'Client found in FacturAPI'
              );
            } else {
              throw new Error(`Client "${nombreBusqueda}" not found in local DB or FacturAPI`);
            }
          }
        } catch (error) {
          logger.error({ error }, 'Error searching for client');
          throw new Error(
            `Error searching client by name: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // Check if client requires withholding
      const requiresWithholding = ['INFOASIST', 'ARSA', 'S.O.S', 'SOS'].some(
        (name) =>
          data.clienteNombre?.includes(name) ||
          (typeof data.clienteId === 'string' && data.clienteId.includes(name))
      );

      logger.debug({ requiresWithholding }, 'Withholding requirement determined');

      // Configure taxes
      const taxes = requiresWithholding
        ? [
            { type: 'IVA', rate: 0.16, factor: 'Tasa' },
            { type: 'IVA', rate: 0.04, factor: 'Tasa', withholding: true },
          ]
        : [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }];

      // Create invoice in FacturAPI
      const facturaData = {
        customer: facturapiClienteId,
        items: [
          {
            quantity: 1,
            product: {
              description: `ARRASTRE DE GRUA PEDIDO DE COMPRA ${data.numeroPedido}`,
              product_key: data.claveProducto,
              unit_key: 'E48',
              unit_name: 'SERVICIO',
              price: parseFloat(String(data.monto)),
              tax_included: false,
              taxes: taxes,
            },
          },
        ],
        use: 'G03',
        payment_form: '99',
        payment_method: 'PPD',
      };

      logger.info({ tenantId }, 'Creating invoice in FacturAPI');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const factura = await (facturapi.invoices as any).create(facturaData);

      logger.info(
        { facturaId: factura.id, folioNumber: factura.folio_number },
        'Invoice created in FacturAPI'
      );

      // Register invoice in background (async, no await)
      TenantService.registerInvoice(
        tenantId,
        factura.id,
        factura.series,
        factura.folio_number,
        localCustomerDbId,
        factura.total,
        null
      ).catch((error) => {
        logger.error(
          { tenantId, facturaId: factura.id, error },
          'Error registering invoice in background'
        );
      });

      return factura;
    } catch (error) {
      logger.error({ tenantId, error }, 'Error creating invoice in FacturAPI');
      throw error;
    }
  }

  /**
   * Search invoices with pagination
   */
  static async searchInvoices(criteria: SearchCriteria): Promise<SearchResult> {
    const {
      tenantId,
      startDate,
      endDate,
      customerId,
      status,
      minAmount,
      maxAmount,
      page = 1,
      limit = 10,
    } = criteria;

    // Build Prisma query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const whereClause: any = { tenantId };

    // Date filters
    if (startDate || endDate) {
      whereClause.invoiceDate = {};

      if (startDate) {
        whereClause.invoiceDate.gte = startDate;
      }

      if (endDate) {
        whereClause.invoiceDate.lte = endDate;
      }
    }

    // Customer filter
    if (customerId) {
      whereClause.customerId = customerId;
    }

    // Status filter
    if (status) {
      whereClause.status = status;
    }

    // Amount filters
    if (minAmount || maxAmount) {
      whereClause.total = {};

      if (minAmount) {
        whereClause.total.gte = minAmount;
      }

      if (maxAmount) {
        whereClause.total.lte = maxAmount;
      }
    }

    // Calculate skip for pagination
    const skip = (page - 1) * limit;

    // Execute queries in parallel: data + total
    const [invoices, total] = await Promise.all([
      prisma.tenantInvoice.findMany({
        where: whereClause,
        include: {
          customer: true,
          documents: true,
        },
        orderBy: {
          invoiceDate: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.tenantInvoice.count({
        where: whereClause,
      }),
    ]);

    return {
      data: invoices,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    };
  }
}

export default InvoiceService;
