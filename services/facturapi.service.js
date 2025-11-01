import prisma from '../lib/prisma.js';
import axios from 'axios';
import facturapiQueueService from './facturapi-queue.service.js';
import facturapiModule from 'facturapi';
const Facturapi = facturapiModule.default;

// Cache para clientes FacturAPI
const clientCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutos

/**
 * Servicio para interactuar con FacturAPI en modo multi-tenant
 */
class FacturapiService {
  /**
   * Obtiene una instancia de FacturAPI para un tenant específico
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Cliente de FacturAPI
   */
  static async getFacturapiClient(tenantId) {
    try {
      // ✅ CACHE: Verificar si ya tenemos el cliente en cache
      const cacheKey = tenantId;
      const cached = clientCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`🚀 Cliente FacturAPI obtenido desde cache para tenant ${tenantId}`);
        return cached.client;
      }

      // Obtener el tenant y sus credenciales
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!tenant) {
        console.error(`No se encontró el tenant con ID ${tenantId}`);
        throw new Error('No se encontró el tenant especificado');
      }

      if (!tenant.facturapiApiKey) {
        console.error(`Tenant ${tenant.businessName} (${tenantId}) no tiene API key configurada`);
        throw new Error(
          'El tenant no tiene una API key configurada. Por favor, contacte al administrador.'
        );
      }

      console.log(`Obteniendo API key para tenant: ${tenant.businessName} (${tenantId})`);

      // Usar exclusivamente la API key del tenant
      const apiKey = tenant.facturapiApiKey;

      // Registrar el entorno para depuración
      console.log(`Usando API key almacenada para el tenant: ${tenant.businessName} (${tenantId})`);

      // Verificar que la API key tenga un formato válido
      if (apiKey && apiKey.length >= 30) {
        console.log(`La API key parece tener un formato válido`);
      } else {
        console.log(
          `La API key no tiene la longitud esperada (debería tener al menos 30 caracteres)`
        );
      }

      console.log(
        `✅ API key obtenida para tenant ${tenant.businessName} (ID: ${tenantId}). Longitud: ${apiKey?.length || 0}. Primeros caracteres: ${apiKey ? apiKey.substring(0, 5) + '...' : 'null o undefined'}`
      );

      if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10) {
        console.error(`API key inválida para tenant ${tenantId}:`, apiKey?.substring(0, 5));
        throw new Error('La API key del tenant es inválida');
      }

      try {
        // Crear instancia con la API key
        const client = new Facturapi(apiKey);

        // ✅ CACHE: Guardar cliente en cache
        clientCache.set(cacheKey, {
          client,
          timestamp: Date.now(),
        });

        console.log(
          `Cliente FacturAPI creado exitosamente para tenant ${tenantId} y guardado en cache`
        );
        return client;
      } catch (error) {
        console.error(`Error al crear cliente FacturAPI para tenant ${tenantId}:`, error);
        throw new Error(`Error al crear cliente de FacturAPI: ${error.message}`);
      }
    } catch (error) {
      console.error(`Error en getFacturapiClient para tenant ${tenantId}:`, error.message);
      throw error;
    }
  }

  /**
   * Obtiene información de la organización del tenant
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Información de la organización
   */
  static async getOrganizationInfo(tenantId) {
    try {
      const facturapi = await this.getFacturapiClient(tenantId);
      const legal = await facturapi.organizations.getLegal();
      const customization = await facturapi.organizations.getCustomization();

      return {
        legal,
        customization,
      };
    } catch (error) {
      console.error(`Error al obtener información de organización para tenant ${tenantId}:`, error);
      throw error;
    }
  }

  /**
   * Obtiene catálogos del SAT
   * @param {string} tenantId - ID del tenant
   * @param {string} catalogType - Tipo de catálogo ('products', 'payment_forms', etc)
   * @returns {Promise<Array>} - Catálogo solicitado
   */
  static async getCatalog(tenantId, catalogType) {
    try {
      const facturapi = await this.getFacturapiClient(tenantId);

      switch (catalogType) {
        case 'products':
          return facturapi.catalogs.getProducts();
        case 'units':
          return facturapi.catalogs.getUnits();
        case 'payment_forms':
          return facturapi.catalogs.getPaymentForms();
        case 'payment_methods':
          return facturapi.catalogs.getPaymentMethods();
        case 'cfdi_uses':
          return facturapi.catalogs.getCfdiUses();
        case 'tax_types':
          return facturapi.catalogs.getTaxTypes();
        default:
          throw new Error(`Tipo de catálogo no soportado: ${catalogType}`);
      }
    } catch (error) {
      console.error(`Error al obtener catálogo ${catalogType} para tenant ${tenantId}:`, error);
      throw error;
    }
  }

  /**
   * Verifica la conexión con FacturAPI usando cola y timeouts adaptativos
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Resultado de la verificación
   */
  static async testConnection(tenantId) {
    try {
      // Usar cola para operaciones de prueba
      const result = await facturapiQueueService.enqueue(
        async () => {
          const facturapi = await this.getFacturapiClient(tenantId);
          const products = await facturapi.catalogs.getProducts();
          return { products_count: products.length };
        },
        'quick', // Operación rápida
        { tenantId, operation: 'test_connection' },
        2 // Prioridad media-alta
      );

      return {
        success: true,
        message: 'Conexión establecida correctamente con FacturAPI',
        data: result,
      };
    } catch (error) {
      console.error(`Error al probar conexión para tenant ${tenantId}:`, error);
      return {
        success: false,
        message: `Error de conexión: ${error.message}`,
        error: error,
      };
    }
  }

  /**
   * Crear factura usando cola y timeouts adaptativos para escalabilidad
   * @param {Object} facturapi - Cliente de FacturAPI
   * @param {Object} facturaData - Datos de la factura
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Factura creada
   */
  static async createInvoiceQueued(facturapi, facturaData, tenantId) {
    return await facturapiQueueService.enqueue(
      async () => {
        return await facturapi.invoices.create(facturaData);
      },
      'normal', // Operación normal
      { tenantId, operation: 'create_invoice', invoiceData: facturaData },
      3 // Prioridad alta para facturación
    );
  }

  /**
   * Buscar clientes usando cola para evitar sobrecarga
   * @param {Object} facturapi - Cliente de FacturAPI
   * @param {string} searchQuery - Query de búsqueda
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Resultados de búsqueda
   */
  static async searchCustomersQueued(facturapi, searchQuery, tenantId) {
    return await facturapiQueueService.enqueue(
      async () => {
        return await facturapi.customers.list({ q: searchQuery });
      },
      'quick', // Búsquedas son operaciones rápidas
      { tenantId, operation: 'search_customers', query: searchQuery },
      1 // Prioridad baja para búsquedas
    );
  }

  /**
   * Obtener catálogos usando cola
   * @param {string} tenantId - ID del tenant
   * @param {string} catalogType - Tipo de catálogo
   * @returns {Promise<Array>} - Catálogo solicitado
   */
  static async getCatalogQueued(tenantId, catalogType) {
    return await facturapiQueueService.enqueue(
      async () => {
        const facturapi = await this.getFacturapiClient(tenantId);

        switch (catalogType) {
          case 'products':
            return facturapi.catalogs.getProducts();
          case 'units':
            return facturapi.catalogs.getUnits();
          case 'payment_forms':
            return facturapi.catalogs.getPaymentForms();
          case 'payment_methods':
            return facturapi.catalogs.getPaymentMethods();
          case 'cfdi_uses':
            return facturapi.catalogs.getCfdiUses();
          case 'tax_types':
            return facturapi.catalogs.getTaxTypes();
          default:
            throw new Error(`Tipo de catálogo no soportado: ${catalogType}`);
        }
      },
      'quick', // Catálogos son operaciones rápidas
      { tenantId, operation: 'get_catalog', catalogType },
      1 // Prioridad baja
    );
  }

  /**
   * Actualiza la información legal de una organización
   * @param {string} organizationId - ID de la organización en FacturAPI
   * @param {Object} legalData - Datos legales a actualizar
   * @returns {Promise<Object>} - Datos actualizados
   */
  static async updateOrganizationLegal(organizationId, legalData) {
    try {
      // Verificamos que el campo organizationId esté presente
      if (!organizationId) {
        throw new Error('Se requiere el ID de la organización en FacturAPI');
      }

      // Verificamos que legalData sea un objeto
      if (!legalData || typeof legalData !== 'object') {
        throw new Error('Los datos legales deben ser un objeto válido');
      }

      // Creamos un objeto nuevo con solo los campos permitidos
      const dataToSend = {
        name: legalData.name || legalData.legal_name,
        legal_name: legalData.legal_name,
        tax_system: legalData.tax_system || '601', // Valor por defecto
        phone: legalData.phone || '',
        website: legalData.website || '',
        address: {},
      };

      // Campos de dirección permitidos
      if (legalData.address) {
        dataToSend.address = {
          street: legalData.address.street || '',
          exterior: legalData.address.exterior || '',
          interior: legalData.address.interior || '',
          neighborhood: legalData.address.neighborhood || '',
          zip: legalData.address.zip || '',
          city: legalData.address.city || '',
          municipality: legalData.address.municipality || '',
          state: legalData.address.state || '',
        };
      }

      console.log('Actualizando datos legales en FacturAPI:', dataToSend);

      // Obtener el cliente de Facturapi usando FACTURAPI_USER_KEY
      const FACTURAPI_USER_KEY = process.env.FACTURAPI_USER_KEY;
      if (!FACTURAPI_USER_KEY) {
        throw new Error('FACTURAPI_USER_KEY no está configurada en las variables de entorno');
      }

      const response = await axios({
        method: 'PUT',
        url: `https://www.facturapi.io/v2/organizations/${organizationId}/legal`,
        headers: {
          Authorization: `Bearer ${FACTURAPI_USER_KEY}`,
          'Content-Type': 'application/json',
        },
        data: dataToSend,
      });

      return response.data;
    } catch (error) {
      console.error('Error al actualizar datos legales en FacturAPI:', error);

      if (error.response) {
        console.error('Detalles del error:', error.response.status, error.response.data);
      }

      throw error;
    }
  }

  /**
   * Limpia el cache del cliente FacturAPI para un tenant específico
   * @param {string} tenantId - ID del tenant
   */
  static clearClientCache(tenantId) {
    const cacheKey = tenantId;
    if (clientCache.has(cacheKey)) {
      clientCache.delete(cacheKey);
      console.log(`🧹 Cache eliminado para tenant ${tenantId}`);
    }
  }

  // ========== METODOS PARA COMPLEMENTOS DE PAGO (TIPO "P") ==========

  /**
   * Calcula la base imponible y los impuestos de un monto total
   * @param {number} montoTotal - Monto total (con IVA incluido)
   * @param {number} tasaIVA - Tasa de IVA trasladado (default: 0.16 para 16%)
   * @param {number} tasaRetencion - Tasa de retención de IVA (default: 0.04 para 4%)
   * @param {boolean} incluirRetencion - Si se debe incluir retención (default: true)
   * @returns {Object} - { base, iva, retencion, total, taxesArray }
   */
  static calcularImpuestos(
    montoTotal,
    tasaIVA = 0.16,
    tasaRetencion = 0.04,
    incluirRetencion = true
  ) {
    // Calcular la base (monto sin IVA)
    const base = montoTotal / (1 + tasaIVA);
    const iva = montoTotal - base;
    const retencion = incluirRetencion ? base * tasaRetencion : 0;

    // Construir array de taxes en formato Facturapi
    const taxesArray = [
      {
        base: parseFloat(base.toFixed(2)),
        type: 'IVA',
        factor: 'Tasa',
        rate: tasaIVA,
        withholding: false,
      },
    ];

    // Agregar retención si se requiere
    if (incluirRetencion) {
      taxesArray.push({
        base: parseFloat(base.toFixed(2)),
        type: 'IVA',
        factor: 'Tasa',
        rate: tasaRetencion,
        withholding: true,
      });
    }

    return {
      base: parseFloat(base.toFixed(2)),
      iva: parseFloat(iva.toFixed(2)),
      retencion: parseFloat(retencion.toFixed(2)),
      total: parseFloat(montoTotal.toFixed(2)),
      taxesArray, // Array listo para usar en Facturapi
    };
  }

  /**
   * Calcula el saldo pendiente de una factura después de pagos anteriores
   * @param {number} totalFactura - Monto total de la factura original
   * @param {Array} pagosAnteriores - Array de pagos anteriores [{ amount: number }]
   * @returns {Object} - { totalPagado, saldoPendiente }
   */
  static calcularSaldos(totalFactura, pagosAnteriores = []) {
    const totalPagado = pagosAnteriores.reduce((sum, pago) => sum + pago.amount, 0);
    const saldoPendiente = totalFactura - totalPagado;

    return {
      totalPagado: parseFloat(totalPagado.toFixed(2)),
      saldoPendiente: parseFloat(saldoPendiente.toFixed(2)),
    };
  }

  /**
   * Valida los datos de un complemento de pago antes de enviarlo
   * @param {Object} pagoData - Datos del complemento de pago
   * @returns {Object} - { valid: boolean, errors: Array }
   */
  static validarComplementoPago(pagoData) {
    const errors = [];

    // Validar customer
    if (!pagoData.customer) {
      errors.push('El campo customer es requerido');
    }

    // Validar payment_form
    if (!pagoData.payment_form) {
      errors.push('El campo payment_form es requerido');
    }

    // Validar related_documents
    if (!pagoData.related_documents || !Array.isArray(pagoData.related_documents)) {
      errors.push('El campo related_documents debe ser un array');
    } else if (pagoData.related_documents.length === 0) {
      errors.push('Debe incluir al menos una factura en related_documents');
    } else {
      // Validar cada documento relacionado
      pagoData.related_documents.forEach((doc, index) => {
        if (!doc.uuid) {
          errors.push(`Documento ${index + 1}: falta el campo uuid`);
        }
        if (!doc.amount || doc.amount <= 0) {
          errors.push(`Documento ${index + 1}: el monto debe ser mayor a 0`);
        }
        if (!doc.installment || doc.installment < 1) {
          errors.push(`Documento ${index + 1}: installment debe ser >= 1`);
        }
        if (!doc.last_balance || doc.last_balance <= 0) {
          errors.push(`Documento ${index + 1}: last_balance debe ser mayor a 0`);
        }
        if (doc.amount > doc.last_balance) {
          errors.push(
            `Documento ${index + 1}: el monto a pagar (${doc.amount}) no puede ser mayor al saldo pendiente (${doc.last_balance})`
          );
        }
        if (!doc.taxes || !Array.isArray(doc.taxes) || doc.taxes.length === 0) {
          errors.push(`Documento ${index + 1}: debe incluir al menos un impuesto en taxes`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Crear complemento de pago (CFDI tipo "P")
   * @param {string} tenantId - ID del tenant
   * @param {Object} pagoData - Datos del pago
   * @param {Object|string} pagoData.customer - Información del cliente (objeto completo o ID)
   * @param {string} pagoData.payment_form - Forma de pago (código del catálogo SAT)
   * @param {string} pagoData.date - Fecha del pago (ISO 8601, opcional)
   * @param {Array} pagoData.related_documents - Facturas que se están pagando
   * @param {string} pagoData.related_documents[].uuid - UUID de la factura
   * @param {number} pagoData.related_documents[].amount - Monto que se paga
   * @param {number} pagoData.related_documents[].installment - Número de parcialidad
   * @param {number} pagoData.related_documents[].last_balance - Saldo antes del pago
   * @param {Array} pagoData.related_documents[].taxes - Impuestos del pago
   * @returns {Promise<Object>} - Complemento de pago creado
   */
  static async createPaymentComplement(tenantId, pagoData) {
    try {
      // Validar datos antes de enviar
      const validacion = this.validarComplementoPago(pagoData);
      if (!validacion.valid) {
        console.error(`Errores de validación en complemento de pago:`, validacion.errors);
        throw new Error(`Datos inválidos: ${validacion.errors.join(', ')}`);
      }

      const facturapi = await this.getFacturapiClient(tenantId);

      // Construir estructura del complemento de pago tipo "P"
      // IMPORTANTE: data debe ser un ARRAY con la fecha del pago
      const complementoPago = {
        type: 'P',
        customer: pagoData.customer,
        complements: [
          {
            type: 'pago',
            data: [
              {
                date: pagoData.date || new Date().toISOString(), // Fecha del pago
                payment_form: pagoData.payment_form,
                related_documents: pagoData.related_documents,
              },
            ],
          },
        ],
      };

      console.log(
        `Creando complemento de pago para tenant ${tenantId}:`,
        JSON.stringify(complementoPago, null, 2)
      );

      // Crear usando cola para evitar sobrecarga
      const resultado = await this.createInvoiceQueued(facturapi, complementoPago, tenantId);

      console.log(
        `✅ Complemento de pago creado exitosamente. UUID: ${resultado.id || resultado.uuid}`
      );

      return resultado;
    } catch (error) {
      console.error(`Error al crear complemento de pago para tenant ${tenantId}:`, error);
      if (error.response?.data) {
        console.error('Detalles del error de Facturapi:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Crear complemento de pago simple (una sola factura, pago completo)
   * @param {string} tenantId - ID del tenant
   * @param {Object} params - Parámetros del pago
   * @param {string|Object} params.customer - ID del cliente o objeto customer
   * @param {string} params.payment_form - Forma de pago
   * @param {string} params.invoice_uuid - UUID de la factura a pagar
   * @param {number} params.amount - Monto del pago
   * @param {number} params.installment - Número de parcialidad (default: 1)
   * @param {number} params.last_balance - Saldo pendiente antes del pago
   * @param {number} params.tax_rate - Tasa de IVA (default: 0.16)
   * @param {number} params.retention_rate - Tasa de retención (default: 0.04)
   * @param {boolean} params.include_retention - Incluir retención (default: true)
   * @param {string} params.date - Fecha del pago (ISO 8601, opcional)
   * @returns {Promise<Object>} - Complemento de pago creado
   */
  static async createSimplePaymentComplement(tenantId, params) {
    try {
      const {
        customer,
        payment_form,
        invoice_uuid,
        amount,
        installment = 1,
        last_balance,
        tax_rate = 0.16,
        retention_rate = 0.04,
        include_retention = true,
        date,
      } = params;

      // Calcular impuestos con el formato correcto
      const { taxesArray } = this.calcularImpuestos(amount, tax_rate, retention_rate, include_retention);

      // Construir datos del pago
      const pagoData = {
        customer,
        payment_form,
        date: date || new Date().toISOString(),
        related_documents: [
          {
            uuid: invoice_uuid,
            amount: parseFloat(amount.toFixed(2)),
            installment,
            last_balance: parseFloat(last_balance.toFixed(2)),
            taxes: taxesArray, // Usar el array con formato completo
          },
        ],
      };

      return await this.createPaymentComplement(tenantId, pagoData);
    } catch (error) {
      console.error(`Error al crear complemento de pago simple para tenant ${tenantId}:`, error);
      throw error;
    }
  }

  /**
   * Crear complemento de pago para múltiples facturas
   * @param {string} tenantId - ID del tenant
   * @param {Object} params - Parámetros del pago
   * @param {string|Object} params.customer - ID del cliente o objeto customer
   * @param {string} params.payment_form - Forma de pago
   * @param {string} params.date - Fecha del pago (ISO 8601, opcional)
   * @param {Array} params.invoices - Array de facturas a pagar
   * @param {string} params.invoices[].uuid - UUID de la factura
   * @param {number} params.invoices[].amount - Monto a pagar
   * @param {number} params.invoices[].installment - Número de parcialidad
   * @param {number} params.invoices[].last_balance - Saldo pendiente
   * @param {number} params.invoices[].tax_rate - Tasa de IVA (opcional, default: 0.16)
   * @param {number} params.invoices[].retention_rate - Tasa de retención (opcional, default: 0.04)
   * @param {boolean} params.invoices[].include_retention - Incluir retención (opcional, default: true)
   * @returns {Promise<Object>} - Complemento de pago creado
   */
  static async createMultipleInvoicesPaymentComplement(tenantId, params) {
    try {
      const { customer, payment_form, invoices, date } = params;

      if (!invoices || invoices.length === 0) {
        throw new Error('Debe proporcionar al menos una factura para pagar');
      }

      // Construir related_documents para cada factura
      const related_documents = invoices.map((invoice) => {
        const tax_rate = invoice.tax_rate || 0.16;
        const retention_rate = invoice.retention_rate || 0.04;
        const include_retention = invoice.include_retention !== undefined ? invoice.include_retention : true;

        const { taxesArray } = this.calcularImpuestos(
          invoice.amount,
          tax_rate,
          retention_rate,
          include_retention
        );

        return {
          uuid: invoice.uuid,
          amount: parseFloat(invoice.amount.toFixed(2)),
          installment: invoice.installment || 1,
          last_balance: parseFloat(invoice.last_balance.toFixed(2)),
          taxes: taxesArray,
        };
      });

      const pagoData = {
        customer,
        payment_form,
        date: date || new Date().toISOString(),
        related_documents,
      };

      return await this.createPaymentComplement(tenantId, pagoData);
    } catch (error) {
      console.error(
        `Error al crear complemento de pago múltiple para tenant ${tenantId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Crear múltiples complementos de pago en lote
   * @param {string} tenantId - ID del tenant
   * @param {Array} pagosData - Array de datos de pagos
   * @returns {Promise<Array>} - Array con resultados { success: boolean, data/error }
   */
  static async createMultiplePaymentComplements(tenantId, pagosData) {
    const results = [];

    for (const pagoData of pagosData) {
      try {
        const result = await this.createPaymentComplement(tenantId, pagoData);
        results.push({
          success: true,
          data: result,
          uuid: result.id || result.uuid,
        });
      } catch (error) {
        results.push({
          success: false,
          error: error.message,
          pagoData,
        });
      }
    }

    const exitosos = results.filter((r) => r.success).length;
    const fallidos = results.filter((r) => !r.success).length;

    console.log(
      `Procesamiento de complementos de pago completado. Exitosos: ${exitosos}, Fallidos: ${fallidos}`
    );

    return results;
  }
}

export default FacturapiService;
