import prisma from '../lib/prisma.js';
import axios from 'axios';
import logger from '../core/utils/logger.js';

// Variable para almacenar el módulo Facturapi una vez importado
let FacturapiModule = null;

// Logger específico para FacturAPI service
const facturapiLogger = logger.child({ module: 'facturapi-service' });

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
      // Obtener el tenant y sus credenciales
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId }
      });
    
      if (!tenant) {
        console.error(`No se encontró el tenant con ID ${tenantId}`);
        throw new Error('No se encontró el tenant especificado');
      }
    
      if (!tenant.facturapiApiKey) {
        console.error(`Tenant ${tenant.businessName} (${tenantId}) no tiene API key configurada`);
        throw new Error('El tenant no tiene una API key configurada. Por favor, contacte al administrador.');
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
        console.log(`La API key no tiene la longitud esperada (debería tener al menos 30 caracteres)`);
      }
      
      console.log(`✅ API key obtenida para tenant ${tenant.businessName} (ID: ${tenantId}). Longitud: ${apiKey?.length || 0}. Primeros caracteres: ${apiKey ? apiKey.substring(0, 5) + '...' : 'null o undefined'}`);
  
      if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10) {
        console.error(`API key inválida para tenant ${tenantId}:`, apiKey?.substring(0,5));
        throw new Error('La API key del tenant es inválida');
      }
      
      try {
        // Importar Facturapi solo una vez
        if (!FacturapiModule) {
          FacturapiModule = await import('facturapi');
          console.log('Módulo Facturapi importado correctamente');
        }
        
        // Usar la estructura correcta para el constructor
        const FacturapiConstructor = FacturapiModule.default.default;
        if (typeof FacturapiConstructor !== 'function') {
          console.error('El constructor de Facturapi no es una función:', typeof FacturapiConstructor);
          throw new Error('No se pudo encontrar un constructor válido para Facturapi');
        }
        
        // Crear instancia con la API key
        const client = new FacturapiConstructor(apiKey);
        
        console.log(`Cliente FacturAPI creado exitosamente para tenant ${tenantId}`);
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
        customization
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
   * Verifica la conexión con FacturAPI
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Resultado de la verificación
   */
  static async testConnection(tenantId) {
    try {
      const facturapi = await this.getFacturapiClient(tenantId);
      
      // Intentar obtener algo simple como los productos
      const products = await facturapi.catalogs.getProducts();
      
      return { 
        success: true, 
        message: 'Conexión establecida correctamente con FacturAPI',
        data: { products_count: products.length }
      };
    } catch (error) {
      console.error(`Error al probar conexión para tenant ${tenantId}:`, error);
      return { 
        success: false, 
        message: `Error de conexión: ${error.message}`,
        error: error
      };
    }
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
        tax_system: legalData.tax_system || "601", // Valor por defecto
        phone: legalData.phone || "",
        website: legalData.website || "",
        address: {}
      };
      
      // Campos de dirección permitidos
      if (legalData.address) {
        dataToSend.address = {
          street: legalData.address.street || "",
          exterior: legalData.address.exterior || "",
          interior: legalData.address.interior || "",
          neighborhood: legalData.address.neighborhood || "",
          zip: legalData.address.zip || "",
          city: legalData.address.city || "",
          municipality: legalData.address.municipality || "",
          state: legalData.address.state || ""
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
          'Authorization': `Bearer ${FACTURAPI_USER_KEY}`,
          'Content-Type': 'application/json'
        },
        data: dataToSend
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
