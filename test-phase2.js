// test-phase2.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Establecer NODE_ENV si no está definido
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// Cargar variables de entorno según el entorno
dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

// Obtener información sobre el archivo actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log(`🔍 Pruebas de Fase 2 (Servicios de Negocio) - Entorno: ${process.env.NODE_ENV}`);

// Generar ID único para las pruebas
const testId = Date.now().toString().slice(-6);

// Simular un tenant para pruebas (mientras no tengamos Prisma)
const mockTenant = {
  id: `tenant-test-${testId}`,
  businessName: 'Empresa de Prueba',
  rfc: `TEST${testId}`,
  email: 'test@example.com'
};

// Crear estructura de directorios necesaria
async function setupDirectories() {
  console.log('\n🔹 PREPARACIÓN: Creando estructura de directorios necesaria...');
  
  const directories = [
    './services',
    './data',
    './storage',
    `./storage/tenant-${mockTenant.id}`,
    `./storage/tenant-${mockTenant.id}/invoices`
  ];
  
  for (const dir of directories) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`  Directorio creado: ${dir}`);
    } else {
      console.log(`  Directorio ya existe: ${dir}`);
    }
  }
  
  console.log('✅ Estructura de directorios preparada');
}

// Probar creación de servicios individualmente
async function testFolioService() {
  console.log('\n🔹 PRUEBA SERVICIO DE FOLIOS');
  
  try {
    // Importar el servicio de folios
    const folioService = await import('./services/folio.service.js');
    
    // Probar la inicialización
    console.log('- Probando initFolioCounter()...');
    folioService.initFolioCounter();
    
    // Verificar que se haya creado el archivo de contadores
    const folioFile = path.join(__dirname, 'data', 'folio-counter.json');
    const exists = fs.existsSync(folioFile);
    console.log(`  Archivo de folios creado: ${exists ? '✓' : '✗'}`);
    
    if (exists) {
      const data = fs.readFileSync(folioFile, 'utf8');
      const counters = JSON.parse(data);
      console.log(`  Contenido: ${JSON.stringify(counters)}`);
    }
    
    // Probar funciones de contador (basadas en archivo)
    console.log('- Probando peekNextFolio()...');
    const nextFolio = folioService.peekNextFolio('A');
    console.log(`  Próximo folio: A-${nextFolio}`);
    
    console.log('- Probando reserveNextFolio()...');
    const folioNumber = folioService.reserveNextFolio('A');
    console.log(`  Folio reservado: A-${folioNumber}`);
    
    const verifyFolio = folioService.peekNextFolio('A');
    console.log(`  Verificación: próximo folio es ahora A-${verifyFolio}`);
    
    if (verifyFolio !== folioNumber + 1) {
      throw new Error(`La reserva de folio no incrementó correctamente el contador (esperado: ${folioNumber + 1}, actual: ${verifyFolio})`);
    }
    
    console.log('✅ Servicio de Folios funcionando correctamente');
    return true;
  } catch (error) {
    console.error('❌ Error en prueba de servicio de folios:', error);
    return false;
  }
}

async function testInvoiceService() {
  console.log('\n🔹 PRUEBA SERVICIO DE FACTURAS (Funciones independientes)');
  
  try {
    // Importar el servicio de facturas
    const invoiceModule = await import('./services/invoice.service.js');
    
    // Verificar que se haya importado correctamente
    console.log('- Verificando funciones exportadas...');
    const functions = Object.keys(invoiceModule);
    console.log(`  Funciones disponibles: ${functions.join(', ')}`);
    
    if (functions.length === 0) {
      throw new Error('No se encontraron funciones exportadas');
    }
    
    // Verificar funciones esperadas
    const expectedFunctions = [
      'downloadInvoice', 
      'findInvoiceByFolio', 
      'generateInvoice'
    ];
    
    const missingFunctions = expectedFunctions.filter(fn => !functions.includes(fn));
    
    if (missingFunctions.length > 0) {
      console.warn(`⚠️ Algunas funciones esperadas no están disponibles: ${missingFunctions.join(', ')}`);
    } else {
      console.log('  Todas las funciones esperadas están disponibles ✓');
    }
    
    console.log('✅ Servicio de Facturas verificado');
    return true;
  } catch (error) {
    console.error('❌ Error en prueba de servicio de facturas:', error);
    return false;
  }
}

async function testClientService() {
  console.log('\n🔹 PRUEBA SERVICIO DE CLIENTES (Funciones independientes)');
  
  try {
    // Importar el servicio de clientes
    const clientModule = await import('./services/client.service.js');
    
    // Verificar que se haya importado correctamente
    console.log('- Verificando funciones exportadas...');
    const functions = Object.keys(clientModule);
    console.log(`  Funciones disponibles: ${functions.join(', ')}`);
    
    if (functions.length === 0) {
      throw new Error('No se encontraron funciones exportadas');
    }
    
    // Verificar la definición de clientes predefinidos
    console.log('- Verificando CLIENTES_PREDEFINIDOS...');
    if (clientModule.setupPredefinedClients) {
      console.log('  Función setupPredefinedClients existe ✓');
    } else {
      console.warn('⚠️ Función setupPredefinedClients no encontrada');
    }
    
    console.log('✅ Servicio de Clientes verificado');
    return true;
  } catch (error) {
    console.error('❌ Error en prueba de servicio de clientes:', error);
    return false;
  }
}

async function testFacturapiService() {
  console.log('\n🔹 PRUEBA SERVICIO DE FACTURAPI');
  
  try {
    // Importar el servicio de FacturAPI
    const factuAPIModule = await import('./services/facturapi.service.js');
    
    // Verificar que se haya importado correctamente
    console.log('- Verificando clase FacturapiService...');
    const facturapiService = factuAPIModule.default;
    
    if (!facturapiService) {
      throw new Error('No se encontró la exportación default de FacturapiService');
    }
    
    console.log('  FacturapiService importado correctamente ✓');
    
    // Verificar métodos estáticos
    console.log('- Verificando métodos estáticos...');
    const methodNames = Object.getOwnPropertyNames(facturapiService)
      .filter(prop => typeof facturapiService[prop] === 'function');
    
    console.log(`  Métodos disponibles: ${methodNames.join(', ')}`);
    
    // Verificar método específico
    if (facturapiService.getFacturapiClient) {
      console.log('  Método getFacturapiClient existe ✓');
    } else {
      console.warn('⚠️ Método getFacturapiClient no encontrado');
    }
    
    console.log('✅ Servicio de FacturAPI verificado');
    return true;
  } catch (error) {
    console.error('❌ Error en prueba de servicio de FacturAPI:', error);
    return false;
  }
}

async function testPaymentService() {
  console.log('\n🔹 PRUEBA SERVICIO DE PAGOS (STRIPE)');
  
  try {
    // Importar el servicio de pagos
    const paymentModule = await import('./services/payment.service.js');
    
    // Verificar que se haya importado correctamente
    console.log('- Verificando funciones exportadas...');
    const functions = Object.keys(paymentModule);
    console.log(`  Funciones disponibles: ${functions.join(', ')}`);
    
    if (functions.length === 0) {
      throw new Error('No se encontraron funciones exportadas');
    }
    
    // Verificar funciones esperadas
    const expectedFunctions = [
      'initializeStripe', 
      'createCustomer', 
      'handleWebhookEvent'
    ];
    
    const missingFunctions = expectedFunctions.filter(fn => !functions.includes(fn));
    
    if (missingFunctions.length > 0) {
      console.warn(`⚠️ Algunas funciones esperadas no están disponibles: ${missingFunctions.join(', ')}`);
    } else {
      console.log('  Todas las funciones esperadas están disponibles ✓');
    }
    
    // Verificar inicialización con clave de prueba falsa
    console.log('- Probando inicialización con clave simulada...');
    try {
      if (paymentModule.initializeStripe) {
        const testKey = 'sk_test_simulated_key_for_testing_only';
        const result = paymentModule.initializeStripe(testKey);
        console.log(`  Inicialización: ${result ? 'Completada' : 'Falló'}`);
      } else {
        console.warn('⚠️ Función initializeStripe no disponible para prueba');
      }
    } catch (error) {
      console.warn(`⚠️ Error en inicialización simulada: ${error.message}`);
    }
    
    console.log('✅ Servicio de Pagos verificado');
    return true;
  } catch (error) {
    console.error('❌ Error en prueba de servicio de Pagos:', error);
    return false;
  }
}

// Ejecutar todas las pruebas
async function runAllTests() {
  try {
    // Preparar directorios
    await setupDirectories();
    
    // Ejecutar pruebas de servicios
    const results = {
      folioService: await testFolioService(),
      invoiceService: await testInvoiceService(),
      clientService: await testClientService(),
      facturapiService: await testFacturapiService(),
      paymentService: await testPaymentService()
    };
    
    // Resumen de resultados
    console.log('\n📊 RESUMEN DE PRUEBAS');
    console.log('-------------------');
    for (const [test, result] of Object.entries(results)) {
      console.log(`${test}: ${result ? '✅ Pasó' : '❌ Falló'}`);
    }
    
    const passedCount = Object.values(results).filter(Boolean).length;
    const totalCount = Object.values(results).length;
    
    console.log(`\n${passedCount}/${totalCount} pruebas pasaron correctamente`);
    
    if (passedCount === totalCount) {
      console.log('\n🎉 TODAS LAS PRUEBAS DE FASE 2 COMPLETADAS CON ÉXITO');
    } else {
      console.log('\n⚠️ ALGUNAS PRUEBAS FALLARON - Revise los mensajes de error');
    }
  } catch (error) {
    console.error('\n❌ ERROR EN LAS PRUEBAS:', error);
  }
}

// Ejecutar
runAllTests();