// services/invoice.service.js
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import prisma from '../src/lib/prisma.js';
import * as folioService from './folio.service.js';
import factuAPIService from './facturapi.service.js';
import { decryptApiKey } from '../src/utils/encryption.js';

// Para rutas de almacenamiento de archivos
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_BASE = path.join(__dirname, '..', 'storage');

/**
 * Asegura que existe el directorio de almacenamiento para un tenant
 * @param {string} tenantId - ID del tenant
 * @returns {string} - Ruta al directorio de almacenamiento
 */
function ensureTenantStorageDir(tenantId) {
  const tenantDir = path.join(STORAGE_BASE, `tenant-${tenantId}`, 'invoices');
  
  if (!fs.existsSync(tenantDir)) {
    fs.mkdirSync(tenantDir, { recursive: true });
  }
  
  return tenantDir;
}

/**
 * Genera una factura para un tenant específico
 * @param {string} tenantId - ID del tenant
 * @param {Object} invoiceData - Datos para la factura
 * @param {number} userId - ID del usuario que genera la factura (opcional)
 * @returns {Promise<Object>} - Factura generada
 */
async function generateInvoice(tenantId, invoiceData, userId = null) {
  try {
    console.log(`Iniciando generación de factura para tenant ${tenantId}`);
    
    // Verificar si el tenant puede generar facturas según su plan
    const canGenerateResult = await canGenerateInvoice(tenantId);
    
    if (!canGenerateResult.canGenerate) {
      throw new Error(canGenerateResult.reason || 'No se pueden generar más facturas');
    }
    
    // Obtener el próximo folio
    const nextFolio = await folioService.reserveNextFolioDb(tenantId, 'A');
    console.log(`Folio asignado: A-${nextFolio} para tenant ${tenantId}`);
    
    // Generar la factura en FacturAPI
    const facturapi = await factuAPIService.getFacturapiClient(tenantId);
    console.log(`Cliente FacturAPI obtenido, procediendo a crear factura para tenant ${tenantId}`);
    
    const invoice = await facturapi.invoices.create(invoiceData);
    console.log(`Factura creada exitosamente en FacturAPI con ID: ${invoice.id}`);
    
    // Registrar la factura en la base de datos
    let customerId = null;
    if (invoiceData.customer) {
      // Buscar el cliente en la base de datos local
      const customer = await prisma.tenantCustomer.findFirst({
        where: {
          tenantId,
          facturapiCustomerId: invoiceData.customer
        }
      });
      customerId = customer?.id || null;
    }
    
    const tenantInvoice = await registerInvoice(
      tenantId,
      invoice.id,
      invoice.series || 'A',
      invoice.folio_number || nextFolio,
      customerId,
      invoice.total,
      userId
    );
    
    console.log(`Factura registrada en base de datos local para tenant ${tenantId}`);
    return { ...invoice, dbId: tenantInvoice.id };
  } catch (error) {
    console.error(`Error al generar factura para tenant ${tenantId}:`, error.message);
    if (error.response) {
      console.error('Detalles del error:', error.response.data);
    }
    throw error;
  }
}

/**
 * Verifica si un tenant puede generar más facturas según su plan
 * @param {string} tenantId - ID del tenant
 * @returns {Promise<Object>} - Resultado de la verificación
 */
async function canGenerateInvoice(tenantId) {
  // Obtener la suscripción activa con el plan
  const subscription = await prisma.tenantSubscription.findFirst({
    where: {
      tenantId,
      OR: [
        { status: 'active' },
        { status: 'trial' }
      ]
    },
    include: {
      plan: true
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  if (!subscription) {
    return { 
      canGenerate: false, 
      reason: 'No hay una suscripción activa para este tenant' 
    };
  }

  // Verificar si la suscripción está activa
  if (subscription.status === 'trial') {
    // Verificar si el período de prueba ha terminado
    if (subscription.trialEndsAt && subscription.trialEndsAt < new Date()) {
      return { 
        canGenerate: false, 
        reason: 'El período de prueba ha terminado' 
      };
    }
  }

  // Verificar límite de facturas
  if (subscription.invoicesUsed >= subscription.plan.invoiceLimit) {
    return { 
      canGenerate: false, 
      reason: `Ha alcanzado el límite de ${subscription.plan.invoiceLimit} facturas de su plan` 
    };
  }

  return { canGenerate: true };
}

/**
 * Registra una factura generada para un tenant
 * @param {string} tenantId - ID del tenant
 * @param {string} facturapiInvoiceId - ID de la factura en FacturAPI
 * @param {string} series - Serie de la factura
 * @param {number} folioNumber - Número de folio
 * @param {number} customerId - ID del cliente (opcional)
 * @param {number} total - Total de la factura
 * @param {number} createdById - ID del usuario que creó la factura (opcional)
 * @returns {Promise<Object>} - Factura registrada
 */
async function registerInvoice(
  tenantId, 
  facturapiInvoiceId, 
  series, 
  folioNumber, 
  customerId, 
  total, 
  createdById
) {
  // Registrar la factura
  const invoice = await prisma.tenantInvoice.create({
    data: {
      tenantId,
      facturapiInvoiceId,
      series,
      folioNumber,
      customerId,
      total,
      status: 'valid',
      createdById
    }
  });

  // Incrementar el contador de facturas usadas
  await incrementInvoiceCount(tenantId);

  return invoice;
}

/**
 * Incrementa el contador de facturas usadas en la suscripción del tenant
 * @param {string} tenantId - ID del tenant
 */
async function incrementInvoiceCount(tenantId) {
  // Obtener la suscripción activa
  const subscription = await prisma.tenantSubscription.findFirst({
    where: {
      tenantId,
      OR: [
        { status: 'active' },
        { status: 'trial' }
      ]
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  if (!subscription) {
    throw new Error('No hay una suscripción activa para este tenant');
  }

  // Incrementar el contador
  await prisma.tenantSubscription.update({
    where: { id: subscription.id },
    data: {
      invoicesUsed: {
        increment: 1
      }
    }
  });
}

/**
 * Cancela una factura
 * @param {string} tenantId - ID del tenant
 * @param {string} facturapiInvoiceId - ID de la factura en FacturAPI
 * @param {Object} data - Datos para la cancelación (motivo, etc.)
 * @returns {Promise<Object>} - Resultado de la cancelación
 */
async function cancelInvoice(tenantId, facturapiInvoiceId, data) {
  try {
    const facturapi = await factuAPIService.getFacturapiClient(tenantId);
    
    // Cancelar la factura en FacturAPI
    await facturapi.invoices.cancel(facturapiInvoiceId, data);
    
    // Actualizar el estado en nuestra base de datos
    await prisma.tenantInvoice.updateMany({
      where: {
        tenantId,
        facturapiInvoiceId
      },
      data: {
        status: 'canceled',
        updatedAt: new Date()
      }
    });
    
    return { success: true, message: 'Factura cancelada exitosamente' };
  } catch (error) {
    console.error(`Error al cancelar factura ${facturapiInvoiceId}:`, error);
    throw error;
  }
}

/**
 * Descarga una factura en formato PDF o XML
 * @param {string} tenantId - ID del tenant
 * @param {string} facturapiInvoiceId - ID de la factura en FacturAPI
 * @param {string} format - Formato de descarga ('pdf' o 'xml')
 * @returns {Promise<Object>} - Stream y metadatos del archivo
 */
async function downloadInvoice(tenantId, facturapiInvoiceId, format) {
  try {
    const facturapi = await factuAPIService.getFacturapiClient(tenantId);
    
    // Obtener información de la factura
    const invoice = await facturapi.invoices.retrieve(facturapiInvoiceId);
    
    // Descargar el archivo según el formato solicitado
    let fileStream;
    let fileName;
    
    if (format === 'pdf') {
      fileStream = await facturapi.invoices.downloadPdf(facturapiInvoiceId);
      fileName = `${invoice.series}-${invoice.folio_number}.pdf`;
    } else if (format === 'xml') {
      fileStream = await facturapi.invoices.downloadXml(facturapiInvoiceId);
      fileName = `${invoice.series}-${invoice.folio_number}.xml`;
    } else {
      throw new Error(`Formato no soportado: ${format}`);
    }
    
    // Guardar una copia local si está configurado el almacenamiento
    const storageDir = ensureTenantStorageDir(tenantId);
    const filePath = path.join(storageDir, fileName);
    
    // Retornar el stream y metadatos
    return {
      stream: fileStream,
      fileName,
      contentType: format === 'pdf' ? 'application/pdf' : 'application/xml',
      localPath: filePath
    };
  } catch (error) {
    console.error(`Error al descargar factura ${facturapiInvoiceId} en formato ${format}:`, error);
    throw error;
  }
}

/**
 * Busca facturas por rango de fechas
 * @param {string} tenantId - ID del tenant
 * @param {Date} startDate - Fecha inicial
 * @param {Date} endDate - Fecha final
 * @returns {Promise<Array>} - Facturas encontradas
 */
async function findInvoicesByDateRange(tenantId, startDate, endDate) {
  try {
    const facturapi = await factuAPIService.getFacturapiClient(tenantId);
    
    // Convertir fechas al formato requerido por FacturAPI
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    // Buscar facturas en FacturAPI
    const result = await facturapi.invoices.list({
      date_range: {
        start: startDateStr,
        end: endDateStr
      }
    });
    
    return result.data;
  } catch (error) {
    console.error(`Error al buscar facturas por rango de fechas para tenant ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Busca facturas por cliente
 * @param {string} tenantId - ID del tenant
 * @param {string} clientId - ID del cliente en FacturAPI
 * @returns {Promise<Array>} - Facturas encontradas
 */
async function findInvoicesByClient(tenantId, clientId) {
  try {
    const facturapi = await factuAPIService.getFacturapiClient(tenantId);
    
    // Buscar facturas en FacturAPI
    const result = await facturapi.invoices.list({
      customer: clientId
    });
    
    return result.data;
  } catch (error) {
    console.error(`Error al buscar facturas por cliente para tenant ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Busca una factura por su número de folio
 * @param {string} tenantId - ID del tenant
 * @param {number} folioNumber - Número de folio
 * @param {string} series - Serie del folio (por defecto 'A')
 * @returns {Promise<Object>} - Factura encontrada o null
 */
async function findInvoiceByFolio(tenantId, folioNumber, series = 'A') {
  try {
    // Primero buscar en nuestra base de datos local
    const localInvoice = await prisma.tenantInvoice.findFirst({
      where: {
        tenantId,
        series,
        folioNumber
      }
    });

    if (localInvoice) {
      // Si encontramos la factura localmente, obtener los detalles completos de FacturAPI
      const facturapi = await factuAPIService.getFacturapiClient(tenantId);
      return facturapi.invoices.retrieve(localInvoice.facturapiInvoiceId);
    }

    // Si no está en la base de datos local, buscar en FacturAPI
    const facturapi = await factuAPIService.getFacturapiClient(tenantId);
    const response = await facturapi.invoices.list({
      q: `folio_number:${folioNumber}`,
      limit: 1
    });

    if (response.data && response.data.length > 0) {
      const invoice = response.data[0];
      
      // Guardar en nuestra base de datos local para futuras consultas
      let customerId = null;
      if (invoice.customer) {
        // Buscar el cliente en la base de datos local
        const customer = await prisma.tenantCustomer.findFirst({
          where: {
            tenantId,
            facturapiCustomerId: invoice.customer.id
          }
        });
        customerId = customer?.id || null;
      }

      await prisma.tenantInvoice.create({
        data: {
          tenantId,
          facturapiInvoiceId: invoice.id,
          series: invoice.series || series,
          folioNumber: invoice.folio_number,
          customerId,
          total: invoice.total,
          status: invoice.status
        }
      });

      return invoice;
    }

    return null;
  } catch (error) {
    console.error(`Error al buscar factura por folio ${folioNumber} para tenant ${tenantId}:`, error);
    throw error;
  }
}

export {
  generateInvoice,
  cancelInvoice,
  downloadInvoice,
  findInvoicesByDateRange,
  findInvoicesByClient,
  findInvoiceByFolio,
  canGenerateInvoice,
  registerInvoice
};