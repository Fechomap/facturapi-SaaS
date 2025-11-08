/**
 * Script de Verificación: Datos Completos en Facturas
 *
 * Verifica que las facturas recién emitidas tienen todos los campos
 * financieros completos guardados en la base de datos.
 *
 * Uso:
 *   npx tsx scripts/verify-invoice-complete-data.ts              # Últimas 50 facturas
 *   npx tsx scripts/verify-invoice-complete-data.ts --count 100  # Últimas 100
 *   npx tsx scripts/verify-invoice-complete-data.ts --tenant <id> # Solo un tenant
 */

import prisma from '../src/lib/prisma';
import { createModuleLogger } from '../src/core/utils/logger';

const logger = createModuleLogger('verify-invoice-data');

// Argumentos de línea de comandos
const args = process.argv.slice(2);
const countIndex = args.indexOf('--count');
const count = countIndex !== -1 ? parseInt(args[countIndex + 1], 10) : 50;
const tenantIndex = args.indexOf('--tenant');
const specificTenantId = tenantIndex !== -1 ? args[tenantIndex + 1] : null;

interface VerificationResult {
  total: number;
  withCompleteData: number;
  withoutCompleteData: number;
  completeDataPercentage: number;
  samples: any[];
}

/**
 * Verifica si una factura tiene datos completos
 */
function hasCompleteData(invoice: any): boolean {
  return (
    invoice.subtotal !== null &&
    invoice.ivaAmount !== null &&
    invoice.currency !== null &&
    invoice.uuid !== null
  );
}

/**
 * Función principal de verificación
 */
async function verifyInvoiceData(): Promise<VerificationResult> {
  console.log('🔍 VERIFICACIÓN DE DATOS COMPLETOS EN FACTURAS');
  console.log('='.repeat(80));
  console.log(`   Cantidad a verificar: ${count}`);
  if (specificTenantId) {
    console.log(`   Tenant específico: ${specificTenantId}`);
  }
  console.log('='.repeat(80));
  console.log('');

  try {
    // Construir condición WHERE
    const whereCondition: any = {};
    if (specificTenantId) {
      whereCondition.tenantId = specificTenantId;
    }

    // Obtener últimas facturas ordenadas por fecha de creación
    const invoices = await prisma.tenantInvoice.findMany({
      where: whereCondition,
      orderBy: {
        createdAt: 'desc',
      },
      take: count,
      select: {
        id: true,
        tenantId: true,
        facturapiInvoiceId: true,
        series: true,
        folioNumber: true,
        total: true,
        uuid: true,
        createdAt: true,
        // Campos financieros completos
        subtotal: true,
        ivaAmount: true,
        retencionAmount: true,
        discount: true,
        currency: true,
        paymentForm: true,
        paymentMethod: true,
        verificationUrl: true,
        satCertNumber: true,
        usoCfdi: true,
        tipoComprobante: true,
        exportacion: true,
        items: true,
        // Relaciones
        customer: {
          select: {
            legalName: true,
            rfc: true,
          },
        },
        tenant: {
          select: {
            businessName: true,
            rfc: true,
          },
        },
      },
    });

    console.log(`📊 Facturas encontradas: ${invoices.length}\n`);

    // Clasificar facturas
    const withComplete = invoices.filter(hasCompleteData);
    const withoutComplete = invoices.filter((inv) => !hasCompleteData(inv));

    const result: VerificationResult = {
      total: invoices.length,
      withCompleteData: withComplete.length,
      withoutCompleteData: withoutComplete.length,
      completeDataPercentage: (withComplete.length / invoices.length) * 100,
      samples: [],
    };

    // Mostrar resumen
    console.log('📈 RESUMEN DE VERIFICACIÓN:');
    console.log('─'.repeat(80));
    console.log(`   Total facturas: ${result.total}`);
    console.log(
      `   Con datos completos: ${result.withCompleteData} (${result.completeDataPercentage.toFixed(2)}%)`
    );
    console.log(`   Sin datos completos: ${result.withoutCompleteData}`);
    console.log('─'.repeat(80));
    console.log('');

    // Mostrar las últimas 10 facturas con datos completos
    if (withComplete.length > 0) {
      console.log('✅ ÚLTIMAS 10 FACTURAS CON DATOS COMPLETOS:');
      console.log('─'.repeat(80));

      const samples = withComplete.slice(0, 10);
      result.samples = samples;

      for (const invoice of samples) {
        console.log(`\n📄 Factura ${invoice.series}${invoice.folioNumber} (ID: ${invoice.id})`);
        console.log(`   Cliente: ${invoice.customer?.legalName || 'N/A'}`);
        console.log(`   Fecha: ${invoice.createdAt.toISOString().split('T')[0]}`);
        console.log('   ─────────────────────────────────────────');
        console.log(`   Total: $${parseFloat(invoice.total.toString()).toFixed(2)} ${invoice.currency || 'MXN'}`);
        console.log(
          `   Subtotal: $${invoice.subtotal ? parseFloat(invoice.subtotal.toString()).toFixed(2) : 'NULL'}`
        );
        console.log(
          `   IVA: $${invoice.ivaAmount ? parseFloat(invoice.ivaAmount.toString()).toFixed(2) : 'NULL'}`
        );
        console.log(
          `   Retención: $${invoice.retencionAmount ? parseFloat(invoice.retencionAmount.toString()).toFixed(2) : 'NULL'}`
        );
        console.log(`   UUID: ${invoice.uuid || 'NULL'}`);
        console.log(`   Forma de pago: ${invoice.paymentForm || 'NULL'}`);
        console.log(`   Método de pago: ${invoice.paymentMethod || 'NULL'}`);
        console.log(`   Uso CFDI: ${invoice.usoCfdi || 'NULL'}`);
        console.log(`   Items guardados: ${invoice.items ? 'SÍ (JSON)' : 'NO'}`);

        // Validar que los números cuadran (subtotal + IVA - retención = total)
        if (invoice.subtotal && invoice.ivaAmount) {
          const subtotalNum = parseFloat(invoice.subtotal.toString());
          const ivaNum = parseFloat(invoice.ivaAmount.toString());
          const retencionNum = invoice.retencionAmount
            ? parseFloat(invoice.retencionAmount.toString())
            : 0;
          const totalNum = parseFloat(invoice.total.toString());
          const calculated = subtotalNum + ivaNum - retencionNum;
          const diff = Math.abs(calculated - totalNum);

          if (diff < 0.5) {
            console.log(`   ✅ Cálculo correcto: ${subtotalNum.toFixed(2)} + ${ivaNum.toFixed(2)} - ${retencionNum.toFixed(2)} = ${totalNum.toFixed(2)}`);
          } else {
            console.log(`   ⚠️  Diferencia: calculado=${calculated.toFixed(2)}, guardado=${totalNum.toFixed(2)} (diff=${diff.toFixed(2)})`);
          }
        }
      }

      console.log('\n' + '─'.repeat(80));
    }

    // Mostrar facturas SIN datos completos (si hay)
    if (withoutComplete.length > 0) {
      console.log('');
      console.log('⚠️  FACTURAS SIN DATOS COMPLETOS:');
      console.log('─'.repeat(80));

      const samplesWithout = withoutComplete.slice(0, 10);

      for (const invoice of samplesWithout) {
        console.log(
          `   ${invoice.series}${invoice.folioNumber} (ID: ${invoice.id}) - Fecha: ${invoice.createdAt.toISOString().split('T')[0]}`
        );
      }

      if (withoutComplete.length > 10) {
        console.log(`   ... y ${withoutComplete.length - 10} más sin datos completos`);
      }

      console.log('─'.repeat(80));
      console.log('');
      console.log('💡 NOTA: Estas facturas son antiguas (antes de la implementación).');
      console.log('   Ejecuta el script de migración para poblarlas con datos completos.');
      console.log('');
    }

    return result;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, 'Error en verificación');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// ========== EJECUCIÓN DEL SCRIPT ==========

verifyInvoiceData()
  .then((result) => {
    console.log('');
    console.log('✅ VERIFICACIÓN COMPLETADA');
    console.log('='.repeat(80));
    console.log(
      `   ${result.withCompleteData}/${result.total} facturas tienen datos completos (${result.completeDataPercentage.toFixed(2)}%)`
    );

    if (result.completeDataPercentage === 100) {
      console.log('   🎉 PERFECTO: Todas las facturas tienen datos completos!');
    } else if (result.completeDataPercentage >= 80) {
      console.log('   ✅ BIEN: La mayoría de facturas tienen datos completos.');
    } else {
      console.log('   ⚠️  ACCIÓN REQUERIDA: Ejecuta el script de migración de datos históricos.');
    }

    console.log('='.repeat(80));
    console.log('');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ ERROR EN VERIFICACIÓN:', error.message || error);
    process.exit(1);
  });
