import prisma from '../lib/prisma.js';

/**
 * Datos de los clientes con RFC reales
 */
const CLIENTES_PREDEFINIDOS = [
  {
    legal_name: "INFOASIST INFORMACION Y ASISTENCIA",
    tax_id: "IIA951221LQA",
    tax_system: "601",
    address: {
      street: "ADOLFO LOPEZ MATEOS",
      exterior: "261",
      interior: "OFICINA 301",
      neighborhood: "LOS ALPES",
      zip: "01010",
      municipality: "ALVARO OBREGON",
      state: "CIUDAD DE MEXICO",
      country: "MEX"
    },
    email: "info@example.com",
    phone: ""
  },
  {
    legal_name: "ARSA ASESORIA INTEGRAL PROFESIONAL",
    tax_id: "AIP900419FI1",
    tax_system: "601",
    address: {
      street: "BOULEVARD ADOLFO LOPEZ MATEOS",
      exterior: "261",
      interior: "PISO 8",
      neighborhood: "LOS ALPES",
      zip: "01010",
      municipality: "ALVARO OBREGON",
      state: "CIUDAD DE MEXICO",
      country: "MEX"
    },
    email: "arsa@example.com",
    phone: ""
  },
  {
    legal_name: "PROTECCION S.O.S. JURIDICO AUTOMOVILISTICO LAS VEINTICUATRO HORAS DEL DIA",
    tax_id: "PSO880407SN0",
    tax_system: "601",
    address: {
      street: "REVOLUCION",
      exterior: "1267",
      interior: "PISO 20 CLUSTER A",
      neighborhood: "LOS ALPES",
      zip: "01010",
      municipality: "ALVARO OBREGON",
      state: "CIUDAD DE MEXICO",
      country: "MEX"
    },
    email: "sos@example.com",
    phone: ""
  },
  {
    legal_name: "CHUBB DIGITAL SERVICES",
    tax_id: "CDS211206J20",
    tax_system: "601",
    address: {
      street: "AVENIDA PASEO DE LA REFORMA",
      exterior: "250",
      interior: "PISO 7",
      neighborhood: "Juárez",
      zip: "06600",
      municipality: "Cuauhtémoc",
      state: "CIUDAD DE MEXICO",
      country: "MEX"
    },
    email: "chubb@example.com",
    phone: ""
  }
];

/**
 * Servicio para la configuración y setup de clientes predefinidos
 */
class CustomerSetupService {
  /**
   * Verifica si un tenant tiene clientes configurados
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<boolean>} - true si hay clientes configurados
   */
  static async hasConfiguredCustomers(tenantId) {
    if (!tenantId) return false;
    
    const count = await prisma.tenantCustomer.count({
      where: { tenantId }
    });
    
    return count > 0;
  }
  
  /**
   * Obtiene el estado de configuración de los clientes predefinidos
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Información de estado de los clientes
   */
  static async getCustomersStatus(tenantId) {
    // Obtener los clientes ya configurados para este tenant
    const configuredClients = await prisma.tenantCustomer.findMany({
      where: { tenantId },
      select: {
        legalName: true,
        facturapiCustomerId: true
      }
    });
    
    // Verificar el estado de cada cliente predefinido
    const clients = CLIENTES_PREDEFINIDOS.map(predefined => {
      const isConfigured = configuredClients.some(
        configured => configured.legalName === predefined.legal_name
      );
      
      return {
        legalName: predefined.legal_name,
        isConfigured,
        facturapiId: isConfigured ? 
          configuredClients.find(c => c.legalName === predefined.legal_name)?.facturapiCustomerId : 
          null
      };
    });
    
    return {
      configuredCount: configuredClients.length,
      totalCount: CLIENTES_PREDEFINIDOS.length,
      clients
    };
  }
  
  /**
   * Configura los clientes predefinidos para un tenant
   * @param {string} tenantId - ID del tenant
   * @param {boolean} forceAll - Si se deben configurar todos los clientes (incluso los ya configurados)
   * @returns {Promise<Array>} - Resultados de la configuración
   */
  static async setupPredefinedCustomers(tenantId, forceAll = false) {
    try {
      // Importar el servicio real de clientes
      const clientService = await import('./client.service.js');
      
      // Llamar a la implementación real de setupPredefinedClients
      return await clientService.setupPredefinedClients(tenantId, forceAll);
    } catch (error) {
      console.error('Error en CustomerSetupService.setupPredefinedCustomers:', error);
      throw error;
    }
  }
}

export default CustomerSetupService;