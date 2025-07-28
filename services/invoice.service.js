import prisma from '../lib/prisma.js';
import TenantService from './tenant.service.js';
import facturapIService from './facturapi.service.js';
import facturapiQueueService from './facturapi-queue.service.js'; // Importar el servicio de cola
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
      console.log(`[INVOICE_METRICS] Iniciando facturapIService.getFacturapiClient()`);
      const clientStartTime = Date.now();
      const facturapi = await facturapIService.getFacturapiClient(tenantId);
      console.log(
        `[INVOICE_METRICS] facturapIService.getFacturapiClient() tomó ${Date.now() - clientStartTime}ms`
      );

      // Verificar si el clienteId es un código corto o un ID hexadecimal
      let facturapiClienteId = data.clienteId;
      let localCustomerDbId = data.localCustomerDbId; // ID de PostgreSQL para FK
      const hexRegex = /^[0-9a-f]{24}$/i;

      // Si el clienteId no es un ID hexadecimal válido, buscar el cliente por nombre
      if (!hexRegex.test(facturapiClienteId)) {
        invoiceServiceLogger.debug(
          { clienteId: facturapiClienteId },
          'ID de cliente no es hexadecimal, buscando por nombre'
        );

        // Mapa de códigos cortos a nombres completos para buscar
        const clientMap = {
          SOS: 'PROTECCION S.O.S. JURIDICO',
          ARSA: 'ARSA ASESORIA INTEGRAL PROFESIONAL',
          INFO: 'INFOASIST INFORMACION Y ASISTENCIA',
        };

        // Obtener el nombre completo si es un código corto
        const nombreBusqueda =
          clientMap[facturapiClienteId] || data.clienteNombre || facturapiClienteId;

        try {
          // ✅ OPTIMIZACIÓN: Buscar primero en BD local (mucho más rápido)
          console.log(`🔍 Buscando cliente en BD local: "${nombreBusqueda}"`);
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
            // ✅ Encontrado en BD local (0.1 segundos)
            facturapiClienteId = localCustomer.facturapiCustomerId; // Para FacturAPI
            localCustomerDbId = localCustomer.id; // Para BD PostgreSQL FK
            console.log(
              `✅ Cliente encontrado en BD local: ${localCustomer.legalName} (FacturAPI ID: ${facturapiClienteId}, DB ID: ${localCustomerDbId})`
            );
          } else {
            // ⚠️ Solo como fallback, buscar en FacturAPI (30 segundos)
            console.log(
              `⚠️ Cliente no encontrado en BD local, buscando en FacturAPI: "${nombreBusqueda}"`
            );
            const clientes = await facturapi.customers.list({
              q: nombreBusqueda, // Usar el nombre completo para mayor precisión
            });

            if (clientes && clientes.data && clientes.data.length > 0) {
              // Usar el primer cliente que coincida
              facturapiClienteId = clientes.data[0].id;
              localCustomerDbId = null; // No hay FK local para clientes de FacturAPI
              console.log(
                `Cliente encontrado en FacturAPI: ${clientes.data[0].legal_name} (ID: ${facturapiClienteId})`
              );
            } else {
              throw new Error(
                `No se encontró el cliente "${nombreBusqueda}" ni en BD local ni en FacturAPI`
              );
            }
          }
        } catch (error) {
          console.error('Error buscando cliente:', error);
          throw new Error(`Error al buscar cliente por nombre: ${error.message}`);
        }
      }

      // OPTIMIZACIÓN: Comentar la obtención del folio - FacturAPI lo asigna automáticamente
      // El folio se obtiene de FacturAPI después de crear la factura
      // Esto elimina 2-3 segundos de latencia con BD remota
      /*
      console.log(`[INVOICE_METRICS] Iniciando TenantService.getNextFolio()`);
      const folioStartTime = Date.now();
      await TenantService.getNextFolio(tenantId, 'A');
      console.log(`[INVOICE_METRICS] TenantService.getNextFolio() tomó ${Date.now() - folioStartTime}ms`);
      */

      // Verificar si el cliente requiere retención (SOS, INFOASIST, ARSA)
      // OPTIMIZACIÓN: Verificar por nombre sin llamada adicional a FacturAPI
      const requiresWithholding = ['INFOASIST', 'ARSA', 'S.O.S', 'SOS'].some(
        (name) =>
          data.clienteNombre?.includes(name) ||
          (typeof data.clienteId === 'string' && data.clienteId.includes(name))
      );

      console.log(
        `Cliente: ${data.clienteNombre || data.clienteId}, Requiere retención: ${requiresWithholding}`
      );

      // Configurar los impuestos según corresponda
      const taxes = requiresWithholding
        ? [
            { type: 'IVA', rate: 0.16, factor: 'Tasa' },
            { type: 'IVA', rate: 0.04, factor: 'Tasa', withholding: true },
          ]
        : [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }];

      // Crear la factura en FacturAPI
      const facturaData = {
        customer: facturapiClienteId, // Usar el ID convertido
        items: [
          {
            quantity: 1,
            product: {
              description: `ARRASTRE DE GRUA PEDIDO DE COMPRA ${data.numeroPedido}`,
              product_key: data.claveProducto,
              unit_key: 'E48',
              unit_name: 'SERVICIO',
              price: parseFloat(data.monto),
              tax_included: false,
              taxes: taxes,
            },
          },
        ],
        use: 'G03',
        payment_form: '99',
        payment_method: 'PPD',
      };

      console.log('Enviando solicitud a FacturAPI para crear factura:', facturaData);

      // 🔍 MÉTRICAS: Medir tiempo de FacturAPI
      const facturapiStartTime = Date.now();
      console.log(`[FACTURAPI_METRICS] Iniciando llamada a FacturAPI.invoices.create()`);

      // Llamar a FacturAPI para crear la factura
      const factura = await facturapi.invoices.create(facturaData);

      const facturapiDuration = Date.now() - facturapiStartTime;
      console.log(`[FACTURAPI_METRICS] FacturAPI.invoices.create() tomó ${facturapiDuration}ms`);

      console.log('Factura creada en FacturAPI:', factura.id);
      console.log('Folio asignado por FacturAPI:', factura.folio_number); // Logging para verificar

      // Encolar el registro de la factura en segundo plano
      facturapiQueueService.enqueue(
        () =>
          TenantService.registerInvoice(
            tenantId,
            factura.id,
            factura.series,
            factura.folio_number,
            localCustomerDbId, // Usar ID de PostgreSQL para FK
            factura.total,
            null // QUICK FIX: Always use null for createdById to avoid INT4 overflow with Telegram IDs
          ),
        'register-invoice',
        { tenantId, facturapiInvoiceId: factura.id }
      );

      return factura;
    } catch (error) {
      console.error('Error al crear factura en FacturAPI:', error);
      throw error;
    }
  }

  /**
   * Busca facturas según criterios con paginación a nivel de BD
   * @param {Object} criteria - Criterios de búsqueda
   * @param {number} criteria.page - Página (default: 1)
   * @param {number} criteria.limit - Límite por página (default: 10)
   * @returns {Promise<Object>} - {data: facturas, pagination: info}
   */
  static async searchInvoices(criteria) {
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

    // Calcular skip para paginación
    const skip = (page - 1) * limit;

    // Ejecutar consultas en paralelo: datos + total
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
