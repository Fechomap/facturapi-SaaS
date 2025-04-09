// Import the Prisma client
import { PrismaClient } from '@prisma/client';

// Initialize Prisma Client
const prisma = new PrismaClient();

async function main() {
  try {
    // Create a new tenant
    const tenant = await prisma.tenant.create({
      data: {
        businessName: 'Test Business',
        rfc: 'RFC123456789',
        email: 'test@example.com',
      },
    });

    console.log('Tenant created:', tenant);

    // Create a new subscription plan
    const plan = await prisma.subscriptionPlan.create({
      data: {
        name: 'Basic Plan',
        description: 'Basic subscription plan',
        price: 299,
        currency: 'MXN',
        billingPeriod: 'monthly',
        invoiceLimit: 100,
        isActive: true,
      },
    });

    console.log('Subscription plan created:', plan);

    // Create a new tenant subscription
    const subscription = await prisma.tenantSubscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: 'trial',
        trialEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
      },
    });

    console.log('Tenant subscription created:', subscription);
  } catch (error) {
    console.error('Error creating tenant, subscription plan, or tenant subscription:', error);
  } finally {
    // Disconnect Prisma Client
    await prisma.$disconnect();
  }
}

main();
