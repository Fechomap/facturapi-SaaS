// services/excel-report.service.js
// Servicio principal para generación de reportes Excel de facturas

import ExcelJS from 'exceljs';
import prisma from '../lib/prisma.js';
import FacturapiService from './facturapi.service.js';
import reportCacheService from './report-cache.service.js';
import DateFilterUtils from '../utils/date-filter.utils.js';
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
      // Configuración por defecto con FASE 2 mejorada
      const config = {
        limit: options.limit || 500, // FASE 2: límite aumentado a 500 facturas
        includeDetails: options.includeDetails !== false,
        format: options.format || 'xlsx',
        // NUEVOS: Filtros FASE 2
        dateRange: options.dateRange || null,
        clientIds: options.clientIds || null,
        useCache: false, // Deshabilitado por decisión del equipo
        ...options,
      };

      console.log(`⚙️ Configuración del reporte:`, config);

      // FASE 2: Verificar cache primero
      if (config.useCache) {
        const cachedResult = await reportCacheService.getCachedInvoiceData(tenantId, config);
        if (cachedResult) {
          console.log(`🚀 Reporte obtenido desde cache`);
          // Generar Excel desde datos cacheados
          const buffer = await this.generateExcelBuffer(tenantId, cachedResult.data, config);
          const duration = Date.now() - startTime;

          return {
            success: true,
            buffer,
            fromCache: true,
            stats: {
              totalInvoices: cachedResult.data.length,
              duration,
            },
          };
        }
      }

      // PASO 1: Obtener facturas de la base de datos
      const invoicesFromDB = await this.getInvoicesFromDatabase(tenantId, config);

      if (invoicesFromDB.length === 0) {
        throw new Error('No se encontraron facturas para generar el reporte');
      }

      console.log(`📝 Facturas obtenidas de BD: ${invoicesFromDB.length}`);

      // PASO 2: Enriquecer con datos de FacturAPI
      const enrichedInvoices = await this.enrichWithFacturapiData(tenantId, invoicesFromDB, config);

      console.log(`✨ Facturas enriquecidas: ${enrichedInvoices.length}`);

      // PASO 3: Generar Excel en memoria
      const buffer = await this.generateExcelBuffer(tenantId, enrichedInvoices, config);

      // FASE 2: Guardar en cache para futuras consultas
      if (config.useCache && enrichedInvoices.length > 0) {
        await reportCacheService.setCachedInvoiceData(tenantId, config, enrichedInvoices);
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Reporte Excel generado exitosamente en ${duration}ms`);
      console.log(`📄 Buffer tamaño: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

      return {
        success: true,
        buffer,
        fromCache: false,
        stats: {
          totalInvoices: enrichedInvoices.length,
          duration,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Error generando reporte Excel (${duration}ms):`, error.message);

      return {
        success: false,
        error: error.message,
        duration,
      };
    }
  }

  /**
   * Obtener facturas de la base de datos con filtros FASE 2
   */
  static async getInvoicesFromDatabase(tenantId, config) {
    // Construir cláusula WHERE con filtros FASE 2
    const whereClause = {
      tenantId,
    };

    // FASE 2: Filtro por rango de fechas
    if (config.dateRange && config.dateRange.start && config.dateRange.end) {
      // Asegurar que las fechas sean objetos Date
      const startDate = config.dateRange.start instanceof Date 
        ? config.dateRange.start 
        : new Date(config.dateRange.start);
      const endDate = config.dateRange.end instanceof Date 
        ? config.dateRange.end 
        : new Date(config.dateRange.end);
      
      whereClause.invoiceDate = {
        gte: startDate,
        lte: endDate,
      };
      console.log(`📅 Aplicando filtro de fecha: ${config.dateRange.display}`);
      console.log(`🔍 DEBUG - Fecha inicio: ${startDate.toISOString()}`);
      console.log(`🔍 DEBUG - Fecha fin: ${endDate.toISOString()}`);
    }

    // FASE 2: Filtro por clientes específicos
    if (config.clientIds && config.clientIds.length > 0) {
      whereClause.customerId = {
        in: config.clientIds.map((id) => parseInt(id)),
      };
      console.log(`👥 Aplicando filtro de clientes: ${config.clientIds.length} clientes`);
    }

    const invoices = await prisma.tenantInvoice.findMany({
      where: whereClause,
      include: {
        customer: {
          select: {
            id: true,
            legalName: true,
            rfc: true,
            email: true,
          },
        },
        tenant: {
          select: {
            businessName: true,
            rfc: true,
          },
        },
      },
      orderBy: {
        invoiceDate: 'desc', // Ordenar por fecha de factura más reciente
      },
      take: config.limit,
    });

    console.log(`📊 Facturas encontradas con filtros: ${invoices.length}/${config.limit}`);
    return invoices;
  }

  /**
   * FASE 2: Obtener lista de clientes de un tenant
   */
  static async getTenantCustomers(tenantId) {
    try {
      // Verificar cache primero
      const cachedCustomers = await reportCacheService.getCachedCustomers(tenantId);
      if (cachedCustomers) {
        console.log(`🚀 Clientes obtenidos desde cache`);
        return cachedCustomers.customers;
      }

      // Obtener de BD con conteo de facturas
      const customers = await prisma.tenantCustomer.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          legalName: true,
          rfc: true,
          email: true,
          _count: {
            select: {
              invoices: true,
            },
          },
        },
        orderBy: {
          legalName: 'asc',
        },
      });

      // Guardar en cache
      await reportCacheService.setCachedCustomers(tenantId, customers);

      console.log(`👥 Clientes encontrados: ${customers.length}`);
      return customers;
    } catch (error) {
      console.error('❌ Error obteniendo clientes:', error.message);
      return [];
    }
  }

  /**
   * FASE 2: Estimar facturas y tiempo de generación
   */
  static async estimateReportGeneration(tenantId, filters = {}) {
    try {
      // Construir cláusula WHERE similar a getInvoicesFromDatabase
      const whereClause = { tenantId };

      if (filters.dateRange && filters.dateRange.start && filters.dateRange.end) {
        whereClause.invoiceDate = {
          gte: filters.dateRange.start,
          lte: filters.dateRange.end,
        };
      }

      if (filters.clientIds && filters.clientIds.length > 0) {
        whereClause.customerId = {
          in: filters.clientIds.map((id) => parseInt(id)),
        };
      }

      // Contar facturas sin límite
      const totalCount = await prisma.tenantInvoice.count({
        where: whereClause,
      });

      const actualLimit = Math.min(totalCount, filters.limit || 500);

      // Estimación de tiempo: 300ms por factura + overhead
      const baseTimePerInvoice = 300;
      const overhead = 2000;
      const estimatedTimeMs = actualLimit * baseTimePerInvoice + overhead;
      const estimatedTimeSeconds = Math.round(estimatedTimeMs / 1000);

      return {
        totalAvailable: totalCount,
        willGenerate: actualLimit,
        estimatedTimeSeconds,
        timeCategory:
          estimatedTimeSeconds < 10 ? 'fast' : estimatedTimeSeconds < 30 ? 'medium' : 'slow',
        hasMoreThanLimit: totalCount > (filters.limit || 500),
      };
    } catch (error) {
      console.error('❌ Error estimando generación:', error.message);
      return {
        totalAvailable: 0,
        willGenerate: 0,
        estimatedTimeSeconds: 5,
        timeCategory: 'unknown',
        hasMoreThanLimit: false,
      };
    }
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
        console.log(
          `🔄 Procesando factura ${i + 1}/${invoices.length}: ${invoice.facturapiInvoiceId}`
        );

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
          invoiceDate: invoice.invoiceDate, // MANTENER para filtros de BD
          
          // CORRECCIÓN: USAR POSTGRESQL COMO FUENTE ÚNICA DE FECHAS
          // PostgreSQL ya tiene las fechas sincronizadas correctamente desde el reporte crítico
          realEmissionDate: invoice.invoiceDate, // USAR DIRECTAMENTE POSTGRESQL (sin new Date())

          // Datos del cliente
          customer: {
            legalName: invoice.customer?.legalName || 'Cliente no especificado',
            rfc: invoice.customer?.rfc || 'RFC no disponible',
            email: invoice.customer?.email || '',
          },

          // Datos del tenant emisor
          tenant: {
            businessName: invoice.tenant?.businessName || 'Empresa',
            rfc: invoice.tenant?.rfc || 'RFC Emisor',
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
          processedAt: new Date().toISOString(),
        };

        enrichedInvoices.push(enrichedInvoice);
      } catch (error) {
        console.error(
          `❌ Error enriqueciendo factura ${invoice.facturapiInvoiceId}:`,
          error.message
        );

        // Incluir solo datos de BD si falla FacturAPI
        enrichedInvoices.push({
          ...invoice,
          folio: `${invoice.series}${invoice.folioNumber}`,
          uuid: 'Error al obtener',
          subtotal: 0,
          ivaAmount: 0,
          retencionAmount: 0,
          verificationUrl: '',
          realEmissionDate: invoice.invoiceDate, // CORRECCIÓN: Usar fecha directamente de PostgreSQL
          error: error.message,
        });
      }
    }

    return enrichedInvoices;
  }

  /**
   * Generar archivo Excel
   */
  /**
   * Generar Excel en memoria (buffer) - SIN ARCHIVOS TEMPORALES
   */
  static async generateExcelBuffer(tenantId, invoices, config) {
    console.log('📊 Generando Excel en memoria...');

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
      'Folio', // A
      'UUID/Folio Fiscal', // B
      'Cliente', // C
      'RFC Cliente', // D
      'Fecha Factura', // E
      'Subtotal', // F
      'IVA', // G
      'Retención', // H
      'Total', // I
      'Estado', // J
      'URL Verificación', // K
    ];

    // Agregar encabezados con estilo
    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '366092' },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Agregar datos de las facturas
    invoices.forEach((invoice) => {
      const row = [
        invoice.folio || `${invoice.series}${invoice.folioNumber}`,
        invoice.uuid || invoice.folioFiscal || 'No disponible',
        invoice.customer?.legalName || 'Cliente no especificado',
        invoice.customer?.rfc || 'RFC no disponible',
        invoice.realEmissionDate ? this.createMexicoDateForExcel(invoice.realEmissionDate) : (invoice.invoiceDate ? this.createMexicoDateForExcel(invoice.invoiceDate) : null),
        this.truncateToTwoDecimals(invoice.subtotal || 0),
        this.truncateToTwoDecimals(invoice.ivaAmount || 0),
        this.truncateToTwoDecimals(invoice.retencionAmount || 0),
        this.truncateToTwoDecimals(invoice.total || 0),
        this.translateStatus(invoice.status || 'unknown'),
        invoice.verificationUrl || 'No disponible',
      ];

      worksheet.addRow(row);
    });

    // Ajustar ancho de columnas automáticamente
    worksheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: false }, (cell) => {
        const cellLength = cell.value ? cell.value.toString().length : 0;
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      column.width = maxLength < 10 ? 12 : maxLength + 2;
    });

    // Generar buffer en memoria (SIN ARCHIVO)
    const buffer = await workbook.xlsx.writeBuffer();
    
    console.log(`📊 Excel generado en memoria: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
    return buffer;
  }

  // MÉTODO LEGACY - mantener para compatibilidad con cache
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
      'Folio', // A
      'UUID/Folio Fiscal', // B
      'Cliente', // C
      'RFC Cliente', // D
      'Fecha Factura', // E
      'Subtotal', // F
      'IVA', // G
      'Retención', // H
      'Total', // I
      'Estado', // J
      'URL Verificación', // K
    ];

    // Agregar encabezados
    worksheet.addRow(headers);

    // Formatear encabezados (solo columnas A-K)
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };

    // Aplicar formato solo a las 11 columnas utilizadas (A-K)
    for (let col = 1; col <= 11; col++) {
      const cell = headerRow.getCell(col);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '366092' },
      };
    }

    // AGREGAR FILTROS AUTOMÁTICOS EN LOS ENCABEZADOS
    worksheet.autoFilter = {
      from: 'A1',
      to: 'K1', // Solo hasta la columna K (columna 11)
    };

    // Configurar ancho de columnas y formato numérico
    worksheet.columns = [
      { width: 12 }, // Folio
      { width: 40 }, // UUID
      { width: 35 }, // Cliente
      { width: 15 }, // RFC Cliente
      { width: 12, numFmt: 'dd/mm/yyyy' }, // Fecha - FORMATO FECHA DD/MM/YYYY
      { width: 15, numFmt: '"$"#,##0.00_);("$"#,##0.00)' }, // Subtotal - FORMATO PESOS MEXICANOS 2 DECIMALES
      { width: 15, numFmt: '"$"#,##0.00_);("$"#,##0.00)' }, // IVA - FORMATO PESOS MEXICANOS 2 DECIMALES
      { width: 15, numFmt: '"$"#,##0.00_);("$"#,##0.00)' }, // Retención - FORMATO PESOS MEXICANOS 2 DECIMALES
      { width: 15, numFmt: '"$"#,##0.00_);("$"#,##0.00)' }, // Total - FORMATO PESOS MEXICANOS 2 DECIMALES
      { width: 10 }, // Estado
      { width: 145 }, // URL
    ];

    // AGREGAR DATOS
    invoices.forEach((invoice, index) => {
      const row = worksheet.addRow([
        invoice.folio || `${invoice.series}${invoice.folioNumber}`,
        invoice.uuid || invoice.folioFiscal || 'No disponible',
        invoice.customer?.legalName || 'Cliente no especificado',
        invoice.customer?.rfc || 'RFC no disponible',
        invoice.realEmissionDate ? this.createMexicoDateForExcel(invoice.realEmissionDate) : (invoice.invoiceDate ? this.createMexicoDateForExcel(invoice.invoiceDate) : null), // Convertir a fecha México para Excel
        this.truncateToTwoDecimals(invoice.subtotal || 0), // Columna 6 - TRUNCADO A 2 DECIMALES
        this.truncateToTwoDecimals(invoice.ivaAmount || 0), // Columna 7 - TRUNCADO A 2 DECIMALES
        this.truncateToTwoDecimals(invoice.retencionAmount || 0), // Columna 8 - TRUNCADO A 2 DECIMALES
        this.truncateToTwoDecimals(invoice.total || 0), // Columna 9 - TRUNCADO A 2 DECIMALES
        this.translateStatus(invoice.status || 'unknown'),
        invoice.verificationUrl || 'No disponible',
      ]);

      // Las columnas numéricas ya tienen formato aplicado a nivel de columna

      // Alternar colores de filas (solo columnas A-K)
      if (index % 2 === 0) {
        for (let col = 1; col <= 11; col++) {
          const cell = row.getCell(col);
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'F2F2F2' },
          };
        }
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
        this.truncateToTwoDecimals(
          invoices.reduce((sum, inv) => sum + parseFloat(inv.subtotal || 0), 0)
        ), // TRUNCADO A 2 DECIMALES
        this.truncateToTwoDecimals(
          invoices.reduce((sum, inv) => sum + parseFloat(inv.ivaAmount || 0), 0)
        ), // TRUNCADO A 2 DECIMALES
        this.truncateToTwoDecimals(
          invoices.reduce((sum, inv) => sum + parseFloat(inv.retencionAmount || 0), 0)
        ), // TRUNCADO A 2 DECIMALES
        this.truncateToTwoDecimals(
          invoices.reduce((sum, inv) => sum + parseFloat(inv.total || 0), 0)
        ), // TRUNCADO A 2 DECIMALES
        '',
        '',
      ]);

      totalRow.font = { bold: true };

      // Aplicar formato verde solo a las columnas A-K
      for (let col = 1; col <= 11; col++) {
        const cell = totalRow.getCell(col);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'D9EAD3' },
        };
      }

      // Las columnas numéricas ya tienen formato aplicado a nivel de columna
    }

    // Aplicar bordes solo a las columnas A-K (1-11)
    const borderStyle = { style: 'thin', color: { argb: '000000' } };
    const border = {
      top: borderStyle,
      left: borderStyle,
      bottom: borderStyle,
      right: borderStyle,
    };

    worksheet.eachRow((row) => {
      // Solo aplicar bordes a las columnas 1-11 (A-K)
      for (let col = 1; col <= 11; col++) {
        const cell = row.getCell(col);
        cell.border = border;
      }
    });

    // Las columnas ya tienen ancho configurado arriba

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
   * Truncar número a exactamente 2 decimales (SIN REDONDEO)
   * Ejemplo: 123.456 -> 123.45 (no 123.46)
   */
  static truncateToTwoDecimals(amount) {
    const num = parseFloat(amount || 0);
    return Math.floor(num * 100) / 100; // Truncar, no redondear
  }

  /**
   * Calcular subtotal desde datos de FacturAPI
   */
  static calculateSubtotal(facturapiData) {
    if (facturapiData.subtotal) return facturapiData.subtotal;

    return (
      facturapiData.items?.reduce((sum, item) => {
        return sum + item.quantity * item.product.price;
      }, 0) || 0
    );
  }

  /**
   * Calcular IVA
   */
  static calculateIVA(facturapiData) {
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

  /**
   * Calcular retención
   */
  static calculateRetencion(facturapiData) {
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

  /**
   * Formatear moneda
   */
  static formatCurrency(amount) {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
    }).format(amount || 0);
  }

  /**
   * Traducir estado de factura
   */
  static translateStatus(status) {
    const statusMap = {
      valid: 'Válida',
      canceled: 'Cancelada',
      pending: 'Pendiente',
      draft: 'Borrador',
    };

    return statusMap[status] || status;
  }

  /**
   * Convertir fecha UTC a hora local de México para Excel
   * @param {Date|string} utcDate - Fecha en UTC (Date object o string)
   * @returns {Date} - Fecha ajustada para Excel en hora México
   */
  static convertToMexicoTime(utcDate) {
    if (!utcDate) return null;
    
    // Asegurar que tenemos un Date object (puede venir string desde cache)
    const dateObj = utcDate instanceof Date ? utcDate : new Date(utcDate);
    
    // Verificar que es una fecha válida
    if (isNaN(dateObj.getTime())) {
      console.warn('⚠️ Fecha inválida en convertToMexicoTime:', utcDate);
      return null;
    }
    
    // CORREGIDO: Usar timezone automático de México (considera horario de verano)
    // Esto convierte de UTC a timezone México automáticamente
    const mexicoDateString = dateObj.toLocaleString("en-US", {timeZone: "America/Mexico_City"});
    const mexicoDate = new Date(mexicoDateString);
    
    return mexicoDate;
  }

  /**
   * Preparar fecha para Excel (CORREGIDO: Evitar inconsistencia entre día local e ISO)
   * @param {Date|string} dateFromDB - Fecha desde PostgreSQL (ya en timezone correcto)
   * @returns {Date} - Fecha lista para Excel con día consistente
   */
  static createMexicoDateForExcel(dateFromDB) {
    if (!dateFromDB) return null;
    
    const dateObj = dateFromDB instanceof Date ? dateFromDB : new Date(dateFromDB);
    
    if (isNaN(dateObj.getTime())) {
      console.warn('⚠️ Fecha inválida en createMexicoDateForExcel:', dateFromDB);
      return null;
    }
    
    // CORRECCIÓN CRÍTICA: El problema era que toISOString() mostraba un día diferente
    // al día local, causando que Excel interpretara fechas incorrectas.
    // 
    // Ejemplo del problema:
    // - Fecha local: Mon Jul 28 2025 22:53:59 GMT-0600 (día 28)
    // - toISOString(): 2025-07-29T04:53:59.937Z (día 29) ← PROBLEMA
    //
    // Solución: Crear fecha usando solo año, mes, día (sin horas) para evitar
    // conversiones de timezone que causen inconsistencias
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth();
    const day = dateObj.getDate();
    
    // Crear fecha exacta sin horas para mantener consistencia entre día local e ISO
    const consistentDate = new Date(year, month, day, 0, 0, 0, 0);
    
    return consistentDate;
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

    files.forEach((file) => {
      const filePath = path.join(tempDir, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtime.getTime() > oneDayMs) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Archivo temporal eliminado: ${file}`);
      }
    });
  }

  /**
   * Estimar cantidad de facturas que coinciden con los filtros (FASE 3)
   * @param {string} tenantId - ID del tenant
   * @param {Object} config - Configuración con filtros
   * @returns {Promise<Object>} - Estimación de facturas
   */
  static async estimateInvoiceCount(tenantId, config = {}) {
    try {
      console.log(`📊 Estimando cantidad de facturas para tenant: ${tenantId}`);

      // Construir filtros de base de datos
      const where = { tenantId };

      // Aplicar filtro de fecha si existe
      if (config.dateRange) {
        const { startDate, endDate } = DateFilterUtils.getDateRangeForFilter(config.dateRange);
        if (startDate && endDate) {
          where.invoiceDate = {
            gte: startDate,
            lte: endDate,
          };
        }
      }

      // Aplicar filtro de clientes si existe
      if (config.clientIds && config.clientIds.length > 0) {
        where.customerId = {
          in: config.clientIds.map((id) => parseInt(id)),
        };
      }

      // Contar facturas que coinciden con los filtros
      const count = await prisma.tenantInvoice.count({ where });

      console.log(`📈 Facturas estimadas: ${count}`);

      return {
        count,
        tenantId,
        filters: config,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error('❌ Error estimando cantidad de facturas:', error);
      return {
        count: 0,
        error: error.message,
        tenantId,
        filters: config,
      };
    }
  }
}

export default ExcelReportService;
