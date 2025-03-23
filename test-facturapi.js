// test-facturapi.js
import { config, initConfig } from './config/index.js';
import { connectDatabase, prisma } from './config/database.js';
import facturapIService from './services/facturapi.service.js';

async function testFacturapi() {
  console.log('Iniciando prueba de conexión con FacturAPI...');
  
  try {
    // Inicializar configuración
    await initConfig();
    
    // Conectar a la base de datos
    await connectDatabase();
    
    // Obtener un tenant válido
    const tenant = await prisma.tenant.findFirst({
      where: { isActive: true }
    });
    
    if (!tenant) {
      throw new Error('No se encontró ningún tenant activo en la base de datos');
    }
    
    console.log(`Usando tenant: ${tenant.businessName} (ID: ${tenant.id})`);
    
    // Verificar que el tenant tiene API key de FacturAPI
    if (!tenant.facturapiApiKey) {
      throw new Error(`El tenant ${tenant.businessName} no tiene una API key de FacturAPI configurada`);
    }
    
    // Obtener cliente de FacturAPI
    console.log('Obteniendo cliente de FacturAPI...');
    const facturapi = await facturapIService.getFacturapiClient(tenant.id);
    
    // Probar conexión obteniendo la legal de la organización
    console.log('Probando conexión con FacturAPI (obteniendo información de la organización)...');
    try {
      const orgInfo = await facturapi.organizations.get();
      console.log('✅ Conexión exitosa con FacturAPI. Información de la organización:', orgInfo);
    } catch (error) {
      console.error('❌ Error al obtener información de la organización:', error.message);
      
      // Intentar otra operación simple como listar clientes
      console.log('Intentando listar clientes...');
      const clientes = await facturapi.customers.list();
      console.log(`✅ Conexión exitosa con FacturAPI. Se encontraron ${clientes.total_items} clientes.`);
    }
    
    // Buscar cliente CHUBB
    console.log('Buscando cliente CHUBB para el tenant...');
    const chubbClient = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId: tenant.id,
        legalName: { contains: 'CHUBB' }
      }
    });
    
    if (!chubbClient) {
      console.log('⚠️ No se encontró cliente CHUBB para este tenant. Buscando otro cliente...');
      
      // Intentar encontrar cualquier cliente
      const anyClient = await prisma.tenantCustomer.findFirst({
        where: { tenantId: tenant.id }
      });
      
      if (!anyClient) {
        console.log('⚠️ No se encontraron clientes para este tenant.');
      } else {
        console.log(`✅ Cliente encontrado: ${anyClient.legalName} (ID: ${anyClient.facturapiCustomerId})`);
        
        // Verificar que el cliente existe en FacturAPI
        try {
          const clienteFacturapi = await facturapi.customers.retrieve(anyClient.facturapiCustomerId);
          console.log(`✅ Cliente verificado en FacturAPI: ${clienteFacturapi.legal_name} (ID: ${clienteFacturapi.id})`);
        } catch (error) {
          console.error(`❌ Error al verificar cliente en FacturAPI: ${error.message}`);
        }
      }
    } else {
      console.log(`✅ Cliente CHUBB encontrado: ${chubbClient.legalName} (ID: ${chubbClient.facturapiCustomerId})`);
      
      // Verificar que el cliente existe en FacturAPI
      try {
        const clienteFacturapi = await facturapi.customers.retrieve(chubbClient.facturapiCustomerId);
        console.log(`✅ Cliente verificado en FacturAPI: ${clienteFacturapi.legal_name} (ID: ${clienteFacturapi.id})`);
      } catch (error) {
        console.error(`❌ Error al verificar cliente en FacturAPI: ${error.message}`);
      }
    }
    
    // Prueba simple de crear factura
    console.log('Probando crear una factura simple...');
    
    // Primero verificar si tenemos un cliente válido
    let clienteId;
    if (chubbClient) {
      clienteId = chubbClient.facturapiCustomerId;
    } else {
      // Buscar cualquier cliente
      const anyClient = await prisma.tenantCustomer.findFirst({
        where: { tenantId: tenant.id }
      });
      
      if (!anyClient) {
        throw new Error('No se encontró ningún cliente para este tenant');
      }
      
      clienteId = anyClient.facturapiCustomerId;
    }
    
    // Obtener un folio
    const TenantService = await import('./services/tenant.service.js').then(m => m.default);
    const folio = await TenantService.getNextFolio(tenant.id, 'A');
    
    console.log(`Folio a utilizar: ${folio}`);
    
    // Crear una factura simple de prueba
    const facturaData = {
      customer: clienteId,
      items: [
        {
          quantity: 1,
          product: {
            description: "Servicio de prueba para verificar FacturAPI",
            product_key: "78101803",
            unit_key: "E48",
            unit_name: "SERVICIO",
            price: 100, // precio bajo para prueba
            tax_included: false,
            taxes: [
              { type: "IVA", rate: 0.16, factor: "Tasa" }
            ]
          }
        }
      ],
      use: "G03",
      payment_form: "99",
      payment_method: "PPD",
      currency: "MXN",
      exchange: 1,
      folio_number: folio
    };
    
    try {
      const factura = await facturapi.invoices.create(facturaData);
      console.log('✅ Factura creada exitosamente en FacturAPI:', factura);
      
      // Registrar la factura en la base de datos
      const registeredInvoice = await TenantService.registerInvoice(
        tenant.id,
        factura.id,
        factura.series || 'A',
        factura.folio_number,
        null,
        factura.total,
        null
      );
      
      console.log('✅ Factura registrada en la base de datos:', registeredInvoice);
      
      // Verificar si la factura se guardó correctamente
      const savedInvoice = await prisma.tenantInvoice.findFirst({
        where: {
          tenantId: tenant.id,
          facturapiInvoiceId: factura.id
        }
      });
      
      if (savedInvoice) {
        console.log('✅ Factura encontrada en la base de datos.');
      } else {
        console.error('❌ No se encontró la factura en la base de datos.');
      }
      
      // Probar descargar PDF
      console.log('Descargando PDF de la factura...');
      const pdfBuffer = await facturapi.invoices.downloadPdf(factura.id);
      console.log(`✅ PDF descargado correctamente (${pdfBuffer.length} bytes).`);
      
      // Probar descargar XML
      console.log('Descargando XML de la factura...');
      const xmlBuffer = await facturapi.invoices.downloadXml(factura.id);
      console.log(`✅ XML descargado correctamente (${xmlBuffer.length} bytes).`);
      
    } catch (facturaError) {
      console.error('❌ Error al crear factura de prueba:', facturaError);
      
      if (facturaError.response && facturaError.response.data) {
        console.error('Detalles del error:', facturaError.response.data);
      }
    }
    
  } catch (error) {
    console.error('Error en la prueba:', error);
  } finally {
    // Cerrar conexión a la base de datos
    await prisma.$disconnect();
  }
}

// Ejecutar la prueba
testFacturapi();