import prisma from '../lib/prisma.js';
import factuAPIService from './facturapi.service.js';

// Datos de los clientes predefinidos
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
  },
  {
    legal_name: "AXA ASSISTANCE MEXICO",
    tax_id: "AAM850528H51",
    tax_system: "601",
    address: {
      street: "Félix Cuevas",
      exterior: "366",
      interior: "PISO 6",
      neighborhood: "Tlacoquemécatl",
      zip: "03200",
      municipality: "Benito Juárez",
      state: "Ciudad de México",
      country: "MEX"
    },
    email: "axa@example.com",
    phone: ""
  }
];

/**
 * Registra clientes predefinidos para un tenant
 * @param {string} tenantId - ID del tenant
 * @param {boolean} forceAll - Forzar creación de todos los clientes
 * @returns {Promise<Array>} - Resultados de las operaciones
 */
async function setupPredefinedClients(tenantId, forceAll = false) {
  try {
    console.log(`Iniciando configuración de clientes predefinidos para tenant ${tenantId}`);

    // Obtener el tenant con toda su información
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId }
    });

    if (!tenant) {
      throw new Error(`No se encontró el tenant con ID ${tenantId}`);
    }

    if (!tenant.facturapiApiKey) {
      throw new Error(`El tenant ${tenant.businessName} no tiene una API key configurada`);
    }

    if (!tenant.facturapiOrganizationId) {
      throw new Error(`El tenant ${tenant.businessName} no tiene una organización de FacturAPI configurada`);
    }

    const existingClients = await prisma.tenantCustomer.findMany({
      where: { tenantId },
      select: {
        legalName: true,
        facturapiCustomerId: true
      }
    });

    const existingClientsMap = {};
    existingClients.forEach(customer => {
      existingClientsMap[customer.legalName] = customer.facturapiCustomerId;
    });

    const clientsToCreate = CLIENTES_PREDEFINIDOS.filter(cliente =>
      forceAll || !existingClientsMap[cliente.legal_name]
    );

    const results = [
      ...existingClients.map(customer => ({
        legalName: customer.legalName,
        success: true,
        id: customer.facturapiCustomerId,
        message: 'Cliente ya existente'
      }))
    ];

    const facturapi = await factuAPIService.getFacturapiClient(tenantId);

    for (const clientData of clientsToCreate) {
      try {
        console.log(`Procesando cliente ${clientData.legal_name}...`);

        const existingCustomer = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId,
            legalName: clientData.legal_name
          }
        });

        if (existingCustomer) {
          if (!results.some(r => r.legalName === clientData.legal_name)) {
            results.push({
              legalName: clientData.legal_name,
              success: true,
              id: existingCustomer.facturapiCustomerId,
              message: 'Cliente ya existente en la base de datos'
            });
          }
          continue;
        }

        const nuevoCliente = await facturapi.customers.create(clientData);

        await prisma.tenantCustomer.create({
          data: {
            tenantId,
            facturapiCustomerId: nuevoCliente.id,
            legalName: nuevoCliente.legal_name,
            rfc: nuevoCliente.tax_id,
            email: nuevoCliente.email || null,
            phone: nuevoCliente.phone || null,
            address: nuevoCliente.address ? JSON.stringify(nuevoCliente.address) : null,
            isActive: true
          }
        });

        results.push({
          legalName: clientData.legal_name,
          success: true,
          id: nuevoCliente.id
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`Error al crear cliente ${clientData.legal_name}:`, error.message);

        if (error.response && error.response.status === 400 && error.response.data?.path === 'tax_id') {
          try {
            const clienteModificado = { ...clientData, tax_id: 'AAA010101AAA' };
            const nuevoCliente = await facturapi.customers.create(clienteModificado);

            await prisma.tenantCustomer.create({
              data: {
                tenantId,
                facturapiCustomerId: nuevoCliente.id,
                legalName: nuevoCliente.legal_name,
                rfc: nuevoCliente.tax_id,
                email: nuevoCliente.email || null,
                phone: nuevoCliente.phone || null,
                address: nuevoCliente.address ? JSON.stringify(nuevoCliente.address) : null,
                isActive: true
              }
            });

            results.push({
              legalName: clientData.legal_name,
              success: true,
              id: nuevoCliente.id,
              message: 'Creado con RFC genérico AAA010101AAA'
            });

          } catch (retryError) {
            console.error(`Error al reintentar con RFC genérico para ${clientData.legal_name}:`, retryError.message);

            results.push({
              legalName: clientData.legal_name,
              success: false,
              error: retryError.response?.data?.message || retryError.message
            });
          }
        } else {
          results.push({
            legalName: clientData.legal_name,
            success: false,
            error: error.response?.data?.message || error.message
          });
        }
      }
    }

    return results;

  } catch (error) {
    console.error('Error en setupPredefinedClients:', error);
    throw error;
  }
}

/**
 * Verifica si un tenant tiene clientes configurados
 * @param {string} tenantId - ID del tenant
 * @returns {Promise<boolean>} - true si tiene clientes configurados
 */
async function hasConfiguredClients(tenantId) {
const customersCount = await prisma.tenantCustomer.count({
    where: { tenantId }
});

return customersCount > 0;
}

/**
 * Verifica el estado de configuración de los clientes predefinidos
 * @param {string} tenantId - ID del tenant
 * @returns {Promise<Object>} - Estado de los clientes
 */
async function getClientsStatus(tenantId) {
// Obtener los clientes que ya existen para este tenant
const existingClients = await prisma.tenantCustomer.findMany({
    where: { tenantId },
    select: {
    legalName: true,
    facturapiCustomerId: true
    }
});

// Crear un mapa para búsqueda rápida
const existingClientsMap = {};
existingClients.forEach(customer => {
    existingClientsMap[customer.legalName] = customer.facturapiCustomerId;
});

// Verificar el estado de cada cliente predefinido
const clientsStatus = CLIENTES_PREDEFINIDOS.map(cliente => ({
    legalName: cliente.legal_name,
    isConfigured: !!existingClientsMap[cliente.legal_name],
    facturapiId: existingClientsMap[cliente.legal_name] || null
}));

return {
    configuredCount: existingClients.length,
    totalCount: CLIENTES_PREDEFINIDOS.length,
    clients: clientsStatus
};
}

/**
 * Crea un nuevo cliente para un tenant
 * @param {string} tenantId - ID del tenant
 * @param {Object} clientData - Datos del cliente
 * @returns {Promise<Object>} - Cliente creado
 */
async function createClient(tenantId, clientData) {
try {
    const facturapi = await factuAPIService.getFacturapiClient(tenantId);
    
    // Crear cliente en FacturAPI
    const customer = await facturapi.customers.create(clientData);
    
    // Guardar el cliente en la base de datos
    const savedCustomer = await prisma.tenantCustomer.create({
    data: {
        tenantId,
        facturapiCustomerId: customer.id,
        legalName: customer.legal_name,
        rfc: customer.tax_id,
        email: customer.email || null,
        phone: customer.phone || null,
        address: customer.address ? JSON.stringify(customer.address) : null,
        isActive: true
    }
    });
    
    return { ...customer, dbId: savedCustomer.id };
} catch (error) {
    console.error(`Error al crear cliente para tenant ${tenantId}:`, error);
    throw error;
}
}

/**
 * Obtiene un cliente por su ID de FacturAPI
 * @param {string} tenantId - ID del tenant
 * @param {string} clientId - ID del cliente en FacturAPI
 * @returns {Promise<Object>} - Cliente encontrado
 */
async function getClientById(tenantId, clientId) {
// Primero buscar en la base de datos local
const localClient = await prisma.tenantCustomer.findFirst({
    where: {
    tenantId,
    facturapiCustomerId: clientId
    }
});

if (localClient) {
    return localClient;
}

// Si no existe localmente, obtener de FacturAPI
const facturapi = await factuAPIService.getFacturapiClient(tenantId);
const client = await facturapi.customers.retrieve(clientId);

// Guardar en la base de datos local
const savedClient = await prisma.tenantCustomer.create({
    data: {
    tenantId,
    facturapiCustomerId: client.id,
    legalName: client.legal_name,
    rfc: client.tax_id,
    email: client.email || null,
    phone: client.phone || null,
    address: client.address ? JSON.stringify(client.address) : null,
    isActive: true
    }
});

return { ...client, dbId: savedClient.id };
}

/**
 * Actualiza un cliente existente
 * @param {string} tenantId - ID del tenant
 * @param {string} clientId - ID del cliente en FacturAPI
 * @param {Object} updateData - Datos a actualizar
 * @returns {Promise<Object>} - Cliente actualizado
 */
async function updateClient(tenantId, clientId, updateData) {
try {
    const facturapi = await factuAPIService.getFacturapiClient(tenantId);
    
    // Actualizar cliente en FacturAPI
    const updatedClient = await facturapi.customers.update(clientId, updateData);
    
    // Actualizar en la base de datos local
    await prisma.tenantCustomer.updateMany({
    where: {
        tenantId,
        facturapiCustomerId: clientId
    },
    data: {
        legalName: updatedClient.legal_name,
        rfc: updatedClient.tax_id,
        email: updatedClient.email || null,
        phone: updatedClient.phone || null,
        address: updatedClient.address ? JSON.stringify(updatedClient.address) : null,
        updatedAt: new Date()
    }
    });
    
    return updatedClient;
} catch (error) {
    console.error(`Error al actualizar cliente ${clientId} para tenant ${tenantId}:`, error);
    throw error;
}
}

/**
 * Obtiene todos los clientes de un tenant
 * @param {string} tenantId - ID del tenant
 * @returns {Promise<Array>} - Lista de clientes
 */
async function getAllClients(tenantId) {
try {
    // Obtener clientes de la base de datos local
    const localClients = await prisma.tenantCustomer.findMany({
    where: {
        tenantId,
        isActive: true
    }
    });
    
    return localClients;
} catch (error) {
    console.error(`Error al obtener clientes para tenant ${tenantId}:`, error);
    throw error;
}
}

// Añadir esta función al final de client.service.js
async function verifyClientSetup(tenantId) {
  try {
    // Consultar base de datos local
    const localClients = await prisma.tenantCustomer.findMany({
      where: { tenantId }
    });
    
    console.log(`Verificación: ${localClients.length} clientes encontrados en la base de datos`);
    
    // Si hay clientes locales, intentar verificar uno en FacturAPI
    if (localClients.length > 0) {
      const facturapi = await factuAPIService.getFacturapiClient(tenantId);
      try {
        // Intentar obtener el primer cliente de FacturAPI
        const facturapiClient = await facturapi.customers.retrieve(localClients[0].facturapiCustomerId);
        console.log(`✅ Verificación exitosa: Cliente ${facturapiClient.legal_name} existe en FacturAPI`);
        return { success: true, verified: true };
      } catch (error) {
        console.error(`Error al verificar cliente en FacturAPI: ${error.message}`);
        return { success: false, error: 'Los clientes existen en la base de datos local pero no en FacturAPI' };
      }
    }
    
    return { success: true, verified: false, message: 'No hay clientes configurados' };
  } catch (error) {
    console.error(`Error en verificación de clientes: ${error.message}`);
    return { success: false, error: error.message };
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
verifyClientSetup
};