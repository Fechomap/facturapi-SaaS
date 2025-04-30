// scripts/update-plan-price.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// ID del precio de Stripe que queremos asignar al plan
const STRIPE_PRICE_ID = 'price_1RE0sy08NU3gw60xfd2BivWP';

async function main() {
  try {
    console.log(`Actualizando plan con Stripe Price ID: ${STRIPE_PRICE_ID}...`);
    
    // Actualizar el plan con ID 1 (Basic Plan)
    const updatedPlan = await prisma.subscriptionPlan.update({
      where: { id: 1 },
      data: {
        stripePriceId: STRIPE_PRICE_ID
      }
    });
    
    console.log('Plan actualizado correctamente:');
    console.log(`- ID: ${updatedPlan.id}`);
    console.log(`  Nombre: ${updatedPlan.name}`);
    console.log(`  Stripe Price ID: ${updatedPlan.stripePriceId}`);
    
  } catch (error) {
    console.error('Error al actualizar el plan:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
