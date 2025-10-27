// scripts/check-plans.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Consultando planes de suscripción...');
    const plans = await prisma.subscriptionPlan.findMany();
    console.log('Planes encontrados:', plans.length);
    console.log('Detalles de los planes:');
    plans.forEach((plan) => {
      console.log(`- ID: ${plan.id}`);
      console.log(`  Nombre: ${plan.name}`);
      console.log(`  Precio: $${plan.price} ${plan.currency}`);
      console.log(`  Límite de facturas: ${plan.invoiceLimit}`);
      console.log('---');
    });
  } catch (error) {
    console.error('Error al consultar planes:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
