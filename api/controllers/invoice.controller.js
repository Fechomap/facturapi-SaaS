// api/controllers/invoice.controller.js
// Importaciones (temporales hasta que los servicios estén completamente implementados)
import axios from 'axios';
import prisma from '../../lib/prisma.js';

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
          message: 'Se requiere un tenant válido para esta operación'
        });
      }
      
      // Validar datos básicos
      const { customer, items } = req.body;
      
      if (!customer || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requieren campos customer e items (array no vacío)'
        });
      }
      
      // Simulación de creación de factura
      const invoice = {
        id: `inv_${Date.now()}`,
        series: 'A',
        folio_number: 1001,
        customer: customer,
        items: items,
        subtotal: items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0),
        total: 0, // Calculado después
        created_at: new Date().toISOString(),
        status: 'valid'
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
          message: 'Se requiere un tenant válido para esta operación'
        });
      }
      
      // Extraer datos del request
      const { cliente_id, producto_id, cantidad = 1 } = req.body;
      
      if (!cliente_id || !producto_id) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requieren cliente_id y producto_id'
        });
      }
      
      // Simulación de creación de factura simplificada
      const invoice = {
        id: `inv_${Date.now()}`,
        series: 'A',
        folio_number: 1001,
        customer: cliente_id,
        items: [{
          quantity: cantidad,
          product: {
            id: producto_id,
            price: 100, // Precio simulado
            description: 'Producto simulado'
          }
        }],
        subtotal: 100 * cantidad,
        total: 116 * cantidad, // Precio con IVA
        created_at: new Date().toISOString(),
        status: 'valid'
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
          message: 'Se requiere un tenant válido para esta operación'
        });
      }
      
      // Parámetros de paginación y filtrado
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const startDate = req.query.start_date;
      const endDate = req.query.end_date;
      const status = req.query.status;
      
      // Simulación de listado de facturas
      const invoices = [
        {
          id: 'inv_1',
          series: 'A',
          folio_number: 1001,
          customer: 'client_1',
          total: 1160,
          status: 'valid',
          created_at: '2023-01-01T12:00:00Z'
        },
        {
          id: 'inv_2',
          series: 'A',
          folio_number: 1002,
          customer: 'client_2',
          total: 580,
          status: 'valid',
          created_at: '2023-01-02T14:30:00Z'
        }
      ];
      
      res.json({
        data: invoices,
        pagination: {
          total: invoices.length,
          page,
          limit
        }
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
          message: 'Se requiere un tenant válido para esta operación'
        });
      }
      
      if (!invoiceId) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura'
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
          tax_id: 'AAA010101AAA'
        },
        items: [
          {
            quantity: 1,
            product: {
              description: 'Producto de ejemplo',
              price: 1000,
              tax_included: false
            }
          }
        ],
        subtotal: 1000,
        total: 1160,
        status: 'valid',
        created_at: '2023-01-01T12:00:00Z'
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
          message: 'Se requiere un tenant válido para esta operación'
        });
      }
      
      if (!invoiceId) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura'
        });
      }
      
      // Extraer motivo de cancelación
      const { motive } = req.body;
      
      if (!motive) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el motivo de cancelación'
        });
      }
      
      // Validar que el motivo sea válido (01, 02, 03, 04)
      const validMotives = ['01', '02', '03', '04'];
      if (!validMotives.includes(motive)) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Motivo de cancelación inválido. Debe ser 01, 02, 03 o 04'
        });
      }
      
      // Simulación de cancelación
      res.json({ 
        success: true, 
        message: `Factura ${invoiceId} cancelada correctamente con motivo ${motive}` 
      });
    } catch (error) {
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
          message: 'Se requiere un tenant válido para esta operación'
        });
      }
      
      if (!invoiceId) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura'
        });
      }
      
      // Extraer email del request (opcional)
      const { email } = req.body;
      
      // Simulación de envío
      res.json({ 
        success: true, 
        message: `Factura ${invoiceId} enviada por email exitosamente` + (email ? ` a ${email}` : '')
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
          message: 'Se requiere un tenant válido para esta operación'
        });
      }
      
      if (!invoiceId) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura'
        });
      }
  
      // Obtener la API key del tenant
      const apiKey = await req.getApiKey();
      if (!apiKey) {
        return res.status(500).json({
          error: 'ApiKeyError',
          message: 'No se pudo obtener la API key para este tenant'
        });
      }
  
      // Hacer la solicitud a FacturAPI
      try {
        const response = await axios({
          method: 'GET',
          url: `https://www.facturapi.io/v2/invoices/${invoiceId}/pdf`,
          responseType: 'arraybuffer', // Cambiado a arraybuffer en lugar de stream
          headers: {
            'Authorization': `Bearer ${apiKey}`
          }
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
            details: facturapierror.response.data
          });
        }
        
        return res.status(500).json({
          error: 'FacturAPIError',
          message: 'Error de conexión con FacturAPI',
          details: facturapierror.message
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
          message: 'Se requiere un tenant válido para esta operación'
        });
      }
      
      if (!invoiceId) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID de la factura'
        });
      }

      // Obtener la API key del tenant
      const apiKey = await req.getApiKey();
      if (!apiKey) {
        return res.status(500).json({
          error: 'ApiKeyError',
          message: 'No se pudo obtener la API key para este tenant'
        });
      }

      // Hacer la solicitud a FacturAPI
      try {
        const response = await axios({
          method: 'GET',
          url: `https://www.facturapi.io/v2/invoices/${invoiceId}/xml`,
          responseType: 'arraybuffer', // Cambiado a arraybuffer en lugar de stream
          headers: {
            'Authorization': `Bearer ${apiKey}`
          }
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
            details: facturapierror.response.data
          });
        }
        
        return res.status(500).json({
          error: 'FacturAPIError',
          message: 'Error de conexión con FacturAPI',
          details: facturapierror.message
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
          message: 'Se requiere un tenant válido para esta operación'
        });
      }
      
      if (!folio) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el número de folio'
        });
      }
      
      // Convertir el folio a número entero
      const folioNumber = parseInt(folio);
      if (isNaN(folioNumber)) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'El folio debe ser un número válido'
        });
      }
      
      console.log(`Buscando factura con folio ${folioNumber} para tenant ${tenantId}`);
      
      // Buscar en la base de datos primero
      const invoiceRecord = await prisma.tenantInvoice.findFirst({
        where: {
          tenantId,
          folioNumber
        },
        include: {
          customer: true // Incluir información del cliente si está relacionada
        }
      });
  
      if (invoiceRecord) {
        // Si encontramos el registro en nuestra base de datos
        const facturapiId = invoiceRecord.facturapiInvoiceId;
        console.log(`Factura encontrada en BD local, ID FacturAPI: ${facturapiId}`);
  
        // Construir respuesta con todos los campos necesarios
        const invoice = {
          id: facturapiId,
          facturapiInvoiceId: facturapiId,
          series: invoiceRecord.series || 'A',
          folio_number: invoiceRecord.folioNumber,
          customer: invoiceRecord.customer ? {
            id: invoiceRecord.customer.id.toString(),
            legal_name: invoiceRecord.customer.legalName,
            tax_id: invoiceRecord.customer.rfc
          } : {
            id: 'unknown',
            legal_name: 'Cliente Desconocido',
            tax_id: 'AAA010101AAA'
          },
          status: invoiceRecord.status || 'valid',
          subtotal: invoiceRecord.total ? (invoiceRecord.total / 1.16).toFixed(2) : 0,
          total: invoiceRecord.total || 0,
          created_at: invoiceRecord.createdAt?.toISOString() || new Date().toISOString()
        };
  
        return res.json(invoice);
      }
  
      // Si no lo encontramos en la BD, devolvemos un error 404
      return res.status(404).json({
        error: 'NotFoundError',
        message: `No se encontró factura con folio ${folio}`
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
          message: 'Se requiere un tenant válido para esta operación'
        });
      }
      
      // Extraer parámetros de búsqueda
      const { 
        startDate, 
        endDate, 
        customerId, 
        status,
        minAmount,
        maxAmount 
      } = req.query;
      
      // Crear objeto de criterios
      const criteria = {
        tenantId,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        customerId,
        status,
        minAmount: minAmount ? parseFloat(minAmount) : undefined,
        maxAmount: maxAmount ? parseFloat(maxAmount) : undefined
      };
      
      // Llamar al servicio para buscar
      const invoices = await InvoiceService.searchInvoices(criteria);
      
      res.json({
        data: invoices,
        count: invoices.length
      });
    } catch (error) {
      next(error);
    }
  }
}

// Crear instancia del controlador
const invoiceController = new InvoiceController();

export default invoiceController;