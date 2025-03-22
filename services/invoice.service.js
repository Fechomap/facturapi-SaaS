// services/invoice.service.js
import prisma from '../lib/prisma.js';
import TenantService from './tenant.service.js';

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
    
    // En una implementación real, aquí se llamaría a facturapi.service
    // Para esta simulación, crearemos un objeto de factura de ejemplo
    
    // Obtener el próximo folio
    const folio = await TenantService.getNextFolio(tenantId, 'A');
    
    // Simular una factura generada (en un caso real se llamaría a FacturAPI)
    const factura = {
      id: `invoice_${Date.now()}`,
      series: 'A',
      folio_number: folio,
      customer: data.clienteId,
      total: parseFloat(data.monto) * 1.16, // Simulando el IVA
      status: 'valid',
      items: [
        {
          quantity: 1,
          description: `ARRASTRE DE GRUA PEDIDO DE COMPRA ${data.numeroPedido}`,
          product_key: data.claveProducto,
          unit_key: "E48",
          unit_name: "SERVICIO",
          price: parseFloat(data.monto),
          taxes: [
            { type: "IVA", rate: 0.16, factor: "Tasa" },
            { type: "IVA", rate: 0.04, factor: "Tasa", withholding: true }
          ]
        }
      ],
      use: "G03",
      payment_form: "99",
      payment_method: "PPD",
      date: new Date().toISOString()
    };
    
    // Registrar la factura en la base de datos
    await TenantService.registerInvoice(
      tenantId,
      factura.id,
      factura.series,
      factura.folio_number,
      null, // customerId (en un caso real se obtendría)
      factura.total,
      data.userId || null
    );
    
    return factura;
  }
  static async saveInvoiceDocument(tenantId, invoiceId, documentType, content) {
    try {
      // Llamar al StorageService para guardar el documento
      const document = await StorageService.saveInvoiceDocument(
        tenantId,
        invoiceId,
        facturapiInvoiceId,
        documentType, // 'PDF' o 'XML'
        content,
        { 
          series: factura.series,
          folioNumber: factura.folio_number
        }
      );
      
      return document;
    } catch (error) {
      console.error(`Error al guardar documento ${documentType} para factura ${invoiceId}:`, error);
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