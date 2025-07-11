import { performance } from 'perf_hooks';
import fs from 'fs';
import prisma from '../../lib/prisma.js';
import TenantService from '../../services/tenant.service.js';
import FacturapiService from '../../services/facturapi.service.js';
import SessionService from '../../core/auth/session.service.js';

const CHAT_ID = 7143094298; // Usuario de prueba
const ITERATIONS = 20; // Más iteraciones para mejor promedio

// Colores para output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bright: '\x1b[1m'
};

class PerformanceBenchmark {
  constructor(phase) {
    this.phase = phase; // 'BEFORE' o 'AFTER'
    this.results = [];
    this.startTime = new Date();
  }

  async measureOperation(name, operation) {
    const measurements = [];
    
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      try {
        await operation();
        const duration = performance.now() - start;
        measurements.push(duration);
      } catch (error) {
        console.error(`Error en ${name}:`, error.message);
        measurements.push(-1); // Marca error
      }
      
      // Pequeña pausa entre mediciones
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Calcular estadísticas
    const validMeasurements = measurements.filter(m => m >= 0);
    const stats = {
      operation: name,
      iterations: ITERATIONS,
      successful: validMeasurements.length,
      failed: measurements.filter(m => m < 0).length,
      min: Math.min(...validMeasurements),
      max: Math.max(...validMeasurements),
      avg: validMeasurements.reduce((a, b) => a + b, 0) / validMeasurements.length,
      median: this.getMedian(validMeasurements),
      p95: this.getPercentile(validMeasurements, 95),
      stdDev: this.getStdDev(validMeasurements)
    };
    
    this.results.push(stats);
    return stats;
  }

  getMedian(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  getPercentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[index];
  }

  getStdDev(arr) {
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(avgSquareDiff);
  }

  async runFullBenchmark() {
    console.log(`\n${colors.bright}=== BENCHMARK ${this.phase} OPTIMIZACIONES ===${colors.reset}`);
    console.log(`Fecha: ${this.startTime.toISOString()}`);
    console.log(`Iteraciones por operación: ${ITERATIONS}\n`);

    // Obtener datos necesarios
    const user = await prisma.tenantUser.findUnique({
      where: { telegramId: BigInt(CHAT_ID) },
      include: { tenant: true }
    });

    if (!user?.tenant) {
      console.error('Usuario sin tenant');
      return;
    }

    const tenantId = user.tenant.id;

    // 1. BENCHMARK: getNextFolio
    console.log(`${colors.yellow}Midiendo: getNextFolio${colors.reset}`);
    const folioStats = await this.measureOperation('getNextFolio', async () => {
      await TenantService.getNextFolio(tenantId, 'A');
    });
    this.printStats(folioStats);

    // 2. BENCHMARK: getUserState (cold y warm)
    console.log(`\n${colors.yellow}Midiendo: getUserState${colors.reset}`);
    
    // Cold (limpiar cache primero)
    await prisma.$executeRaw`DELETE FROM user_sessions WHERE telegram_id = ${BigInt(CHAT_ID)}`;
    const sessionColdStats = await this.measureOperation('getUserState_cold', async () => {
      await SessionService.getUserState(CHAT_ID);
    });
    this.printStats(sessionColdStats);

    // Warm (con cache)
    const sessionWarmStats = await this.measureOperation('getUserState_warm', async () => {
      await SessionService.getUserState(CHAT_ID);
    });
    this.printStats(sessionWarmStats);

    // 3. BENCHMARK: getFacturapiClient
    console.log(`\n${colors.yellow}Midiendo: getFacturapiClient${colors.reset}`);
    const facturapiStats = await this.measureOperation('getFacturapiClient', async () => {
      await FacturapiService.getFacturapiClient(tenantId);
    });
    this.printStats(facturapiStats);

    // 4. BENCHMARK: findCustomer
    console.log(`\n${colors.yellow}Midiendo: findCustomer${colors.reset}`);
    const customerStats = await this.measureOperation('findCustomer', async () => {
      await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          legalName: { contains: 'CHUBB', mode: 'insensitive' }
        }
      });
    });
    this.printStats(customerStats);

    // 5. BENCHMARK: incrementInvoiceCount
    console.log(`\n${colors.yellow}Midiendo: incrementInvoiceCount${colors.reset}`);
    const incrementStats = await this.measureOperation('incrementInvoiceCount', async () => {
      await TenantService.incrementInvoiceCount(tenantId);
    });
    this.printStats(incrementStats);

    // Guardar resultados
    this.saveResults();
    
    // Mostrar resumen
    this.printSummary();
  }

  printStats(stats) {
    console.log(`  Promedio: ${colors.bright}${stats.avg.toFixed(2)}ms${colors.reset}`);
    console.log(`  Min/Max: ${stats.min.toFixed(2)}ms / ${stats.max.toFixed(2)}ms`);
    console.log(`  Mediana: ${stats.median.toFixed(2)}ms`);
    console.log(`  P95: ${stats.p95.toFixed(2)}ms`);
    console.log(`  Desv.Est: ${stats.stdDev.toFixed(2)}ms`);
    console.log(`  Éxito: ${stats.successful}/${stats.iterations}`);
  }

  saveResults() {
    const filename = `benchmark-results-${this.phase.toLowerCase()}-${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify({
      phase: this.phase,
      timestamp: this.startTime,
      environment: process.env.NODE_ENV || 'development',
      results: this.results
    }, null, 2));
    console.log(`\n✅ Resultados guardados en: ${filename}`);
  }

  printSummary() {
    console.log(`\n${colors.bright}=== RESUMEN ${this.phase} ===${colors.reset}`);
    console.log('\nOperación              | Promedio  | Min      | Max      | P95');
    console.log('-----------------------|-----------|----------|----------|----------');
    
    let totalAvg = 0;
    this.results.forEach(stat => {
      console.log(
        `${stat.operation.padEnd(22)} | ` +
        `${stat.avg.toFixed(2).padStart(9)}ms | ` +
        `${stat.min.toFixed(2).padStart(8)}ms | ` +
        `${stat.max.toFixed(2).padStart(8)}ms | ` +
        `${stat.p95.toFixed(2).padStart(8)}ms`
      );
      totalAvg += stat.avg;
    });
    
    console.log('-----------------------|-----------|----------|----------|----------');
    console.log(`${colors.bright}TOTAL${colors.reset}                  | ${colors.bright}${totalAvg.toFixed(2).padStart(9)}ms${colors.reset}`);
  }
}

// Función para comparar resultados
async function compareResults() {
  // Buscar archivos de resultados
  const files = fs.readdirSync('.').filter(f => f.startsWith('benchmark-results-'));
  const beforeFiles = files.filter(f => f.includes('before'));
  const afterFiles = files.filter(f => f.includes('after'));

  if (beforeFiles.length === 0 || afterFiles.length === 0) {
    console.log('⚠️ No hay suficientes archivos para comparar');
    console.log('Ejecuta primero con --before y luego con --after');
    return;
  }

  // Tomar los más recientes
  const beforeFile = beforeFiles.sort().pop();
  const afterFile = afterFiles.sort().pop();

  const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
  const after = JSON.parse(fs.readFileSync(afterFile, 'utf8'));

  console.log(`\n${colors.bright}=== COMPARACIÓN ANTES vs DESPUÉS ===${colors.reset}`);
  console.log(`Before: ${beforeFile}`);
  console.log(`After: ${afterFile}\n`);

  console.log('Operación              | Antes     | Después  | Mejora   | %');
  console.log('-----------------------|-----------|----------|----------|------');

  const improvements = [];

  // Comparar cada operación
  before.results.forEach(beforeStat => {
    const afterStat = after.results.find(a => a.operation === beforeStat.operation);
    if (afterStat) {
      const improvement = beforeStat.avg - afterStat.avg;
      const improvementPct = (improvement / beforeStat.avg) * 100;
      
      improvements.push({
        operation: beforeStat.operation,
        before: beforeStat.avg,
        after: afterStat.avg,
        improvement,
        improvementPct
      });

      const color = improvementPct > 0 ? colors.green : colors.red;
      console.log(
        `${beforeStat.operation.padEnd(22)} | ` +
        `${beforeStat.avg.toFixed(2).padStart(9)}ms | ` +
        `${afterStat.avg.toFixed(2).padStart(8)}ms | ` +
        `${color}${improvement > 0 ? '-' : '+'}${Math.abs(improvement).toFixed(2).padStart(7)}ms${colors.reset} | ` +
        `${color}${improvementPct.toFixed(1).padStart(4)}%${colors.reset}`
      );
    }
  });

  // Total
  const totalBefore = before.results.reduce((sum, r) => sum + r.avg, 0);
  const totalAfter = after.results.reduce((sum, r) => sum + r.avg, 0);
  const totalImprovement = totalBefore - totalAfter;
  const totalImprovementPct = (totalImprovement / totalBefore) * 100;

  console.log('-----------------------|-----------|----------|----------|------');
  const totalColor = totalImprovementPct > 0 ? colors.green : colors.red;
  console.log(
    `${colors.bright}TOTAL${colors.reset}                  | ` +
    `${colors.bright}${totalBefore.toFixed(2).padStart(9)}ms${colors.reset} | ` +
    `${colors.bright}${totalAfter.toFixed(2).padStart(8)}ms${colors.reset} | ` +
    `${totalColor}${totalImprovement > 0 ? '-' : '+'}${Math.abs(totalImprovement).toFixed(2).padStart(7)}ms${colors.reset} | ` +
    `${totalColor}${totalImprovementPct.toFixed(1).padStart(4)}%${colors.reset}`
  );

  // Guardar comparación
  const comparisonFile = `benchmark-comparison-${Date.now()}.json`;
  fs.writeFileSync(comparisonFile, JSON.stringify({
    timestamp: new Date(),
    before: beforeFile,
    after: afterFile,
    improvements,
    totalImprovement: {
      before: totalBefore,
      after: totalAfter,
      improvement: totalImprovement,
      improvementPct: totalImprovementPct
    }
  }, null, 2));

  console.log(`\n✅ Comparación guardada en: ${comparisonFile}`);
}

// Main
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--compare')) {
    await compareResults();
  } else if (args.includes('--before')) {
    const benchmark = new PerformanceBenchmark('BEFORE');
    await benchmark.runFullBenchmark();
  } else if (args.includes('--after')) {
    const benchmark = new PerformanceBenchmark('AFTER');
    await benchmark.runFullBenchmark();
  } else {
    console.log(`
${colors.bright}USO:${colors.reset}
  node benchmark-before-after.js --before    # Ejecutar ANTES de optimizaciones
  node benchmark-before-after.js --after     # Ejecutar DESPUÉS de optimizaciones  
  node benchmark-before-after.js --compare   # Comparar resultados

${colors.bright}PASOS:${colors.reset}
  1. Ejecuta con --before
  2. Implementa las optimizaciones
  3. Ejecuta con --after
  4. Ejecuta con --compare para ver mejoras
    `);
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);