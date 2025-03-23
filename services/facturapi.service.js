import prisma from '../lib/prisma.js';
import { decryptApiKey } from '../core/utils/encryption.js';

// Variable para almacenar el módulo Facturapi una vez importado
let FacturapiModule = null;

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
      
      // Usar la API key directamente sin desencriptar
      let apiKey = tenant.facturapiApiKey;
      
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
}

export default FacturapiService;

import { TenantService } from '../core/tenant/tenant.service.js';

async function testFacturapiDirect() {
  console.log('\n=== TEST DIRECTO DE FACTURAPI ===');
  
  try {
    // Obtener la API key del tenant
    console.log(`Obteniendo API key para tenant: ${TENANT_ID}`);
    const apiKey = await TenantService.getDecryptedApiKey(TENANT_ID);
    
    if (!apiKey) {
      console.error('❌ No se pudo obtener la API key del tenant');
      return;
    }
    
    console.log(`API key obtenida (primeros 5 caracteres): ${apiKey.substring(0, 5)}...`);
    
    // Probar descarga directa de FacturAPI
    console.log(`Probando descarga directa desde FacturAPI para factura: ${FACTURA_ID}`);
    
    const response = await axios({
      method: 'GET',
      url: `https://www.facturapi.io/v2/invoices/${FACTURA_ID}/pdf`,
      responseType: 'stream',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    // Guardar el archivo para verificar
    const writer = fs.createWriteStream(`./test-factura-direct.pdf`);
    response.data.pipe(writer);
    
    writer.on('finish', () => {
      console.log('✅ Descarga DIRECTA EXITOSA - Archivo guardado como test-factura-direct.pdf');
    });
    
    writer.on('error', (err) => {
      console.error('❌ Error al escribir el archivo:', err);
    });
  } catch (error) {
    console.error('❌ Error en la solicitud directa a FacturAPI:');
    
    if (error.response) {
      console.error(`  Status: ${error.response.status}`);
      console.error(`  Mensaje: ${error.response.statusText}`);
      
      if (error.response.data) {
        // Para capturar el cuerpo del error
        const chunks = [];
        error.response.data.on('data', (chunk) => chunks.push(chunk));
        error.response.data.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          console.error(`  Respuesta: ${body}`);
        });
      }
    } else {
      console.error(`  Error: ${error.message}`);
    }
  }
}

// Ejecutamos ambos tests
async function runAllTests() {
  await testDownloadEndpoint();
  await testFacturapiDirect();
}

runAllTests();