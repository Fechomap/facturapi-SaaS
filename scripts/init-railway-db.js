// Script para inicializar la base de datos de Railway con datos de suscripción
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Inicializando base de datos de Railway con datos de suscripción...');
  
  try {
    // Verificar si ya existen planes para evitar duplicados
    const existingPlans = await prisma.subscriptionPlan.findMany();
    
    if (existingPlans.length > 0) {
      console.log('✅ Ya existen planes de suscripción. No se crearán nuevos.');
      return;
    }
    
    // Crear planes de suscripción básicos
    await prisma.subscriptionPlan.createMany({
      data: [
        {
          name: "Plan Básico",
          description: "Emisión de hasta 100 facturas mensuales",
          price: 199.99,
          currency: "MXN",
          billingPeriod: "monthly",
          invoiceLimit: 100,
          isActive: true
        },
        {
          name: "Plan Profesional",
          description: "Emisión de hasta 500 facturas mensuales",
          price: 499.99,
          currency: "MXN",
          billingPeriod: "monthly",
          invoiceLimit: 500,
          isActive: true
        },
        {
          name: "Plan Empresarial",
          description: "Emisión de hasta 2000 facturas mensuales",
          price: 999.99,
          currency: "MXN",
          billingPeriod: "monthly",
          invoiceLimit: 2000,
          isActive: true
        }
      ]
    });
    
    console.log('✅ Planes de suscripción creados exitosamente.');
  } catch (error) {
    console.error('❌ Error al inicializar la base de datos:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
