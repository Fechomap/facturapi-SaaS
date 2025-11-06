/**
 * Invoice Controller
 * Controller for invoice-related operations
 */

import axios from 'axios';
import type { Response, NextFunction } from 'express';
import type { TenantCustomer } from '@prisma/client';
import { prisma } from '@config/database.js';
import { createModuleLogger } from '@core/utils/logger.js';
import InvoiceService from '@services/invoice.service.js';
import type { TenantRequest } from '../../types/api.types.js';

const logger = createModuleLogger('invoice-controller');

// Types for invoice controller
interface InvoiceProduct {
  id?: string;
  description: string;
  price: number;
  tax_included?: boolean;
  taxes?: InvoiceTax[];
}

interface InvoiceTax {
  rate: number;
  withholding: boolean;
}

interface InvoiceItem {
  quantity: number;
  product: InvoiceProduct;
}

interface InvoiceCustomer {
  id?: string;
  legal_name: string;
  tax_id: string;
}

interface CreateInvoiceBody {
  customer: InvoiceCustomer;
  items: InvoiceItem[];
}

interface CreateSimpleInvoiceBody {
  cliente_id: string;
  producto_id: string;
  cantidad?: number;
}

interface CancelInvoiceBody {
  motive: string;
}

interface SendInvoiceBody {
  email?: string;
}

/**
 * Controller for invoice-related operations
 */
class InvoiceController {
  /**
   * Creates a new invoice
   */
  async createInvoice(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      // Verify tenant subscription status
      const subscriptionStatus = req.subscription?.status;
      const isActive = subscriptionStatus === 'active' || subscriptionStatus === 'trial';

      if (!isActive) {
        logger.warn(
          { tenantId, subscriptionStatus },
          'Intento de crear factura bloqueado por suscripción inactiva'
        );
        res.status(403).json({
          error: 'SubscriptionError',
          message: `Tu suscripción (${subscriptionStatus || 'none'}) no está activa. No puedes generar nuevas facturas.`,
          subscriptionStatus: subscriptionStatus || 'none',
        });
        return;
      }

      // Validate basic data
      const { customer, items } = req.body as CreateInvoiceBody;

      if (!customer || !items || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requieren campos customer e items (array no vacío)',
        });
        return;
      }

      // Invoice creation simulation
      const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

      const invoice = {
        id: `inv_${Date.now()}`,
        series: 'A',
        folio_number: 1001,
        customer: customer,
        items: items,
        subtotal: subtotal,
        total: 0,
        created_at: new Date().toISOString(),
        status: 'valid',
      };

      // Calculate taxes and total
      let taxes = 0;
      for (const item of items) {
        if (item.product.taxes) {
          for (const tax of item.product.taxes) {
            if (tax.withholding) {
              taxes -= item.product.price * item.quantity * tax.rate;
            } else {
              taxes += item.product.price * item.quantity * tax.rate;
            }
          }
        }
      }

      invoice.total = invoice.subtotal + taxes;

      res.status(201).json(invoice);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Creates a simplified invoice
   */
  async createSimpleInvoice(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      // Verify tenant subscription status
      const subscriptionStatus = req.subscription?.status;
      const isActive = subscriptionStatus === 'active' || subscriptionStatus === 'trial';

      if (!isActive) {
        logger.warn(
          { tenantId, subscriptionStatus },
          'Intento de crear factura simple bloqueado por suscripción inactiva'
        );
        res.status(403).json({
          error: 'SubscriptionError',
          message: `Tu suscripción (${subscriptionStatus || 'none'}) no está activa. No puedes generar nuevas facturas.`,
          subscriptionStatus: subscriptionStatus || 'none',
        });
        return;
      }

      // Extract data from request
      const { cliente_id, producto_id, cantidad = 1 } = req.body as CreateSimpleInvoiceBody;

      if (!cliente_id || !producto_id) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requieren cliente_id y producto_id',
        });
        return;
      }

      // Simplified invoice creation simulation
      const invoice = {
        id: `inv_${Date.now()}`,
        series: 'A',
        folio_number: 1001,
        customer: cliente_id,
        items: [
          {
            quantity: cantidad,
            product: {
              id: producto_id,
              price: 100,
              description: 'Producto simulado',
            },
          },
        ],
        subtotal: 100 * cantidad,
        total: 116 * cantidad,
        created_at: new Date().toISOString(),
        status: 'valid',
      };

      res.status(201).json(invoice);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lists all invoices
   */
  async listInvoices(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      // Pagination and filtering parameters
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const startDate = req.query.start_date as string | undefined;
      const endDate = req.query.end_date as string | undefined;
      const status = req.query.status as string | undefined;

      logger.debug({ tenantId, page, limit }, 'Buscando facturas');

      // Create criteria object for search with pagination
      const criteria = {
        tenantId,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        status,
        page,
        limit,
      };

      // Use service to get invoices with real pagination
      const result = await InvoiceService.searchInvoices(criteria);

      logger.info(
        { tenantId, count: result.data.length, total: result.pagination.total },
        'Facturas encontradas con paginación'
      );

      // Transform data to maintain frontend compatibility
      const formattedInvoices = result.data.map((invoice) => {
        const customer = ('customer' in invoice ? invoice.customer : null) as TenantCustomer | null;
        return {
          id: invoice.facturapiInvoiceId || `inv_${invoice.id}`,
          series: invoice.series || 'A',
          folio_number: invoice.folioNumber,
          customer: customer
            ? {
                id: customer.id.toString(),
                legal_name: customer.legalName,
                tax_id: customer.rfc,
              }
            : {
                id: 'unknown',
                legal_name: 'Cliente',
                tax_id: 'XAXX010101000',
              },
          total: parseFloat(invoice.total.toString()) || 0,
          status: invoice.status || 'valid',
          created_at: invoice.createdAt?.toISOString() || new Date().toISOString(),
        };
      });

      res.json({
        data: formattedInvoices,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Gets an invoice by its ID
   */
  async getInvoice(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;
      const invoiceId = req.params.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      if (!invoiceId) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura',
        });
        return;
      }

      // Invoice simulation
      const invoice = {
        id: invoiceId,
        series: 'A',
        folio_number: 1001,
        customer: {
          id: 'client_1',
          legal_name: 'Cliente Ejemplo',
          tax_id: 'AAA010101AAA',
        },
        items: [
          {
            quantity: 1,
            product: {
              description: 'Producto de ejemplo',
              price: 1000,
              tax_included: false,
            },
          },
        ],
        subtotal: 1000,
        total: 1160,
        status: 'valid',
        created_at: '2023-01-01T12:00:00Z',
      };

      res.json(invoice);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancels an invoice
   */
  async cancelInvoice(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;
      const invoiceId = req.params.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      if (!invoiceId) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura',
        });
        return;
      }

      // Extract cancellation motive
      const { motive } = req.body as CancelInvoiceBody;

      if (!motive) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el motivo de cancelación',
        });
        return;
      }

      // Validate that motive is valid (01, 02, 03, 04)
      const validMotives = ['01', '02', '03', '04'];
      if (!validMotives.includes(motive)) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Motivo de cancelación inválido. Debe ser 01, 02, 03 o 04',
        });
        return;
      }

      // Search for the invoice in the database
      const invoice = await prisma.tenantInvoice.findFirst({
        where: {
          tenantId,
          facturapiInvoiceId: invoiceId,
        },
      });

      if (!invoice) {
        res.status(404).json({
          error: 'NotFoundError',
          message: `No se encontró la factura con ID ${invoiceId}`,
        });
        return;
      }

      // Get tenant's API key
      const apiKey = req.getApiKey ? await req.getApiKey() : req.tenant?.facturapiApiKey;
      if (!apiKey) {
        res.status(500).json({
          error: 'ApiKeyError',
          message: 'No se pudo obtener la API key para este tenant',
        });
        return;
      }

      logger.debug(
        { invoiceId, motive },
        `Intentando cancelar factura ${invoiceId} con motivo ${motive} en FacturAPI`
      );
      logger.debug({ apiKey: `${apiKey.substring(0, 8)}...` }, 'API Key');

      try {
        // Perform cancellation in FacturAPI
        // IMPORTANT: For FacturAPI, the motive must be sent as query param, not as JSON body
        const facturapResponse = await axios({
          method: 'DELETE',
          url: `https://www.facturapi.io/v2/invoices/${invoiceId}?motive=${motive}`,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });

        logger.debug({ response: facturapResponse.data }, 'Respuesta de FacturAPI al cancelar');

        // Update status in local database
        await prisma.tenantInvoice.update({
          where: {
            id: invoice.id,
          },
          data: {
            status: 'canceled',
            updatedAt: new Date(),
          },
        });

        res.json({
          success: true,
          message: `Factura ${invoiceId} cancelada correctamente con motivo ${motive}`,
        });
      } catch (facturapierror) {
        logger.error({ error: facturapierror }, 'Error al cancelar factura en FacturAPI');

        if (axios.isAxiosError(facturapierror) && facturapierror.response) {
          res.status(facturapierror.response.status).json({
            error: 'FacturAPIError',
            message: 'Error al cancelar la factura en FacturAPI',
            details: facturapierror.response.data,
          });
          return;
        }

        res.status(500).json({
          error: 'FacturAPIError',
          message: 'Error de conexión con FacturAPI',
          details: facturapierror instanceof Error ? facturapierror.message : 'Unknown error',
        });
      }
    } catch (error) {
      logger.error({ error }, 'Error en cancelInvoice');
      next(error);
    }
  }

  /**
   * Sends an invoice by email
   */
  async sendInvoiceByEmail(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;
      const invoiceId = req.params.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      if (!invoiceId) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura',
        });
        return;
      }

      // Extract email from request (optional)
      const { email } = req.body as SendInvoiceBody;

      // Send simulation
      res.json({
        success: true,
        message:
          `Factura ${invoiceId} enviada por email exitosamente` + (email ? ` a ${email}` : ''),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Downloads an invoice in PDF format
   */
  async downloadInvoicePdf(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;
      const invoiceId = req.params.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      if (!invoiceId) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura',
        });
        return;
      }

      // Get tenant's API key
      const apiKey = req.getApiKey ? await req.getApiKey() : req.tenant?.facturapiApiKey;
      if (!apiKey) {
        res.status(500).json({
          error: 'ApiKeyError',
          message: 'No se pudo obtener la API key para este tenant',
        });
        return;
      }

      // Make request to FacturAPI
      try {
        const response = await axios({
          method: 'GET',
          url: `https://www.facturapi.io/v2/invoices/${invoiceId}/pdf`,
          responseType: 'arraybuffer',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=factura-${invoiceId}.pdf`);

        // Send buffer directly
        res.send(response.data);
      } catch (facturapierror) {
        logger.error({ error: facturapierror }, 'Error al obtener PDF de FacturAPI');

        if (axios.isAxiosError(facturapierror) && facturapierror.response) {
          res.status(facturapierror.response.status).json({
            error: 'FacturAPIError',
            message: 'Error al obtener el PDF de FacturAPI',
            details: facturapierror.response.data,
          });
          return;
        }

        res.status(500).json({
          error: 'FacturAPIError',
          message: 'Error de conexión con FacturAPI',
          details: facturapierror instanceof Error ? facturapierror.message : 'Unknown error',
        });
      }
    } catch (error) {
      logger.error({ error }, 'Error en downloadInvoicePdf');
      next(error);
    }
  }

  /**
   * Downloads an invoice in XML format
   */
  async downloadInvoiceXml(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;
      const invoiceId = req.params.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      if (!invoiceId) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura',
        });
        return;
      }

      // Get tenant's API key
      const apiKey = req.getApiKey ? await req.getApiKey() : req.tenant?.facturapiApiKey;
      if (!apiKey) {
        res.status(500).json({
          error: 'ApiKeyError',
          message: 'No se pudo obtener la API key para este tenant',
        });
        return;
      }

      // Make request to FacturAPI
      try {
        const response = await axios({
          method: 'GET',
          url: `https://www.facturapi.io/v2/invoices/${invoiceId}/xml`,
          responseType: 'arraybuffer',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        // Set response headers
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Disposition', `attachment; filename=factura-${invoiceId}.xml`);

        // Send buffer directly
        res.send(response.data);
      } catch (facturapierror) {
        logger.error({ error: facturapierror }, 'Error al obtener XML de FacturAPI');

        if (axios.isAxiosError(facturapierror) && facturapierror.response) {
          res.status(facturapierror.response.status).json({
            error: 'FacturAPIError',
            message: 'Error al obtener el XML de FacturAPI',
            details: facturapierror.response.data,
          });
          return;
        }

        res.status(500).json({
          error: 'FacturAPIError',
          message: 'Error de conexión con FacturAPI',
          details: facturapierror instanceof Error ? facturapierror.message : 'Unknown error',
        });
      }
    } catch (error) {
      logger.error({ error }, 'Error en downloadInvoiceXml');
      next(error);
    }
  }

  /**
   * Searches for an invoice by its folio number
   */
  async getInvoiceByFolio(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;
      const { folio } = req.params;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      if (!folio) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el número de folio',
        });
        return;
      }

      // Convert folio to integer
      const folioNumber = parseInt(folio);
      if (isNaN(folioNumber)) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'El folio debe ser un número válido',
        });
        return;
      }

      logger.debug(
        { folioNumber, tenantId },
        `Buscando factura con folio ${folioNumber} para tenant ${tenantId}`
      );

      // Search in database first
      const invoiceRecord = await prisma.tenantInvoice.findFirst({
        where: {
          tenantId,
          folioNumber,
        },
        include: {
          customer: true,
        },
      });

      if (invoiceRecord) {
        // If we found the record in our database
        const facturapiId = invoiceRecord.facturapiInvoiceId;
        logger.debug(
          { facturapiId, status: invoiceRecord.status },
          `Factura encontrada en BD local, ID FacturAPI: ${facturapiId}, Estado: ${invoiceRecord.status}`
        );

        const customer = (
          'customer' in invoiceRecord ? invoiceRecord.customer : null
        ) as TenantCustomer | null;
        const totalNumber = parseFloat(invoiceRecord.total.toString());

        // Build response with all necessary fields
        const invoice = {
          id: facturapiId,
          facturapiInvoiceId: facturapiId,
          series: invoiceRecord.series || 'A',
          folio_number: invoiceRecord.folioNumber,
          customer: customer
            ? {
                id: customer.id.toString(),
                legal_name: customer.legalName,
                tax_id: customer.rfc,
              }
            : {
                id: 'unknown',
                legal_name: 'Cliente Desconocido',
                tax_id: 'AAA010101AAA',
              },
          status: invoiceRecord.status || 'valid',
          // If canceled, add cancellation information
          cancellation_status: invoiceRecord.status === 'canceled' ? 'accepted' : undefined,
          cancellation_date:
            invoiceRecord.status === 'canceled'
              ? invoiceRecord.updatedAt?.toISOString()
              : undefined,
          subtotal: totalNumber ? (totalNumber / 1.16).toFixed(2) : '0',
          total: totalNumber || 0,
          created_at: invoiceRecord.createdAt?.toISOString() || new Date().toISOString(),
        };

        res.json(invoice);
        return;
      }

      // If not found in DB, return 404
      res.status(404).json({
        error: 'NotFoundError',
        message: `No se encontró factura con folio ${folio}`,
      });
    } catch (error) {
      logger.error({ error }, 'Error en getInvoiceByFolio');
      next(error);
    }
  }

  /**
   * Searches for invoices by date range and other criteria
   */
  async searchInvoices(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      // Extract search parameters
      const { startDate, endDate, customerId, status, minAmount, maxAmount } = req.query;

      // Create criteria object
      const criteria = {
        tenantId,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        customerId: customerId ? parseInt(customerId as string) : undefined,
        status: status as string | undefined,
        minAmount: minAmount ? parseFloat(minAmount as string) : undefined,
        maxAmount: maxAmount ? parseFloat(maxAmount as string) : undefined,
      };

      // Call service to search (with pagination)
      const result = await InvoiceService.searchInvoices(criteria);

      res.json({
        data: result.data,
        count: result.data.length,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }
}

// Create controller instance
const invoiceController = new InvoiceController();

export default invoiceController;
