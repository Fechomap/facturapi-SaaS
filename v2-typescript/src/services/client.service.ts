/**
 * Client Service
 * Service for managing predefined and custom clients
 */

import { prisma } from '@config/database.js';
import { createModuleLogger } from '@core/utils/logger.js';
import FacturapiService from './facturapi.service.js';

const logger = createModuleLogger('ClientService');

interface Address {
  street: string;
  exterior: string;
  interior: string;
  neighborhood: string;
  zip: string;
  municipality: string;
  state: string;
  country: string;
}

interface PredefinedClient {
  legal_name: string;
  tax_id: string;
  tax_system: string;
  address: Address;
  email: string;
  phone: string;
}

interface ClientResult {
  legalName: string;
  success: boolean;
  id?: string;
  message?: string;
  error?: string;
}

interface ClientStatus {
  legalName: string;
  isConfigured: boolean;
  facturapiId: string | null;
}

interface ClientsStatusResult {
  configuredCount: number;
  totalCount: number;
  clients: ClientStatus[];
}

interface VerificationResult {
  success: boolean;
  verified?: boolean;
  message?: string;
  error?: string;
}

// Predefined clients data
const CLIENTES_PREDEFINIDOS: PredefinedClient[] = [
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
    legal_name: 'CLUB DE ASISTENCIA',
    tax_id: 'CAS981016P46',
    tax_system: '601',
    address: {
      street: 'Montes Urales',
      exterior: '632',
      interior: 'PISO 5',
      neighborhood: 'Lomas de Chapultepec',
      zip: '11000',
      municipality: 'Miguel Hidalgo',
      state: 'Ciudad de México',
      country: 'MEX',
    },
    email: 'club@example.com',
    phone: '',
  },
  {
    legal_name: 'QUALITAS COMPAÑIA DE SEGUROS',
    tax_id: 'QCS931209G49',
    tax_system: '601',
    address: {
      street: 'San José de los Cedros',
      exterior: 'SN',
      interior: '',
      neighborhood: 'San José de los Cedros',
      zip: '05200',
      municipality: 'Cuajimalpa de Morelos',
      state: 'Ciudad de México',
      country: 'MEX',
    },
    email: 'qualitas@example.com',
    phone: '',
  },
];

/**
 * Setup predefined clients for a tenant
 */
async function setupPredefinedClients(tenantId: string, forceAll = false): Promise<ClientResult[]> {
  try {
    logger.info({ tenantId, forceAll }, 'Starting predefined clients setup');

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new Error(`Tenant not found with ID ${tenantId}`);
    }

    if (!tenant.facturapiApiKey) {
      throw new Error(`Tenant ${tenant.businessName} does not have API key configured`);
    }

    if (!tenant.facturapiOrganizationId) {
      throw new Error(
        `Tenant ${tenant.businessName} does not have FacturAPI organization configured`
      );
    }

    const existingClients = await prisma.tenantCustomer.findMany({
      where: { tenantId },
      select: {
        legalName: true,
        facturapiCustomerId: true,
      },
    });

    const existingClientsMap: Record<string, string> = {};
    existingClients.forEach((customer) => {
      existingClientsMap[customer.legalName] = customer.facturapiCustomerId;
    });

    const clientsToCreate = CLIENTES_PREDEFINIDOS.filter(
      (cliente) => forceAll || !existingClientsMap[cliente.legal_name]
    );

    const results: ClientResult[] = [
      ...existingClients.map((customer) => ({
        legalName: customer.legalName,
        success: true,
        id: customer.facturapiCustomerId,
        message: 'Cliente ya existente',
      })),
    ];

    const facturapi = await FacturapiService.getFacturapiClient(tenantId);

    for (const clientData of clientsToCreate) {
      try {
        logger.debug({ legalName: clientData.legal_name }, 'Processing client');

        const existingCustomer = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId,
            legalName: clientData.legal_name,
          },
        });

        if (existingCustomer && !forceAll) {
          if (!results.some((r) => r.legalName === clientData.legal_name)) {
            results.push({
              legalName: clientData.legal_name,
              success: true,
              id: existingCustomer.facturapiCustomerId,
              message: 'Cliente ya existente en la base de datos',
            });
          }
          continue;
        }

        // If forceAll = true AND client exists, recreate in FacturAPI
        if (existingCustomer && forceAll) {
          logger.info(
            { legalName: clientData.legal_name },
            'Recreating client in FacturAPI (forceAll=true)'
          );

          try {
            if (existingCustomer.facturapiCustomerId) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (facturapi.customers as any).del(existingCustomer.facturapiCustomerId);
              logger.debug(
                { facturapiCustomerId: existingCustomer.facturapiCustomerId },
                'Client deleted from FacturAPI'
              );
            }
          } catch (deleteError) {
            logger.warn({ deleteError }, 'Client did not exist in FacturAPI or error deleting');
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nuevoCliente = await (facturapi.customers as any).create(clientData);

        if (existingCustomer && forceAll) {
          await prisma.tenantCustomer.update({
            where: { id: existingCustomer.id },
            data: {
              facturapiCustomerId: nuevoCliente.id,
              legalName: nuevoCliente.legal_name,
              rfc: nuevoCliente.tax_id,
              email: nuevoCliente.email || null,
              phone: nuevoCliente.phone || null,
              address: nuevoCliente.address ? JSON.stringify(nuevoCliente.address) : null,
              isActive: true,
            },
          });
          logger.info(
            { legalName: nuevoCliente.legal_name, id: nuevoCliente.id },
            'Client updated'
          );
        } else {
          await prisma.tenantCustomer.create({
            data: {
              tenantId,
              facturapiCustomerId: nuevoCliente.id,
              legalName: nuevoCliente.legal_name,
              rfc: nuevoCliente.tax_id,
              email: nuevoCliente.email || null,
              phone: nuevoCliente.phone || null,
              address: nuevoCliente.address ? JSON.stringify(nuevoCliente.address) : null,
              isActive: true,
            },
          });
        }

        results.push({
          legalName: clientData.legal_name,
          success: true,
          id: nuevoCliente.id,
          message:
            existingCustomer && forceAll ? 'Cliente recreado en FacturAPI' : 'Cliente creado',
        });

        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        logger.error({ legalName: clientData.legal_name, error }, 'Error creating client');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err = error as any;
        if (err.response && err.response.status === 400 && err.response.data?.path === 'tax_id') {
          try {
            const clienteModificado = { ...clientData, tax_id: 'AAA010101AAA' };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nuevoCliente = await (facturapi.customers as any).create(clienteModificado);

            await prisma.tenantCustomer.create({
              data: {
                tenantId,
                facturapiCustomerId: nuevoCliente.id,
                legalName: nuevoCliente.legal_name,
                rfc: nuevoCliente.tax_id,
                email: nuevoCliente.email || null,
                phone: nuevoCliente.phone || null,
                address: nuevoCliente.address ? JSON.stringify(nuevoCliente.address) : null,
                isActive: true,
              },
            });

            results.push({
              legalName: clientData.legal_name,
              success: true,
              id: nuevoCliente.id,
              message: 'Creado con RFC genérico AAA010101AAA',
            });
          } catch (retryError) {
            logger.error(
              { legalName: clientData.legal_name, retryError },
              'Error retrying with generic RFC'
            );

            results.push({
              legalName: clientData.legal_name,
              success: false,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              error: (retryError as any).response?.data?.message || (retryError as Error).message,
            });
          }
        } else {
          results.push({
            legalName: clientData.legal_name,
            success: false,
            error: err.response?.data?.message || err.message,
          });
        }
      }
    }

    // Clear FacturAPI client cache after changes
    if (forceAll) {
      FacturapiService.clearClientCache(tenantId);
      logger.debug({ tenantId }, 'FacturAPI cache cleared');
    }

    return results;
  } catch (error) {
    logger.error({ tenantId, error }, 'Error in setupPredefinedClients');
    throw error;
  }
}

/**
 * Check if tenant has configured clients
 */
async function hasConfiguredClients(tenantId: string): Promise<boolean> {
  const customersCount = await prisma.tenantCustomer.count({
    where: { tenantId },
  });

  return customersCount > 0;
}

/**
 * Get status of predefined clients configuration
 */
async function getClientsStatus(tenantId: string): Promise<ClientsStatusResult> {
  const existingClients = await prisma.tenantCustomer.findMany({
    where: { tenantId },
    select: {
      legalName: true,
      facturapiCustomerId: true,
    },
  });

  const existingClientsMap: Record<string, string> = {};
  existingClients.forEach((customer) => {
    existingClientsMap[customer.legalName] = customer.facturapiCustomerId;
  });

  const clientsStatus: ClientStatus[] = CLIENTES_PREDEFINIDOS.map((cliente) => ({
    legalName: cliente.legal_name,
    isConfigured: !!existingClientsMap[cliente.legal_name],
    facturapiId: existingClientsMap[cliente.legal_name] || null,
  }));

  return {
    configuredCount: existingClients.length,
    totalCount: CLIENTES_PREDEFINIDOS.length,
    clients: clientsStatus,
  };
}

/**
 * Create new client for tenant
 */
async function createClient(tenantId: string, clientData: Record<string, unknown>) {
  try {
    const facturapi = await FacturapiService.getFacturapiClient(tenantId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customer = await (facturapi.customers as any).create(clientData);

    const savedCustomer = await prisma.tenantCustomer.create({
      data: {
        tenantId,
        facturapiCustomerId: customer.id,
        legalName: customer.legal_name,
        rfc: customer.tax_id,
        email: customer.email || null,
        phone: customer.phone || null,
        address: customer.address ? JSON.stringify(customer.address) : null,
        isActive: true,
      },
    });

    return { ...customer, dbId: savedCustomer.id };
  } catch (error) {
    logger.error({ tenantId, error }, 'Error creating client');
    throw error;
  }
}

/**
 * Get client by FacturAPI ID
 */
async function getClientById(tenantId: string, clientId: string) {
  const localClient = await prisma.tenantCustomer.findFirst({
    where: {
      tenantId,
      facturapiCustomerId: clientId,
    },
  });

  if (localClient) {
    return localClient;
  }

  const facturapi = await FacturapiService.getFacturapiClient(tenantId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = await (facturapi.customers as any).retrieve(clientId);

  const savedClient = await prisma.tenantCustomer.create({
    data: {
      tenantId,
      facturapiCustomerId: client.id,
      legalName: client.legal_name,
      rfc: client.tax_id,
      email: client.email || null,
      phone: client.phone || null,
      address: client.address ? JSON.stringify(client.address) : null,
      isActive: true,
    },
  });

  return { ...client, dbId: savedClient.id };
}

/**
 * Update existing client
 */
async function updateClient(
  tenantId: string,
  clientId: string,
  updateData: Record<string, unknown>
) {
  try {
    const facturapi = await FacturapiService.getFacturapiClient(tenantId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatedClient = await (facturapi.customers as any).update(clientId, updateData);

    await prisma.tenantCustomer.updateMany({
      where: {
        tenantId,
        facturapiCustomerId: clientId,
      },
      data: {
        legalName: updatedClient.legal_name,
        rfc: updatedClient.tax_id,
        email: updatedClient.email || null,
        phone: updatedClient.phone || null,
        address: updatedClient.address ? JSON.stringify(updatedClient.address) : null,
        updatedAt: new Date(),
      },
    });

    return updatedClient;
  } catch (error) {
    logger.error({ tenantId, clientId, error }, 'Error updating client');
    throw error;
  }
}

/**
 * Get all clients for tenant
 */
async function getAllClients(tenantId: string) {
  try {
    const localClients = await prisma.tenantCustomer.findMany({
      where: {
        tenantId,
        isActive: true,
      },
    });

    return localClients;
  } catch (error) {
    logger.error({ tenantId, error }, 'Error getting all clients');
    throw error;
  }
}

/**
 * Verify client setup
 */
async function verifyClientSetup(tenantId: string): Promise<VerificationResult> {
  try {
    const localClients = await prisma.tenantCustomer.findMany({
      where: { tenantId },
    });

    logger.info({ count: localClients.length }, 'Clients found in database');

    if (localClients.length > 0) {
      const facturapi = await FacturapiService.getFacturapiClient(tenantId);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const facturapiClient = await (facturapi.customers as any).retrieve(
          localClients[0].facturapiCustomerId
        );
        logger.info({ legalName: facturapiClient.legal_name }, 'Verification successful');
        return { success: true, verified: true };
      } catch (error) {
        logger.error({ error }, 'Error verifying client in FacturAPI');
        return {
          success: false,
          error: 'Clients exist in local database but not in FacturAPI',
        };
      }
    }

    return { success: true, verified: false, message: 'No clients configured' };
  } catch (error) {
    logger.error({ error }, 'Error in client verification');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export {
  setupPredefinedClients,
  hasConfiguredClients,
  getClientsStatus,
  createClient,
  getClientById,
  updateClient,
  getAllClients,
  verifyClientSetup,
};
