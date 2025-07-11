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
}

export default FacturapiService;
