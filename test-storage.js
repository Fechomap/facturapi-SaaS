// test-storage.js
import fs from 'fs';
import path from 'path';
import StorageService from './core/storage/storage.service.js'; // Ruta corregida

(async () => {
  const tenantId = 'test-tenant-001';
  const tipoDocumento = 'PDF';
  const fechaFactura = new Date('2025-03-21');
  const year = fechaFactura.getFullYear();
  const month = String(fechaFactura.getMonth() + 1).padStart(2, '0');

  await StorageService.ensureTenantDirectories(tenantId);

  const dirEsperado = path.join(
    './storage',
    `tenant-${tenantId}`,
    'invoices',
    tipoDocumento.toLowerCase(),
    year.toString(),
    month
  );

  if (!fs.existsSync(dirEsperado)) {
    await fs.promises.mkdir(dirEsperado, { recursive: true });
    console.log(`✅ Directorio creado correctamente: ${dirEsperado}`);
  } else {
    console.log(`🔵 El directorio ya existía previamente: ${dirEsperado}`);
  }

  const existe = fs.existsSync(dirEsperado);
  if (existe) {
    console.log('🎉 TEST APROBADO: La estructura está correcta.');
  } else {
    console.log('🚨 TEST FALLIDO: No se creó la estructura correctamente.');
  }

})();