import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

// Importaciones de módulos reales
import prisma from '../lib/prisma.js';
import PDFAnalysisService from '../services/pdf-analysis.service.js';
import InvoiceService from '../services/invoice.service.js';
import TenantService from '../services/tenant.service.js';
import FacturapiService from '../services/facturapi.service.js';
import redisSessionService from '../services/redis-session.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Clase para medir tiempos con alta precisión
class PerformanceTracker {
  constructor() {
    this.metrics = {};
    this.stack = [];
  }

  start(label) {
    const startTime = performance.now();
    this.stack.push({ label, startTime });
    return startTime;
  }

  end(label) {
    const endTime = performance.now();
    const stackItem = this.stack.pop();
    if (stackItem && stackItem.label === label) {
      const duration = endTime - stackItem.startTime;
      if (!this.metrics[label]) {
        this.metrics[label] = [];
      }
      this.metrics[label].push(duration);
      return duration;
    }
    throw new Error(`Mismatched performance tracking: expected ${stackItem?.label}, got ${label}`);
  }

  report() {
    console.log('\n=== PERFORMANCE REPORT ===\n');
    const sortedMetrics = Object.entries(this.metrics)
      .sort(([, a], [, b]) => {
        const avgA = a.reduce((sum, val) => sum + val, 0) / a.length;
        const avgB = b.reduce((sum, val) => sum + val, 0) / b.length;
        return avgB - avgA;
      });

    sortedMetrics.forEach(([label, times]) => {
      const avg = times.reduce((sum, val) => sum + val, 0) / times.length;
      const min = Math.min(...times);
      const max = Math.max(...times);
      console.log(`${label}:`);
      console.log(`  Avg: ${avg.toFixed(2)}ms`);
      console.log(`  Min: ${min.toFixed(2)}ms`);
      console.log(`  Max: ${max.toFixed(2)}ms`);
      console.log(`  Count: ${times.length}`);
      console.log('');
    });

    // Calcular totales
    const totalTime = sortedMetrics.reduce((sum, [, times]) => {
      return sum + times.reduce((s, t) => s + t, 0) / times.length;
    }, 0);
    console.log(`TOTAL AVERAGE TIME: ${totalTime.toFixed(2)}ms\n`);
  }
}

// Flujo completo de diagnóstico
async function runCompleteDiagnosis() {
  const tracker = new PerformanceTracker();
  const tenantId = 'd7f8e9a0-1b2c-3d4e-5f6a-7b8c9d0e1f2a'; // Tenant de prueba
  
  console.log('🔍 INICIANDO DIAGNÓSTICO DE PERFORMANCE\n');
  
  try {
    // 1. INICIALIZACIÓN
    tracker.start('1_TOTAL_INITIALIZATION');
    
    // 1.1 Conexión a Base de Datos
    tracker.start('1.1_DB_CONNECTION');
    await prisma.$connect();
    tracker.end('1.1_DB_CONNECTION');
    
    // 1.2 Conexión a Redis
    tracker.start('1.2_REDIS_CONNECTION');
    await redisSessionService.initialize();
    tracker.end('1.2_REDIS_CONNECTION');
    
    tracker.end('1_TOTAL_INITIALIZATION');
    
    // 2. SIMULACIÓN DE RECEPCIÓN DE PDF
    tracker.start('2_TOTAL_PDF_PROCESSING');
    
    // 2.1 Lectura de archivo
    tracker.start('2.1_FILE_READ');
    const pdfPath = path.join(__dirname, '..', 'test', 'data', 'sample.pdf');
    const pdfBuffer = fs.readFileSync(pdfPath);
    tracker.end('2.1_FILE_READ');
    
    // 2.2 Análisis de PDF
    tracker.start('2.2_PDF_ANALYSIS');
    const analysisResult = await PDFAnalysisService.analyzePDF(pdfPath);
    tracker.end('2.2_PDF_ANALYSIS');
    
    // 3. RESOLUCIÓN DE TENANT Y SESIÓN
    tracker.start('3_TOTAL_TENANT_RESOLUTION');
    
    // 3.1 Búsqueda de Tenant
    tracker.start('3.1_FIND_TENANT');
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId }
    });
    tracker.end('3.1_FIND_TENANT');
    
    // 3.2 Carga de sesión de Redis
    tracker.start('3.2_REDIS_SESSION_LOAD');
    const session = await redisSessionService.getSession('test_user_123');
    tracker.end('3.2_REDIS_SESSION_LOAD');
    
    // 3.3 Verificación de suscripción
    tracker.start('3.3_SUBSCRIPTION_CHECK');
    const subscription = await prisma.tenantSubscription.findFirst({
      where: {
        tenantId,
        status: { in: ['active', 'trial'] }
      },
      include: { plan: true }
    });
    tracker.end('3.3_SUBSCRIPTION_CHECK');
    
    tracker.end('3_TOTAL_TENANT_RESOLUTION');
    
    // 4. BÚSQUEDA DE CLIENTE
    tracker.start('4_TOTAL_CLIENT_RESOLUTION');
    
    // 4.1 Búsqueda en DB local
    tracker.start('4.1_LOCAL_CLIENT_SEARCH');
    const localClient = await prisma.tenantCustomer.findFirst({
      where: {
        tenantId,
        OR: [
          { legalName: { contains: 'PROTECCION S.O.S', mode: 'insensitive' } },
          { legalName: { contains: 'SOS', mode: 'insensitive' } }
        ]
      }
    });
    tracker.end('4.1_LOCAL_CLIENT_SEARCH');
    
    if (!localClient) {
      // 4.2 Búsqueda en FacturAPI (solo si no está en local)
      tracker.start('4.2_FACTURAPI_CLIENT_SEARCH');
      const facturapi = await FacturapiService.getFacturapiClient(tenantId);
      const remoteClients = await facturapi.customers.list({ q: 'PROTECCION S.O.S' });
      tracker.end('4.2_FACTURAPI_CLIENT_SEARCH');
    }
    
    tracker.end('4_TOTAL_CLIENT_RESOLUTION');
    
    // 5. GENERACIÓN DE FOLIO
    tracker.start('5_TOTAL_FOLIO_GENERATION');
    
    // 5.1 Obtener folio actual
    tracker.start('5.1_GET_CURRENT_FOLIO');
    const folio = await prisma.tenantFolio.findUnique({
      where: {
        tenantId_series: { tenantId, series: 'A' }
      }
    });
    tracker.end('5.1_GET_CURRENT_FOLIO');
    
    // 5.2 Actualizar folio
    tracker.start('5.2_UPDATE_FOLIO');
    await prisma.tenantFolio.update({
      where: { id: folio?.id || 1 },
      data: { currentNumber: { increment: 1 } }
    });
    tracker.end('5.2_UPDATE_FOLIO');
    
    tracker.end('5_TOTAL_FOLIO_GENERATION');
    
    // 6. CREACIÓN DE FACTURA
    tracker.start('6_TOTAL_INVOICE_CREATION');
    
    // 6.1 Preparar datos de factura
    tracker.start('6.1_PREPARE_INVOICE_DATA');
    const invoiceData = {
      customer: localClient?.facturapiCustomerId || 'test_customer_id',
      items: [{
        product: {
          description: 'Servicio de prueba',
          product_key: '01010101',
          price: 100
        },
        quantity: 1
      }],
      payment_form: '03',
      folio_number: folio?.currentNumber || 1000,
      series: 'A'
    };
    tracker.end('6.1_PREPARE_INVOICE_DATA');
    
    // 6.2 Llamada a FacturAPI (simulada para no crear factura real)
    tracker.start('6.2_FACTURAPI_CREATE_INVOICE');
    // Simulamos el tiempo de respuesta típico de FacturAPI
    await new Promise(resolve => setTimeout(resolve, 2000));
    const facturapiResponse = { id: 'simulated_invoice_id', status: 'valid' };
    tracker.end('6.2_FACTURAPI_CREATE_INVOICE');
    
    // 6.3 Guardar en base de datos
    tracker.start('6.3_SAVE_INVOICE_TO_DB');
    await prisma.tenantInvoice.create({
      data: {
        tenantId,
        facturapiInvoiceId: facturapiResponse.id,
        series: 'A',
        folioNumber: folio?.currentNumber || 1000,
        total: 100,
        status: 'valid',
        createdById: BigInt(123456789)
      }
    });
    tracker.end('6.3_SAVE_INVOICE_TO_DB');
    
    // 6.4 Actualizar contador de suscripción
    tracker.start('6.4_UPDATE_SUBSCRIPTION_COUNTER');
    await prisma.tenantSubscription.update({
      where: { id: subscription?.id || 1 },
      data: { invoicesUsed: { increment: 1 } }
    });
    tracker.end('6.4_UPDATE_SUBSCRIPTION_COUNTER');
    
    tracker.end('6_TOTAL_INVOICE_CREATION');
    
    // 7. POST-PROCESAMIENTO
    tracker.start('7_TOTAL_POST_PROCESSING');
    
    // 7.1 Actualizar sesión en Redis
    tracker.start('7.1_UPDATE_REDIS_SESSION');
    await redisSessionService.saveSession('test_user_123', {
      ...session,
      lastInvoiceId: facturapiResponse.id
    });
    tracker.end('7.1_UPDATE_REDIS_SESSION');
    
    // 7.2 Log de auditoría
    tracker.start('7.2_AUDIT_LOG');
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: 'invoice_created',
        entityType: 'invoice',
        entityId: facturapiResponse.id
      }
    });
    tracker.end('7.2_AUDIT_LOG');
    
    tracker.end('7_TOTAL_POST_PROCESSING');
    
  } catch (error) {
    console.error('Error durante el diagnóstico:', error);
  } finally {
    await prisma.$disconnect();
    await redisSessionService.disconnect();
  }
  
  // Generar reporte
  tracker.report();
  
  // Análisis adicional de cuellos de botella
  console.log('=== ANÁLISIS DE CUELLOS DE BOTELLA ===\n');
  
  const dbOperations = [
    '3.1_FIND_TENANT',
    '3.3_SUBSCRIPTION_CHECK', 
    '4.1_LOCAL_CLIENT_SEARCH',
    '5.1_GET_CURRENT_FOLIO',
    '5.2_UPDATE_FOLIO',
    '6.3_SAVE_INVOICE_TO_DB',
    '6.4_UPDATE_SUBSCRIPTION_COUNTER',
    '7.2_AUDIT_LOG'
  ];
  
  const dbTotal = dbOperations.reduce((sum, op) => {
    const times = tracker.metrics[op] || [];
    return sum + (times.length > 0 ? times.reduce((s, t) => s + t, 0) / times.length : 0);
  }, 0);
  
  console.log(`Total en operaciones de DB: ${dbTotal.toFixed(2)}ms`);
  console.log(`FacturAPI Create Invoice: ${(tracker.metrics['6.2_FACTURAPI_CREATE_INVOICE']?.[0] || 0).toFixed(2)}ms`);
  console.log(`Redis Operations: ${((tracker.metrics['3.2_REDIS_SESSION_LOAD']?.[0] || 0) + (tracker.metrics['7.1_UPDATE_REDIS_SESSION']?.[0] || 0)).toFixed(2)}ms`);
}

// Ejecutar diagnóstico
runCompleteDiagnosis().catch(console.error);