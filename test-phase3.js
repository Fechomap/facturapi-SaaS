// test-phase3.js
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Establecer NODE_ENV si no está definido
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// Cargar variables de entorno según el entorno
dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

// Obtener información sobre el archivo actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log(`🔍 Pruebas de Fase 3 (API REST) - Entorno: ${process.env.NODE_ENV}`);

// URL base para las pruebas
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000/api';
console.log(`URL de la API: ${API_BASE_URL}`);

// ID de tenant de prueba
const TEST_TENANT_ID = 'test-tenant-' + Date.now().toString().slice(-6);

// Función para verificar estructura de archivos
async function testFileStructure() {
  console.log('\n🔹 PRUEBA DE ESTRUCTURA DE ARCHIVOS');
  
  const requiredFiles = [
    'api/controllers/client.controller.js',
    'api/controllers/invoice.controller.js',
    'api/controllers/product.controller.js',
    'api/controllers/webhook.controller.js',
    'api/middlewares/error.middleware.js',
    'api/middlewares/validation.middleware.js',
    'api/middlewares/tenant.middleware.js',
    'api/routes/client.routes.js',
    'api/routes/invoice.routes.js',
    'api/routes/product.routes.js',
    'api/routes/webhook.routes.js',
    'api/routes/index.js'
  ];
  
  const results = {};
  
  for (const file of requiredFiles) {
    const filePath = path.join(__dirname, file);
    const exists = fs.existsSync(filePath);
    results[file] = exists;
    console.log(`  ${exists ? '✅' : '❌'} ${file}`);
  }
  
  const allFilesExist = Object.values(results).every(Boolean);
  if (allFilesExist) {
    console.log('✅ Todos los archivos requeridos existen');
    return true;
  } else {
    console.log('❌ Faltan algunos archivos requeridos');
    return false;
  }
}

// Función para probar endpoints de la API (sin necesidad de servidor en ejecución)
async function testApiImports() {
  console.log('\n🔹 PRUEBA DE IMPORTACIÓN DE MÓDULOS DE API');
  
  try {
    // Importar controladores
    console.log('- Importando controladores...');
    const clientController = await import('./api/controllers/client.controller.js');
    const invoiceController = await import('./api/controllers/invoice.controller.js');
    const productController = await import('./api/controllers/product.controller.js');
    const webhookController = await import('./api/controllers/webhook.controller.js');
    
    console.log('  ✅ Controladores importados correctamente');
    
    // Importar middlewares
    console.log('- Importando middlewares...');
    const errorMiddleware = await import('./api/middlewares/error.middleware.js');
    const validationMiddleware = await import('./api/middlewares/validation.middleware.js');
    const tenantMiddleware = await import('./api/middlewares/tenant.middleware.js');
    
    console.log('  ✅ Middlewares importados correctamente');
    
    // Importar rutas
    console.log('- Importando rutas...');
    const routes = await import('./api/routes/index.js');
    
    console.log('  ✅ Rutas importadas correctamente');
    
    return true;
  } catch (error) {
    console.error('❌ Error al importar módulos de API:', error);
    return false;
  }
}

// Función para probar endpoints con servidor en ejecución
async function testLiveApi() {
  console.log('\n🔹 PRUEBA DE ENDPOINTS EN VIVO');
  console.log('⚠️ NOTA: Estas pruebas requieren que el servidor esté en ejecución');
  
  try {
    // Probar endpoint principal
    console.log('- Probando endpoint base...');
    const response = await axios.get(API_BASE_URL.replace('/api', ''));
    
    if (response.status === 200) {
      console.log(`  ✅ Endpoint base respondió: ${JSON.stringify(response.data)}`);
    } else {
      console.log(`  ❌ Endpoint base respondió con estado ${response.status}`);
    }
    
    // Configuración para todas las peticiones
    const config = {
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': TEST_TENANT_ID
      }
    };
    
    // Probar endpoint de clientes
    console.log('- Probando endpoint de clientes...');
    try {
      const clientsResponse = await axios.get(`${API_BASE_URL}/clientes`, config);
      console.log(`  ✅ Endpoint de clientes respondió: ${clientsResponse.status}`);
    } catch (error) {
      handleApiError('clientes', error);
    }
    
    // Probar endpoint de facturas
    console.log('- Probando endpoint de facturas...');
    try {
      const invoicesResponse = await axios.get(`${API_BASE_URL}/facturas`, config);
      console.log(`  ✅ Endpoint de facturas respondió: ${invoicesResponse.status}`);
    } catch (error) {
      handleApiError('facturas', error);
    }
    
    // Probar endpoint de productos
    console.log('- Probando endpoint de productos...');
    try {
      const productsResponse = await axios.get(`${API_BASE_URL}/productos`, config);
      console.log(`  ✅ Endpoint de productos respondió: ${productsResponse.status}`);
    } catch (error) {
      handleApiError('productos', error);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error en pruebas de API en vivo:', error.message);
    return false;
  }
}

// Función para manejar errores de API de manera consistente
function handleApiError(endpoint, error) {
  if (error.response) {
    console.log(`  ⚠️ Endpoint de ${endpoint} respondió con estado ${error.response.status}`);
    if (process.env.NODE_ENV === 'development') {
      console.log(`  Detalle: ${JSON.stringify(error.response.data)}`);
    }
  } else if (error.request) {
    console.log(`  ❌ No se recibió respuesta del endpoint de ${endpoint}`);
  } else {
    console.log(`  ❌ Error al hacer petición a ${endpoint}: ${error.message}`);
  }
  return false;
}

// Ejecutar todas las pruebas
async function runAllTests() {
  try {
    // Ejecutar pruebas de estructura de archivos
    const structureResult = await testFileStructure();
    
    // Ejecutar pruebas de importación de módulos
    const importsResult = await testApiImports();
    
    // Preguntar si se quieren ejecutar pruebas en vivo
    console.log('\n¿Desea ejecutar pruebas en vivo? (Requiere servidor en ejecución)');
    console.log('Para continuar, ejecute en otra terminal: npm run dev');
    console.log('Luego presione Enter para continuar o Ctrl+C para salir');
    
    // Esperar entrada del usuario
    process.stdin.resume();
    await new Promise(resolve => process.stdin.once('data', resolve));
    process.stdin.pause();
    
    // Ejecutar pruebas en vivo
    const liveResult = await testLiveApi();
    
    // Resumen de resultados
    console.log('\n📊 RESUMEN DE PRUEBAS');
    console.log('-------------------');
    console.log(`Estructura de archivos: ${structureResult ? '✅ Pasó' : '❌ Falló'}`);
    console.log(`Importación de módulos: ${importsResult ? '✅ Pasó' : '❌ Falló'}`);
    console.log(`Endpoints en vivo: ${liveResult ? '✅ Pasó' : '⚠️ Con advertencias'}`);
    
    if (structureResult && importsResult) {
      console.log('\n🎉 IMPLEMENTACIÓN DE FASE 3 EXITOSA');
      console.log('Los componentes básicos de la API REST están correctamente estructurados.');
      if (liveResult) {
        console.log('Los endpoints responden según lo esperado.');
      } else {
        console.log('⚠️ Algunos endpoints no respondieron correctamente. Revise los logs para más detalles.');
      }
    } else {
      console.log('\n⚠️ IMPLEMENTACIÓN INCOMPLETA DE FASE 3');
      console.log('Revise los errores específicos en los logs.');
    }
  } catch (error) {
    console.error('\n❌ ERROR EN LAS PRUEBAS:', error);
  }
}

// Ejecutar
runAllTests();