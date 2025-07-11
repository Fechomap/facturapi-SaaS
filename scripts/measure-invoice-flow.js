import { performance } from 'perf_hooks';
import prisma from '../lib/prisma.js';
import InvoiceService from '../services/invoice.service.js';
import TenantService from '../services/tenant.service.js';
import FacturapiService from '../services/facturapi.service.js';
import dotenv from 'dotenv';
dotenv.config();

// Colores para output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

class DetailedPerformanceTracker {
  constructor() {
    this.events = [];
    this.startTime = performance.now();
  }

  mark(event, metadata = {}) {
    const timestamp = performance.now();
    const relativeTime = timestamp - this.startTime;
    this.events.push({
      event,
      timestamp,
      relativeTime,
      metadata
    });
    
    // Log inmediato con color
    const color = relativeTime > 1000 ? colors.red : 
                  relativeTime > 500 ? colors.yellow : 
                  colors.green;
    
    console.log(`${color}[${relativeTime.toFixed(2)}ms]${colors.reset} ${event}`);
    
    if (Object.keys(metadata).length > 0) {
      console.log(`  └─ ${JSON.stringify(metadata)}`);
    }
  }

  async measureAsync(label, fn) {
    const start = performance.now();
    this.mark(`${label} - START`);
    
    try {
      const result = await fn();
      const duration = performance.now() - start;
      this.mark(`${label} - END`, { duration: `${duration.toFixed(2)}ms` });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.mark(`${label} - ERROR`, { 
        duration: `${duration.toFixed(2)}ms`, 
        error: error.message 
      });
      throw error;
    }
  }

  generateReport() {
    console.log('\n' + '='.repeat(80));
    console.log('REPORTE DETALLADO DE PERFORMANCE');
    console.log('='.repeat(80) + '\n');

    // Calcular tiempos entre eventos consecutivos
    const segments = [];
    for (let i = 1; i < this.events.length; i++) {
      const duration = this.events[i].relativeTime - this.events[i-1].relativeTime;
      if (duration > 10) { // Solo mostrar segmentos > 10ms
        segments.push({
          from: this.events[i-1].event,
          to: this.events[i].event,
          duration
        });
      }
    }

    // Ordenar por duración
    segments.sort((a, b) => b.duration - a.duration);

    console.log('TOP 10 SEGMENTOS MÁS LENTOS:');
    console.log('-'.repeat(80));
    segments.slice(0, 10).forEach((seg, i) => {
      const color = seg.duration > 1000 ? colors.red : 
                    seg.duration > 500 ? colors.yellow : 
                    colors.cyan;
      console.log(`${i+1}. ${color}${seg.duration.toFixed(2)}ms${colors.reset}`);
      console.log(`   De: ${seg.from}`);
      console.log(`   A:  ${seg.to}\n`);
    });

    // Resumen total
    const totalTime = this.events[this.events.length - 1].relativeTime;
    console.log(`\nTIEMPO TOTAL: ${colors.magenta}${totalTime.toFixed(2)}ms${colors.reset}`);
  }
}

async function runDetailedInvoiceFlow() {
  const tracker = new DetailedPerformanceTracker();
  
  console.log(`${colors.blue}🚀 INICIANDO MEDICIÓN DETALLADA DEL FLUJO DE FACTURACIÓN${colors.reset}\n`);
  
  try {
    // 0. CONFIGURACIÓN INICIAL
    tracker.mark('0. INICIO DEL PROCESO');
    
    // 1. CONEXIÓN A BASE DE DATOS
    await tracker.measureAsync('1. CONEXIÓN A PRISMA', async () => {
      await prisma.$connect();
    });
    
    // 2. OBTENER PRIMER TENANT ACTIVO
    const tenant = await tracker.measureAsync('2. BUSCAR TENANT ACTIVO', async () => {
      return await prisma.tenant.findFirst({
        where: { isActive: true },
        include: {
          subscriptions: {
            where: { status: { in: ['active', 'trial'] } },
            include: { plan: true }
          }
        }
      });
    });
    
    if (!tenant) {
      throw new Error('No se encontró ningún tenant activo');
    }
    
    tracker.mark('2.1 Tenant encontrado', { 
      tenantId: tenant.id, 
      name: tenant.businessName 
    });
    
    // 3. BUSCAR CLIENTE LOCAL
    const localClient = await tracker.measureAsync('3. BUSCAR CLIENTE EN DB LOCAL', async () => {
      return await prisma.tenantCustomer.findFirst({
        where: {
          tenantId: tenant.id,
          isActive: true
        }
      });
    });
    
    let clienteId;
    if (localClient) {
      clienteId = localClient.facturapiCustomerId;
      tracker.mark('3.1 Cliente encontrado en DB local', { 
        clientId: clienteId,
        name: localClient.legalName 
      });
    } else {
      // 4. BUSCAR CLIENTE EN FACTURAPI
      tracker.mark('4. CLIENTE NO ENCONTRADO LOCALMENTE - BUSCANDO EN FACTURAPI');
      
      const facturapi = await tracker.measureAsync('4.1 OBTENER CLIENTE FACTURAPI', async () => {
        return await FacturapiService.getFacturapiClient(tenant.id);
      });
      
      const clientes = await tracker.measureAsync('4.2 BUSCAR CLIENTES EN FACTURAPI', async () => {
        return await facturapi.customers.list({ limit: 1 });
      });
      
      if (clientes.data && clientes.data.length > 0) {
        clienteId = clientes.data[0].id;
        tracker.mark('4.3 Cliente encontrado en FacturAPI', { 
          clientId: clienteId,
          name: clientes.data[0].legal_name 
        });
      } else {
        throw new Error('No se encontraron clientes');
      }
    }
    
    // 5. OBTENER FOLIO
    const nextFolio = await tracker.measureAsync('5. OBTENER SIGUIENTE FOLIO', async () => {
      return await TenantService.getNextFolio(tenant.id, 'A');
    });
    
    tracker.mark('5.1 Folio obtenido', { folio: nextFolio });
    
    // 6. VERIFICAR RETENCIÓN (SEGUNDA LLAMADA A FACTURAPI)
    await tracker.measureAsync('6. VERIFICAR SI CLIENTE REQUIERE RETENCIÓN', async () => {
      const facturapi = await FacturapiService.getFacturapiClient(tenant.id);
      try {
        const cliente = await facturapi.customers.retrieve(clienteId);
        const requiresWithholding = 
          cliente.legal_name.includes('INFOASIST') || 
          cliente.legal_name.includes('ARSA') || 
          cliente.legal_name.includes('S.O.S');
        tracker.mark('6.1 Retención verificada', { 
          requiresWithholding,
          clientName: cliente.legal_name 
        });
        return requiresWithholding;
      } catch (error) {
        tracker.mark('6.2 Error verificando retención', { error: error.message });
        return false;
      }
    });
    
    // 7. PREPARAR DATOS DE FACTURA
    tracker.mark('7. PREPARANDO DATOS DE FACTURA');
    const invoiceData = {
      clienteId: clienteId,
      numeroPedido: 'TEST-' + Date.now(),
      claveProducto: '01010101',
      monto: 100.00,
      userId: '123456789'
    };
    
    // 8. CREAR FACTURA EN FACTURAPI
    const factura = await tracker.measureAsync('8. CREAR FACTURA EN FACTURAPI', async () => {
      const facturapi = await FacturapiService.getFacturapiClient(tenant.id);
      
      const facturaData = {
        customer: clienteId,
        items: [{
          quantity: 1,
          product: {
            description: `SERVICIO DE PRUEBA - MEDICIÓN PERFORMANCE`,
            product_key: '01010101',
            unit_key: 'E48',
            unit_name: 'SERVICIO',
            price: 100.00,
            tax_included: false,
            taxes: [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }]
          }
        }],
        use: 'G03',
        payment_form: '99',
        payment_method: 'PPD'
      };
      
      // SIMULAR llamada sin crear factura real
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simular 2s de API
      return {
        id: 'test_invoice_' + Date.now(),
        folio_number: nextFolio,
        series: 'A',
        total: 116.00,
        status: 'valid'
      };
    });
    
    tracker.mark('8.1 Factura creada', { 
      invoiceId: factura.id,
      folio: factura.folio_number 
    });
    
    // 9. REGISTRAR FACTURA EN DB
    await tracker.measureAsync('9. REGISTRAR FACTURA EN DB LOCAL', async () => {
      return await TenantService.registerInvoice(
        tenant.id,
        factura.id,
        factura.series,
        factura.folio_number,
        clienteId,
        factura.total,
        BigInt(123456789)
      );
    });
    
    // 10. ACTUALIZAR CONTADOR DE SUSCRIPCIÓN
    await tracker.measureAsync('10. ACTUALIZAR CONTADOR SUSCRIPCIÓN', async () => {
      if (tenant.subscriptions && tenant.subscriptions.length > 0) {
        return await prisma.tenantSubscription.update({
          where: { id: tenant.subscriptions[0].id },
          data: { invoicesUsed: { increment: 1 } }
        });
      }
    });
    
    tracker.mark('11. PROCESO COMPLETADO');
    
  } catch (error) {
    tracker.mark('ERROR FATAL', { error: error.message });
    console.error(`\n${colors.red}ERROR: ${error.message}${colors.reset}`);
  } finally {
    await prisma.$disconnect();
  }
  
  // Generar reporte
  tracker.generateReport();
}

// Ejecutar múltiples veces para obtener promedios
async function runMultipleMeasurements(count = 3) {
  console.log(`${colors.cyan}Ejecutando ${count} mediciones...${colors.reset}\n`);
  
  const results = [];
  
  for (let i = 0; i < count; i++) {
    console.log(`\n${colors.yellow}=== MEDICIÓN ${i + 1} DE ${count} ===${colors.reset}\n`);
    await runDetailedInvoiceFlow();
    
    if (i < count - 1) {
      console.log(`\n${colors.cyan}Esperando 2 segundos antes de la siguiente medición...${colors.reset}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Ejecutar
runMultipleMeasurements(3).catch(console.error);