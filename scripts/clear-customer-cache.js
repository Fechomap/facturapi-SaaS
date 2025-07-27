#!/usr/bin/env node
// scripts/clear-customer-cache.js
// Limpiar cache de clientes para que se actualice con AXA y CHUBB

import reportCacheService from '../services/report-cache.service.js';

async function clearCustomerCache() {
  const tenantId = '3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb';

  console.log('🗑️ LIMPIANDO CACHE DE CLIENTES');
  console.log('='.repeat(40));

  try {
    // Limpiar cache de clientes
    await reportCacheService.clearCachedCustomers(tenantId);
    console.log('✅ Cache de clientes limpiado exitosamente');

    // Verificar que se limpió
    const cachedCustomers = await reportCacheService.getCachedCustomers(tenantId);

    if (cachedCustomers) {
      console.log('⚠️ Cache aún contiene datos (no se limpió)');
      console.log('Datos en cache:', cachedCustomers);
    } else {
      console.log('✅ Cache verificado como vacío');
      console.log('💡 La próxima consulta recargará desde BD');
    }
  } catch (error) {
    console.error('❌ Error limpiando cache:', error);
  }
}

clearCustomerCache();
