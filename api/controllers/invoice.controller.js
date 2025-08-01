// api/controllers/invoice.controller.js
// Importaciones
import axios from 'axios';
import prisma from '../../lib/prisma.js';
import InvoiceService from '../../services/invoice.service.js';
import logger from '../../core/utils/logger.js';

// Logger específico para facturas
const invoiceLogger = logger.child({ module: 'invoice-controller' });

/**
 * Controlador para operaciones relacionadas con facturas
 */
class InvoiceController {
  /**
   * Crea una nueva factura
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async createInvoice(req, res, next) {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      // --- Verificar estado de la suscripción del Tenant ---
      const subscriptionStatus = req.tenant?.subscriptionStatus; // Asume que el middleware añade esto
      const isActive = subscriptionStatus === 'active' || subscriptionStatus === 'trial';

      if (!isActive) {
        invoiceLogger.warn(
          { tenantId, subscriptionStatus },
          'Intento de crear factura bloqueado por suscripción inactiva'
        );
        return res.status(403).json({
          error: 'SubscriptionError',
          message: `Tu suscripción (${subscriptionStatus}) no está activa. No puedes generar nuevas facturas.`,
          subscriptionStatus: subscriptionStatus,
        });
      }
      // --- Fin verificación suscripción ---

      // Validar datos básicos
      const { customer, items } = req.body;

      if (!customer || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requieren campos customer e items (array no vacío)',
        });
      }

      // Simulación de creación de factura
      const invoice = {
        id: `inv_${Date.now()}`,
        series: 'A',
        folio_number: 1001,
        customer: customer,
        items: items,
        subtotal: items.reduce((sum, item) => sum + item.product.price * item.quantity, 0),
        total: 0, // Calculado después
        created_at: new Date().toISOString(),
        status: 'valid',
      };

      // Calcular impuestos y total
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

      // Responder con la factura creada
      res.status(201).json(invoice);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Crea una factura simplificada
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async createSimpleInvoice(req, res, next) {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      // --- Verificar estado de la suscripción del Tenant ---
      const subscriptionStatus = req.tenant?.subscriptionStatus; // Asume que el middleware añade esto
      const isActive = subscriptionStatus === 'active' || subscriptionStatus === 'trial';

      if (!isActive) {
        invoiceLogger.warn(
          { tenantId, subscriptionStatus },
          'Intento de crear factura simple bloqueado por suscripción inactiva'
        );
        return res.status(403).json({
          error: 'SubscriptionError',
          message: `Tu suscripción (${subscriptionStatus}) no está activa. No puedes generar nuevas facturas.`,
          subscriptionStatus: subscriptionStatus,
        });
      }
      // --- Fin verificación suscripción ---

      // Extraer datos del request
      const { cliente_id, producto_id, cantidad = 1 } = req.body;

      if (!cliente_id || !producto_id) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requieren cliente_id y producto_id',
        });
      }

      // Simulación de creación de factura simplificada
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
              price: 100, // Precio simulado
              description: 'Producto simulado',
            },
          },
        ],
        subtotal: 100 * cantidad,
        total: 116 * cantidad, // Precio con IVA
        created_at: new Date().toISOString(),
        status: 'valid',
      };

      // Responder con la factura creada
      res.status(201).json(invoice);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lista todas las facturas
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async listInvoices(req, res, next) {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      // Parámetros de paginación y filtrado
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const startDate = req.query.start_date;
      const endDate = req.query.end_date;
      const status = req.query.status;

      invoiceLogger.debug({ tenantId, page, limit }, 'Buscando facturas');

      // Crear objeto de criterios para la búsqueda con paginación
      const criteria = {
        tenantId,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        status,
        page,
        limit,
      };

      // Usar el servicio para obtener facturas con paginación real
      const result = await InvoiceService.searchInvoices(criteria);

      invoiceLogger.info(
        { tenantId, count: result.data.length, total: result.pagination.total },
        'Facturas encontradas con paginación'
      );

      // Transformar datos para mantener compatibilidad con el frontend
      const formattedInvoices = result.data.map((invoice) => ({
        id: invoice.facturapiInvoiceId || `inv_${invoice.id}`,
        series: invoice.series || 'A',
        folio_number: invoice.folioNumber,
        customer: invoice.customer
          ? {
              id: invoice.customer.id.toString(),
              legal_name: invoice.customer.legalName,
              tax_id: invoice.customer.rfc,
            }
          : {
              id: 'unknown',
              legal_name: 'Cliente',
              tax_id: 'XAXX010101000',
            },
        total: parseFloat(invoice.total) || 0, // Convertir a número
        status: invoice.status || 'valid',
        created_at: invoice.createdAt?.toISOString() || new Date().toISOString(),
      }));

      res.json({
        data: formattedInvoices,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Obtiene una factura por su ID
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async getInvoice(req, res, next) {
    try {
      const tenantId = req.tenant?.id;
      const invoiceId = req.params.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      if (!invoiceId) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura',
        });
      }

      // Simulación de factura
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
   * Cancela una factura
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async cancelInvoice(req, res, next) {
    try {
      const tenantId = req.tenant?.id;
      const invoiceId = req.params.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      if (!invoiceId) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura',
        });
      }

      // Extraer motivo de cancelación
      const { motive } = req.body;

      if (!motive) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el motivo de cancelación',
        });
      }

      // Validar que el motivo sea válido (01, 02, 03, 04)
      const validMotives = ['01', '02', '03', '04'];
      if (!validMotives.includes(motive)) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Motivo de cancelación inválido. Debe ser 01, 02, 03 o 04',
        });
      }

      // Buscar la factura en la base de datos
      const invoice = await prisma.tenantInvoice.findFirst({
        where: {
          tenantId,
          facturapiInvoiceId: invoiceId,
        },
      });

      if (!invoice) {
        return res.status(404).json({
          error: 'NotFoundError',
          message: `No se encontró la factura con ID ${invoiceId}`,
        });
      }

      // Obtener la API key del tenant
      const apiKey = await req.getApiKey();
      if (!apiKey) {
        return res.status(500).json({
          error: 'ApiKeyError',
          message: 'No se pudo obtener la API key para este tenant',
        });
      }

      console.log(`Intentando cancelar factura ${invoiceId} con motivo ${motive} en FacturAPI`);
      console.log(`API Key: ${apiKey.substring(0, 8)}...`);

      try {
        // Realizar la cancelación en FacturAPI
        // IMPORTANTE: Para FacturAPI, el motivo debe enviarse como query param, no como JSON body
        const facturapResponse = await axios({
          method: 'DELETE',
          url: `https://www.facturapi.io/v2/invoices/${invoiceId}?motive=${motive}`,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });

        console.log('Respuesta de FacturAPI al cancelar:', facturapResponse.data);

        // Actualizar estado en la base de datos local
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
        console.error('Error al cancelar factura en FacturAPI:', facturapierror);

        if (facturapierror.response) {
          return res.status(facturapierror.response.status).json({
            error: 'FacturAPIError',
            message: 'Error al cancelar la factura en FacturAPI',
            details: facturapierror.response.data,
          });
        }

        return res.status(500).json({
          error: 'FacturAPIError',
          message: 'Error de conexión con FacturAPI',
          details: facturapierror.message,
        });
      }
    } catch (error) {
      console.error('Error en cancelInvoice:', error);
      next(error);
    }
  }

  /**
   * Envía una factura por email
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async sendInvoiceByEmail(req, res, next) {
    try {
      const tenantId = req.tenant?.id;
      const invoiceId = req.params.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      if (!invoiceId) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura',
        });
      }

      // Extraer email del request (opcional)
      const { email } = req.body;

      // Simulación de envío
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
   * Descarga una factura en formato PDF
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async downloadInvoicePdf(req, res, next) {
    try {
      const tenantId = req.tenant?.id;
      const invoiceId = req.params.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      if (!invoiceId) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura',
        });
      }

      // Obtener la API key del tenant
      const apiKey = await req.getApiKey();
      if (!apiKey) {
        return res.status(500).json({
          error: 'ApiKeyError',
          message: 'No se pudo obtener la API key para este tenant',
        });
      }

      // Hacer la solicitud a FacturAPI
      try {
        const response = await axios({
          method: 'GET',
          url: `https://www.facturapi.io/v2/invoices/${invoiceId}/pdf`,
          responseType: 'arraybuffer', // Cambiado a arraybuffer en lugar de stream
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        // Configurar encabezados de respuesta
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=factura-${invoiceId}.pdf`);

        // Enviar el buffer directamente
        return res.send(response.data);
      } catch (facturapierror) {
        console.error('Error al obtener PDF de FacturAPI:', facturapierror);

        if (facturapierror.response) {
          return res.status(facturapierror.response.status).json({
            error: 'FacturAPIError',
            message: 'Error al obtener el PDF de FacturAPI',
            details: facturapierror.response.data,
          });
        }

        return res.status(500).json({
          error: 'FacturAPIError',
          message: 'Error de conexión con FacturAPI',
          details: facturapierror.message,
        });
      }
    } catch (error) {
      console.error('Error en downloadInvoicePdf:', error);
      next(error);
    }
  }

  /**
   * Descarga una factura en formato XML
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async downloadInvoiceXml(req, res, next) {
    try {
      const tenantId = req.tenant?.id;
      const invoiceId = req.params.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      if (!invoiceId) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura',
        });
      }

      // Obtener la API key del tenant
      const apiKey = await req.getApiKey();
      if (!apiKey) {
        return res.status(500).json({
          error: 'ApiKeyError',
          message: 'No se pudo obtener la API key para este tenant',
        });
      }

      // Hacer la solicitud a FacturAPI
      try {
        const response = await axios({
          method: 'GET',
          url: `https://www.facturapi.io/v2/invoices/${invoiceId}/xml`,
          responseType: 'arraybuffer', // Cambiado a arraybuffer en lugar de stream
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        // Configurar encabezados de respuesta
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Disposition', `attachment; filename=factura-${invoiceId}.xml`);

        // Enviar el buffer directamente
        return res.send(response.data);
      } catch (facturapierror) {
        console.error('Error al obtener XML de FacturAPI:', facturapierror);

        if (facturapierror.response) {
          return res.status(facturapierror.response.status).json({
            error: 'FacturAPIError',
            message: 'Error al obtener el XML de FacturAPI',
            details: facturapierror.response.data,
          });
        }

        return res.status(500).json({
          error: 'FacturAPIError',
          message: 'Error de conexión con FacturAPI',
          details: facturapierror.message,
        });
      }
    } catch (error) {
      console.error('Error en downloadInvoiceXml:', error);
      next(error);
    }
  }

  /**
   * Busca una factura por su número de folio
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async getInvoiceByFolio(req, res, next) {
    try {
      const tenantId = req.tenant?.id;
      const { folio } = req.params;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      if (!folio) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el número de folio',
        });
      }

      // Convertir el folio a número entero
      const folioNumber = parseInt(folio);
      if (isNaN(folioNumber)) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'El folio debe ser un número válido',
        });
      }

      console.log(`Buscando factura con folio ${folioNumber} para tenant ${tenantId}`);

      // Buscar en la base de datos primero
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
        // Si encontramos el registro en nuestra base de datos
        const facturapiId = invoiceRecord.facturapiInvoiceId;
        console.log(
          `Factura encontrada en BD local, ID FacturAPI: ${facturapiId}, Estado: ${invoiceRecord.status}`
        );

        // Construir respuesta con todos los campos necesarios
        const invoice = {
          id: facturapiId,
          facturapiInvoiceId: facturapiId,
          series: invoiceRecord.series || 'A',
          folio_number: invoiceRecord.folioNumber,
          customer: invoiceRecord.customer
            ? {
                id: invoiceRecord.customer.id.toString(),
                legal_name: invoiceRecord.customer.legalName,
                tax_id: invoiceRecord.customer.rfc,
              }
            : {
                id: 'unknown',
                legal_name: 'Cliente Desconocido',
                tax_id: 'AAA010101AAA',
              },
          status: invoiceRecord.status || 'valid',
          // Si está cancelada, añadir información de cancelación
          cancellation_status: invoiceRecord.status === 'canceled' ? 'accepted' : undefined,
          cancellation_date:
            invoiceRecord.status === 'canceled'
              ? invoiceRecord.updatedAt?.toISOString()
              : undefined,
          subtotal: invoiceRecord.total ? (invoiceRecord.total / 1.16).toFixed(2) : 0,
          total: invoiceRecord.total || 0,
          created_at: invoiceRecord.createdAt?.toISOString() || new Date().toISOString(),
        };

        return res.json(invoice);
      }

      // Si no lo encontramos en la BD, devolvemos un error 404
      return res.status(404).json({
        error: 'NotFoundError',
        message: `No se encontró factura con folio ${folio}`,
      });
    } catch (error) {
      console.error('Error en getInvoiceByFolio:', error);
      next(error);
    }
  }
  /**
   * Busca facturas por rango de fechas y otros criterios
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async searchInvoices(req, res, next) {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      // Extraer parámetros de búsqueda
      const { startDate, endDate, customerId, status, minAmount, maxAmount } = req.query;

      // Crear objeto de criterios
      const criteria = {
        tenantId,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        customerId,
        status,
        minAmount: minAmount ? parseFloat(minAmount) : undefined,
        maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
      };

      // Llamar al servicio para buscar (con paginación)
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

// Crear instancia del controlador
const invoiceController = new InvoiceController();

export default invoiceController;
