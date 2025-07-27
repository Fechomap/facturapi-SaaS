// scripts/migration-data-collector.js
// Estrategia para recolectar y almacenar datos de FacturAPI

import prisma from '../lib/prisma.js';
import FacturapiService from '../services/facturapi.service.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * ESTRATEGIA DE ALMACENAMIENTO TEMPORAL:
 * 1. JSON files por tenant (backup y auditoría)
 * 2. Tabla temporal en PostgreSQL (staging)
 * 3. Migración final a campos existentes
 */

class MigrationDataCollector {
  constructor() {
    this.dataDir = './migration-data';
    this.batchSize = 50; // Facturas por lote
  }

  /**
   * PASO 1: Recolectar datos de FacturAPI para todos los tenants
   */
  async collectAllTenantData() {
    console.log('🚀 Iniciando recolección de datos de FacturAPI...');

    // 1. Obtener todos los tenants activos
    const tenants = await prisma.tenant.findMany({
      where: {
        isActive: true,
        facturapiApiKey: { not: null },
      },
      select: {
        id: true,
        businessName: true,
        _count: { invoices: true },
      },
    });

    console.log(`📊 Tenants encontrados: ${tenants.length}`);

    // 2. Crear directorio para datos
    await this.ensureDataDirectory();

    // 3. Procesar cada tenant
    const results = [];
    for (const tenant of tenants) {
      console.log(`\n🏢 Procesando: ${tenant.businessName} (${tenant._count.invoices} facturas)`);

      const tenantResult = await this.collectTenantData(tenant);
      results.push(tenantResult);

      // Pausa entre tenants para no sobrecargar FacturAPI
      await this.sleep(2000);
    }

    // 4. Generar reporte final
    await this.generateCollectionReport(results);
    return results;
  }

  /**
   * PASO 2: Recolectar datos de un tenant específico
   */
  async collectTenantData(tenant) {
    try {
      // Obtener facturas de BD
      const invoices = await prisma.tenantInvoice.findMany({
        where: { tenantId: tenant.id },
        include: { customer: true },
        orderBy: { createdAt: 'desc' },
      });

      console.log(`📝 Facturas en BD: ${invoices.length}`);

      const enrichedData = [];
      const errors = [];

      // Procesar en lotes
      for (let i = 0; i < invoices.length; i += this.batchSize) {
        const batch = invoices.slice(i, i + this.batchSize);
        console.log(
          `🔄 Procesando lote ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(invoices.length / this.batchSize)}`
        );

        const batchResult = await this.processBatch(tenant.id, batch);
        enrichedData.push(...batchResult.success);
        errors.push(...batchResult.errors);

        // Pausa entre lotes
        await this.sleep(1000);
      }

      // Guardar datos del tenant
      const tenantData = {
        tenantId: tenant.id,
        businessName: tenant.businessName,
        totalInvoices: invoices.length,
        successfulEnriched: enrichedData.length,
        errors: errors.length,
        timestamp: new Date().toISOString(),
        data: enrichedData,
        errorDetails: errors,
      };

      await this.saveTenantData(tenant.id, tenantData);

      return {
        tenantId: tenant.id,
        businessName: tenant.businessName,
        success: true,
        stats: {
          total: invoices.length,
          enriched: enrichedData.length,
          errors: errors.length,
        },
      };
    } catch (error) {
      console.error(`❌ Error procesando tenant ${tenant.id}:`, error.message);
      return {
        tenantId: tenant.id,
        businessName: tenant.businessName,
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Procesar lote de facturas
   */
  async processBatch(tenantId, invoices) {
    const success = [];
    const errors = [];

    try {
      const facturapiClient = await FacturapiService.getFacturapiClient(tenantId);

      for (const invoice of invoices) {
        try {
          // Consultar FacturAPI
          const facturapiData = await facturapiClient.invoices.retrieve(invoice.facturapiInvoiceId);

          // Estructura de datos enriquecidos
          const enrichedInvoice = {
            // Datos de BD
            dbId: invoice.id,
            facturapiInvoiceId: invoice.facturapiInvoiceId,
            series: invoice.series,
            folioNumber: invoice.folioNumber,
            total: parseFloat(invoice.total),

            // Datos de FacturAPI para persistir
            uuid: facturapiData.uuid,
            subtotal: facturapiData.subtotal || this.calculateSubtotal(facturapiData),
            ivaAmount: this.extractIVA(facturapiData),
            retencionAmount: this.extractRetencion(facturapiData),
            currency: facturapiData.currency,
            verificationUrl: facturapiData.verification_url,

            // Metadatos
            lastSynced: new Date().toISOString(),
            facturapiStatus: facturapiData.status,
          };

          success.push(enrichedInvoice);
        } catch (error) {
          errors.push({
            invoiceId: invoice.id,
            facturapiInvoiceId: invoice.facturapiInvoiceId,
            error: error.message,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      throw new Error(`Error obteniendo cliente FacturAPI: ${error.message}`);
    }

    return { success, errors };
  }

  // Utilidades para cálculos
  calculateSubtotal(facturapiData) {
    if (facturapiData.subtotal) return facturapiData.subtotal;

    // Calcular desde items si no está disponible
    return (
      facturapiData.items?.reduce((sum, item) => {
        return sum + item.quantity * item.product.price;
      }, 0) || 0
    );
  }

  extractIVA(facturapiData) {
    if (!facturapiData.items) return 0;

    return facturapiData.items.reduce((total, item) => {
      const ivaTax = item.product.taxes?.find((tax) => tax.type === 'IVA' && !tax.withholding);

      if (ivaTax) {
        const base = item.quantity * item.product.price;
        return total + base * (ivaTax.rate || 0);
      }

      return total;
    }, 0);
  }

  extractRetencion(facturapiData) {
    if (!facturapiData.items) return 0;

    return facturapiData.items.reduce((total, item) => {
      const retencionTax = item.product.taxes?.find((tax) => tax.withholding === true);

      if (retencionTax) {
        const base = item.quantity * item.product.price;
        return total + base * (retencionTax.rate || 0);
      }

      return total;
    }, 0);
  }

  // Utilidades de archivo
  async ensureDataDirectory() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  async saveTenantData(tenantId, data) {
    const filePath = path.join(this.dataDir, `tenant_${tenantId}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`💾 Datos guardados: ${filePath}`);
  }

  async generateCollectionReport(results) {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTenants: results.length,
        successfulTenants: results.filter((r) => r.success).length,
        failedTenants: results.filter((r) => !r.success).length,
        totalInvoicesEnriched: results
          .filter((r) => r.success)
          .reduce((sum, r) => sum + (r.stats?.enriched || 0), 0),
      },
      details: results,
    };

    const reportPath = path.join(this.dataDir, 'collection_report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    console.log(`\n📊 REPORTE FINAL:`);
    console.log(
      `✅ Tenants procesados: ${report.summary.successfulTenants}/${report.summary.totalTenants}`
    );
    console.log(`📝 Facturas enriquecidas: ${report.summary.totalInvoicesEnriched}`);
    console.log(`📄 Reporte guardado: ${reportPath}`);
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Script ejecutable
if (process.argv[2] === 'run') {
  const collector = new MigrationDataCollector();

  collector
    .collectAllTenantData()
    .then((results) => {
      console.log('\n🎉 RECOLECCIÓN COMPLETADA');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Error en recolección:', error);
      process.exit(1);
    });
}

export default MigrationDataCollector;
