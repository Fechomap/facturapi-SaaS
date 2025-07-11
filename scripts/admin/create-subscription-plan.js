// create-subscription-plan.js
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Cargar variables de entorno
const NODE_ENV = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${NODE_ENV}` });

const prisma = new PrismaClient();

async function createSubscriptionPlan() {
  console.log('Creando plan de suscripción básico...');
  
  try {
    // Verificar si ya existe un plan con ese nombre
    const existingPlan = await prisma.subscriptionPlan.findFirst({
      where: {
        name: 'Plan Básico'
      }
    });
    
    if (existingPlan) {
      console.log('⚠️ Ya existe un plan con este nombre:');
      console.log(existingPlan);
      
      const answer = await question('¿Deseas crear otro plan de todas formas? (s/N): ');
      if (answer.toLowerCase() !== 's') {
        console.log('🛑 Operación cancelada.');
        return;
      }
    }
    
    // Crear el plan de suscripción
    const plan = await prisma.subscriptionPlan.create({
      data: {
        name: 'Plan Básico',
        description: 'Plan mensual de facturación para pequeñas empresas',
        price: 599.00,
        currency: 'MXN',
        billingPeriod: 'monthly',
        invoiceLimit: 100, // Ajusta este valor según sea necesario
        isActive: true,
        stripeProductId: 'prod_S8DMoG02MoBqXg',
        stripePriceId: 'price_1RDww1P4Me2WA9wKONkcrai4',
      }
    });
    
    console.log('✅ Plan de suscripción creado exitosamente:');
    console.log(plan);
  } catch (error) {
    console.error('Error al crear el plan de suscripción:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Función para preguntas interactivas
function question(query) {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    readline.question(query, answer => {
      readline.close();
      resolve(answer);
    });
  });
}

// Ejecutar la función
createSubscriptionPlan();