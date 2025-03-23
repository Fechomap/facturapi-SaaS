// scripts/create-subscription.js
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Configuración inicial
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno según el entorno
const NODE_ENV = process.env.NODE_ENV || 'development';
const envPath = path.resolve(__dirname, `../.env.${NODE_ENV}`);
dotenv.config({ path: envPath });

// Inicializar Prisma
const prisma = new PrismaClient();

// Función para inicializar la configuración
async function initConfig() {
  console.log('✅ Configuración inicializada');
}

/**
 * Crea una suscripción de prueba para un tenant específico
 * @param {string} tenantId - ID del tenant al que se creará la suscripción
 * @param {number} trialDays - Días de prueba (por defecto 14)
 */
async function createSubscriptionForTenant(tenantId, trialDays = 14) {
  console.log(`Creando suscripción para tenant ${tenantId} con ${trialDays} días de prueba...`);
  
  try {
    // 1. Verificar que el tenant existe
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });
    
    if (!tenant) {
      console.error(`❌ ERROR: No se encontró el tenant con ID ${tenantId}`);
      return false;
    }
    
    console.log(`✅ Tenant encontrado: ${tenant.businessName} (${tenant.rfc})`);
    
    // 2. Verificar si ya tiene una suscripción activa
    if (tenant.subscriptions && tenant.subscriptions.length > 0) {
      const existingSub = tenant.subscriptions[0];
      
      if (existingSub.status === 'active' || existingSub.status === 'trial') {
        console.log(`\n⚠️ El tenant ya tiene una suscripción ${existingSub.status}:`);
        console.log(existingSub);
        
        // Preguntar si desea sobreescribir
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise(resolve => {
          rl.question('\n¿Desea crear una nueva suscripción de todos modos? (s/N): ', resolve);
        });
        
        rl.close();
        
        if (answer.toLowerCase() !== 's') {
          console.log('🛑 Operación cancelada por el usuario.');
          return false;
        }
        
        console.log('✅ Continuando con la creación de una nueva suscripción...');
      }
    }
    
    // 3. Obtener planes disponibles
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' }
    });
    
    if (!plans || plans.length === 0) {
      console.error('❌ ERROR: No se encontraron planes de suscripción activos.');
      return false;
    }
    
    console.log(`✅ Planes disponibles: ${plans.length}`);
    console.log(`✅ Usando plan: ${plans[0].name} (ID: ${plans[0].id})`);
    
    // 4. Calcular fechas para el período de prueba
    const now = new Date();
    const trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);
    
    // 5. Crear la suscripción
    const subscription = await prisma.tenantSubscription.create({
      data: {
        tenantId: tenant.id,
        planId: plans[0].id,
        status: 'trial',
        trialEndsAt,
        currentPeriodStartsAt: now,
        currentPeriodEndsAt: trialEndsAt,
        invoicesUsed: 0
      },
      include: {
        plan: true
      }
    });
    
    if (!subscription) {
      console.error('❌ ERROR: No se pudo crear la suscripción.');
      return false;
    }
    
    console.log(`\n✅ Suscripción creada exitosamente:`);
    console.log(`- ID: ${subscription.id}`);
    console.log(`- Plan: ${subscription.plan.name}`);
    console.log(`- Estado: ${subscription.status}`);
    console.log(`- Inicia: ${subscription.currentPeriodStartsAt?.toLocaleDateString()}`);
    console.log(`- Vence: ${subscription.trialEndsAt?.toLocaleDateString()}`);
    
    return subscription;
    
  } catch (error) {
    console.error(`❌ ERROR al crear suscripción:`, error);
    return false;
  }
}

/**
 * Muestra los tenants que no tienen suscripciones activas
 */
async function listTenantsWithoutSubscription() {
  console.log('Buscando tenants sin suscripciones activas...');
  
  try {
    // Obtener todos los tenants con sus suscripciones
    const tenants = await prisma.tenant.findMany({
      include: {
        subscriptions: {
          where: {
            OR: [
              { status: 'active' },
              { status: 'trial' }
            ]
          }
        }
      }
    });
    
    // Filtrar los que no tienen suscripciones activas
    const tenantsWithoutSub = tenants.filter(tenant => tenant.subscriptions.length === 0);
    
    if (tenantsWithoutSub.length === 0) {
      console.log('✅ Todos los tenants tienen suscripciones activas.');
      return [];
    }
    
    console.log(`\n📋 Tenants sin suscripciones activas (${tenantsWithoutSub.length}):`);
    tenantsWithoutSub.forEach((tenant, index) => {
      console.log(`${index + 1}. ${tenant.businessName} (${tenant.rfc}) - ID: ${tenant.id}`);
    });
    
    return tenantsWithoutSub;
    
  } catch (error) {
    console.error('❌ ERROR al listar tenants:', error);
    return [];
  }
}

/**
 * Función principal para manejar los argumentos de línea de comandos
 */
async function main() {
  await initConfig();
  
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Uso: node scripts/create-subscription.js [OPCIÓN]

Opciones:
  --list, -l                 Lista los tenants sin suscripciones activas
  --create TENANT_ID [DIAS]  Crea una suscripción para el tenant especificado
                             [DIAS] es opcional, por defecto 14
  --all                      Crea suscripciones para todos los tenants sin una
  --help, -h                 Muestra esta ayuda
    `);
    return;
  }
  
  if (args[0] === '--list' || args[0] === '-l') {
    await listTenantsWithoutSubscription();
    console.log('\nScript completado');
    return;
  }
  
  if (args[0] === '--create' && args.length >= 2) {
    const tenantId = args[1];
    const days = args.length >= 3 ? parseInt(args[2]) : 14;
    
    if (isNaN(days) || days <= 0) {
      console.error('❌ ERROR: El número de días debe ser un número positivo.');
      return;
    }
    
    await createSubscriptionForTenant(tenantId, days);
    console.log('\nScript completado');
    return;
  }
  
  if (args[0] === '--all') {
    const tenantsWithoutSub = await listTenantsWithoutSubscription();
    
    if (tenantsWithoutSub.length === 0) {
      console.log('\nScript completado');
      return;
    }
    
    // Preguntar confirmación
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      rl.question(`\n¿Desea crear suscripciones para todos estos ${tenantsWithoutSub.length} tenants? (s/N): `, resolve);
    });
    
    rl.close();
    
    if (answer.toLowerCase() !== 's') {
      console.log('🛑 Operación cancelada por el usuario.');
      console.log('\nScript completado');
      return;
    }
    
    console.log('✅ Creando suscripciones para todos los tenants sin suscripción activa...');
    
    // Crear suscripciones para todos
    for (const tenant of tenantsWithoutSub) {
      console.log(`\n⏳ Procesando tenant: ${tenant.businessName}`);
      await createSubscriptionForTenant(tenant.id);
    }
    
    console.log('\n✅ Proceso completado.');
    return;
  }
  
  console.log('❌ Opción no reconocida. Use --help para ver las opciones disponibles.');
  console.log('\nScript completado');
}

// Ejecutar la función principal
main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('❌ Error en script principal:', error);
    await prisma.$disconnect();
    process.exit(1);
  });