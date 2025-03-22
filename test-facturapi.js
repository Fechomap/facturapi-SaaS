// test-facturapi.js
import { PrismaClient } from '@prisma/client';
import { decryptApiKey } from './core/utils/encryption.js';
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';
import readline from 'readline';

// Cargar variables de entorno
dotenv.config({ path: `.env.development` });

const prisma = new PrismaClient();

// Función para crear una interfaz de lectura
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Función para preguntar al usuario
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
  try {
    console.log("Test de Integración con FacturAPI");
    console.log("--------------------------------");

    // 1. Obtener tenant específico
    const tenantId = process.argv[2] || 'c472336e-63de-4ab1-ae94-eaee097ac35a';
    console.log(`Buscando tenant con ID: ${tenantId}`);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId }
    });

    if (!tenant) {
      console.error(`❌ No se encontró el tenant con ID ${tenantId}`);
      return;
    }

    console.log(`✅ Tenant encontrado: ${tenant.businessName}`);
    console.log(`  Organización FacturAPI: ${tenant.facturapiOrganizationId || 'No configurada'}`);
    
    // 2. Verificar la API key almacenada
    if (!tenant.facturapiApiKey) {
      console.error("❌ El tenant no tiene una API key configurada");
      
      // Preguntar si desea configurar una nueva API key
      const newApiKey = await question("¿Desea configurar una nueva API key? (Ingrese la API key o 'no' para cancelar): ");
      
      if (newApiKey.toLowerCase() === 'no') {
        console.log("Operación cancelada");
        return;
      }
      
      // Verificar formato de la API key
      if (!newApiKey.startsWith('sk_')) {
        console.error("❌ El formato de la API key no es válido. Debe comenzar con 'sk_'");
        return;
      }
      
      // Almacenar la nueva API key
      await updateApiKey(tenant.id, newApiKey);
      console.log("✅ API key actualizada correctamente");
      return;
    }

    // 3. Intentar desencriptar la API key
    try {
      const decryptedApiKey = await decryptApiKey(tenant.facturapiApiKey);
      console.log(`Longitud de API key desencriptada: ${decryptedApiKey.length}`);
      console.log(`Primeros caracteres: ${decryptedApiKey.substring(0, 10)}...`);
      
      // Verificar formato de la API key
      if (!decryptedApiKey.startsWith('sk_')) {
        console.error("❌ La API key desencriptada no tiene el formato correcto (debe comenzar con 'sk_')");
        
        // Preguntar si desea configurar una nueva API key
        const newApiKey = await question("¿Desea configurar una nueva API key? (Ingrese la API key o 'no' para cancelar): ");
        
        if (newApiKey.toLowerCase() === 'no') {
          console.log("Operación cancelada");
          return;
        }
        
        // Verificar formato de la nueva API key
        if (!newApiKey.startsWith('sk_')) {
          console.error("❌ El formato de la API key no es válido. Debe comenzar con 'sk_'");
          return;
        }
        
        // Almacenar la nueva API key
        await updateApiKey(tenant.id, newApiKey);
        console.log("✅ API key actualizada correctamente");
        return;
      }
      
      // 4. Probar la API key con FacturAPI
      console.log("Probando conexión con FacturAPI...");
      
      try {
        const response = await axios.get('https://www.facturapi.io/v2/catalogs/products', {
          headers: {
            'Authorization': `Bearer ${decryptedApiKey}`
          }
        });
        
        console.log("✅ Conexión exitosa con FacturAPI");
        console.log(`Respuesta: ${JSON.stringify(response.data).substring(0, 100)}...`);
        
        // 5. Intentar crear un cliente de prueba
        console.log("\nIntentando crear un cliente de prueba...");
        
        const testCustomer = {
          legal_name: "CLIENTE DE PRUEBA",
          tax_id: "AAA010101AAA",
          tax_system: "601",
          email: "prueba@example.com"
        };
        
        const customerResponse = await axios.post('https://www.facturapi.io/v2/customers', 
          testCustomer,
          {
            headers: {
              'Authorization': `Bearer ${decryptedApiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        console.log("✅ Cliente creado exitosamente");
        console.log(`ID del cliente: ${customerResponse.data.id}`);
        
      } catch (apiError) {
        console.error("❌ Error al conectar con FacturAPI:", apiError.message);
        if (apiError.response) {
          console.error("Código de estado:", apiError.response.status);
          console.error("Respuesta:", apiError.response.data);
        }
      }
      
    } catch (decryptError) {
      console.error("❌ Error al desencriptar la API key:", decryptError.message);
    }
    
  } catch (error) {
    console.error("Error en el script:", error);
  } finally {
    await prisma.$disconnect();
    rl.close();
  }
}

// Función para actualizar la API key
async function updateApiKey(tenantId, apiKey) {
  // Encriptar la API key
  const encryptedKey = await encryptApiKey(apiKey);
  
  // Actualizar en la base de datos
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { facturapiApiKey: encryptedKey }
  });
}

// Función para encriptar API key
async function encryptApiKey(apiKey) {
  // Obtener clave secreta de variables de entorno
  const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'desarrolloFacturapiSaas2025Secret';
  
  // Generar un IV aleatorio
  const iv = crypto.randomBytes(16);
  
  // Crear clave a partir del secreto usando SHA-256
  const key = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();
  
  // Crear cipher con algoritmo, clave e IV
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  
  // Encriptar el texto
  let encrypted = cipher.update(apiKey, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  // Combinar IV y texto cifrado
  return iv.toString('base64') + ':' + encrypted;
}

main();