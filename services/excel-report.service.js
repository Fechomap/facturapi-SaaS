// services/excel-report.service.js
// Servicio principal para generación de reportes Excel de facturas

import ExcelJS from 'exceljs';
import prisma from '../lib/prisma.js';
import FacturapiService from './facturapi.service.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Servicio para generar reportes Excel de facturas
 */
class ExcelReportService {
  /**
   * Generar reporte Excel completo para un tenant
   * @param {string} tenantId - ID del tenant
   * @param {Object} options - Opciones del reporte
   * @returns {Promise<string>} - Ruta del archivo Excel generado
   */
  static async generateInvoiceReport(tenantId, options = {}) {
    const startTime = Date.now();
    console.log(`📊 Iniciando generación de reporte Excel para tenant: ${tenantId}`);

    try {
      // Configuración por defecto
      const config = {
        limit: options.limit || 100, // MVP: límite de 100 facturas
        includeDetails: options.includeDetails !== false,
        format: options.format || 'xlsx',
        ...options
      };

      console.log(`⚙️ Configuración del reporte:`, config);

      // PASO 1: Obtener facturas de la base de datos
      const invoicesFromDB = await this.getInvoicesFromDatabase(tenantId, config);
      
      if (invoicesFromDB.length === 0) {
        throw new Error('No se encontraron facturas para generar el reporte');
      }

      console.log(`📝 Facturas obtenidas de BD: ${invoicesFromDB.length}`);

      // PASO 2: Enriquecer con datos de FacturAPI
      const enrichedInvoices = await this.enrichWithFacturapiData(tenantId, invoicesFromDB, config);
      
      console.log(`✨ Facturas enriquecidas: ${enrichedInvoices.length}`);

      // PASO 3: Generar archivo Excel
      const filePath = await this.generateExcelFile(tenantId, enrichedInvoices, config);
      
      const duration = Date.now() - startTime;
      console.log(`✅ Reporte Excel generado exitosamente en ${duration}ms`);
      console.log(`📄 Archivo: ${filePath}`);

      return {
        success: true,
        filePath,
        stats: {
          totalInvoices: enrichedInvoices.length,
          duration,
          fileSize: this.getFileSize(filePath)
        }
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Error generando reporte Excel (${duration}ms):`, error.message);
      
      return {
        success: false,
        error: error.message,
        duration
      };
    }
  }

  /**
   * Obtener facturas de la base de datos
   */
  static async getInvoicesFromDatabase(tenantId, config) {
    const whereClause = {
      tenantId,
      // Filtros adicionales pueden agregarse aquí en futuras versiones
    };

    const invoices = await prisma.tenantInvoice.findMany({
      where: whereClause,
      include: {
        customer: {
          select: {
            legalName: true,
            rfc: true,
            email: true
          }
        },
        tenant: {
          select: {
            businessName: true,
            rfc: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: config.limit
    });

    return invoices;
  }

  /**
   * Enriquecer facturas con datos de FacturAPI
   */
  static async enrichWithFacturapiData(tenantId, invoices, config) {
    console.log(`🔄 Enriqueciendo ${invoices.length} facturas con datos de FacturAPI...`);
    
    const facturapiClient = await FacturapiService.getFacturapiClient(tenantId);
    const enrichedInvoices = [];

    for (let i = 0; i < invoices.length; i++) {
      const invoice = invoices[i];
      
      try {
        console.log(`🔄 Procesando factura ${i + 1}/${invoices.length}: ${invoice.facturapiInvoiceId}`);
        
        // Obtener datos de FacturAPI
        const facturapiData = await facturapiClient.invoices.retrieve(invoice.facturapiInvoiceId);
        
        // Combinar datos
        const enrichedInvoice = {
          // Datos de BD
          id: invoice.id,
          facturapiInvoiceId: invoice.facturapiInvoiceId,
          series: invoice.series,
          folioNumber: invoice.folioNumber,
          total: parseFloat(invoice.total),
          status: invoice.status,
          createdAt: invoice.createdAt,
          invoiceDate: invoice.invoiceDate,
          
          // Datos del cliente
          customer: {
            legalName: invoice.customer?.legalName || 'Cliente no especificado',
            rfc: invoice.customer?.rfc || 'RFC no disponible',
            email: invoice.customer?.email || ''
          },
          
          // Datos del tenant emisor
          tenant: {
            businessName: invoice.tenant?.businessName || 'Empresa',
            rfc: invoice.tenant?.rfc || 'RFC Emisor'
          },
          
          // Datos de FacturAPI
          uuid: facturapiData.uuid,
          subtotal: facturapiData.subtotal || this.calculateSubtotal(facturapiData),
          currency: facturapiData.currency || 'MXN',
          verificationUrl: facturapiData.verification_url || '',
          
          // Datos calculados
          folio: `${invoice.series}${invoice.folioNumber}`,
          folioFiscal: facturapiData.uuid, // UUID = Folio Fiscal
          ivaAmount: this.calculateIVA(facturapiData),
          retencionAmount: this.calculateRetencion(facturapiData),
          
          // Metadatos
          processedAt: new Date().toISOString()
        };

        enrichedInvoices.push(enrichedInvoice);
        
      } catch (error) {
        console.error(`❌ Error enriqueciendo factura ${invoice.facturapiInvoiceId}:`, error.message);
        
        // Incluir solo datos de BD si falla FacturAPI
        enrichedInvoices.push({
          ...invoice,
          folio: `${invoice.series}${invoice.folioNumber}`,
          uuid: 'Error al obtener',
          subtotal: 0,
          ivaAmount: 0,
          retencionAmount: 0,
          verificationUrl: '',
          error: error.message
        });
      }
    }

    return enrichedInvoices;
  }

  /**
   * Generar archivo Excel
   */
  static async generateExcelFile(tenantId, invoices, config) {
    console.log('📊 Generando archivo Excel...');
    
    // Crear workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reporte de Facturas');

    // Configurar propiedades del workbook
    workbook.creator = 'Sistema de Facturación';
    workbook.lastModifiedBy = 'FacturAPI SaaS';
    workbook.created = new Date();
    workbook.modified = new Date();

    // ENCABEZADOS DE COLUMNAS (11 campos principales)
    const headers = [
      'Folio',              // A
      'UUID/Folio Fiscal',  // B  
      'Cliente',            // C
      'RFC Cliente',        // D
      'Fecha Factura',      // E
      'Subtotal',           // F
      'IVA',               // G
      'Retención',         // H
      'Total',             // I
      'Estado',            // J
      'URL Verificación'    // K
    ];

    // Agregar encabezados
    worksheet.addRow(headers);

    // Formatear encabezados
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '366092' }
    };

    // Configurar ancho de columnas
    worksheet.columns = [
      { width: 12 },  // Folio
      { width: 40 },  // UUID
      { width: 35 },  // Cliente
      { width: 15 },  // RFC Cliente
      { width: 12 },  // Fecha
      { width: 12 },  // Subtotal
      { width: 12 },  // IVA
      { width: 12 },  // Retención
      { width: 12 },  // Total
      { width: 10 },  // Estado
      { width: 50 }   // URL
    ];

    // AGREGAR DATOS
    invoices.forEach((invoice, index) => {
      const row = worksheet.addRow([
        invoice.folio || `${invoice.series}${invoice.folioNumber}`,
        invoice.uuid || invoice.folioFiscal || 'No disponible',
        invoice.customer?.legalName || 'Cliente no especificado',
        invoice.customer?.rfc || 'RFC no disponible',
        invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('es-MX') : 'Sin fecha',
        this.formatCurrency(invoice.subtotal || 0),
        this.formatCurrency(invoice.ivaAmount || 0),
        this.formatCurrency(invoice.retencionAmount || 0),
        this.formatCurrency(invoice.total || 0),
        this.translateStatus(invoice.status || 'unknown'),
        invoice.verificationUrl || 'No disponible'
      ]);

      // Alternar colores de filas
      if (index % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'F2F2F2' }
        };
      }
    });

    // TOTALES
    if (invoices.length > 0) {
      const totalRow = worksheet.addRow([
        '',
        '',
        '',
        '',
        'TOTALES:',
        this.formatCurrency(invoices.reduce((sum, inv) => sum + (inv.subtotal || 0), 0)),
        this.formatCurrency(invoices.reduce((sum, inv) => sum + (inv.ivaAmount || 0), 0)),
        this.formatCurrency(invoices.reduce((sum, inv) => sum + (inv.retencionAmount || 0), 0)),
        this.formatCurrency(invoices.reduce((sum, inv) => sum + (inv.total || 0), 0)),
        '',
        ''
      ]);

      totalRow.font = { bold: true };
      totalRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'D9EAD3' }
      };
    }

    // Aplicar bordes
    const borderStyle = { style: 'thin', color: { argb: '000000' } };
    const border = {
      top: borderStyle,
      left: borderStyle,
      bottom: borderStyle,
      right: borderStyle
    };

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = border;
      });
    });

    // GUARDAR ARCHIVO
    const tempDir = path.join(__dirname, '../temp/excel-reports');
    
    // Crear directorio si no existe
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const fileName = `reporte_facturas_${tenantId}_${Date.now()}.xlsx`;
    const filePath = path.join(tempDir, fileName);

    await workbook.xlsx.writeFile(filePath);
    
    console.log(`💾 Archivo Excel guardado: ${filePath}`);
    return filePath;
  }

  // UTILIDADES

  /**
   * Calcular subtotal desde datos de FacturAPI
   */
  static calculateSubtotal(facturapiData) {
    if (facturapiData.subtotal) return facturapiData.subtotal;
    
    return facturapiData.items?.reduce((sum, item) => {
      return sum + (item.quantity * item.product.price);
    }, 0) || 0;
  }

  /**
   * Calcular IVA
   */
  static calculateIVA(facturapiData) {
    if (!facturapiData.items) return 0;
    
    return facturapiData.items.reduce((total, item) => {
      const ivaTax = item.product.taxes?.find(tax => 
        tax.type === 'IVA' && !tax.withholding
      );
      
      if (ivaTax) {
        const base = item.quantity * item.product.price;
        return total + (base * (ivaTax.rate || 0));
      }
      
      return total;
    }, 0);
  }

  /**
   * Calcular retención
   */
  static calculateRetencion(facturapiData) {
    if (!facturapiData.items) return 0;
    
    return facturapiData.items.reduce((total, item) => {
      const retencionTax = item.product.taxes?.find(tax => 
        tax.withholding === true
      );
      
      if (retencionTax) {
        const base = item.quantity * item.product.price;
        return total + (base * (retencionTax.rate || 0));
      }
      
      return total;
    }, 0);
  }

  /**
   * Formatear moneda
   */
  static formatCurrency(amount) {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN'
    }).format(amount || 0);
  }

  /**
   * Traducir estado de factura
   */
  static translateStatus(status) {
    const statusMap = {
      'valid': 'Válida',
      'canceled': 'Cancelada',
      'pending': 'Pendiente',
      'draft': 'Borrador'
    };
    
    return statusMap[status] || status;
  }

  /**
   * Obtener tamaño de archivo
   */
  static getFileSize(filePath) {
    try {
      const stats = fs.statSync(filePath);
      const sizeInMB = stats.size / (1024 * 1024);
      return `${sizeInMB.toFixed(2)} MB`;
    } catch (error) {
      return 'Tamaño desconocido';
    }
  }

  /**
   * Limpiar archivos temporales antiguos (más de 24 horas)
   */
  static cleanupOldFiles() {
    const tempDir = path.join(__dirname, '../temp/excel-reports');
    
    if (!fs.existsSync(tempDir)) return;

    const files = fs.readdirSync(tempDir);
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtime.getTime() > oneDayMs) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Archivo temporal eliminado: ${file}`);
      }
    });
  }
}

export default ExcelReportService;