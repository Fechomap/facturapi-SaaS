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
      
      // Verificar si el cliente requiere retención (SOS, INFOASIST, ARSA)
      let requiresWithholding = false;
      try {
        // Intentar obtener el cliente para verificar si requiere retención
        const cliente = await facturapi.customers.retrieve(data.clienteId);
        const clientName = cliente.legal_name || '';
        
        // Verificar si es uno de los clientes que requieren retención
        requiresWithholding = 
          clientName.includes('INFOASIST') || 
          clientName.includes('ARSA') || 
          clientName.includes('S.O.S') || 
          clientName.includes('SOS');
        
        console.log(`Cliente: ${clientName}, Requiere retención: ${requiresWithholding}`);
      } catch (error) {
        console.warn(`No se pudo verificar si el cliente requiere retención: ${error.message}`);
        // Si hay problema con la obtención del cliente, verificamos por clienteNombre en data
        if (data.clienteNombre) {
          requiresWithholding = 
            data.clienteNombre.includes('INFOASIST') || 
            data.clienteNombre.includes('ARSA') || 
            data.clienteNombre.includes('S.O.S') || 
            data.clienteNombre.includes('SOS');
          console.log(`Usando nombre alternativo: ${data.clienteNombre}, Requiere retención: ${requiresWithholding}`);
        }
      }
      
      // Configurar los impuestos según corresponda
      const taxes = requiresWithholding ? 
        [
          { type: "IVA", rate: 0.16, factor: "Tasa" },
          { type: "IVA", rate: 0.04, factor: "Tasa", withholding: true }
        ] : 
        [
          { type: "IVA", rate: 0.16, factor: "Tasa" }
        ];
      
      // Crear la factura en FacturAPI
      const facturaData = {
        customer: data.clienteId,
        items: [
          {
            quantity: 1,
            product: {
              description: `ARRASTRE DE GRUA PEDIDO DE COMPRA ${data.numeroPedido}`,
              product_key: data.claveProducto,
              unit_key: "E48",
              unit_name: "SERVICIO",
              price: parseFloat(data.monto),
              tax_included: false,
              taxes: taxes
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
      const registeredInvoice = await TenantService.registerInvoice(
        tenantId,
        factura.id,
        factura.series,
        factura.folio_number,
        null, // customerId (en un caso real se obtendría)
        factura.total,
        data.userId || null
      );
      
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