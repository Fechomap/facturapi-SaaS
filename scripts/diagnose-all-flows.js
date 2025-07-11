import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import XLSX from 'xlsx';

// Cargar variables de entorno
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Importaciones de módulos reales
import prisma from '../lib/prisma.js';
import * as pdfAnalysisService from '../services/pdf-analysis.service.js';
import * as invoiceService from '../services/invoice.service.js';
import TenantService from '../services/tenant.service.js';
import * as facturapiService from '../services/facturapi.service.js';
import SessionService from '../core/auth/session.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colores para el output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Clase para medición detallada
class DetailedProfiler {
  constructor(name) {
    this.name = name;
    this.metrics = new Map();
    this.currentStack = [];
  }

  start(operation) {
    const metric = {
      operation,
      startTime: performance.now(),
      startMemory: process.memoryUsage(),
      subMetrics: []
    };
    
    this.currentStack.push(metric);
    return metric;
  }

  end(metric) {
    const endTime = performance.now();
    const endMemory = process.memoryUsage();
    
    metric.duration = endTime - metric.startTime;
    metric.memoryDelta = {
      heapUsed: (endMemory.heapUsed - metric.startMemory.heapUsed) / 1024 / 1024,
      external: (endMemory.external - metric.startMemory.external) / 1024 / 1024
    };
    
    // Remover del stack
    const index = this.currentStack.indexOf(metric);
    if (index > -1) {
      this.currentStack.splice(index, 1);
    }
    
    // Si tiene padre, agregarlo como sub-métrica
    if (this.currentStack.length > 0) {
      const parent = this.currentStack[this.currentStack.length - 1];
      parent.subMetrics.push(metric);
    } else {
      // Es métrica de nivel superior
      if (!this.metrics.has(metric.operation)) {
        this.metrics.set(metric.operation, []);
      }
      this.metrics.get(metric.operation).push(metric);
    }
    
    return metric.duration;
  }

  getStatistics() {
    const stats = {};
    
    this.metrics.forEach((measurements, operation) => {
      const durations = measurements.map(m => m.duration);
      const sorted = [...durations].sort((a, b) => a - b);
      
      stats[operation] = {
        count: durations.length,
        min: Math.min(...durations),
        max: Math.max(...durations),
        avg: durations.reduce((a, b) => a + b, 0) / durations.length,
        median: sorted[Math.floor(sorted.length / 2)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
        stdDev: this.calculateStdDev(durations),
        variance: this.calculateVariance(durations)
      };
    });
    
    return stats;
  }

  calculateVariance(values) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map(value => Math.pow(value - avg, 2));
    return squareDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  calculateStdDev(values) {
    return Math.sqrt(this.calculateVariance(values));
  }
}

// Simulador de flujos reales
class InvoiceFlowSimulator {
  constructor(chatId) {
    this.chatId = chatId;
    this.profiler = new DetailedProfiler('InvoiceFlow');
  }

  async warmup() {
    console.log(`${colors.yellow}🔥 Calentando conexiones...${colors.reset}`);
    
    // Calentar Prisma
    await prisma.$queryRaw`SELECT 1`;
    
    // Calentar sesión
    await SessionService.getUserState(this.chatId);
    
    // Calentar FacturAPI
    const user = await prisma.tenantUser.findUnique({
      where: { telegramId: BigInt(this.chatId) },
      include: { tenant: true }
    });
    
    if (user?.tenant) {
      try {
        await facturapiService.getFacturapiClient(user.tenant.id);
      } catch (e) {
        console.log(`${colors.yellow}⚠️ No se pudo calentar FacturAPI${colors.reset}`);
      }
    }
  }

  async simulatePDFFlow() {
    const flowMetric = this.profiler.start('PDF_FLOW_COMPLETE');
    
    try {
      // 1. Cargar sesión y tenant
      const sessionMetric = this.profiler.start('1_SESSION_LOAD');
      const userState = await SessionService.getUserState(this.chatId);
      const user = await prisma.tenantUser.findUnique({
        where: { telegramId: BigInt(this.chatId) },
        include: { tenant: true }
      });
      this.profiler.end(sessionMetric);
      
      if (!user?.tenant) {
        throw new Error('Usuario sin tenant');
      }
      
      // 2. Procesar PDF
      const pdfMetric = this.profiler.start('2_PDF_PROCESSING');
      
      // 2.1 Leer archivo
      const readMetric = this.profiler.start('2.1_READ_FILE');
      const pdfPath = path.join(__dirname, '..', 'test', 'data', 'sample.pdf');
      const pdfBuffer = fs.readFileSync(pdfPath);
      this.profiler.end(readMetric);
      
      // 2.2 Extraer datos
      const extractMetric = this.profiler.start('2.2_EXTRACT_DATA');
      const extractedData = {
        rfc: 'XAXX010101000',
        clientName: 'Cliente Prueba',
        orderNumber: `TEST-${Date.now()}`,
        amount: 1000 + Math.random() * 5000
      };
      this.profiler.end(extractMetric);
      
      this.profiler.end(pdfMetric);
      
      // 3. Buscar cliente
      const clientMetric = this.profiler.start('3_CLIENT_SEARCH');
      
      // 3.1 BD Local
      const localSearchMetric = this.profiler.start('3.1_LOCAL_DB_SEARCH');
      const localClient = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId: user.tenant.id,
          legalName: { contains: 'CHUBB' }
        }
      });
      this.profiler.end(localSearchMetric);
      
      if (!localClient) {
        // 3.2 FacturAPI
        const apiSearchMetric = this.profiler.start('3.2_FACTURAPI_SEARCH');
        const facturapi = await facturapiService.getFacturapiClient(user.tenant.id);
        // Simular búsqueda
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 500));
        this.profiler.end(apiSearchMetric);
      }
      
      this.profiler.end(clientMetric);
      
      // 4. Obtener folio
      const folioMetric = this.profiler.start('4_GET_FOLIO');
      const folio = await TenantService.getNextFolio(user.tenant.id, 'A');
      this.profiler.end(folioMetric);
      
      // 5. Crear factura (simulado)
      const invoiceMetric = this.profiler.start('5_CREATE_INVOICE');
      
      // 5.1 Verificar retención
      const retentionMetric = this.profiler.start('5.1_CHECK_RETENTION');
      // Simular verificación
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 150));
      this.profiler.end(retentionMetric);
      
      // 5.2 Llamada a FacturAPI (simulada)
      const apiCallMetric = this.profiler.start('5.2_FACTURAPI_CREATE');
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000));
      this.profiler.end(apiCallMetric);
      
      this.profiler.end(invoiceMetric);
      
      // 6. Post-procesamiento
      const postMetric = this.profiler.start('6_POST_PROCESSING');
      
      // 6.1 Registrar en DB
      const registerMetric = this.profiler.start('6.1_REGISTER_DB');
      // Simular registro
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
      this.profiler.end(registerMetric);
      
      // 6.2 Actualizar contador
      const counterMetric = this.profiler.start('6.2_UPDATE_COUNTER');
      await TenantService.incrementInvoiceCount(user.tenant.id);
      this.profiler.end(counterMetric);
      
      // 6.3 Guardar sesión
      const saveSessionMetric = this.profiler.start('6.3_SAVE_SESSION');
      await SessionService.saveUserState(this.chatId, {
        ...userState,
        lastInvoice: `test-${Date.now()}`
      });
      this.profiler.end(saveSessionMetric);
      
      this.profiler.end(postMetric);
      
    } catch (error) {
      console.error(`${colors.red}Error en flujo PDF:${colors.reset}`, error.message);
    } finally {
      this.profiler.end(flowMetric);
    }
  }

  async simulateCHUBBFlow() {
    const flowMetric = this.profiler.start('CHUBB_FLOW_COMPLETE');
    
    try {
      // Similar al PDF pero con procesamiento de Excel
      const sessionMetric = this.profiler.start('1_SESSION_LOAD');
      const userState = await SessionService.getUserState(this.chatId);
      const user = await prisma.tenantUser.findUnique({
        where: { telegramId: BigInt(this.chatId) },
        include: { tenant: true }
      });
      this.profiler.end(sessionMetric);
      
      // 2. Procesar Excel
      const excelMetric = this.profiler.start('2_EXCEL_PROCESSING');
      
      // Simular lectura y parsing de Excel
      await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
      
      this.profiler.end(excelMetric);
      
      // 3. Cliente ya conocido (CHUBB)
      const clientMetric = this.profiler.start('3_KNOWN_CLIENT_LOAD');
      const chubbClient = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId: user.tenant.id,
          legalName: { contains: 'CHUBB' }
        }
      });
      this.profiler.end(clientMetric);
      
      // 4. Procesar múltiples facturas
      const batchMetric = this.profiler.start('4_BATCH_PROCESSING');
      
      // Simular procesamiento de 3-5 facturas
      const numInvoices = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < numInvoices; i++) {
        const singleInvoiceMetric = this.profiler.start(`4.${i + 1}_SINGLE_INVOICE`);
        
        // Obtener folio
        await TenantService.getNextFolio(user.tenant.id, 'A');
        
        // Crear factura (simulado)
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));
        
        this.profiler.end(singleInvoiceMetric);
      }
      
      this.profiler.end(batchMetric);
      
    } catch (error) {
      console.error(`${colors.red}Error en flujo CHUBB:${colors.reset}`, error.message);
    } finally {
      this.profiler.end(flowMetric);
    }
  }

  async simulateAXAFlow() {
    // Similar a CHUBB pero con lógica específica de AXA
    const flowMetric = this.profiler.start('AXA_FLOW_COMPLETE');
    
    try {
      // Flujo similar pero con validaciones específicas de AXA
      const sessionMetric = this.profiler.start('1_SESSION_LOAD');
      await SessionService.getUserState(this.chatId);
      this.profiler.end(sessionMetric);
      
      // Resto del flujo AXA...
      await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
      
    } finally {
      this.profiler.end(flowMetric);
    }
  }
}

// Función principal
async function runCompleteDiagnostics() {
  console.log(`${colors.bright}=== DIAGNÓSTICO COMPLETO DE FLUJOS DE FACTURACIÓN ===${colors.reset}\n`);
  
  // Usar el primer usuario disponible
  const CHAT_ID = 7143094298; // Usuario de prueba
  const ITERATIONS_PER_FLOW = 10;
  
  const simulator = new InvoiceFlowSimulator(CHAT_ID);
  
  try {
    // Calentar conexiones
    await simulator.warmup();
    
    // 1. Probar flujo PDF
    console.log(`\n${colors.bright}📄 FLUJO PDF - ${ITERATIONS_PER_FLOW} iteraciones${colors.reset}`);
    for (let i = 0; i < ITERATIONS_PER_FLOW; i++) {
      process.stdout.write(`Iteración ${i + 1}/${ITERATIONS_PER_FLOW}... `);
      await simulator.simulatePDFFlow();
      console.log(`${colors.green}✓${colors.reset}`);
      await new Promise(resolve => setTimeout(resolve, 500)); // Pausa entre iteraciones
    }
    
    // 2. Probar flujo CHUBB
    console.log(`\n${colors.bright}📊 FLUJO EXCEL CHUBB - ${ITERATIONS_PER_FLOW} iteraciones${colors.reset}`);
    for (let i = 0; i < ITERATIONS_PER_FLOW; i++) {
      process.stdout.write(`Iteración ${i + 1}/${ITERATIONS_PER_FLOW}... `);
      await simulator.simulateCHUBBFlow();
      console.log(`${colors.green}✓${colors.reset}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 3. Probar flujo AXA
    console.log(`\n${colors.bright}📈 FLUJO EXCEL AXA - ${ITERATIONS_PER_FLOW} iteraciones${colors.reset}`);
    for (let i = 0; i < ITERATIONS_PER_FLOW; i++) {
      process.stdout.write(`Iteración ${i + 1}/${ITERATIONS_PER_FLOW}... `);
      await simulator.simulateAXAFlow();
      console.log(`${colors.green}✓${colors.reset}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Obtener estadísticas
    const stats = simulator.profiler.getStatistics();
    
    // Mostrar resultados
    console.log(`\n${colors.bright}=== ANÁLISIS ESTADÍSTICO ===${colors.reset}\n`);
    
    // Tabla de resultados
    console.log('Operación | Promedio | Min | Max | P95 | P99 | Desv.Est | Varianza');
    console.log('----------|----------|-----|-----|-----|-----|----------|----------');
    
    Object.entries(stats).forEach(([operation, data]) => {
      if (data.count > 0) {
        console.log(
          `${operation.padEnd(50)} | ` +
          `${data.avg.toFixed(2).padStart(8)} | ` +
          `${data.min.toFixed(2).padStart(5)} | ` +
          `${data.max.toFixed(2).padStart(5)} | ` +
          `${data.p95.toFixed(2).padStart(5)} | ` +
          `${data.p99.toFixed(2).padStart(5)} | ` +
          `${data.stdDev.toFixed(2).padStart(8)} | ` +
          `${data.variance.toFixed(2).padStart(8)}`
        );
      }
    });
    
    // Análisis de variabilidad
    console.log(`\n${colors.bright}=== ANÁLISIS DE VARIABILIDAD ===${colors.reset}\n`);
    
    const highVarianceOps = Object.entries(stats)
      .filter(([_, data]) => data.stdDev > data.avg * 0.3) // Variabilidad > 30%
      .sort((a, b) => b[1].stdDev - a[1].stdDev);
    
    if (highVarianceOps.length > 0) {
      console.log(`${colors.red}⚠️ Operaciones con alta variabilidad:${colors.reset}`);
      highVarianceOps.forEach(([op, data]) => {
        const cv = (data.stdDev / data.avg * 100).toFixed(1);
        console.log(`  • ${op}: CV=${cv}% (σ=${data.stdDev.toFixed(2)}ms)`);
      });
    }
    
    // Cuellos de botella principales
    console.log(`\n${colors.bright}=== CUELLOS DE BOTELLA PRINCIPALES ===${colors.reset}\n`);
    
    const bottlenecks = Object.entries(stats)
      .filter(([op, _]) => op.includes('COMPLETE'))
      .sort((a, b) => b[1].avg - a[1].avg);
    
    bottlenecks.forEach(([flow, data]) => {
      console.log(`\n${colors.yellow}${flow}${colors.reset}`);
      console.log(`  Tiempo promedio: ${data.avg.toFixed(2)}ms`);
      console.log(`  Rango: ${data.min.toFixed(2)}ms - ${data.max.toFixed(2)}ms`);
      console.log(`  P95: ${data.p95.toFixed(2)}ms (95% de las veces tarda menos que esto)`);
      
      // Buscar sub-operaciones lentas
      const subOps = Object.entries(stats)
        .filter(([op, _]) => op.startsWith(flow.split('_')[0]) && op !== flow)
        .sort((a, b) => b[1].avg - a[1].avg)
        .slice(0, 3);
      
      if (subOps.length > 0) {
        console.log(`  ${colors.cyan}Top 3 sub-operaciones más lentas:${colors.reset}`);
        subOps.forEach(([subOp, subData]) => {
          const percentage = (subData.avg / data.avg * 100).toFixed(1);
          console.log(`    • ${subOp}: ${subData.avg.toFixed(2)}ms (${percentage}%)`);
        });
      }
    });
    
    // Comparación con objetivo
    console.log(`\n${colors.bright}=== COMPARACIÓN CON OBJETIVO ===${colors.reset}\n`);
    console.log(`Objetivo (CURL directo): 4000ms`);
    
    const pdfStats = stats['PDF_FLOW_COMPLETE'];
    if (pdfStats) {
      const overhead = pdfStats.avg - 4000;
      const overheadPercent = (overhead / 4000 * 100).toFixed(1);
      console.log(`Flujo PDF actual: ${pdfStats.avg.toFixed(2)}ms`);
      console.log(`${colors.red}Overhead: ${overhead.toFixed(2)}ms (${overheadPercent}% más lento)${colors.reset}`);
      
      // Desglose del overhead
      console.log(`\n${colors.cyan}Desglose del overhead:${colors.reset}`);
      const overheadBreakdown = [
        { name: 'Sesión/Auth', op: '1_SESSION_LOAD' },
        { name: 'Búsqueda Cliente', op: '3_CLIENT_SEARCH' },
        { name: 'Obtener Folio', op: '4_GET_FOLIO' },
        { name: 'Post-procesamiento', op: '6_POST_PROCESSING' }
      ];
      
      overheadBreakdown.forEach(({ name, op }) => {
        if (stats[op]) {
          console.log(`  • ${name}: ${stats[op].avg.toFixed(2)}ms`);
        }
      });
    }
    
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar diagnóstico
runCompleteDiagnostics().catch(console.error);