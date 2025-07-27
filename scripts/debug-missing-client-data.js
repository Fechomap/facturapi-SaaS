#!/usr/bin/env node

// scripts/debug-missing-client-data.js
// Script de diagnóstico para investigar clientes AXA y CHUBB con datos faltantes

import prisma from '../lib/prisma.js';
import FacturapiService from '../services/facturapi.service.js';

/**
 * Script para diagnosticar el problema de clientes faltantes en reportes Excel
 * Específicamente para AXA y CHUBB donde aparecen como "RFC no disponible" y "Cliente no especificado"
 */

async function diagnosticMissingClientData() {
  console.log('🔍 INICIANDO DIAGNÓSTICO DE CLIENTES FALTANTES');
  console.log('=' * 60);

  try {
    // PASO 1: Obtener todos los tenants activos
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true, businessName: true, rfc: true },
    });

    console.log(`📋 Tenants encontrados: ${tenants.length}`);

    for (const tenant of tenants) {
      console.log(`\n🏢 ANALIZANDO TENANT: ${tenant.businessName} (${tenant.id})`);

      await analyzeTenantInvoices(tenant.id, tenant.businessName);
    }
  } catch (error) {
    console.error('❌ Error en diagnóstico principal:', error);
  } finally {
    await prisma.$disconnect();
  }
}

async function analyzeTenantInvoices(tenantId, tenantName) {
  try {
    // PASO 2: Obtener facturas con clientes null o datos faltantes
    const problematicInvoices = await prisma.tenantInvoice.findMany({
      where: {
        tenantId,
        OR: [
          { customerId: null },
          { customer: null },
          {
            customer: {
              OR: [
                { legalName: null },
                { rfc: null },
                { legalName: { contains: 'no especificado' } },
                { rfc: { contains: 'no disponible' } },
              ],
            },
          },
        ],
      },
      include: {
        customer: {
          select: {
            id: true,
            legalName: true,
            rfc: true,
            email: true,
            facturapiCustomerId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20, // Limitar para análisis inicial
    });

    console.log(`  📊 Facturas problemáticas encontradas: ${problematicInvoices.length}`);

    if (problematicInvoices.length > 0) {
      console.log('\n  🔍 ANÁLISIS DETALLADO:');

      for (const invoice of problematicInvoices.slice(0, 5)) {
        console.log(`\n    📄 Factura ID: ${invoice.id}`);
        console.log(`       Serie-Folio: ${invoice.series}${invoice.folioNumber}`);
        console.log(`       FacturAPI ID: ${invoice.facturapiInvoiceId}`);
        console.log(`       Customer ID en BD: ${invoice.customerId}`);
        console.log(`       Customer data:`, invoice.customer);

        // PASO 3: Consultar datos en FacturAPI
        await analyzeFacturapiData(tenantId, invoice);
      }
    }

    // PASO 4: Buscar facturas que podrían ser de AXA o CHUBB por patrón
    await searchSuspiciousPatterns(tenantId);
  } catch (error) {
    console.error(`  ❌ Error analizando tenant ${tenantId}:`, error);
  }
}

async function analyzeFacturapiData(tenantId, invoice) {
  try {
    console.log(`\n      🔗 CONSULTANDO FACTURAPI:`);

    const facturapiClient = await FacturapiService.getFacturapiClient(tenantId);
    const facturapiData = await facturapiClient.invoices.retrieve(invoice.facturapiInvoiceId);

    console.log(`       UUID: ${facturapiData.uuid}`);
    console.log(`       Customer en FacturAPI:`, {
      legal_name: facturapiData.customer?.legal_name,
      tax_id: facturapiData.customer?.tax_id,
      email: facturapiData.customer?.email,
    });

    // Verificar si hay discrepancia entre BD y FacturAPI
    const bdCustomerName = invoice.customer?.legalName;
    const apiCustomerName = facturapiData.customer?.legal_name;

    if ((!bdCustomerName || bdCustomerName.includes('no especificado')) && apiCustomerName) {
      console.log(`       ⚠️ DISCREPANCIA DETECTADA:`);
      console.log(`         BD: "${bdCustomerName}"`);
      console.log(`         API: "${apiCustomerName}"`);

      // Verificar si es AXA o CHUBB
      if (apiCustomerName.includes('AXA') || apiCustomerName.includes('CHUBB')) {
        console.log(`       🎯 CLIENTE OBJETIVO ENCONTRADO: ${apiCustomerName}`);
        await analyzeClientMismatch(tenantId, invoice, facturapiData);
      }
    }
  } catch (error) {
    console.log(`       ❌ Error consultando FacturAPI: ${error.message}`);
  }
}

async function searchSuspiciousPatterns(tenantId) {
  try {
    console.log(`\n  🔎 BUSCANDO PATRONES SOSPECHOSOS:`);

    // Buscar facturas recientes sin customer asociado
    const recentOrphanInvoices = await prisma.tenantInvoice.findMany({
      where: {
        tenantId,
        customerId: null,
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Últimos 30 días
        },
      },
      select: {
        id: true,
        series: true,
        folioNumber: true,
        facturapiInvoiceId: true,
        total: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    console.log(`     📊 Facturas huérfanas (últimos 30 días): ${recentOrphanInvoices.length}`);

    if (recentOrphanInvoices.length > 0) {
      console.log(`     📋 Ejemplos:`);
      recentOrphanInvoices.slice(0, 3).forEach((inv) => {
        console.log(
          `       - ${inv.series}${inv.folioNumber} | $${inv.total} | ${inv.createdAt.toDateString()}`
        );
      });
    }

    // Buscar clientes con nombres que podrían ser AXA o CHUBB
    const suspiciousClients = await prisma.tenantCustomer.findMany({
      where: {
        tenantId,
        OR: [
          { legalName: { contains: 'AXA', mode: 'insensitive' } },
          { legalName: { contains: 'CHUBB', mode: 'insensitive' } },
          { rfc: { contains: 'AXA' } },
          { rfc: { contains: 'CHU' } },
        ],
      },
      select: {
        id: true,
        legalName: true,
        rfc: true,
        facturapiCustomerId: true,
        _count: {
          select: { invoices: true },
        },
      },
    });

    console.log(`\n     👥 Clientes AXA/CHUBB encontrados: ${suspiciousClients.length}`);
    suspiciousClients.forEach((client) => {
      console.log(
        `       - ${client.legalName} | RFC: ${client.rfc} | Facturas: ${client._count.invoices}`
      );
    });
  } catch (error) {
    console.error(`     ❌ Error en búsqueda de patrones:`, error);
  }
}

async function analyzeClientMismatch(tenantId, invoice, facturapiData) {
  console.log(`\n        🔬 ANÁLISIS PROFUNDO DE DISCREPANCIA:`);

  try {
    // Verificar si existe el cliente en la BD con el nombre de FacturAPI
    const apiCustomerName = facturapiData.customer?.legal_name;
    const apiCustomerRFC = facturapiData.customer?.tax_id;

    if (apiCustomerName) {
      const existingClient = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          OR: [
            { legalName: { contains: apiCustomerName.substring(0, 10), mode: 'insensitive' } },
            { rfc: apiCustomerRFC },
          ],
        },
      });

      if (existingClient) {
        console.log(`          ✅ Cliente existe en BD:`, existingClient);
        console.log(`          🔗 ¿Por qué no está vinculado a la factura?`);

        // Verificar el facturapiCustomerId
        if (existingClient.facturapiCustomerId) {
          console.log(
            `          📋 FacturAPI Customer ID en BD: ${existingClient.facturapiCustomerId}`
          );
          console.log(`          📋 FacturAPI Customer ID en API: ${facturapiData.customer?.id}`);
        }
      } else {
        console.log(`          ❌ Cliente NO existe en BD`);
        console.log(`          💡 Datos de FacturAPI:`, {
          name: apiCustomerName,
          rfc: apiCustomerRFC,
          id: facturapiData.customer?.id,
        });
      }
    }
  } catch (error) {
    console.error(`          ❌ Error en análisis profundo:`, error);
  }
}

// Función para obtener estadísticas generales
async function getGeneralStats() {
  console.log('\n📈 ESTADÍSTICAS GENERALES:');

  try {
    const totalInvoices = await prisma.tenantInvoice.count();
    const invoicesWithoutCustomer = await prisma.tenantInvoice.count({
      where: { customerId: null },
    });

    const invoicesWithBadCustomerData = await prisma.tenantInvoice.count({
      where: {
        customer: {
          OR: [
            { legalName: null },
            { rfc: null },
            { legalName: { contains: 'no especificado' } },
            { rfc: { contains: 'no disponible' } },
          ],
        },
      },
    });

    console.log(`  📊 Total de facturas: ${totalInvoices}`);
    console.log(
      `  ❌ Sin cliente asociado: ${invoicesWithoutCustomer} (${((invoicesWithoutCustomer / totalInvoices) * 100).toFixed(2)}%)`
    );
    console.log(
      `  ⚠️ Con datos de cliente problemáticos: ${invoicesWithBadCustomerData} (${((invoicesWithBadCustomerData / totalInvoices) * 100).toFixed(2)}%)`
    );
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
  }
}

// Función principal
async function main() {
  console.log('🚀 DIAGNÓSTICO DE CLIENTES FALTANTES EN REPORTES EXCEL');
  console.log('🎯 Enfoque: AXA y CHUBB con "RFC no disponible" y "Cliente no especificado"');
  console.log('📅', new Date().toLocaleString());
  console.log('=' * 80);

  await getGeneralStats();
  await diagnosticMissingClientData();

  console.log('\n✅ DIAGNÓSTICO COMPLETADO');
  console.log('📋 Revisa los resultados arriba para identificar el problema');
}

// Ejecutar si es llamado directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default { diagnosticMissingClientData, analyzeFacturapiData };
