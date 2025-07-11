// services/pdf-analysis.service.js
import fs from 'fs/promises';
import logger from '../core/utils/logger.js';

// Logger específico para análisis de PDF
const pdfAnalysisLogger = logger.child({ module: 'pdf-analysis-service' });

class PDFAnalysisService {
  static async analyzePDF(filePath) {
    try {
      // Leer el archivo PDF de forma asíncrona (no bloquea event loop)
      const dataBuffer = await fs.readFile(filePath);

      // Importación dinámica para evitar el problema con el archivo de prueba
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(dataBuffer);
      const text = pdfData.text;

      pdfAnalysisLogger.debug({ filePath }, 'Analizando PDF');

      // PRIMERO: Identificar el tipo de documento
      const documentType = this.identifyDocumentType(text);

      if (documentType !== 'PEDIDO_COMPRA') {
        console.log(`❌ Documento rechazado: Tipo identificado como ${documentType}`);
        return {
          success: false,
          error: `Este documento es una ${documentType}, no un pedido de compra válido`,
          documentType,
        };
      }

      // SEGUNDO: Extraer información del pedido
      const analysis = this.extractKeyInformation(text);

      // TERCERO: Validar la información extraída
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
      console.error('Error al analizar PDF:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  static identifyDocumentType(text) {
    // Obtener las primeras 1000 caracteres para enfocarnos en la parte superior
    const headerText = text.substring(0, 1000);

    // Verificar PRIMERO si es un pedido de compra (parte superior izquierda)
    const pedidoCompraPattern = /Pedido\s+de\s+compra/i;

    if (pedidoCompraPattern.test(headerText)) {
      console.log('✅ Se detectó "Pedido de compra" en la parte superior');

      // Verificar que NO sea una factura con elementos CFDI
      const facturaPatterns = [
        /Folio\s+Fiscal/i,
        /Sello\s+digital\s+del\s+CFDI/i,
        /Cadena\s+original\s+del\s+complemento/i,
        /Este\s+documento\s+es\s+una\s+representación\s+impresa\s+de\s+un\s+CFDI/i,
        /Tipo\s+de\s+CFDI/i,
        /Versión\s+CFDI/i,
        /Método\s+de\s+pago.*?(PUE|PPD)/i,
      ];

      // Si contiene elementos de factura CFDI, no es un pedido
      for (const pattern of facturaPatterns) {
        if (pattern.test(text)) {
          console.log('❌ Se encontraron elementos de factura CFDI');
          return 'FACTURA';
        }
      }

      // Si dice "Pedido de compra" y no tiene elementos CFDI, es pedido
      console.log('✅ Confirmado como PEDIDO_COMPRA');
      return 'PEDIDO_COMPRA';
    }

    // Verificar otros tipos solo si NO es pedido de compra
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

  static extractKeyInformation(text) {
    const result = {
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

    // 1. DETECTAR CLIENTE (buscar en sección "Desde: Cliente")
    const clientSectionMatch = text.match(/Desde:\s*Cliente\s*([\s\S]*?)Para:/i);

    if (clientSectionMatch) {
      const clientSection = clientSectionMatch[1];
      const lines = clientSection.trim().split('\n');

      if (lines.length > 0) {
        const clientNameLine = lines.find((line) => line.trim().length > 0);
        if (clientNameLine) {
          result.clientName = clientNameLine.trim();

          // Intentar mapear a código conocido
          const clientPatterns = {
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
          console.log(`✅ Cliente detectado: ${result.clientName}`);
        }
      }
    }

    // Si no se encontró en la sección, buscar con los patrones originales
    if (!result.clientName) {
      const clientPatterns = {
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
          console.log(`✅ Cliente detectado: ${clientKey}`);
          break;
        }
      }
    }

    if (!result.clientName) {
      result.errors.push('No se pudo identificar el cliente');
      console.log('❌ Cliente no detectado');
    }

    // 2. EXTRAER NÚMERO DE PEDIDO
    const orderPatterns = [
      /Pedido\s+de\s+compra:\s*(\d{10})/i,
      /Pedido\s+de\s+compra\s*\(Nuevo\)\s*(\d{10})/i,
      /(\d{10})/g, // Números de 10 dígitos como fallback
    ];

    for (const pattern of orderPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && /^\d{10}$/.test(match[1])) {
        result.orderNumber = match[1];
        result.confidence += 35;
        console.log(`✅ Número de pedido: ${result.orderNumber}`);
        break;
      }
    }

    if (!result.orderNumber) {
      result.errors.push('No se encontró el número de pedido');
      console.log('❌ Número de pedido no detectado');
    }

    // 3. EXTRAER IMPORTE TOTAL
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
        console.log(`✅ Importe detectado: $${result.totalAmount}`);
        break;
      }
    }

    if (!result.totalAmount) {
      result.errors.push('No se encontró el importe total');
      console.log('❌ Importe no detectado');
    }

    // 4. EXTRAER PROVEEDOR (opcional)
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
        console.log(`✅ Proveedor detectado: ${result.metadata.providerName}`);
      }
    }

    console.log(`📊 Confianza total: ${result.confidence}%`);
    return result;
  }

  static parseAmount(amountStr) {
    // Normalizar formato para manejar diferentes convenciones de decimales
    let cleanAmount = amountStr.trim();

    // Determinar si el último separador (coma o punto) es decimal
    const lastCommaIndex = cleanAmount.lastIndexOf(',');
    const lastDotIndex = cleanAmount.lastIndexOf('.');

    // Si hay coma y está cerca del final, podría ser separador decimal
    if (lastCommaIndex > -1 && cleanAmount.length - lastCommaIndex <= 3) {
      // Formato con coma decimal (p.ej. 80,57)
      cleanAmount = cleanAmount.replace(/\./g, ''); // Quitar puntos de miles
      cleanAmount = cleanAmount.replace(',', '.'); // Reemplazar coma decimal con punto
    } else if (lastDotIndex > -1 && cleanAmount.length - lastDotIndex <= 3) {
      // Formato con punto decimal (p.ej. 80.57)
      cleanAmount = cleanAmount.replace(/,/g, ''); // Quitar comas de miles
    } else {
      // Sin decimal, limpiar todos los separadores
      cleanAmount = cleanAmount.replace(/[,.\s]/g, '');
    }

    return parseFloat(cleanAmount);
  }

  static validateExtractedData(analysis) {
    const validation = {
      isValid: true,
      errors: [],
      warnings: [],
      confidence: analysis.confidence,
    };

    // Validaciones críticas
    if (!analysis.clientName) {
      validation.isValid = false;
      validation.errors.push('Cliente no identificado');
    }

    if (!analysis.orderNumber || !/^\d{10}$/.test(analysis.orderNumber)) {
      validation.isValid = false;
      validation.errors.push('Número de pedido no válido (debe ser de 10 dígitos)');
    }

    if (!analysis.totalAmount || analysis.totalAmount <= 0) {
      validation.isValid = false;
      validation.errors.push('Importe total no válido');
    }

    // Validación de confianza mínima reducida
    if (analysis.confidence < 50) {
      validation.isValid = false;
      validation.errors.push('Confianza insuficiente en la validación del pedido');
    }

    // Advertencias no críticas
    if (!analysis.clientCode) {
      validation.warnings.push('Cliente no mapeado a código conocido, se usará el nombre completo');
    }

    if (!analysis.metadata.providerName) {
      validation.warnings.push('Nombre del proveedor no detectado');
    }

    return validation;
  }

  static generateInvoiceData(analysis) {
    // Solo generar datos si la confianza es suficiente
    if (analysis.confidence < 50) {
      return null;
    }

    return {
      clientCode: analysis.clientCode || null,
      clientName: analysis.clientName,
      orderNumber: analysis.orderNumber,
      totalAmount: analysis.totalAmount,
      confidence: analysis.confidence,
      satKey: '78101803', // Siempre usar esta clave SAT
      providerName: analysis.metadata.providerName,
    };
  }

  // Método para mapear código de cliente a nombre completo
  static getClientMapping(clientCode) {
    const clientMap = {
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
