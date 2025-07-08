// scripts/test-axa-client.js
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Configurar dotenv
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

import prisma from '../lib/prisma.js';
import factuAPIService from '../services/facturapi.service.js';

const CLIENTE_AXA_DATA = {
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
};

async function testAxaClient() {
  try {
    console.log('🔍 Buscando tenant de prueba...');
    
    // Buscar un tenant activo
    const tenant = await prisma.tenant.findFirst({
      where: {
        isActive: true,
        facturapiApiKey: { not: null },
        facturapiOrganizationId: { not: null }
      }
    });
    
    if (!tenant) {
      console.error('❌ No se encontró un tenant activo con configuración de FacturAPI');
      return;
    }
    
    console.log(`✅ Tenant encontrado: ${tenant.businessName} (${tenant.id})`);
    
    // Verificar si AXA ya existe
    const existingAxa = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId: tenant.id,
        legalName: {
          contains: 'AXA'
        }
      }
    });
    
    if (existingAxa) {
      console.log(`✅ Cliente AXA ya existe: ${existingAxa.legalName} (${existingAxa.facturapiCustomerId})`);
      
      // Actualizar .env con el ID correcto
      console.log(`💡 ID de AXA para el .env: CLIENTE_AXA=${existingAxa.facturapiCustomerId}`);
      return;
    }
    
    console.log('📝 Cliente AXA no existe, creando...');
    
    // Obtener cliente de FacturAPI
    const facturapi = await factuAPIService.getFacturapiClient(tenant.id);
    
    // Crear cliente en FacturAPI
    console.log('⏳ Creando cliente AXA en FacturAPI...');
    const nuevoCliente = await facturapi.customers.create(CLIENTE_AXA_DATA);
    console.log(`✅ Cliente creado en FacturAPI: ${nuevoCliente.id}`);
    
    // Guardar en base de datos local
    console.log('⏳ Guardando cliente AXA en base de datos local...');
    await prisma.tenantCustomer.create({
      data: {
        tenantId: tenant.id,
        facturapiCustomerId: nuevoCliente.id,
        legalName: nuevoCliente.legal_name,
        rfc: nuevoCliente.tax_id,
        email: nuevoCliente.email || null,
        phone: nuevoCliente.phone || null,
        address: nuevoCliente.address ? JSON.stringify(nuevoCliente.address) : null,
        isActive: true
      }
    });
    
    console.log(`✅ Cliente AXA guardado en base de datos local`);
    console.log(`💡 ID de AXA para el .env: CLIENTE_AXA=${nuevoCliente.id}`);
    console.log(`📋 Datos del cliente:`, {
      id: nuevoCliente.id,
      legal_name: nuevoCliente.legal_name,
      tax_id: nuevoCliente.tax_id
    });
    
  } catch (error) {
    console.error('❌ Error al probar cliente AXA:', error);
    
    if (error.response?.data) {
      console.error('📄 Detalles del error:', JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar el test
testAxaClient();