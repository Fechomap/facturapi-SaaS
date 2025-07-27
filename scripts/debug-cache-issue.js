#!/usr/bin/env node
// scripts/debug-cache-issue.js
// Debug el problema del cache de clientes

import reportCacheService from '../services/report-cache.service.js';

async function debugCacheIssue() {
  console.log('🔍 DEBUG: PROBLEMA DE CACHE DE CLIENTES');
  console.log('='.repeat(50));

  const tenantId = '3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb';

  try {
    // Verificar estado de conexión
    console.log('📊 Estado del cache service:');
    console.log(`   isConnected: ${reportCacheService.isConnected}`);
    console.log(`   client: ${reportCacheService.client ? 'exists' : 'null'}`);

    // Intentar obtener clientes del cache
    console.log('\n🔍 Intentando obtener clientes del cache...');
    const cachedCustomers = await reportCacheService.getCachedCustomers(tenantId);

    if (cachedCustomers) {
      console.log('✅ Cache devolvió datos:');
      console.log(`   Cantidad: ${cachedCustomers.customers?.length || 'N/A'}`);
      console.log(`   Timestamp: ${cachedCustomers.timestamp || 'N/A'}`);

      if (cachedCustomers.customers) {
        console.log('\n👥 Clientes en cache:');
        cachedCustomers.customers.forEach((customer, index) => {
          console.log(
            `   ${index + 1}. ${customer.legalName} (${customer._count?.invoices || 0} facturas)`
          );
        });
      }
    } else {
      console.log('❌ Cache devolvió null (correcto si Redis no conectado)');
    }

    // Verificar directamente el método interno
    console.log('\n🔍 Verificando conexión Redis directamente...');
    if (reportCacheService.client) {
      try {
        const isReady = reportCacheService.client.isReady;
        console.log(`   client.isReady: ${isReady}`);
      } catch (error) {
        console.log(`   Error verificando client: ${error.message}`);
      }
    }
  } catch (error) {
    console.error('❌ Error en debug:', error);
  }
}

debugCacheIssue();
