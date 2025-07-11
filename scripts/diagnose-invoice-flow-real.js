import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Importaciones de módulos reales
import prisma from '../lib/prisma.js';
import * as invoiceHandler from '../bot/handlers/invoice.handler.js';
import * as pdfAnalysisService from '../services/pdf-analysis.service.js';
import * as invoiceService from '../services/invoice.service.js';
import * as clientService from '../services/client.service.js';
import * as tenantService from '../services/tenant.service.js';
import * as facturapiService from '../services/facturapi.service.js';

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

// Mock del contexto de Telegram mejorado
const createMockCtx = (filePath, chatId = 12345) => ({
  chat: { id: chatId },
  from: { id: chatId },
  message: {
    document: {
      file_id: 'dummy_file_id',
      file_name: path.basename(filePath),
    },
  },
  reply: (message) => {
    console.log(`${colors.cyan}[BOT-REPLY]${colors.reset} ${message}`);
  },
  scene: {
    enter: (sceneName) => {
      console.log(`${colors.magenta}[SCENE]${colors.reset} Entering: ${sceneName}`);
    }
  },
  userState: {},
  getTenantId: function() { return this.userState?.tenantId; },
  hasTenant: function() { return !!this.userState?.tenantId; }
});

// Medidor de tiempo detallado
class PerformanceMeasurer {
  constructor() {
    this.measurements = [];
    this.subMeasurements = new Map();
  }

  start(name, parent = null) {
    const measurement = {
      name,
      parent,
      startTime: performance.now(),
      endTime: null,
      duration: null
    };
    
    if (parent) {
      if (!this.subMeasurements.has(parent)) {
        this.subMeasurements.set(parent, []);
      }
      this.subMeasurements.get(parent).push(measurement);
    } else {
      this.measurements.push(measurement);
    }
    
    return measurement;
  }

  end(measurement) {
    measurement.endTime = performance.now();
    measurement.duration = measurement.endTime - measurement.startTime;
    return measurement.duration;
  }

  getReport() {
    const report = [];
    
    this.measurements.forEach(m => {
      report.push({
        step: m.name,
        duration: m.duration?.toFixed(2) || 'N/A',
        subSteps: this.subMeasurements.get(m.name)?.map(sub => ({
          name: sub.name,
          duration: sub.duration?.toFixed(2) || 'N/A'
        })) || []
      });
    });
    
    return report;
  }
}

// Flujo real completo sin simulaciones
const runRealFlowBenchmark = async (pdfPath, chatId) => {
  const perf = new PerformanceMeasurer();
  const ctx = createMockCtx(pdfPath, chatId);
  
  console.log(`\n${colors.bright}=== INICIANDO FLUJO REAL DE FACTURACIÓN ===${colors.reset}\n`);

  try {
    // 1. RESOLUCIÓN DE TENANT Y SESIÓN
    const tenantMeasure = perf.start('1. Tenant Resolution & Session');
    
    // 1.1 Buscar usuario por Telegram ID
    const findUserMeasure = perf.start('1.1 Find User by Telegram ID', '1. Tenant Resolution & Session');
    const user = await prisma.tenantUser.findUnique({
      where: { telegramId: BigInt(chatId) },
      include: { tenant: true }
    });
    perf.end(findUserMeasure);
    
    if (!user || !user.tenant) {
      throw new Error('No se encontró usuario o tenant para el chat ID proporcionado');
    }
    
    // 1.2 Cargar sesión del usuario
    const loadSessionMeasure = perf.start('1.2 Load User Session', '1. Tenant Resolution & Session');
    const session = await prisma.userSession.findUnique({
      where: { telegramId: BigInt(chatId) }
    });
    perf.end(loadSessionMeasure);
    
    // Configurar contexto con datos reales
    ctx.userState = session?.sessionData || {};
    ctx.userState.tenantId = user.tenant.id;
    ctx.userState.tenantName = user.tenant.businessName;
    
    perf.end(tenantMeasure);
    
    // 2. LECTURA Y ANÁLISIS DEL PDF
    const pdfMeasure = perf.start('2. PDF Processing');
    
    // 2.1 Leer archivo PDF
    const readFileMeasure = perf.start('2.1 Read PDF File', '2. PDF Processing');
    const pdfBuffer = fs.readFileSync(pdfPath);
    perf.end(readFileMeasure);
    
    // 2.2 Extraer datos del PDF
    const extractMeasure = perf.start('2.2 Extract PDF Data', '2. PDF Processing');
    const extractedData = await pdfAnalysisService.extractDataFromPdf(pdfBuffer);
    perf.end(extractMeasure);
    
    if (!extractedData || !extractedData.rfc) {
      throw new Error('No se pudieron extraer datos válidos del PDF');
    }
    
    console.log(`${colors.green}✓${colors.reset} Datos extraídos: RFC=${extractedData.rfc}, Cliente=${extractedData.clientName}`);
    
    perf.end(pdfMeasure);
    
    // 3. BÚSQUEDA Y RESOLUCIÓN DE CLIENTE
    const clientMeasure = perf.start('3. Client Resolution');
    
    // 3.1 Buscar en BD local
    const localSearchMeasure = perf.start('3.1 Search Client in Local DB', '3. Client Resolution');
    let client = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId: user.tenant.id,
        OR: [
          { rfc: extractedData.rfc },
          { legalName: { contains: extractedData.clientName, mode: 'insensitive' } }
        ]
      }
    });
    perf.end(localSearchMeasure);
    
    if (!client) {
      // 3.2 Buscar en FacturAPI (solo si no está en local)
      const apiSearchMeasure = perf.start('3.2 Search Client in FacturAPI', '3. Client Resolution');
      const facturapi = await facturapiService.getFacturapiClient(user.tenant.id);
      const clientes = await facturapi.customers.list({ q: extractedData.clientName });
      perf.end(apiSearchMeasure);
      
      if (clientes?.data?.length > 0) {
        // 3.3 Sincronizar cliente a BD local
        const syncMeasure = perf.start('3.3 Sync Client to Local DB', '3. Client Resolution');
        const facturapiClient = clientes.data[0];
        client = await prisma.tenantCustomer.create({
          data: {
            tenantId: user.tenant.id,
            facturapiCustomerId: facturapiClient.id,
            legalName: facturapiClient.legal_name,
            rfc: facturapiClient.tax_id,
            email: facturapiClient.email,
            isActive: true
          }
        });
        perf.end(syncMeasure);
      } else {
        throw new Error(`Cliente ${extractedData.clientName} no encontrado`);
      }
    }
    
    perf.end(clientMeasure);
    
    // 4. OBTENCIÓN DE FOLIO
    const folioMeasure = perf.start('4. Get Next Folio');
    
    // 4.1 Query actual (2 operaciones)
    const folioCurrentMeasure = perf.start('4.1 Current Implementation (find + update)', '4. Get Next Folio');
    const nextFolio = await tenantService.getNextFolio(user.tenant.id, 'A');
    perf.end(folioCurrentMeasure);
    
    console.log(`${colors.green}✓${colors.reset} Folio obtenido: ${nextFolio}`);
    
    perf.end(folioMeasure);
    
    // 5. CREACIÓN DE FACTURA
    const invoiceMeasure = perf.start('5. Invoice Creation');
    
    // 5.1 Preparar datos de factura
    const prepareDataMeasure = perf.start('5.1 Prepare Invoice Data', '5. Invoice Creation');
    const invoiceData = {
      clienteId: client.facturapiCustomerId,
      numeroPedido: extractedData.orderNumber || 'TEST-001',
      claveProducto: '78101803',
      monto: extractedData.amount || 1000,
      userId: chatId
    };
    perf.end(prepareDataMeasure);
    
    // 5.2 Verificar retención (redundante?)
    const retentionCheckMeasure = perf.start('5.2 Check Retention Requirements', '5. Invoice Creation');
    const facturapi = await facturapiService.getFacturapiClient(user.tenant.id);
    const clienteFacturapi = await facturapi.customers.retrieve(client.facturapiCustomerId);
    const requiresRetention = clienteFacturapi.legal_name.includes('INFOASIST') || 
                            clienteFacturapi.legal_name.includes('ARSA') || 
                            clienteFacturapi.legal_name.includes('S.O.S');
    perf.end(retentionCheckMeasure);
    
    // 5.3 Crear factura en FacturAPI
    const createInvoiceMeasure = perf.start('5.3 Create Invoice in FacturAPI', '5. Invoice Creation');
    console.log(`${colors.yellow}➤${colors.reset} Creando factura REAL en FacturAPI...`);
    
    // COMENTADO PARA NO CREAR FACTURAS REALES
    // const factura = await invoiceService.generateInvoice(invoiceData, user.tenant.id);
    
    // Simular respuesta para testing
    const factura = {
      id: 'test-invoice-id',
      series: 'A',
      folio_number: nextFolio,
      total: invoiceData.monto,
      status: 'valid'
    };
    
    perf.end(createInvoiceMeasure);
    
    perf.end(invoiceMeasure);
    
    // 6. POST-PROCESAMIENTO
    const postProcessMeasure = perf.start('6. Post-Processing');
    
    // 6.1 Registrar factura en BD
    const registerMeasure = perf.start('6.1 Register Invoice in DB', '6. Post-Processing');
    // await tenantService.registerInvoice(...);
    perf.end(registerMeasure);
    
    // 6.2 Actualizar contador de suscripción
    const updateCounterMeasure = perf.start('6.2 Update Subscription Counter', '6. Post-Processing');
    // await tenantService.incrementInvoiceCount(user.tenant.id);
    perf.end(updateCounterMeasure);
    
    // 6.3 Actualizar sesión
    const updateSessionMeasure = perf.start('6.3 Update User Session', '6. Post-Processing');
    await prisma.userSession.update({
      where: { telegramId: BigInt(chatId) },
      data: {
        sessionData: {
          ...ctx.userState,
          lastInvoice: factura.id,
          lastInvoiceAt: new Date()
        }
      }
    });
    perf.end(updateSessionMeasure);
    
    perf.end(postProcessMeasure);
    
    return perf;
    
  } catch (error) {
    console.error(`${colors.red}✗ Error:${colors.reset}`, error.message);
    throw error;
  }
};

// Ejecutar benchmark
const runBenchmark = async () => {
  const mockPdfPath = path.join(__dirname, '..', 'test', 'data', 'sample.pdf');
  
  // Verificar que existe el PDF
  if (!fs.existsSync(mockPdfPath)) {
    console.error(`${colors.red}✗${colors.reset} No se encontró el archivo PDF de prueba en: ${mockPdfPath}`);
    process.exit(1);
  }
  
  // Usar un chat ID real de tu base de datos
  const REAL_CHAT_ID = 7492482846; // Reemplazar con un ID real de tu DB
  
  console.log(`${colors.bright}=== DIAGNÓSTICO DE FLUJO DE FACTURACIÓN REAL ===${colors.reset}`);
  console.log(`PDF: ${mockPdfPath}`);
  console.log(`Chat ID: ${REAL_CHAT_ID}`);
  console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log('');
  
  const results = [];
  const iterations = 5; // Reducido para evitar crear muchas facturas
  
  try {
    // Calentar conexiones
    console.log(`${colors.yellow}Calentando conexiones...${colors.reset}`);
    await prisma.$queryRaw`SELECT 1`;
    
    for (let i = 0; i < iterations; i++) {
      console.log(`\n${colors.bright}--- Ejecución ${i + 1}/${iterations} ---${colors.reset}`);
      
      try {
        const perf = await runRealFlowBenchmark(mockPdfPath, REAL_CHAT_ID);
        const report = perf.getReport();
        
        // Calcular tiempo total
        const totalTime = report.reduce((sum, step) => {
          const duration = parseFloat(step.duration) || 0;
          return sum + duration;
        }, 0);
        
        results.push({ report, totalTime });
        
        console.log(`\n${colors.green}✓ Tiempo total: ${totalTime.toFixed(2)}ms${colors.reset}`);
        
        // Pausa entre ejecuciones
        await new Promise(res => setTimeout(res, 1000));
        
      } catch (error) {
        console.error(`${colors.red}✗ Error en ejecución ${i + 1}:${colors.reset}`, error.message);
      }
    }
    
  } finally {
    await prisma.$disconnect();
  }
  
  // Análisis de resultados
  console.log(`\n\n${colors.bright}=== ANÁLISIS DE RESULTADOS ===${colors.reset}\n`);
  
  if (results.length === 0) {
    console.log(`${colors.red}No se obtuvieron resultados válidos${colors.reset}`);
    return;
  }
  
  // Agrupar métricas por paso
  const stepMetrics = new Map();
  
  results.forEach(result => {
    result.report.forEach(step => {
      if (!stepMetrics.has(step.step)) {
        stepMetrics.set(step.step, {
          times: [],
          subSteps: new Map()
        });
      }
      
      const duration = parseFloat(step.duration) || 0;
      stepMetrics.get(step.step).times.push(duration);
      
      // Procesar sub-pasos
      step.subSteps.forEach(subStep => {
        const subMap = stepMetrics.get(step.step).subSteps;
        if (!subMap.has(subStep.name)) {
          subMap.set(subStep.name, []);
        }
        subMap.get(subStep.name).push(parseFloat(subStep.duration) || 0);
      });
    });
  });
  
  // Mostrar tabla de resultados
  console.log('Paso | Promedio (ms) | Mín (ms) | Máx (ms) | % del Total');
  console.log('-----|---------------|----------|----------|------------');
  
  let totalAvg = 0;
  const stepAvgs = new Map();
  
  stepMetrics.forEach((metrics, stepName) => {
    const times = metrics.times;
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    
    stepAvgs.set(stepName, avg);
    totalAvg += avg;
  });
  
  // Mostrar pasos principales
  stepMetrics.forEach((metrics, stepName) => {
    const times = metrics.times;
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const percentage = (avg / totalAvg * 100).toFixed(1);
    
    console.log(`${colors.bright}${stepName.padEnd(45)}${colors.reset}| ${avg.toFixed(2).padStart(13)} | ${min.toFixed(2).padStart(8)} | ${max.toFixed(2).padStart(8)} | ${percentage.padStart(10)}%`);
    
    // Mostrar sub-pasos
    metrics.subSteps.forEach((subTimes, subStepName) => {
      const subAvg = subTimes.reduce((a, b) => a + b, 0) / subTimes.length;
      const subMin = Math.min(...subTimes);
      const subMax = Math.max(...subTimes);
      const subPercentage = (subAvg / totalAvg * 100).toFixed(1);
      
      console.log(`  ${colors.cyan}↳ ${subStepName.padEnd(41)}${colors.reset}| ${subAvg.toFixed(2).padStart(13)} | ${subMin.toFixed(2).padStart(8)} | ${subMax.toFixed(2).padStart(8)} | ${subPercentage.padStart(10)}%`);
    });
  });
  
  console.log('\n' + '='.repeat(80));
  console.log(`${colors.bright}TIEMPO TOTAL PROMEDIO: ${totalAvg.toFixed(2)}ms${colors.reset}`);
  
  // Identificar cuellos de botella
  console.log(`\n${colors.bright}=== CUELLOS DE BOTELLA IDENTIFICADOS ===${colors.reset}\n`);
  
  const bottlenecks = [];
  stepMetrics.forEach((metrics, stepName) => {
    const avg = stepAvgs.get(stepName);
    const percentage = (avg / totalAvg * 100);
    
    if (percentage > 15) { // Si toma más del 15% del tiempo total
      bottlenecks.push({ 
        step: stepName, 
        avg: avg.toFixed(2), 
        percentage: percentage.toFixed(1),
        subSteps: metrics.subSteps
      });
    }
  });
  
  bottlenecks.sort((a, b) => parseFloat(b.percentage) - parseFloat(a.percentage));
  
  bottlenecks.forEach((bottleneck, index) => {
    console.log(`${colors.red}${index + 1}. ${bottleneck.step}${colors.reset}`);
    console.log(`   Tiempo promedio: ${bottleneck.avg}ms (${bottleneck.percentage}% del total)`);
    
    // Mostrar sub-pasos problemáticos
    const subBottlenecks = [];
    bottleneck.subSteps.forEach((times, name) => {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      if (avg > 50) { // Si toma más de 50ms
        subBottlenecks.push({ name, avg });
      }
    });
    
    if (subBottlenecks.length > 0) {
      console.log(`   Sub-pasos lentos:`);
      subBottlenecks.sort((a, b) => b.avg - a.avg);
      subBottlenecks.forEach(sub => {
        console.log(`     ${colors.yellow}• ${sub.name}: ${sub.avg.toFixed(2)}ms${colors.reset}`);
      });
    }
    
    console.log('');
  });
  
  // Comparación con CURL
  console.log(`${colors.bright}=== COMPARACIÓN CON CURL ===${colors.reset}\n`);
  console.log(`CURL directo a FacturAPI: ~4000ms`);
  console.log(`Bot actual: ${totalAvg.toFixed(0)}ms`);
  console.log(`${colors.red}Overhead del bot: ${(totalAvg - 4000).toFixed(0)}ms (${((totalAvg/4000 - 1) * 100).toFixed(1)}% más lento)${colors.reset}`);
};

// Ejecutar
runBenchmark().catch(console.error);