import { performance } from 'perf_hooks';
import dotenv from 'dotenv';
dotenv.config();

import prisma from '../lib/prisma.js';
import TenantService from '../services/tenant.service.js';
import FacturapiService from '../services/facturapi.service.js';
import SessionService from '../core/auth/session.service.js';

const CHAT_ID = 7143094298;

async function measureOperation(name, fn) {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - start;
    return { name, duration, success: true, result };
  } catch (error) {
    const duration = performance.now() - start;
    return { name, duration, success: false, error: error.message };
  }
}

async function runDiagnostics() {
  console.log('🔍 DIAGNÓSTICO DE CUELLOS DE BOTELLA\n');
  
  const measurements = [];
  
  // 1. Obtener usuario y tenant
  const user = await prisma.tenantUser.findUnique({
    where: { telegramId: BigInt(CHAT_ID) },
    include: { tenant: true }
  });
  
  if (!user?.tenant) {
    console.error('❌ Usuario sin tenant');
    return;
  }
  
  const tenantId = user.tenant.id;
  console.log(`✅ Tenant: ${user.tenant.businessName}\n`);
  
  // MEDICIÓN 1: Sesión completa
  console.log('📊 Midiendo operaciones de sesión...');
  measurements.push(
    await measureOperation('getUserState (cold)', 
      () => SessionService.getUserState(CHAT_ID))
  );
  
  measurements.push(
    await measureOperation('getUserState (warm)', 
      () => SessionService.getUserState(CHAT_ID))
  );
  
  measurements.push(
    await measureOperation('saveUserState', 
      () => SessionService.saveUserState(CHAT_ID, { test: Date.now() }))
  );
  
  // MEDICIÓN 2: getNextFolio (el problema principal)
  console.log('\n📊 Midiendo getNextFolio...');
  for (let i = 0; i < 5; i++) {
    measurements.push(
      await measureOperation(`getNextFolio #${i+1}`, 
        () => TenantService.getNextFolio(tenantId, 'A'))
    );
  }
  
  // MEDICIÓN 3: Cliente FacturAPI
  console.log('\n📊 Midiendo FacturAPI client...');
  measurements.push(
    await measureOperation('getFacturapiClient (cold)', 
      () => FacturapiService.getFacturapiClient(tenantId))
  );
  
  measurements.push(
    await measureOperation('getFacturapiClient (warm)', 
      () => FacturapiService.getFacturapiClient(tenantId))
  );
  
  // MEDICIÓN 4: Búsquedas en DB
  console.log('\n📊 Midiendo búsquedas en DB...');
  measurements.push(
    await measureOperation('findCustomer (CHUBB)', 
      () => prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          legalName: { contains: 'CHUBB' }
        }
      }))
  );
  
  measurements.push(
    await measureOperation('findCustomer (not exists)', 
      () => prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          legalName: { contains: 'NO_EXISTE_XXXXX' }
        }
      }))
  );
  
  // MEDICIÓN 5: Incrementar contador
  console.log('\n📊 Midiendo incrementInvoiceCount...');
  measurements.push(
    await measureOperation('incrementInvoiceCount', 
      () => TenantService.incrementInvoiceCount(tenantId))
  );
  
  // RESULTADOS
  console.log('\n\n📈 RESULTADOS:\n');
  console.log('Operación                          | Tiempo (ms) | Estado');
  console.log('-----------------------------------|-------------|--------');
  
  measurements.forEach(m => {
    const status = m.success ? '✅' : '❌';
    const time = m.duration.toFixed(2).padStart(11);
    const name = m.name.padEnd(34);
    console.log(`${name} | ${time} | ${status}`);
  });
  
  // Análisis de getNextFolio
  const folioMeasurements = measurements.filter(m => m.name.includes('getNextFolio'));
  const folioAvg = folioMeasurements.reduce((sum, m) => sum + m.duration, 0) / folioMeasurements.length;
  
  console.log('\n🎯 ANÁLISIS DE getNextFolio:');
  console.log(`   Promedio: ${folioAvg.toFixed(2)}ms`);
  console.log(`   Min: ${Math.min(...folioMeasurements.map(m => m.duration)).toFixed(2)}ms`);
  console.log(`   Max: ${Math.max(...folioMeasurements.map(m => m.duration)).toFixed(2)}ms`);
  
  // Comparación de tiempos
  const sessionCold = measurements.find(m => m.name === 'getUserState (cold)')?.duration || 0;
  const sessionWarm = measurements.find(m => m.name === 'getUserState (warm)')?.duration || 0;
  const facturApiCold = measurements.find(m => m.name === 'getFacturapiClient (cold)')?.duration || 0;
  const facturApiWarm = measurements.find(m => m.name === 'getFacturapiClient (warm)')?.duration || 0;
  
  console.log('\n🔥 IMPACTO DEL CACHE:');
  console.log(`   Sesión: ${sessionCold.toFixed(2)}ms → ${sessionWarm.toFixed(2)}ms (${((1 - sessionWarm/sessionCold) * 100).toFixed(1)}% mejora)`);
  console.log(`   FacturAPI: ${facturApiCold.toFixed(2)}ms → ${facturApiWarm.toFixed(2)}ms (${((1 - facturApiWarm/facturApiCold) * 100).toFixed(1)}% mejora)`);
  
  // Tiempo total estimado
  const totalTime = folioAvg + sessionCold + facturApiCold + 4000; // 4000ms es la llamada a FacturAPI
  console.log('\n⏱️ TIEMPO TOTAL ESTIMADO:');
  console.log(`   Bot actual: ~${totalTime.toFixed(0)}ms`);
  console.log(`   CURL directo: ~4000ms`);
  console.log(`   Overhead: ~${(totalTime - 4000).toFixed(0)}ms`);
  
  await prisma.$disconnect();
}

runDiagnostics().catch(console.error);