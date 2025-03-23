// test-download.js
import axios from 'axios';
import fs from 'fs';
import TenantService from './core/tenant/tenant.service.js';
import invoiceController from './api/controllers/invoice.controller.js';

// Configuración
const BASE_URL = 'http://localhost:3000';
const TENANT_ID = 'c65fada9-81b0-4150-af05-7c326eab0be3'; // El ID que vemos en los logs
const FACTURA_ID = '67df55c1b396953969a34cef'; // Un ID de factura existente

async function testDownloadEndpoint() {
  console.log('=== TEST DE ENDPOINT DE DESCARGA ===');
  
  try {
    console.log(`Probando descarga desde: ${BASE_URL}/api/facturas/${FACTURA_ID}/pdf`);
    console.log(`Usando Tenant ID: ${TENANT_ID}`);
    
    const response = await axios({
      method: 'GET',
      url: `${BASE_URL}/api/facturas/${FACTURA_ID}/pdf`,
      responseType: 'stream',
      headers: {
        'X-Tenant-ID': TENANT_ID
      }
    });
    
    // Guardar el archivo para verificar
    const writer = fs.createWriteStream(`./test-factura.pdf`);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('✅ Descarga EXITOSA - Archivo guardado como test-factura.pdf');
        resolve();
      });
      
      writer.on('error', (err) => {
        console.error('❌ Error al escribir el archivo:', err);
        reject(err);
      });
    });
  } catch (error) {
    console.error('❌ Error en la solicitud:');
    
    if (error.response) {
      console.error(`  Status: ${error.response.status}`);
      console.error(`  Mensaje: ${error.response.statusText}`);
      
      if (error.response.data) {
        try {
          // Para capturar el cuerpo del error
          const chunks = [];
          error.response.data.on('data', (chunk) => chunks.push(chunk));
          await new Promise((resolve) => {
            error.response.data.on('end', () => {
              const body = Buffer.concat(chunks).toString('utf8');
              console.error(`  Respuesta: ${body}`);
              resolve();
            });
          });
        } catch (e) {
          console.error('Error al leer la respuesta:', e);
        }
      }
    } else {
      console.error(`  Error: ${error.message}`);
    }
  }
}

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
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('✅ Descarga DIRECTA EXITOSA - Archivo guardado como test-factura-direct.pdf');
        resolve();
      });
      
      writer.on('error', (err) => {
        console.error('❌ Error al escribir el archivo:', err);
        reject(err);
      });
    });
  } catch (error) {
    console.error('❌ Error en la solicitud directa a FacturAPI:');
    
    if (error.response) {
      console.error(`  Status: ${error.response.status}`);
      console.error(`  Mensaje: ${error.response.statusText}`);
      
      if (error.response.data) {
        try {
          // Para capturar el cuerpo del error
          const chunks = [];
          error.response.data.on('data', (chunk) => chunks.push(chunk));
          await new Promise((resolve) => {
            error.response.data.on('end', () => {
              const body = Buffer.concat(chunks).toString('utf8');
              console.error(`  Respuesta: ${body}`);
              resolve();
            });
          });
        } catch (e) {
          console.error('Error al leer la respuesta:', e);
        }
      }
    } else {
      console.error(`  Error: ${error.message}`);
    }
  }
}

async function testController() {
  console.log('\n=== TEST DEL CONTROLADOR ===');
  
  try {
    // Crear un mock de request y response
    const req = {
      tenant: { id: TENANT_ID },
      params: { id: FACTURA_ID },
      getApiKey: async () => await TenantService.getDecryptedApiKey(TENANT_ID)
    };
    
    const res = {
      setHeader: (name, value) => {
        console.log(`  Estableciendo header: ${name} = ${value}`);
      },
      status: (code) => {
        console.log(`  Estableciendo status: ${code}`);
        return res;
      },
      json: (data) => {
        console.log(`  Enviando respuesta JSON:`, data);
      },
      send: (data) => {
        console.log(`  Enviando datos al cliente (length: ${typeof data === 'string' ? data.length : 'Buffer/Stream'})`);
        if (typeof data === 'string' && data.length < 100) {
          console.log(`  Contenido: ${data}`);
        }
      }
    };
    
    const next = (error) => {
      if (error) {
        console.error('❌ Error en el controlador:', error);
      }
    };
    
    console.log('Ejecutando downloadInvoicePdf...');
    await invoiceController.downloadInvoicePdf(req, res, next);
    
    console.log('✅ Controlador ejecutado sin errores');
  } catch (error) {
    console.error('❌ Error al ejecutar el controlador:', error);
  }
}

// Ejecutamos todos los tests
async function runAllTests() {
  await testDownloadEndpoint();
  await testFacturapiDirect();
  await testController();
}

runAllTests().catch(err => console.error('Error en los tests:', err));