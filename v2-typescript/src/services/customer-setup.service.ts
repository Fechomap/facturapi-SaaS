/**
 * Customer Setup Service
 * Servicio para configuración y setup de clientes predefinidos
 */

import { prisma } from '@config/database.js';
import { createModuleLogger } from '@core/utils/logger.js';

const logger = createModuleLogger('CustomerSetupService');

interface Address {
  street: string;
  exterior: string;
  interior?: string;
  neighborhood: string;
  zip: string;
  municipality: string;
  state: string;
  country: string;
}

interface PredefinedCustomer {
  legal_name: string;
  tax_id: string;
  tax_system: string;
  address: Address;
  email: string;
  phone: string;
}

interface CustomerStatus {
  legalName: string;
  isConfigured: boolean;
  facturapiId: string | null;
}

interface CustomersStatusResult {
  configuredCount: number;
  totalCount: number;
  clients: CustomerStatus[];
}

/**
 * Datos de los clientes con RFC reales
 */
const CLIENTES_PREDEFINIDOS: PredefinedCustomer[] = [
  {
    legal_name: 'INFOASIST INFORMACION Y ASISTENCIA',
    tax_id: 'IIA951221LQA',
    tax_system: '601',
    address: {
      street: 'ADOLFO LOPEZ MATEOS',
      exterior: '261',
      interior: 'OFICINA 301',
      neighborhood: 'LOS ALPES',
      zip: '01010',
      municipality: 'ALVARO OBREGON',
      state: 'CIUDAD DE MEXICO',
      country: 'MEX',
    },
    email: 'info@example.com',
    phone: '',
  },
  {
    legal_name: 'ARSA ASESORIA INTEGRAL PROFESIONAL',
    tax_id: 'AIP900419FI1',
    tax_system: '601',
    address: {
      street: 'BOULEVARD ADOLFO LOPEZ MATEOS',
      exterior: '261',
      interior: 'PISO 8',
      neighborhood: 'LOS ALPES',
      zip: '01010',
      municipality: 'ALVARO OBREGON',
      state: 'CIUDAD DE MEXICO',
      country: 'MEX',
    },
    email: 'arsa@example.com',
    phone: '',
  },
  {
    legal_name: 'PROTECCION S.O.S. JURIDICO AUTOMOVILISTICO LAS VEINTICUATRO HORAS DEL DIA',
    tax_id: 'PSO880407SN0',
    tax_system: '601',
    address: {
      street: 'REVOLUCION',
      exterior: '1267',
      interior: 'PISO 20 CLUSTER A',
      neighborhood: 'LOS ALPES',
      zip: '01010',
      municipality: 'ALVARO OBREGON',
      state: 'CIUDAD DE MEXICO',
      country: 'MEX',
    },
    email: 'sos@example.com',
    phone: '',
  },
  {
    legal_name: 'CHUBB DIGITAL SERVICES',
    tax_id: 'CDS211206J20',
    tax_system: '601',
    address: {
      street: 'AVENIDA PASEO DE LA REFORMA',
      exterior: '250',
      interior: 'PISO 7',
      neighborhood: 'Juárez',
      zip: '06600',
      municipality: 'Cuauhtémoc',
      state: 'CIUDAD DE MEXICO',
      country: 'MEX',
    },
    email: 'chubb@example.com',
    phone: '',
  },
  {
    legal_name: 'AXA ASSISTANCE MEXICO',
    tax_id: 'AAM850528H51',
    tax_system: '601',
    address: {
      street: 'Félix Cuevas',
      exterior: '366',
      interior: 'PISO 6',
      neighborhood: 'Tlacoquemécatl',
      zip: '03200',
      municipality: 'Benito Juárez',
      state: 'Ciudad de México',
      country: 'MEX',
    },
    email: 'axa@example.com',
    phone: '',
  },
  {
    legal_name: 'ESCOTEL ESPECIALISTAS EN CONTACTO TELEFONICO',
    tax_id: 'EEC081222FH8',
    tax_system: '601',
    address: {
      street: 'JOSE MARIA VELASCO',
      exterior: '13',
      interior: 'OFICINA 301',
      neighborhood: 'SAN JOSE INSURGENTES',
      zip: '03900',
      municipality: 'BENITO JUAREZ',
      state: 'CIUDAD DE MEXICO',
      country: 'MEX',
    },
    email: 'escotel@example.com',
    phone: '',
  },
];

/**
 * Servicio para la configuración y setup de clientes predefinidos
 */
class CustomerSetupService {
  /**
   * Verifica si un tenant tiene clientes configurados
   * @param tenantId - ID del tenant
   * @returns true si hay clientes configurados
   */
  async hasConfiguredCustomers(tenantId: string): Promise<boolean> {
    if (!tenantId) {
      logger.warn('hasConfiguredCustomers llamado sin tenantId');
      return false;
    }

    try {
      const count = await prisma.tenantCustomer.count({
        where: { tenantId },
      });

      logger.debug({ tenantId, count }, 'Clientes configurados consultados');
      return count > 0;
    } catch (error) {
      logger.error({ error, tenantId }, 'Error verificando clientes configurados');
      return false;
    }
  }

  /**
   * Obtiene el estado de configuración de los clientes predefinidos
   * @param tenantId - ID del tenant
   * @returns Información de estado de los clientes
   */
  async getCustomersStatus(tenantId: string): Promise<CustomersStatusResult> {
    try {
      // Obtener los clientes ya configurados para este tenant
      const configuredClients = await prisma.tenantCustomer.findMany({
        where: { tenantId },
        select: {
          legalName: true,
          facturapiCustomerId: true,
        },
      });

      // Verificar el estado de cada cliente predefinido
      const clients: CustomerStatus[] = CLIENTES_PREDEFINIDOS.map((predefined) => {
        const isConfigured = configuredClients.some(
          (configured) => configured.legalName === predefined.legal_name
        );

        return {
          legalName: predefined.legal_name,
          isConfigured,
          facturapiId: isConfigured
            ? configuredClients.find((c) => c.legalName === predefined.legal_name)
                ?.facturapiCustomerId || null
            : null,
        };
      });

      logger.debug(
        {
          tenantId,
          configuredCount: configuredClients.length,
          totalCount: CLIENTES_PREDEFINIDOS.length,
        },
        'Estado de clientes obtenido'
      );

      return {
        configuredCount: configuredClients.length,
        totalCount: CLIENTES_PREDEFINIDOS.length,
        clients,
      };
    } catch (error) {
      logger.error({ error, tenantId }, 'Error obteniendo estado de clientes');
      throw error;
    }
  }

  /**
   * Configura los clientes predefinidos para un tenant
   * @param tenantId - ID del tenant
   * @param forceAll - Si se deben configurar todos los clientes (incluso los ya configurados)
   * @returns Resultados de la configuración
   */
  async setupPredefinedCustomers(tenantId: string, forceAll: boolean = false): Promise<any[]> {
    try {
      logger.info({ tenantId, forceAll }, 'Configurando clientes predefinidos');

      // Importar la función específica del servicio de clientes
      const { setupPredefinedClients } = await import('./client.service.js');

      // Llamar a la implementación real de setupPredefinedClients
      const results = await setupPredefinedClients(tenantId, forceAll);

      logger.info(
        {
          tenantId,
          resultsCount: results.length,
          successful: results.filter((r: any) => r.success).length,
        },
        'Clientes predefinidos configurados'
      );

      return results;
    } catch (error) {
      logger.error({ error, tenantId }, 'Error en setupPredefinedCustomers');
      throw error;
    }
  }

  /**
   * Obtiene la lista de clientes predefinidos
   * @returns Lista de clientes predefinidos
   */
  getPredefinedCustomers(): PredefinedCustomer[] {
    return [...CLIENTES_PREDEFINIDOS];
  }

  /**
   * Busca un cliente predefinido por RFC
   * @param taxId - RFC del cliente
   * @returns Cliente predefinido o undefined
   */
  findPredefinedByTaxId(taxId: string): PredefinedCustomer | undefined {
    return CLIENTES_PREDEFINIDOS.find((client) => client.tax_id === taxId);
  }

  /**
   * Busca un cliente predefinido por nombre
   * @param legalName - Nombre del cliente (búsqueda parcial)
   * @returns Cliente predefinido o undefined
   */
  findPredefinedByName(legalName: string): PredefinedCustomer | undefined {
    const searchTerm = legalName.toUpperCase();
    return CLIENTES_PREDEFINIDOS.find((client) =>
      client.legal_name.toUpperCase().includes(searchTerm)
    );
  }
}

export default new CustomerSetupService();
export {
  CLIENTES_PREDEFINIDOS,
  type PredefinedCustomer,
  type CustomerStatus,
  type CustomersStatusResult,
};
