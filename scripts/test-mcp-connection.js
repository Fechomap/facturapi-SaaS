// scripts/test-mcp-connection.js
/**
 * Script para probar la conexión con el servidor MCP de Stripe
 * 
 * Este script verifica que el servidor MCP esté funcionando correctamente
 * y que se pueda comunicar con él.
 * 
 * Uso:
 *   node scripts/test-mcp-connection.js
 */

import dotenv from 'dotenv';
import { checkMcpConnection, callStripeMcpTool } from '../lib/mcpClient.js';

// Cargar variables de entorno
dotenv.config();

// Colores para la salida
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

/**
 * Función principal
 */
async function main() {
  console.log(`${colors.blue}=== Test de Conexión con Servidor MCP de Stripe ===${colors.reset}\n`);
  
  // Mostrar configuración
  console.log(`${colors.cyan}Configuración:${colors.reset}`);
  console.log(`- URL del servidor MCP: ${process.env.MCP_SERVER_URL || 'http://localhost:3000/mcp'}`);
  console.log(`- Nombre del servidor: ${process.env.MCP_STRIPE_SERVER_NAME || 'github.com/stripe/agent-toolkit'}`);
  console.log(`- Timeout: ${process.env.MCP_REQUEST_TIMEOUT || '10000'}ms\n`);
  
  // Paso 1: Verificar conexión básica
  console.log(`${colors.cyan}Paso 1: Verificando conexión básica...${colors.reset}`);
  
  // Intentar varias veces en caso de que el servidor aún esté iniciando
  let isConnected = false;
  let attempts = 0;
  const maxAttempts = 3;
  
  while (!isConnected && attempts < maxAttempts) {
    attempts++;
    try {
      console.log(`${colors.yellow}Intento ${attempts} de ${maxAttempts}...${colors.reset}`);
      isConnected = await checkMcpConnection();
      
      if (isConnected) {
        console.log(`${colors.green}✓ Conexión establecida correctamente${colors.reset}`);
      } else if (attempts < maxAttempts) {
        console.log(`${colors.yellow}Esperando 2 segundos antes de reintentar...${colors.reset}`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Esperar 2 segundos
      } else {
        console.log(`${colors.red}✗ No se pudo establecer conexión después de ${maxAttempts} intentos${colors.reset}`);
        console.log(`${colors.yellow}Sugerencias:${colors.reset}`);
        console.log('- Verifica que el servidor MCP esté en ejecución');
        console.log('- Verifica que la URL del servidor MCP sea correcta');
        console.log('- Verifica que no haya un firewall bloqueando la conexión');
        process.exit(1); // Salir con error
      }
    } catch (error) {
      if (attempts < maxAttempts) {
        console.log(`${colors.yellow}Error al verificar conexión: ${error.message}. Reintentando...${colors.reset}`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Esperar 2 segundos
      } else {
        console.log(`${colors.red}✗ Error al verificar conexión después de ${maxAttempts} intentos: ${error.message}${colors.reset}`);
        process.exit(1); // Salir con error
      }
    }
  }
  
  if (!isConnected) {
    return; // No debería llegar aquí, pero por si acaso
  }
  
  // Paso 2: Probar herramienta simple (products.read)
  console.log(`\n${colors.cyan}Paso 2: Probando herramienta products.read...${colors.reset}`);
  try {
    const products = await callStripeMcpTool('products.read', { limit: 1 });
    console.log(`${colors.green}✓ Herramienta products.read ejecutada correctamente${colors.reset}`);
    console.log('Respuesta:', JSON.stringify(products, null, 2));
  } catch (error) {
    console.log(`${colors.red}✗ Error al llamar a products.read: ${error.message}${colors.reset}`);
    console.log(`${colors.yellow}Sugerencias:${colors.reset}`);
    console.log('- Verifica que la API key de Stripe sea correcta');
    console.log('- Verifica que el servidor MCP tenga acceso a la API de Stripe');
    console.log('- Verifica que la herramienta products.read esté disponible en el servidor MCP');
    return;
  }
  
  // Paso 3: Probar herramienta más compleja (customers.create y luego customers.read)
  console.log(`\n${colors.cyan}Paso 3: Probando herramienta customers.create...${colors.reset}`);
  try {
    const testCustomer = await callStripeMcpTool('customers.create', {
      name: 'Cliente de Prueba MCP',
      email: `test-${Date.now()}@example.com`
    });
    console.log(`${colors.green}✓ Herramienta customers.create ejecutada correctamente${colors.reset}`);
    console.log('Cliente creado:', JSON.stringify(testCustomer, null, 2));

    // Verificar que el cliente se haya creado correctamente
    console.log(`\n${colors.cyan}Paso 4: Verificando cliente creado con customers.read...${colors.reset}`);
    const customers = await callStripeMcpTool('customers.read', {
      email: testCustomer.email,
      limit: 1
    });
    console.log(`${colors.green}✓ Herramienta customers.read ejecutada correctamente${colors.reset}`);
    console.log('Clientes encontrados:', JSON.stringify(customers, null, 2));
    
    if (customers.data && customers.data.length > 0) {
      console.log(`${colors.green}✓ Cliente encontrado en la lista${colors.reset}`);
    } else {
      console.log(`${colors.red}✗ Cliente no encontrado en la lista${colors.reset}`);
    }
  } catch (error) {
    console.log(`${colors.red}✗ Error al probar customers.create/customers.read: ${error.message}${colors.reset}`);
    return;
  }
  
  // Resumen
  console.log(`\n${colors.green}=== Prueba Completada Exitosamente ===${colors.reset}`);
  console.log(`${colors.green}✓ El servidor MCP está funcionando correctamente${colors.reset}`);
  console.log(`${colors.green}✓ Se puede comunicar con la API de Stripe${colors.reset}`);
  console.log(`${colors.green}✓ Las herramientas básicas funcionan correctamente${colors.reset}`);
  console.log(`\n${colors.blue}El sistema está listo para usar las funciones de Stripe a través de MCP.${colors.reset}`);
}

// Ejecutar la función principal
main()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error(`${colors.red}Error inesperado: ${error.message}${colors.reset}`);
    process.exit(1);
  });
