import prisma from '../lib/prisma.js';
import TenantService from './tenant.service.js';
import facturapIService from './facturapi.service.js';
import logger from '../core/utils/logger.js';

// Logger específico para el servicio de facturas
const invoiceServiceLogger = logger.child({ module: 'invoice-service' });

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
      
      // Verificar si el clienteId es un código corto o un ID hexadecimal
      let facturapiClienteId = data.clienteId;
      const hexRegex = /^[0-9a-f]{24}$/i;
      
      // Si el clienteId no es un ID hexadecimal válido, buscar el cliente por nombre
      if (!hexRegex.test(facturapiClienteId)) {
        invoiceServiceLogger.debug({ clienteId: facturapiClienteId }, 'ID de cliente no es hexadecimal, buscando por nombre');
        
        // Mapa de códigos cortos a nombres completos para buscar
        const clientMap = {
          'SOS': 'PROTECCION S.O.S. JURIDICO',
          'ARSA': 'ARSA ASESORIA INTEGRAL PROFESIONAL',
          'INFO': 'INFOASIST INFORMACION Y ASISTENCIA'
        };
        
        // Obtener el nombre completo si es un código corto
        const nombreBusqueda = clientMap[facturapiClienteId] || data.clienteNombre || facturapiClienteId;
        
        try {
          // ✅ OPTIMIZACIÓN: Buscar primero en BD local (mucho más rápido)
          console.log(`🔍 Buscando cliente en BD local: "${nombreBusqueda}"`);
          const localCustomer = await prisma.tenantCustomer.findFirst({
            where: {
              tenantId,
              OR: [
                { legalName: { contains: nombreBusqueda, mode: 'insensitive' } },
                { legalName: clientMap[facturapiClienteId] }
              ]
            }
          });
          
          if (localCustomer) {
            // ✅ Encontrado en BD local (0.1 segundos)
            facturapiClienteId = localCustomer.facturapiCustomerId;
            console.log(`✅ Cliente encontrado en BD local: ${localCustomer.legalName} (ID: ${facturapiClienteId})`);
          } else {
            // ⚠️ Solo como fallback, buscar en FacturAPI (30 segundos)
            console.log(`⚠️ Cliente no encontrado en BD local, buscando en FacturAPI: "${nombreBusqueda}"`);
            const clientes = await facturapi.customers.list({
              q: nombreBusqueda // Usar el nombre completo para mayor precisión
            });
            
            if (clientes && clientes.data && clientes.data.length > 0) {
              // Usar el primer cliente que coincida
              facturapiClienteId = clientes.data[0].id;
              console.log(`Cliente encontrado en FacturAPI: ${clientes.data[0].legal_name} (ID: ${facturapiClienteId})`);
            } else {
              throw new Error(`No se encontró el cliente "${nombreBusqueda}" ni en BD local ni en FacturAPI`);
            }
          }
        } catch (error) {
          console.error('Error buscando cliente:', error);
          throw new Error(`Error al buscar cliente por nombre: ${error.message}`);
        }
      }
      
      // Obtener el próximo folio
      await TenantService.getNextFolio(tenantId, 'A');
      
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
        customer: facturapiClienteId, // Usar el ID convertido
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

      };
      
      console.log('Enviando solicitud a FacturAPI para crear factura:', facturaData);
      
      // Llamar a FacturAPI para crear la factura
      const factura = await facturapi.invoices.create(facturaData);

      console.log('Factura creada en FacturAPI:', factura.id);
      console.log('Folio asignado por FacturAPI:', factura.folio_number); // Logging para verificar
      
      // Registrar la factura en la base de datos con el folio asignado por FacturAPI
      await TenantService.registerInvoice(
        tenantId,
        factura.id,
        factura.series,
        factura.folio_number, // Usar el folio devuelto por FacturAPI
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