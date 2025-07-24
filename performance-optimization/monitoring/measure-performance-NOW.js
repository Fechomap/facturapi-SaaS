#!/usr/bin/env node
// scripts/performance/measure-performance-NOW.js
// Medir performance DESPUÉS de optimizaciones

import { performance } from 'perf_hooks';
import prisma from '../../lib/prisma.js';
import logger from '../../core/utils/logger.js';

const perfLogger = logger.child({ module: 'performance-measurement' });

class PerformanceMeasurement {
  async measureDatabaseQueries() {
    perfLogger.info('📊 Midiendo performance de consultas de BD...');

    const measurements = {};

    try {
      // 1. Consulta de facturas con paginación (OPTIMIZADA)
      const start1 = performance.now();
      const invoices = await prisma.tenant_invoices.findMany({
        where: { tenant_id: { not: null } },
        include: { tenant_customers: true },
        take: 50,
        skip: 0,
        orderBy: { created_at: 'desc' },
      });
      const end1 = performance.now();
      measurements.invoicePagination = end1 - start1;

      // 2. Búsqueda de cliente por nombre (NUEVO ÍNDICE)
      const start2 = performance.now();
      const customers = await prisma.tenant_customers.findMany({
        where: {
          tenant_id: { not: null },
          legal_name: { contains: 'test', mode: 'insensitive' },
        },
        take: 20,
      });
      const end2 = performance.now();
      measurements.customerSearch = end2 - start2;

      // 3. Filtrado por status (NUEVO ÍNDICE)
      const start3 = performance.now();
      const statusFilter = await prisma.tenant_invoices.findMany({
        where: {
          tenant_id: { not: null },
          status: 'draft',
        },
        take: 30,
      });
      const end3 = performance.now();
      measurements.statusFilter = end3 - start3;

      // 4. Consulta de suscripciones (NUEVO ÍNDICE)
      const start4 = performance.now();
      const subscriptions = await prisma.tenant_subscriptions.findMany({
        where: { tenant_id: { not: null } },
        orderBy: { created_at: 'desc' },
        take: 20,
      });
      const end4 = performance.now();
      measurements.subscriptionQuery = end4 - start4;

      // 5. Estadísticas en paralelo (OPTIMIZADA)
      const start5 = performance.now();
      const [userCount, tenantCount, invoiceCount] = await Promise.all([
        prisma.users.count(),
        prisma.tenants.count(),
        prisma.tenant_invoices.count(),
      ]);
      const end5 = performance.now();
      measurements.parallelStats = end5 - start5;

      return measurements;
    } catch (error) {
      perfLogger.error('❌ Error midiendo BD:', error.message);
      return {};
    }
  }

  async testEventLoopBlocking() {
    perfLogger.info('🔄 Midiendo Event Loop lag...');

    const start = performance.now();

    // Simular operación que antes bloqueaba
    await new Promise((resolve) => {
      setImmediate(() => {
        const end = performance.now();
        resolve(end - start);
      });
    });

    const lag = performance.now() - start;
    return { eventLoopLag: lag };
  }

  async measureMemoryUsage() {
    perfLogger.info('💾 Midiendo uso de memoria...');

    const memoryBefore = process.memoryUsage();

    // Simular operación de paginación grande
    const invoices = await prisma.tenant_invoices.findMany({
      take: 100,
      skip: 0,
      include: { tenant_customers: true },
    });

    const memoryAfter = process.memoryUsage();

    return {
      heapUsedMB: Math.round((memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024),
      totalMemoryMB: Math.round(memoryAfter.heapUsed / 1024 / 1024),
      recordsLoaded: invoices.length,
    };
  }

  async runFullPerformanceTest() {
    try {
      perfLogger.info('🚀 INICIANDO MEDICIÓN COMPLETA DE PERFORMANCE');
      perfLogger.info('=============================================');

      const results = {
        timestamp: new Date().toISOString(),
        testType: 'POST_OPTIMIZATION',
      };

      // 1. Medir consultas de BD
      const dbPerf = await this.measureDatabaseQueries();
      results.database = dbPerf;

      // 2. Medir Event Loop
      const eventLoop = await this.testEventLoopBlocking();
      results.eventLoop = eventLoop;

      // 3. Medir memoria
      const memory = await this.measureMemoryUsage();
      results.memory = memory;

      // 4. Información del sistema
      results.system = {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: process.uptime(),
      };

      // 5. Mostrar resultados
      this.displayResults(results);

      // 6. Guardar resultados
      await this.saveResults(results);

      return results;
    } catch (error) {
      perfLogger.error('💥 Error en test de performance:', error.message);
      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }

  displayResults(results) {
    console.log('\n📊 RESULTADOS DE PERFORMANCE (POST-OPTIMIZACIÓN)');
    console.log('================================================');

    console.log('\n🗄️ CONSULTAS DE BASE DE DATOS:');
    if (results.database.invoicePagination) {
      console.log(`  📄 Paginación facturas: ${results.database.invoicePagination.toFixed(2)}ms`);
    }
    if (results.database.customerSearch) {
      console.log(`  👤 Búsqueda clientes: ${results.database.customerSearch.toFixed(2)}ms`);
    }
    if (results.database.statusFilter) {
      console.log(`  🔍 Filtro por status: ${results.database.statusFilter.toFixed(2)}ms`);
    }
    if (results.database.subscriptionQuery) {
      console.log(
        `  💳 Consulta suscripciones: ${results.database.subscriptionQuery.toFixed(2)}ms`
      );
    }
    if (results.database.parallelStats) {
      console.log(`  📊 Estadísticas paralelas: ${results.database.parallelStats.toFixed(2)}ms`);
    }

    console.log('\n🔄 EVENT LOOP:');
    console.log(`  ⚡ Lag del Event Loop: ${results.eventLoop.eventLoopLag.toFixed(2)}ms`);

    console.log('\n💾 MEMORIA:');
    console.log(`  🔢 Registros cargados: ${results.memory.recordsLoaded}`);
    console.log(`  📈 Memoria usada: ${results.memory.heapUsedMB}MB`);
    console.log(`  💾 Memoria total: ${results.memory.totalMemoryMB}MB`);

    console.log('\n✅ EVALUACIÓN:');

    // Evaluación automática
    const evaluations = [];

    if (results.database.invoicePagination < 500) {
      evaluations.push('✅ Paginación: EXCELENTE (< 500ms)');
    } else if (results.database.invoicePagination < 1000) {
      evaluations.push('⚠️ Paginación: BUENA (< 1s)');
    } else {
      evaluations.push('❌ Paginación: NECESITA MEJORA (> 1s)');
    }

    if (results.database.customerSearch < 300) {
      evaluations.push('✅ Búsqueda: EXCELENTE (< 300ms)');
    } else {
      evaluations.push('⚠️ Búsqueda: MEJORABLE');
    }

    if (results.eventLoop.eventLoopLag < 10) {
      evaluations.push('✅ Event Loop: SIN BLOQUEOS');
    } else {
      evaluations.push('⚠️ Event Loop: CON RETRASOS');
    }

    if (results.memory.heapUsedMB < 50) {
      evaluations.push('✅ Memoria: USO EFICIENTE');
    } else {
      evaluations.push('⚠️ Memoria: USO ALTO');
    }

    evaluations.forEach((evaluation) => console.log(`  ${evaluation}`));
  }

  async saveResults(results) {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      const resultsDir = path.join(process.cwd(), 'performance-results');
      await fs.mkdir(resultsDir, { recursive: true });

      const filename = `performance_${results.timestamp.substring(0, 19).replace(/[:.]/g, '-')}.json`;
      const filepath = path.join(resultsDir, filename);

      await fs.writeFile(filepath, JSON.stringify(results, null, 2));
      console.log(`\n💾 Resultados guardados en: ${filepath}`);
    } catch (error) {
      perfLogger.error('❌ Error guardando resultados:', error.message);
    }
  }
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  const measurement = new PerformanceMeasurement();

  measurement
    .runFullPerformanceTest()
    .then(() => {
      console.log('\n🎉 MEDICIÓN COMPLETADA');
      console.log('📋 Compara estos resultados con los anteriores para validar mejoras');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error en medición:', error.message);
      process.exit(1);
    });
}

export default PerformanceMeasurement;
