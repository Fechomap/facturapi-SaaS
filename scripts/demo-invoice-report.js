// scripts/demo-invoice-report.js
// DEMO: Análisis de viabilidad para reporte de facturas Excel

import prisma from '../lib/prisma.js';
import FacturapiService from '../services/facturapi.service.js';

/**
 * PUNTO 1: Verificar qué datos podemos obtener de facturas
 * PUNTO 2: Medir costos de consultas para diferentes volúmenes
 */
class InvoiceReportDemo {
  /**
   * PUNTO 1: Obtener datos completos de facturas (DEMO JSON)
   */
  static async getDemoInvoiceData(tenantId, limit = 5) {
    console.log(`\n🔍 DEMO: Obteniendo datos de facturas para tenant ${tenantId}`);
    console.log(`📊 Límite de facturas para demo: ${limit}`);

    const startTime = Date.now();

    try {
      // 1. Datos disponibles en BD
      const invoicesFromDB = await prisma.tenantInvoice.findMany({
        where: { tenantId },
        include: {
          customer: true,
          tenant: true,
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
      });

      console.log(`📝 Facturas encontradas en BD: ${invoicesFromDB.length}`);

      if (invoicesFromDB.length === 0) {
        console.log('❌ No hay facturas para analizar');
        return { success: false, message: 'Sin facturas disponibles' };
      }

      // 2. Obtener datos adicionales de FacturAPI
      const facturapiClient = await FacturapiService.getFacturapiClient(tenantId);
      const enrichedInvoices = [];

      for (const invoice of invoicesFromDB) {
        try {
          console.log(
            `🔄 Obteniendo datos de FacturAPI para factura ${invoice.facturapiInvoiceId}`
          );

          // Datos de FacturAPI
          const facturapiData = await facturapiClient.invoices.retrieve(invoice.facturapiInvoiceId);

          // Combinar datos de BD + FacturAPI
          const enrichedInvoice = {
            // DATOS DE BD
            bdData: {
              id: invoice.id,
              facturapiInvoiceId: invoice.facturapiInvoiceId,
              series: invoice.series,
              folioNumber: invoice.folioNumber,
              total: invoice.total,
              status: invoice.status,
              createdAt: invoice.createdAt,
              invoiceDate: invoice.invoiceDate,
              customer: {
                legalName: invoice.customer?.legalName,
                rfc: invoice.customer?.rfc,
                email: invoice.customer?.email,
              },
            },

            // DATOS DE FACTURAPI
            facturapiData: {
              uuid: facturapiData.uuid,
              folioFiscal: facturapiData.uuid, // UUID = Folio Fiscal
              total: facturapiData.total,
              subtotal: facturapiData.subtotal,
              currency: facturapiData.currency,
              status: facturapiData.status,
              verificationUrl: facturapiData.verification_url,
              customer: {
                legalName: facturapiData.customer?.legal_name,
                taxId: facturapiData.customer?.tax_id, // RFC
                taxSystem: facturapiData.customer?.tax_system,
              },
              taxes: facturapiData.taxes,
              items: facturapiData.items,
            },

            // DATOS CALCULADOS
            calculatedData: {
              folio: `${invoice.series}${invoice.folioNumber}`,
              ivaAmount: this.calculateIVA(facturapiData),
              retencionAmount: this.calculateRetencion(facturapiData),
              discrepancies: this.findDiscrepancies(invoice, facturapiData),
            },
          };

          enrichedInvoices.push(enrichedInvoice);
        } catch (error) {
          console.error(
            `❌ Error obteniendo datos de FacturAPI para ${invoice.facturapiInvoiceId}:`,
            error.message
          );

          // Incluir solo datos de BD si falla FacturAPI
          enrichedInvoices.push({
            bdData: {
              /* datos de BD */
            },
            facturapiData: null,
            error: error.message,
          });
        }
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`\n✅ DEMO COMPLETADO`);
      console.log(`⏱️  Tiempo total: ${duration}ms`);
      console.log(`📊 Facturas procesadas: ${enrichedInvoices.length}`);
      console.log(`⚡ Promedio por factura: ${Math.round(duration / enrichedInvoices.length)}ms`);

      return {
        success: true,
        stats: {
          totalInvoices: enrichedInvoices.length,
          duration,
          averagePerInvoice: Math.round(duration / enrichedInvoices.length),
        },
        data: enrichedInvoices,
      };
    } catch (error) {
      console.error(`❌ Error en demo:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * PUNTO 2: Analizar costo de consultas para diferentes volúmenes
   */
  static async analyzeCostsByVolume(tenantId) {
    console.log(`\n📈 ANÁLISIS DE COSTOS POR VOLUMEN`);

    // Primero verificar cuántas facturas tiene el tenant
    const totalInvoices = await prisma.tenantInvoice.count({
      where: { tenantId },
    });

    console.log(`📊 Total de facturas del tenant: ${totalInvoices}`);

    const scenarios = [
      { name: 'Pequeño', invoices: Math.min(10, totalInvoices) },
      { name: 'Mediano', invoices: Math.min(100, totalInvoices) },
      { name: 'Grande', invoices: Math.min(500, totalInvoices) },
      { name: 'Muy Grande', invoices: Math.min(1000, totalInvoices) },
      { name: 'Extremo', invoices: totalInvoices },
    ];

    const results = [];

    for (const scenario of scenarios) {
      if (scenario.invoices === 0) continue;

      console.log(`\n🔄 Analizando escenario: ${scenario.name} (${scenario.invoices} facturas)`);

      const startTime = Date.now();

      try {
        // Solo consulta a BD (sin FacturAPI para esta prueba)
        const invoices = await prisma.tenantInvoice.findMany({
          where: { tenantId },
          include: { customer: true },
          take: scenario.invoices,
        });

        const endTime = Date.now();
        const duration = endTime - startTime;

        const result = {
          scenario: scenario.name,
          invoiceCount: scenario.invoices,
          dbQueryTime: duration,
          estimatedFacturapiTime: duration * 3, // Estimación: FacturAPI es ~3x más lento
          totalEstimatedTime: duration + duration * 3,
          memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024, // MB
        };

        results.push(result);

        console.log(
          `✅ ${scenario.name}: ${duration}ms BD + ~${duration * 3}ms FacturAPI = ~${duration * 4}ms total`
        );
      } catch (error) {
        console.error(`❌ Error en escenario ${scenario.name}:`, error.message);
      }
    }

    // Análisis de concurrencia
    console.log(`\n🚦 ANÁLISIS DE CONCURRENCIA`);
    console.log(`📊 Si 15 usuarios solicitan reportes simultáneamente:`);

    results.forEach((result) => {
      const concurrent15 = result.totalEstimatedTime * 15;
      const serverLoad =
        concurrent15 > 30000 ? '🔴 CRÍTICO' : concurrent15 > 15000 ? '🟡 ALTO' : '🟢 ACEPTABLE';

      console.log(`   ${result.scenario}: ${concurrent15}ms total (${serverLoad})`);
    });

    return results;
  }

  /**
   * Calcular IVA de datos de FacturAPI
   */
  static calculateIVA(facturapiData) {
    if (!facturapiData.taxes) return 0;

    return facturapiData.taxes
      .filter((tax) => tax.type === 'IVA')
      .reduce((sum, tax) => sum + (tax.amount || 0), 0);
  }

  /**
   * Calcular retenciones de datos de FacturAPI
   */
  static calculateRetencion(facturapiData) {
    if (!facturapiData.taxes) return 0;

    return facturapiData.taxes
      .filter((tax) => tax.type === 'ISR' || tax.type === 'IVA_RET')
      .reduce((sum, tax) => sum + (tax.amount || 0), 0);
  }

  /**
   * Encontrar discrepancias entre BD y FacturAPI
   */
  static findDiscrepancies(dbInvoice, facturapiData) {
    const discrepancies = [];

    if (Math.abs(dbInvoice.total - facturapiData.total) > 0.01) {
      discrepancies.push(
        `Total difiere: BD=${dbInvoice.total} vs FacturAPI=${facturapiData.total}`
      );
    }

    return discrepancies;
  }
}

// Ejecutar demo si el script se llama directamente
if (process.argv[2] === 'run') {
  const tenantId = process.argv[3];

  if (!tenantId) {
    console.log('❌ Uso: node demo-invoice-report.js run <tenantId>');
    process.exit(1);
  }

  console.log(`🚀 Iniciando análisis para tenant: ${tenantId}`);

  InvoiceReportDemo.getDemoInvoiceData(tenantId, 3)
    .then((result) => {
      console.log(`\n📋 RESULTADO DEMO:`);
      console.log(JSON.stringify(result, null, 2));

      return InvoiceReportDemo.analyzeCostsByVolume(tenantId);
    })
    .then((costAnalysis) => {
      console.log(`\n💰 ANÁLISIS DE COSTOS:`);
      console.table(costAnalysis);

      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Error en demo:', error);
      process.exit(1);
    });
}

export default InvoiceReportDemo;
