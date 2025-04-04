// scripts/test-invoice-generation.js
// Script para probar la generación de facturas

import { PrismaClient } from '@prisma/client';
import InvoiceService from '../services/invoice.service.js';

// Inicializar Prisma
const prisma = new PrismaClient();

async function testInvoiceGeneration() {
  try {
    console.log('Iniciando prueba de generación de factura...');
    
    // Obtener el primer tenant activo
    const tenant = await prisma.tenant.findFirst({
      where: { isActive: true },
      select: {
        id: true,
        businessName: true,
        facturapiApiKey: true
      }
    });
    
    if (!tenant) {
      throw new Error('No se encontró ningún tenant activo');
    }
    
    console.log(`Usando tenant: ${tenant.businessName} (${tenant.id})`);
    console.log(`API Key: ${tenant.facturapiApiKey ? tenant.facturapiApiKey.substring(0, 10) + '...' : 'No configurada'}`);
    
    // Obtener un cliente para el tenant
    const cliente = await prisma.tenantCustomer.findFirst({
      where: { tenantId: tenant.id, isActive: true }
    });
    
    if (!cliente) {
      throw new Error('No se encontró ningún cliente para este tenant');
    }
    
    console.log(`Usando cliente: ${cliente.legalName} (${cliente.facturapiCustomerId})`);
    
    // Datos para la factura
    const invoiceData = {
      clienteId: cliente.facturapiCustomerId,
      clienteNombre: cliente.legalName,
      numeroPedido: `TEST-${Date.now()}`,
      claveProducto: '90101501', // Clave SAT para servicios de grúa
      monto: 100.00, // Monto de prueba
      userId: null // No asociamos a ningún usuario específico
    };
    
    console.log('Datos de factura a generar:', invoiceData);
    
    // Intentar generar la factura
    console.log('Generando factura...');
    const factura = await InvoiceService.generateInvoice(invoiceData, tenant.id);
    
    console.log('✅ Factura generada exitosamente:');
    console.log(`ID: ${factura.id}`);
    console.log(`Serie: ${factura.series}`);
    console.log(`Folio: ${factura.folio_number}`);
    console.log(`Total: ${factura.total}`);
    console.log(`Estatus: ${factura.status}`);
    console.log(`Verificación SAT: ${factura.verification_url}`);
    
    return { success: true, invoice: factura };
  } catch (error) {
    console.error('❌ Error al generar factura:', error);
    return { success: false, error: error.message, stack: error.stack };
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar la función principal
testInvoiceGeneration()
  .then(result => {
    if (result.success) {
      console.log('✅ Prueba completada con éxito');
    } else {
      console.error('❌ La prueba falló');
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('Error inesperado:', err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
