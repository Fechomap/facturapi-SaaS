#!/usr/bin/env node
// scripts/run-repair-test.js
// Ejecutar reparación paso a paso

import SimpleOrphanRepair from './repair-orphans-simple.js';

async function runTest() {
  console.log('🧪 EJECUTANDO REPARACIÓN DE PRUEBA');
  console.log('='.repeat(50));

  try {
    const repair = new SimpleOrphanRepair({ dryRun: true });
    const result = await repair.execute();

    console.log('\n✅ PRUEBA COMPLETADA EXITOSAMENTE');
    console.log('📊 Resultados:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ ERROR EN PRUEBA:', error.message);
    console.error(error.stack);
  }
}

runTest();
