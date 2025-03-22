// scripts/test-setup.js
import { initConfig } from '../config/index.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import logger from '../core/utils/logger.js';
import { encrypt, decrypt } from '../core/utils/encryption.js';
import TenantService from '../core/tenant/tenant.service.js';
import StorageService from '../core/storage/storage.service.js';
import SubscriptionService from '../core/subscription/subscription.service.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Logger para pruebas
const testLogger = logger.child({ module: 'test-setup' });

// Obtener directorio actual
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Función principal de prueba
async function runTests() {
  testLogger.info('Iniciando pruebas de configuración...');
  
  try {
    // 1. Inicializar configuración
    testLogger.info('1. Inicializando configuración');
    const config = await initConfig();
    testLogger.info('✅ Configuración inicializada correctamente');
    
    // 2. Conectar a la base de datos
    testLogger.info('2. Conectando a la base de datos');
    const prisma = await connectDatabase();
    testLogger.info('✅ Conexión a la base de datos establecida correctamente');
    
    // 3. Probar funciones de encriptación
    testLogger.info('3. Probando funciones de encriptación');
    const textToEncrypt = 'sk_test_facturapi_saas_key_123456789';
    const encrypted = encrypt(textToEncrypt);
    const decrypted = decrypt(encrypted);
    
    if (decrypted === textToEncrypt) {
      testLogger.info('✅ Funciones de encriptación funcionando correctamente');
    } else {
      throw new Error(`Error en encriptación: ${textToEncrypt} != ${decrypted}`);
    }
    
    // 4. Probar creación de directorios de almacenamiento
    testLogger.info('4. Probando creación de directorios de almacenamiento');
    const tempTenantId = 'test-tenant-' + Date.now();
    const tenantPath = await StorageService.ensureTenantDirectories(tempTenantId);
    
    if (fs.existsSync(tenantPath)) {
      testLogger.info(`✅ Directorios creados correctamente en ${tenantPath}`);
      
      // Limpiar directorios de prueba
      fs.rmdirSync(tenantPath, { recursive: true });
      testLogger.info('✅ Directorios de prueba limpiados correctamente');
    } else {
      throw new Error('No se crearon los directorios correctamente');
    }
    
    // 5. Probar consulta de planes de suscripción
    testLogger.info('5. Probando consulta de planes de suscripción');
    // Primero verificamos si hay planes, si no, creamos uno de prueba
    let plans = await SubscriptionService.getPlans(false);
    
    if (plans.length === 0) {
      testLogger.info('No hay planes de suscripción, creando plan de prueba');
      
      // Crear plan de prueba
      await SubscriptionService.createPlan({
        name: 'Plan Básico (Test)',
        description: 'Plan básico para pruebas',
        price: 299.00,
        currency: 'MXN',
        billingPeriod: 'monthly',
        invoiceLimit: 100,
        isActive: true
      });
      
      // Verificar que se creó correctamente
      plans = await SubscriptionService.getPlans(false);
      
      if (plans.length > 0) {
        testLogger.info(`✅ Plan de prueba creado correctamente: ${plans[0].name}`);
      } else {
        throw new Error('No se pudo crear el plan de prueba');
      }
    } else {
      testLogger.info(`✅ Se encontraron ${plans.length} planes de suscripción`);
    }
    
    // Mostrar resumen de pruebas
    testLogger.info('---------------------------------');
    testLogger.info('✅ Todas las pruebas completadas correctamente');
    testLogger.info('Sistema configurado y listo para usar');
    testLogger.info('---------------------------------');
    
  } catch (error) {
    testLogger.error({ error }, 'Error durante las pruebas');
    process.exit(1);
  } finally {
    // Cerrar conexión a la base de datos
    await disconnectDatabase();
  }
}

// Ejecutar pruebas
runTests()
  .then(() => {
    testLogger.info('Proceso de prueba finalizado');
    process.exit(0);
  })
  .catch(err => {
    testLogger.error({ err }, 'Error no controlado durante las pruebas');
    process.exit(1);
  });