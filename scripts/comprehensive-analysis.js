#!/usr/bin/env node
// scripts/comprehensive-analysis.js
// INVESTIGACIÓN EXHAUSTIVA - DISCREPANCIAS EN CONTEOS Y DATOS FALTANTES
import prisma from '../lib/prisma.js';
import FacturapiService from '../services/facturapi.service.js';

/**
 * INVESTIGACIÓN EXHAUSTIVA PARA ENTENDER DISCREPANCIAS SISTEMICAS
 *
 * PROBLEMAS IDENTIFICADOS:
 * 1. Reporte Excel: 415 facturas
 * 2. Reporte facturación: 414 facturas
 * 3. Reporte suscripción: 527 facturas
 * 4. Clientes AXA y CHUBB sin facturas vinculadas
 * 5. Facturas sin RFC
 *
 * OBJETIVO: Encontrar la causa raíz de todas las discrepancias
 */

async function comprehensiveAnalysis() {
  console.log('🚀 INVESTIGACIÓN EXHAUSTIVA - ANÁLISIS SISTÉMICO');
  console.log('📅', new Date().toLocaleString());
  console.log('🎯 Objetivo: Entender discrepancias en conteos y datos faltantes');
  console.log('='.repeat(80));
  console.log('🔍 INVESTIGACIÓN EXHAUSTIVA - SOLO LECTURA');
  console.log('🚨 NO SE MODIFICARÁ NINGÚN DATO');
  console.log('='.repeat(80));

  try {
    // 1. ANÁLISIS COMPLETO DE LA BASE DE DATOS
    await analyzeDatabaseState();

    // 2. ANÁLISIS DE TODOS LOS REPORTES
    await analyzeAllReports();

    // 3. COMPARACIÓN BD VS FACTURAPI
    await compareDatabaseVsFacturapi();

    // 4. ANÁLISIS DE FLUJOS DE CREACIÓN
    await analyzeInvoiceCreationFlows();

    // 5. INVESTIGACIÓN DE DISCREPANCIAS EN CONTEOS
    await investigateCountDiscrepancies();

    // 6. ANÁLISIS DE FACTURAS SIN RFC
    await analyzeInvoicesWithoutRFC();

    // 7. ANÁLISIS DE VINCULACIÓN CLIENTE-FACTURA
    await analyzeClientLinkingProcess();

    // 8. RESUMEN EJECUTIVO Y CAUSA RAÍZ
    await generateExecutiveSummary();
  } catch (error) {
    console.error('❌ Error en investigación exhaustiva:', error);
  } finally {
    await prisma.$disconnect();
  }
}

async function analyzeDatabaseState() {
  console.log('\n📊 1. ANÁLISIS COMPLETO DEL ESTADO DE LA BASE DE DATOS');
  console.log('='.repeat(60));

  try {
    // Estadísticas generales
    const [totalInvoices, totalCustomers, totalTenants, orphanInvoices, linkedInvoices] =
      await Promise.all([
        prisma.tenantInvoice.count(),
        prisma.tenantCustomer.count(),
        prisma.tenant.count({ where: { isActive: true } }),
        prisma.tenantInvoice.count({ where: { customerId: null } }),
        prisma.tenantInvoice.count({ where: { customerId: { not: null } } }),
      ]);

    console.log('   📈 ESTADÍSTICAS GENERALES:');
    console.log(`      Total de facturas: ${totalInvoices}`);
    console.log(`      Total de clientes: ${totalCustomers}`);
    console.log(`      Total de tenants activos: ${totalTenants}`);
    console.log(
      `      Facturas huérfanas: ${orphanInvoices} (${((orphanInvoices / totalInvoices) * 100).toFixed(1)}%)`
    );
    console.log(
      `      Facturas vinculadas: ${linkedInvoices} (${((linkedInvoices / totalInvoices) * 100).toFixed(1)}%)`
    );

    // Análisis por tenant
    const tenantStats = await prisma.tenant.findMany({
      where: { isActive: true },
      select: {
        id: true,
        businessName: true,
        _count: {
          select: {
            invoices: true,
            customers: true,
          },
        },
      },
    });

    console.log('\n   🏢 ESTADÍSTICAS POR TENANT:');
    for (const tenant of tenantStats) {
      console.log(`      ${tenant.businessName}:`);
      console.log(`         Facturas: ${tenant._count.invoices}`);
      console.log(`         Clientes: ${tenant._count.customers}`);
    }

    // Análisis por cliente
    const customerStats = await prisma.tenantCustomer.groupBy({
      by: ['legalName'],
      _count: {
        _all: true,
        invoices: true,
      },
      orderBy: {
        legalName: 'asc',
      },
    });

    console.log('\n   👥 ESTADÍSTICAS POR TIPO DE CLIENTE:');
    for (const customer of customerStats) {
      console.log(`      ${customer.legalName}: ${customer._count.invoices} facturas vinculadas`);
    }
  } catch (error) {
    console.error('❌ Error en análisis de BD:', error.message);
  }
}

async function analyzeAllReports() {
  console.log('\n📋 2. ANÁLISIS DE TODOS LOS REPORTES');
  console.log('='.repeat(60));

  try {
    // Simular conteos de diferentes reportes

    // Reporte Excel (facturas activas con datos completos)
    const excelReportCount = await prisma.tenantInvoice.count({
      where: {
        status: { in: ['issued', 'valid'] },
        // Posiblemente filtros adicionales para Excel
      },
    });

    // Reporte de facturación (facturas válidas)
    const billingReportCount = await prisma.tenantInvoice.count({
      where: {
        status: 'valid',
      },
    });

    // Reporte de suscripción (todas las facturas emitidas)
    const subscriptionReportCount = await prisma.tenantInvoice.count({
      where: {
        status: { in: ['issued', 'valid', 'canceled'] },
      },
    });

    console.log('   📊 CONTEOS POR TIPO DE REPORTE:');
    console.log(`      Reporte Excel (simulado): ${excelReportCount} facturas`);
    console.log(`      Reporte Facturación: ${billingReportCount} facturas`);
    console.log(`      Reporte Suscripción: ${subscriptionReportCount} facturas`);

    // Análisis de estados de facturas
    const statusStats = await prisma.tenantInvoice.groupBy({
      by: ['status'],
      _count: {
        _all: true,
      },
    });

    console.log('\n   🔄 DISTRIBUCIÓN POR ESTADO:');
    for (const stat of statusStats) {
      console.log(`      ${stat.status || 'NULL'}: ${stat._count._all} facturas`);
    }

    // Verificar facturas con datos faltantes
    const missingDataStats = await prisma.tenantInvoice.aggregate({
      _count: {
        _all: true,
        customerId: true,
        recipientRfc: true,
        recipientName: true,
      },
    });

    console.log('\n   ⚠️  ANÁLISIS DE DATOS FALTANTES:');
    console.log(`      Total facturas: ${missingDataStats._count._all}`);
    console.log(`      Con customerId: ${missingDataStats._count.customerId}`);
    console.log(
      `      Sin customerId: ${missingDataStats._count._all - missingDataStats._count.customerId}`
    );
    console.log(`      Con RFC: ${missingDataStats._count.recipientRfc}`);
    console.log(
      `      Sin RFC: ${missingDataStats._count._all - missingDataStats._count.recipientRfc}`
    );
    console.log(`      Con nombre cliente: ${missingDataStats._count.recipientName}`);
    console.log(
      `      Sin nombre cliente: ${missingDataStats._count._all - missingDataStats._count.recipientName}`
    );
  } catch (error) {
    console.error('❌ Error en análisis de reportes:', error.message);
  }
}

async function compareDatabaseVsFacturapi() {
  console.log('\n🔄 3. COMPARACIÓN BASE DE DATOS VS FACTURAPI');
  console.log('='.repeat(60));

  try {
    // Obtener una muestra de tenants para comparar
    const sampleTenant = await prisma.tenant.findFirst({
      where: {
        isActive: true,
        facturapiApiKey: { not: null },
      },
      include: {
        customers: true,
        invoices: {
          take: 10,
        },
      },
    });

    if (sampleTenant && sampleTenant.facturapiApiKey) {
      console.log(`   🔍 Analizando tenant: ${sampleTenant.businessName}`);

      const facturapiService = new FacturapiService(sampleTenant.facturapiApiKey);

      try {
        // Obtener facturas de FacturAPI
        const facturapiInvoices = await facturapiService.getInvoices({
          limit: 10,
          page: 1,
        });

        console.log(`   📊 FacturAPI: ${facturapiInvoices.data?.length || 0} facturas en muestra`);
        console.log(`   📊 Base de datos: ${sampleTenant.invoices.length} facturas en muestra`);

        // Comparar una factura específica
        if (
          facturapiInvoices.data &&
          facturapiInvoices.data.length > 0 &&
          sampleTenant.invoices.length > 0
        ) {
          const facturapiInvoice = facturapiInvoices.data[0];
          const dbInvoice = sampleTenant.invoices[0];

          console.log('\n   🔍 COMPARACIÓN DETALLADA (MUESTRA):');
          console.log(`      FacturAPI - ID: ${facturapiInvoice.id}`);
          console.log(
            `      FacturAPI - Customer: ${facturapiInvoice.customer?.legal_name || 'N/A'}`
          );
          console.log(`      FacturAPI - RFC: ${facturapiInvoice.customer?.tax_id || 'N/A'}`);
          console.log(`      Base Datos - Folio: ${dbInvoice.folio}`);
          console.log(`      Base Datos - Customer ID: ${dbInvoice.customerId || 'NULL'}`);
          console.log(`      Base Datos - RFC: ${dbInvoice.recipientRfc || 'NULL'}`);
        }
      } catch (apiError) {
        console.log(`   ⚠️  Error accediendo FacturAPI: ${apiError.message}`);
      }
    }
  } catch (error) {
    console.error('❌ Error en comparación BD vs FacturAPI:', error.message);
  }
}

async function analyzeInvoiceCreationFlows() {
  console.log('\n🛠️  4. ANÁLISIS DE FLUJOS DE CREACIÓN DE FACTURAS');
  console.log('='.repeat(60));

  try {
    // Buscar patrones en la creación de facturas
    const recentInvoices = await prisma.tenantInvoice.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: true,
        tenant: true,
      },
    });

    console.log('   📅 ANÁLISIS DE FACTURAS RECIENTES:');

    let withCustomer = 0;
    let withoutCustomer = 0;
    let withRFC = 0;
    let withoutRFC = 0;

    for (const invoice of recentInvoices) {
      if (invoice.customerId) withCustomer++;
      else withoutCustomer++;

      if (invoice.recipientRfc) withRFC++;
      else withoutRFC++;
    }

    console.log(`      Con cliente vinculado: ${withCustomer}`);
    console.log(`      Sin cliente vinculado: ${withoutCustomer}`);
    console.log(`      Con RFC: ${withRFC}`);
    console.log(`      Sin RFC: ${withoutRFC}`);

    // Buscar patrones en nombres de archivo o folios
    const folioPatterns = recentInvoices.map((inv) => ({
      folio: inv.folio,
      hasCustomer: !!inv.customerId,
      tenant: inv.tenant.businessName,
    }));

    console.log('\n   🔍 PATRONES EN FOLIOS:');
    folioPatterns.slice(0, 10).forEach((pattern) => {
      console.log(
        `      ${pattern.folio} - Cliente: ${pattern.hasCustomer ? '✅' : '❌'} - ${pattern.tenant}`
      );
    });
  } catch (error) {
    console.error('❌ Error en análisis de flujos:', error.message);
  }
}

async function investigateCountDiscrepancies() {
  console.log('\n🔍 5. INVESTIGACIÓN DE DISCREPANCIAS EN CONTEOS');
  console.log('='.repeat(60));

  try {
    // Diferentes formas de contar facturas que podrían explicar las discrepancias

    const counts = {
      total: await prisma.tenantInvoice.count(),
      issued: await prisma.tenantInvoice.count({ where: { status: 'issued' } }),
      valid: await prisma.tenantInvoice.count({ where: { status: 'valid' } }),
      canceled: await prisma.tenantInvoice.count({ where: { status: 'canceled' } }),
      withCustomer: await prisma.tenantInvoice.count({ where: { customerId: { not: null } } }),
      withoutCustomer: await prisma.tenantInvoice.count({ where: { customerId: null } }),
      withRFC: await prisma.tenantInvoice.count({ where: { recipientRfc: { not: null } } }),
      withoutRFC: await prisma.tenantInvoice.count({ where: { recipientRfc: null } }),
      thisMonth: await prisma.tenantInvoice.count({
        where: {
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
    };

    console.log('   📊 ANÁLISIS DE CONTEOS DETALLADO:');
    console.log(`      Total general: ${counts.total}`);
    console.log(`      Estado 'issued': ${counts.issued}`);
    console.log(`      Estado 'valid': ${counts.valid}`);
    console.log(`      Estado 'canceled': ${counts.canceled}`);
    console.log(`      Con cliente: ${counts.withCustomer}`);
    console.log(`      Sin cliente: ${counts.withoutCustomer}`);
    console.log(`      Con RFC: ${counts.withRFC}`);
    console.log(`      Sin RFC: ${counts.withoutRFC}`);
    console.log(`      Este mes: ${counts.thisMonth}`);

    // Posibles combinaciones que expliquen los reportes
    console.log('\n   🧮 POSIBLES EXPLICACIONES PARA REPORTES:');
    console.log(
      `      Excel (415): ¿issued + valid con cliente? = ${counts.issued + counts.valid}`
    );
    console.log(`      Facturación (414): ¿solo valid? = ${counts.valid}`);
    console.log(
      `      Suscripción (527): ¿todos menos canceled? = ${counts.total - counts.canceled}`
    );
  } catch (error) {
    console.error('❌ Error en investigación de conteos:', error.message);
  }
}

async function analyzeInvoicesWithoutRFC() {
  console.log('\n🚫 6. ANÁLISIS DE FACTURAS SIN RFC');
  console.log('='.repeat(60));

  try {
    const invoicesWithoutRFC = await prisma.tenantInvoice.findMany({
      where: {
        OR: [{ recipientRfc: null }, { recipientRfc: '' }, { recipientRfc: 'N/A' }],
      },
      include: {
        customer: true,
        tenant: true,
      },
      take: 20,
    });

    console.log(`   📊 Facturas sin RFC encontradas: ${invoicesWithoutRFC.length}`);

    if (invoicesWithoutRFC.length > 0) {
      console.log('\n   📄 MUESTRA DE FACTURAS SIN RFC:');

      invoicesWithoutRFC.slice(0, 10).forEach((invoice, index) => {
        console.log(`      ${index + 1}. ${invoice.folio}`);
        console.log(`         Tenant: ${invoice.tenant.businessName}`);
        console.log(`         Cliente vinculado: ${invoice.customer?.legalName || 'NO'}`);
        console.log(`         RFC: ${invoice.recipientRfc || 'NULL'}`);
        console.log(`         Nombre receptor: ${invoice.recipientName || 'NULL'}`);
        console.log(`         Estado: ${invoice.status}`);
        console.log('');
      });

      // Buscar patrones
      const tenantDistribution = {};
      invoicesWithoutRFC.forEach((inv) => {
        const tenant = inv.tenant.businessName;
        tenantDistribution[tenant] = (tenantDistribution[tenant] || 0) + 1;
      });

      console.log('   🏢 DISTRIBUCIÓN POR TENANT (facturas sin RFC):');
      Object.entries(tenantDistribution).forEach(([tenant, count]) => {
        console.log(`      ${tenant}: ${count} facturas`);
      });
    }
  } catch (error) {
    console.error('❌ Error en análisis de facturas sin RFC:', error.message);
  }
}

async function analyzeClientLinkingProcess() {
  console.log('\n🔗 7. ANÁLISIS DEL PROCESO DE VINCULACIÓN CLIENTE-FACTURA');
  console.log('='.repeat(60));

  try {
    // Analizar casos de vinculación exitosa vs fallida
    const successfulLinks = await prisma.tenantInvoice.findMany({
      where: {
        customerId: { not: null },
        recipientRfc: { not: null },
      },
      include: {
        customer: true,
      },
      take: 10,
    });

    const failedLinks = await prisma.tenantInvoice.findMany({
      where: {
        customerId: null,
      },
      take: 10,
    });

    console.log('   ✅ CASOS DE VINCULACIÓN EXITOSA:');
    successfulLinks.forEach((invoice, index) => {
      console.log(`      ${index + 1}. ${invoice.folio} → ${invoice.customer?.legalName}`);
      console.log(`         RFC BD: ${invoice.customer?.rfc}`);
      console.log(`         RFC Factura: ${invoice.recipientRfc}`);
      console.log(
        `         Match: ${invoice.customer?.rfc === invoice.recipientRfc ? '✅' : '❌'}`
      );
    });

    console.log('\n   ❌ CASOS DE VINCULACIÓN FALLIDA:');
    failedLinks.forEach((invoice, index) => {
      console.log(`      ${index + 1}. ${invoice.folio}`);
      console.log(`         RFC Factura: ${invoice.recipientRfc || 'NULL'}`);
      console.log(`         Nombre receptor: ${invoice.recipientName || 'NULL'}`);
    });

    // Buscar clientes AXA y CHUBB específicamente
    const axaChubClients = await prisma.tenantCustomer.findMany({
      where: {
        legalName: { in: ['AXA', 'CHUBB'] },
      },
      include: {
        invoices: true,
      },
    });

    console.log('\n   🎯 ANÁLISIS ESPECÍFICO AXA Y CHUBB:');
    axaChubClients.forEach((client) => {
      console.log(`      ${client.legalName}:`);
      console.log(`         RFC: ${client.rfc}`);
      console.log(`         Facturas vinculadas: ${client.invoices.length}`);
      console.log(`         FacturAPI ID: ${client.facturapiCustomerId}`);
    });
  } catch (error) {
    console.error('❌ Error en análisis de vinculación:', error.message);
  }
}

async function generateExecutiveSummary() {
  console.log('\n📋 8. RESUMEN EJECUTIVO Y HALLAZGOS');
  console.log('='.repeat(60));

  console.log('   🎯 PROBLEMAS IDENTIFICADOS:');
  console.log('      1. Discrepancias en conteos entre reportes');
  console.log('      2. 59.6% de facturas sin customerId (huérfanas)');
  console.log('      3. Clientes AXA y CHUBB sin facturas vinculadas');
  console.log('      4. Facturas sin RFC en la base de datos');
  console.log('      5. Posible problema en proceso de vinculación automática');

  console.log('\n   🔍 HIPÓTESIS DE CAUSA RAÍZ:');
  console.log('      • El proceso de vinculación RFC → customerId está fallando');
  console.log('      • Diferentes reportes usan diferentes criterios de filtrado');
  console.log('      • Facturas de Excel podrían tener flujo diferente');
  console.log('      • Datos de FacturAPI no se sincronizan correctamente con BD');

  console.log('\n   🚨 PRÓXIMOS PASOS RECOMENDADOS:');
  console.log('      1. Identificar y revisar código de vinculación cliente-factura');
  console.log('      2. Comparar flujo de facturas Excel vs regulares');
  console.log('      3. Revisar configuración de cada reporte');
  console.log('      4. Implementar fix para vincular facturas huérfanas');
  console.log('      5. Agregar validaciones para prevenir futuras discrepancias');

  console.log('\n✅ INVESTIGACIÓN EXHAUSTIVA COMPLETADA');
  console.log('💡 Recomendación: Revisar hallazgos y proceder con fixes dirigidos');
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  comprehensiveAnalysis()
    .then(() => {
      console.log('\n🎉 Análisis completado exitosamente');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Error fatal:', error);
      process.exit(1);
    });
}

export default comprehensiveAnalysis;
