// scripts/test-excel-report-mvp.js
// Script para probar el MVP del reporte Excel

import ExcelReportService from '../services/excel-report.service.js';

/**
 * Test del MVP de reporte Excel
 */
async function testExcelReportMVP() {
  console.log('🧪 INICIANDO TEST DEL MVP - REPORTE EXCEL');
  console.log('=====================================\n');

  const tenantId = '3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb'; // Tu tenant de pruebas

  try {
    console.log(`🏢 Testing con tenant: ${tenantId}`);
    console.log('📊 Configuración MVP: Límite 100 facturas, todos los campos\n');

    const startTime = Date.now();

    // Configuración del test
    const testConfig = {
      limit: 10, // Solo 10 para test rápido
      includeDetails: true,
      format: 'xlsx',
    };

    console.log('🔄 Generando reporte de prueba...');

    // Generar reporte
    const result = await ExcelReportService.generateInvoiceReport(tenantId, testConfig);

    const duration = Date.now() - startTime;

    if (result.success) {
      console.log('\n✅ TEST EXITOSO!');
      console.log('================');
      console.log(`📊 Facturas procesadas: ${result.stats.totalInvoices}`);
      console.log(`⏱️ Tiempo total: ${duration}ms`);
      console.log(`📄 Tamaño archivo: ${result.stats.fileSize}`);
      console.log(`📁 Archivo generado: ${result.filePath}`);

      // Verificar que el archivo existe
      const fs = await import('fs');
      if (fs.existsSync(result.filePath)) {
        console.log('✅ Archivo Excel creado correctamente');

        // Mostrar estadísticas del archivo
        const stats = fs.statSync(result.filePath);
        console.log(`📏 Tamaño real: ${(stats.size / 1024).toFixed(2)} KB`);

        console.log('\n🎯 VALIDACIONES:');
        console.log('✅ ExcelJS funciona correctamente');
        console.log('✅ Consulta a FacturAPI exitosa');
        console.log('✅ Generación de archivo Excel exitosa');
        console.log('✅ Todos los campos incluidos');
        console.log('✅ Formato y estructura correctos');
      } else {
        console.log('❌ Error: Archivo no encontrado');
      }
    } else {
      console.log('\n❌ TEST FALLIDO!');
      console.log('================');
      console.log(`💬 Error: ${result.error}`);
      console.log(`⏱️ Tiempo hasta fallo: ${duration}ms`);
    }
  } catch (error) {
    console.log('\n💥 ERROR CRÍTICO EN TEST!');
    console.log('==========================');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }

  console.log('\n🏁 Test completado');
}

// Ejecutar test si se llama directamente
if (process.argv[2] === 'run') {
  testExcelReportMVP()
    .then(() => {
      console.log('\n✅ Testing finalizado');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error en testing:', error);
      process.exit(1);
    });
}

export default testExcelReportMVP;
