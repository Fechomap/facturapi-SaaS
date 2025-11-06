/**
 * PDF Analysis Service
 * Service for analyzing PDF documents and extracting invoice data
 */

import fs from 'fs/promises';
import { createModuleLogger } from '@core/utils/logger.js';

const logger = createModuleLogger('PDFAnalysisService');

interface AnalysisMetadata {
  hasValidStructure: boolean;
  extractedAt: string;
  providerName: string | null;
}

interface ExtractionResult {
  client: string | null;
  clientCode: string | null;
  clientName: string | null;
  orderNumber: string | null;
  totalAmount: number | null;
  confidence: number;
  errors: string[];
  metadata: AnalysisMetadata;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  confidence: number;
}

interface AnalysisResult {
  success: boolean;
  documentType?: string;
  analysis?: ExtractionResult;
  fullText?: string;
  error?: string;
}

interface InvoiceData {
  clientCode: string | null;
  clientName: string;
  orderNumber: string;
  totalAmount: number;
  confidence: number;
  satKey: string;
  providerName: string | null;
}

interface ClientMapping {
  name: string;
  satKey: string;
}

class PDFAnalysisService {
  static async analyzePDF(filePath: string): Promise<AnalysisResult> {
    try {
      const dataBuffer = await fs.readFile(filePath);

      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(dataBuffer);
      const text = pdfData.text;

      logger.debug({ filePath }, 'Analyzing PDF');

      // FIRST: Identify document type
      const documentType = this.identifyDocumentType(text);

      if (documentType !== 'PEDIDO_COMPRA') {
        logger.warn({ documentType }, 'Document rejected - wrong type');
        return {
          success: false,
          error: `This document is a ${documentType}, not a valid purchase order`,
          documentType,
        };
      }

      // SECOND: Extract order information
      const analysis = this.extractKeyInformation(text);

      // THIRD: Validate extracted information
      const validation = this.validateExtractedData(analysis);

      if (!validation.isValid) {
        return {
          success: false,
          error: validation.errors.join(', '),
          documentType,
          analysis,
        };
      }

      return {
        success: true,
        documentType,
        analysis,
        fullText: text,
      };
    } catch (error) {
      logger.error({ error, filePath }, 'Error analyzing PDF');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  static identifyDocumentType(text: string): string {
    // Get first 1000 characters to focus on header
    const headerText = text.substring(0, 1000);

    // Check FIRST if it's a purchase order (top left)
    const pedidoCompraPattern = /Pedido\s+de\s+compra/i;

    if (pedidoCompraPattern.test(headerText)) {
      logger.debug('Purchase order detected in header');

      // Verify it's NOT an invoice with CFDI elements
      const facturaPatterns = [
        /Folio\s+Fiscal/i,
        /Sello\s+digital\s+del\s+CFDI/i,
        /Cadena\s+original\s+del\s+complemento/i,
        /Este\s+documento\s+es\s+una\s+representación\s+impresa\s+de\s+un\s+CFDI/i,
        /Tipo\s+de\s+CFDI/i,
        /Versión\s+CFDI/i,
        /Método\s+de\s+pago.*?(PUE|PPD)/i,
      ];

      for (const pattern of facturaPatterns) {
        if (pattern.test(text)) {
          logger.debug('CFDI invoice elements found');
          return 'FACTURA';
        }
      }

      logger.debug('Confirmed as PEDIDO_COMPRA');
      return 'PEDIDO_COMPRA';
    }

    // Check other types only if NOT purchase order
    if (/Factura/i.test(headerText) || /Folio\s+Fiscal|CFDI/i.test(text)) {
      return 'FACTURA';
    }

    if (/COTIZACI[ÓO]N|PRESUPUESTO|PROPUESTA\s+ECON[ÓO]MICA/i.test(headerText)) {
      return 'COTIZACION';
    }

    if (/REMISI[ÓO]N|NOTA\s+DE\s+ENTREGA/i.test(headerText)) {
      return 'REMISION';
    }

    return 'DESCONOCIDO';
  }

  static extractKeyInformation(text: string): ExtractionResult {
    const result: ExtractionResult = {
      client: null,
      clientCode: null,
      clientName: null,
      orderNumber: null,
      totalAmount: null,
      confidence: 0,
      errors: [],
      metadata: {
        hasValidStructure: true,
        extractedAt: new Date().toISOString(),
        providerName: null,
      },
    };

    // 1. DETECT CLIENT (search in "Desde: Cliente" section)
    const clientSectionMatch = text.match(/Desde:\s*Cliente\s*([\s\S]*?)Para:/i);

    if (clientSectionMatch) {
      const clientSection = clientSectionMatch[1];
      const lines = clientSection.trim().split('\n');

      if (lines.length > 0) {
        const clientNameLine = lines.find((line) => line.trim().length > 0);
        if (clientNameLine) {
          result.clientName = clientNameLine.trim();

          // Map to known code
          const clientPatterns: Record<
            string,
            { pattern: RegExp; code: string; fullName: string }
          > = {
            SOS: {
              pattern: /PROTECCION\s+S\.O\.S\.\s+JURIDICO/i,
              code: 'SOS',
              fullName: 'PROTECCION S.O.S. JURIDICO',
            },
            ARSA: {
              pattern: /ARSA\s+ASESORIA\s+INTEGRAL\s+PROFESIONAL/i,
              code: 'ARSA',
              fullName: 'ARSA ASESORIA INTEGRAL PROFESIONAL',
            },
            INFOASIST: {
              pattern: /INFOASIST\s+INFORMACION\s+Y\s+ASISTENCIA/i,
              code: 'INFO',
              fullName: 'INFOASIST INFORMACION Y ASISTENCIA',
            },
          };

          for (const [clientKey, clientInfo] of Object.entries(clientPatterns)) {
            if (clientInfo.pattern.test(result.clientName)) {
              result.client = clientKey;
              result.clientCode = clientInfo.code;
              result.clientName = clientInfo.fullName;
              break;
            }
          }

          result.confidence += 30;
          logger.debug({ clientName: result.clientName }, 'Client detected');
        }
      }
    }

    // If not found in section, search with original patterns
    if (!result.clientName) {
      const clientPatterns: Record<string, { pattern: RegExp; code: string; fullName: string }> = {
        SOS: {
          pattern: /PROTECCION\s+S\.O\.S\.\s+JURIDICO/i,
          code: 'SOS',
          fullName: 'PROTECCION S.O.S. JURIDICO',
        },
        ARSA: {
          pattern: /ARSA\s+ASESORIA\s+INTEGRAL\s+PROFESIONAL/i,
          code: 'ARSA',
          fullName: 'ARSA ASESORIA INTEGRAL PROFESIONAL',
        },
        INFOASIST: {
          pattern: /INFOASIST\s+INFORMACION\s+Y\s+ASISTENCIA/i,
          code: 'INFO',
          fullName: 'INFOASIST INFORMACION Y ASISTENCIA',
        },
      };

      for (const [clientKey, clientInfo] of Object.entries(clientPatterns)) {
        if (clientInfo.pattern.test(text)) {
          result.client = clientKey;
          result.clientCode = clientInfo.code;
          result.clientName = clientInfo.fullName;
          result.confidence += 30;
          logger.debug({ clientKey }, 'Client detected');
          break;
        }
      }
    }

    if (!result.clientName) {
      result.errors.push('Could not identify client');
      logger.warn('Client not detected');
    }

    // 2. EXTRACT ORDER NUMBER
    const orderPatterns = [
      /Pedido\s+de\s+compra:\s*(\d{10})/i,
      /Pedido\s+de\s+compra\s*\(Nuevo\)\s*(\d{10})/i,
      /(\d{10})/g,
    ];

    for (const pattern of orderPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && /^\d{10}$/.test(match[1])) {
        result.orderNumber = match[1];
        result.confidence += 35;
        logger.debug({ orderNumber: result.orderNumber }, 'Order number detected');
        break;
      }
    }

    if (!result.orderNumber) {
      result.errors.push('Order number not found');
      logger.warn('Order number not detected');
    }

    // 3. EXTRACT TOTAL AMOUNT
    const amountPatterns = [
      /Importe:\s*\$\s*([\d,.]+\.?\d*)\s*MXN/i,
      /Total.*?\$\s*([\d,.]+\.?\d*)/i,
      /Suma\s+total.*?\$\s*([\d,.]+\.?\d*)/i,
    ];

    for (const pattern of amountPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        result.totalAmount = this.parseAmount(match[1]);
        result.confidence += 35;
        logger.debug({ totalAmount: result.totalAmount }, 'Amount detected');
        break;
      }
    }

    if (!result.totalAmount) {
      result.errors.push('Total amount not found');
      logger.warn('Amount not detected');
    }

    // 4. EXTRACT PROVIDER (optional)
    const providerSectionMatch = text.match(/Para:\s*([\s\S]*?)Condiciones\s+de\s+pago/i);

    if (providerSectionMatch) {
      const providerSection = providerSectionMatch[1];
      const lines = providerSection.trim().split('\n');

      const providerNameLine = lines.find(
        (line) =>
          line.trim().length > 0 &&
          !line.includes('Teléfono') &&
          !line.includes('Fax') &&
          !line.includes('Correo')
      );
      if (providerNameLine) {
        result.metadata.providerName = providerNameLine.trim();
        logger.debug({ providerName: result.metadata.providerName }, 'Provider detected');
      }
    }

    logger.info({ confidence: result.confidence }, 'Extraction completed');
    return result;
  }

  static parseAmount(amountStr: string): number {
    let cleanAmount = amountStr.trim();

    const lastCommaIndex = cleanAmount.lastIndexOf(',');
    const lastDotIndex = cleanAmount.lastIndexOf('.');

    if (lastCommaIndex > -1 && cleanAmount.length - lastCommaIndex <= 3) {
      cleanAmount = cleanAmount.replace(/\./g, '');
      cleanAmount = cleanAmount.replace(',', '.');
    } else if (lastDotIndex > -1 && cleanAmount.length - lastDotIndex <= 3) {
      cleanAmount = cleanAmount.replace(/,/g, '');
    } else {
      cleanAmount = cleanAmount.replace(/[,.\s]/g, '');
    }

    return parseFloat(cleanAmount);
  }

  static validateExtractedData(analysis: ExtractionResult): ValidationResult {
    const validation: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      confidence: analysis.confidence,
    };

    // Critical validations
    if (!analysis.clientName) {
      validation.isValid = false;
      validation.errors.push('Client not identified');
    }

    if (!analysis.orderNumber || !/^\d{10}$/.test(analysis.orderNumber)) {
      validation.isValid = false;
      validation.errors.push('Invalid order number (must be 10 digits)');
    }

    if (!analysis.totalAmount || analysis.totalAmount <= 0) {
      validation.isValid = false;
      validation.errors.push('Invalid total amount');
    }

    // Minimum confidence validation
    if (analysis.confidence < 50) {
      validation.isValid = false;
      validation.errors.push('Insufficient confidence in order validation');
    }

    // Non-critical warnings
    if (!analysis.clientCode) {
      validation.warnings.push('Client not mapped to known code, full name will be used');
    }

    if (!analysis.metadata.providerName) {
      validation.warnings.push('Provider name not detected');
    }

    return validation;
  }

  static generateInvoiceData(analysis: ExtractionResult): InvoiceData | null {
    if (analysis.confidence < 50) {
      return null;
    }

    if (!analysis.clientName || !analysis.orderNumber || !analysis.totalAmount) {
      return null;
    }

    return {
      clientCode: analysis.clientCode || null,
      clientName: analysis.clientName,
      orderNumber: analysis.orderNumber,
      totalAmount: analysis.totalAmount,
      confidence: analysis.confidence,
      satKey: '78101803',
      providerName: analysis.metadata.providerName,
    };
  }

  static getClientMapping(clientCode: string): ClientMapping | null {
    const clientMap: Record<string, ClientMapping> = {
      SOS: {
        name: 'PROTECCION S.O.S. JURIDICO',
        satKey: '78101803',
      },
      ARSA: {
        name: 'ARSA ASESORIA INTEGRAL PROFESIONAL',
        satKey: '78101803',
      },
      INFO: {
        name: 'INFOASIST INFORMACION Y ASISTENCIA',
        satKey: '78101803',
      },
    };

    return clientMap[clientCode] || null;
  }
}

export default PDFAnalysisService;
