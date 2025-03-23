// scripts/update-invoice-counters.js
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import path from 'path';

// Inicializar Prisma
const prisma = new PrismaClient();

/**
 * Script para actualizar los contadores de facturas de todos los tenants
 * basado en el número real de facturas en la base de datos
 */
async function updateInvoiceCounters() {
  console.log('Iniciando actualización de contadores de facturas...');
  
  try {
    // Obtener todos los tenants
    const tenants = await prisma.tenant.findMany({
      select: {
        id: true,
        businessName: true
      }
    });
    
    console.log(`Se encontraron ${tenants.length} tenants para verificar`);
    
    // Para cada tenant, contar sus facturas y actualizar el contador
    for (const tenant of tenants) {
      // Contar facturas del tenant
      const facturaCount = await prisma.tenantInvoice.count({
        where: { tenantId: tenant.id }
      });
      
      console.log(`Tenant: ${tenant.businessName} (${tenant.id}) - Facturas encontradas: ${facturaCount}`);
      
      // Buscar la suscripción activa del tenant
      const subscription = await prisma.tenantSubscription.findFirst({
        where: {
          tenantId: tenant.id,
          OR: [
            { status: 'active' },
            { status: 'trial' }
          ]
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
      
      if (!subscription) {
        console.log(`No se encontró suscripción activa para tenant ${tenant.id}, buscando cualquier suscripción...`);
        
        // Buscar cualquier suscripción si no hay una activa
        const anySubscription = await prisma.tenantSubscription.findFirst({
          where: { tenantId: tenant.id },
          orderBy: { createdAt: 'desc' }
        });
        
        if (!anySubscription) {
          console.warn(`No se encontró ninguna suscripción para tenant ${tenant.id}. Creando una suscripción de prueba...`);
          
          // Buscar un plan por defecto (el primer plan activo)
          const defaultPlan = await prisma.subscriptionPlan.findFirst({
            where: { isActive: true }
          });
          
          if (!defaultPlan) {
            console.error(`No se encontró un plan activo para crear suscripción para tenant ${tenant.id}`);
            continue;
          }
          
          // Crear una suscripción de prueba
          const newSubscription = await prisma.tenantSubscription.create({
            data: {
              tenantId: tenant.id,
              planId: defaultPlan.id,
              status: 'trial',
              invoicesUsed: facturaCount,
              currentPeriodStartsAt: new Date(),
              currentPeriodEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 14 días
            }
          });
          
          console.log(`Suscripción de prueba creada para tenant ${tenant.id} con ${facturaCount} facturas`);
          continue;
        }
        
        // Actualizar la suscripción existente
        const updated = await prisma.tenantSubscription.update({
          where: { id: anySubscription.id },
          data: { invoicesUsed: facturaCount }
        });
        
        console.log(`Contador actualizado para tenant ${tenant.id}: ${facturaCount} facturas`);
      } else {
        // Actualizar la suscripción activa
        const updated = await prisma.tenantSubscription.update({
          where: { id: subscription.id },
          data: { invoicesUsed: facturaCount }
        });
        
        console.log(`Contador actualizado para tenant ${tenant.id}: de ${subscription.invoicesUsed} a ${facturaCount} facturas`);
      }
    }
    
    console.log('Actualización de contadores completada exitosamente');
  } catch (error) {
    console.error('Error durante la actualización de contadores:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar la función principal
updateInvoiceCounters()
  .then(() => {
    console.log('Script finalizado');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
  });