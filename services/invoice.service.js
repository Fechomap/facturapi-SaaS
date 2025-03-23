import prisma from '../lib/prisma.js';
import TenantService from './tenant.service.js';
import facturapIService from './facturapi.service.js';

/**
 * Servicio para gestión de facturas
 */
class InvoiceService {
  /**
   * Genera una nueva factura
   * @param {Object} data - Datos para la factura
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Factura generada
   */
  // En invoice.service.js - Corregir la estructura de datos

  static async generateInvoice(data, tenantId) {
    if (!tenantId) {
      throw new Error('Se requiere un ID de tenant para generar la factura');
    }
    
    if (!data || !data.clienteId) {
      throw new Error('El ID del cliente es requerido');
    }
    
    if (!data.numeroPedido) throw new Error('El número de pedido es requerido');
    if (!data.claveProducto) throw new Error('La clave del producto es requerida');
    if (!data.monto) throw new Error('El monto es requerido');
    
    try {
      // Obtener el cliente de FacturAPI usando la API key almacenada en el tenant
      const facturapi = await facturapIService.getFacturapiClient(tenantId);
      
      // Obtener el próximo folio
      const folio = await TenantService.getNextFolio(tenantId, 'A');
      
      // Crear la factura en FacturAPI
      const facturaData = {
        customer: data.clienteId,
        items: [
          {
            quantity: 1,
            product: {  // Aquí es donde se debe agrupar la información del producto
              description: `ARRASTRE DE GRUA PEDIDO DE COMPRA ${data.numeroPedido}`,
              product_key: data.claveProducto,
              unit_key: "E48",
              unit_name: "SERVICIO",
              price: parseFloat(data.monto),
              taxes: [
                { type: "IVA", rate: 0.16, factor: "Tasa" }
              ]
            }
          }
        ],
        use: "G03",
        payment_form: "99",
        payment_method: "PPD",
        folio_number: folio
      };
      
      console.log('Enviando solicitud a FacturAPI para crear factura:', facturaData);
      
      // Llamar a FacturAPI para crear la factura
      const factura = await facturapi.invoices.create(facturaData);
      
      console.log('Factura creada en FacturAPI:', factura.id);
      
      // Registrar la factura en la base de datos
      await prisma.tenantInvoice.create({
        data: {
          tenantId,
          facturapiInvoiceId: factura.id, // Guardar el ID real de FacturAPI
          series: factura.series,
          folioNumber: factura.folio_number,
          total: factura.total,
          status: 'valid',
          createdAt: new Date(),
          updatedAt: new Date()
          // otros campos necesarios...
        }
      });
      
      return factura;
    } catch (error) {
      console.error('Error al crear factura en FacturAPI:', error);
      throw error;
    }
  }
    /**
   * Busca facturas según criterios
   * @param {Object} criteria - Criterios de búsqueda
   * @returns {Promise<Array>} - Facturas encontradas
   */
  static async searchInvoices(criteria) {
    const { 
      tenantId, 
      startDate, 
      endDate, 
      customerId, 
      status,
      minAmount,
      maxAmount 
    } = criteria;
    
    // Construir la consulta Prisma
    const whereClause = { tenantId };
    
    // Filtros de fecha
    if (startDate || endDate) {
      whereClause.invoiceDate = {};
      
      if (startDate) {
        whereClause.invoiceDate.gte = startDate;
      }
      
      if (endDate) {
        whereClause.invoiceDate.lte = endDate;
      }
    }
    
    // Filtro por cliente
    if (customerId) {
      whereClause.customerId = customerId;
    }
    
    // Filtro por estado
    if (status) {
      whereClause.status = status;
    }
    
    // Filtros de monto
    if (minAmount || maxAmount) {
      whereClause.total = {};
      
      if (minAmount) {
        whereClause.total.gte = minAmount;
      }
      
      if (maxAmount) {
        whereClause.total.lte = maxAmount;
      }
    }
    
    // Ejecutar consulta
    const invoices = await prisma.tenantInvoice.findMany({
      where: whereClause,
      include: {
        customer: true,
        documents: true
      },
      orderBy: {
        invoiceDate: 'desc'
      }
    });
    
    return invoices;
  }
}

export default InvoiceService;