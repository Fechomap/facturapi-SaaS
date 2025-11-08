/**
 * Script de Testing: Fix N+1 en incrementInvoiceCountBy
 * Verifica que el contador se incrementa atómicamente sin bucle
 */

import { prisma } from '../src/config/database.js';
import TenantService from '../src/core/tenant/tenant.service.js';

async function testN1Fix() {
  console.log('🧪 Testing Fix N+1 en incrementInvoiceCountBy...\n');

  const testTenantId = '00000000-0000-0000-0000-000000000001'; // UUID de prueba
  let subscriptionId: number | null = null;

  try {
    // PASO 1: Buscar plan de suscripción existente
    const plan = await prisma.subscriptionPlan.findFirst({
      where: { isActive: true },
    });

    if (!plan) {
      console.error('❌ No se encontró un plan de suscripción activo');
      console.log('   Crea un plan primero en la BD');
      return;
    }

    console.log('✅ Plan encontrado:', plan.name);

    // PASO 2: Buscar o crear tenant de prueba
    let tenant = await prisma.tenant.findUnique({
      where: { id: testTenantId },
    });

    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          id: testTenantId,
          businessName: 'Test N+1 Fix',
          rfc: 'TEST000000XXX',
          email: 'test@example.com',
        },
      });
      console.log('✅ Tenant de prueba creado');
    } else {
      console.log('✅ Tenant de prueba ya existe');
    }

    // PASO 3: Crear suscripción de prueba
    const subscription = await prisma.tenantSubscription.create({
      data: {
        tenantId: testTenantId,
        planId: plan.id,
        status: 'trial',
        invoicesUsed: 0,
      },
    });

    subscriptionId = subscription.id;
    console.log('✅ Suscripción creada, invoicesUsed inicial:', subscription.invoicesUsed);

    // PASO 4: Test de rendimiento - Incrementar por 100
    console.log('\n⏱️  Midiendo rendimiento...');
    const startTime = Date.now();

    // Llamar a la función privada (usando type assertion para testing)
    await (TenantService as any).incrementInvoiceCountBy(testTenantId, 100);

    const duration = Date.now() - startTime;

    // PASO 5: Verificar resultado
    const updated = await prisma.tenantSubscription.findUnique({
      where: { id: subscription.id },
    });

    console.log('\n📊 Resultados del Test:');
    console.log('─'.repeat(60));
    console.log('   Incremento solicitado: 100');
    console.log('   Invoices usado antes:', subscription.invoicesUsed);
    console.log('   Invoices usado después:', updated?.invoicesUsed);
    console.log('   Incremento correcto:', updated?.invoicesUsed === 100 ? '✅ SÍ' : '❌ NO');
    console.log('   Tiempo de ejecución:', duration, 'ms');
    console.log('─'.repeat(60));

    // PASO 6: Evaluación del rendimiento
    console.log('\n📈 Evaluación de Rendimiento:');

    if (duration < 50) {
      console.log('   🚀 EXCELENTE: <50ms (optimización atómica funcionando)');
    } else if (duration < 200) {
      console.log('   ✅ BUENO: <200ms (aceptable para incremento de 100)');
    } else if (duration < 1000) {
      console.log('   ⚠️  MEDIO: <1s (puede haber margen de mejora)');
    } else {
      console.log('   ❌ MALO: >1s (posible problema N+1 persistente)');
    }

    // Cálculo teórico
    const queriesAnteriores = 100 * 2; // 100 iteraciones x (1 SELECT + 1 UPDATE)
    const queriesActuales = 2; // 1 SELECT + 1 UPDATE atómico
    const mejora = (queriesAnteriores / queriesActuales).toFixed(0);

    console.log('\n💡 Análisis:');
    console.log(`   ANTES: ~${queriesAnteriores} queries (problema N+1)`);
    console.log(`   DESPUÉS: ~${queriesActuales} queries (atómico)`);
    console.log(`   Mejora: ${mejora}x más rápido`);

    if (updated?.invoicesUsed === 100 && duration < 200) {
      console.log('\n✅ FASE PRE-1 EXITOSA: Fix N+1 funcionando correctamente\n');
    } else {
      console.log('\n⚠️  ADVERTENCIA: Revisar implementación\n');
    }

  } catch (error) {
    console.error('\n❌ ERROR en test:', error);
    throw error;
  } finally {
    // PASO 7: Limpieza
    if (subscriptionId) {
      try {
        await prisma.tenantSubscription.delete({
          where: { id: subscriptionId },
        });
        console.log('🧹 Suscripción de prueba eliminada');
      } catch (cleanupError) {
        console.warn('⚠️  No se pudo eliminar suscripción de prueba');
      }
    }

    await prisma.$disconnect();
  }
}

testN1Fix();
