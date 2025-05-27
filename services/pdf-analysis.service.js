// services/pdf-analysis.service.js
import fs from 'fs';

class PDFAnalysisService {
  static async analyzePDF(filePath) {
    try {
      // Leer el archivo PDF
      const dataBuffer = fs.readFileSync(filePath);
      
      // Importación dinámica para evitar el problema con el archivo de prueba
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(dataBuffer);
      const text = pdfData.text;
      
      console.log('Analizando PDF...');
      
      // Analizar el texto para extraer información clave
      const analysis = this.extractKeyInformation(text);
      
      return {
        success: true,
        analysis,
        fullText: text
      };
    } catch (error) {
      console.error('Error al analizar PDF:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  static extractKeyInformation(text) {
    const result = {
      client: null,
      clientCode: null,
      clientName: null,
      orderNumber: null,
      totalAmount: null,
      confidence: 0,
      errors: []
    };

    // 1. DETECTAR CLIENTE
    const clientPatterns = {
      'SOS': {
        pattern: /PROTECCION\s+S\.O\.S\.\s+JURIDICO/i,
        code: 'SOS',
        fullName: 'PROTECCION S.O.S. JURIDICO'
      },
      'ARSA': {
        pattern: /ARSA\s+ASESORIA\s+INTEGRAL\s+PROFESIONAL/i,
        code: 'ARSA',
        fullName: 'ARSA ASESORIA INTEGRAL PROFESIONAL'
      },
      'INFOASIST': {
        pattern: /INFOASIST\s+INFORMACION\s+Y\s+ASISTENCIA/i,
        code: 'INFO',
        fullName: 'INFOASIST INFORMACION Y ASISTENCIA'
      }
    };

    // Buscar cliente
    for (const [clientKey, clientInfo] of Object.entries(clientPatterns)) {
      if (clientInfo.pattern.test(text)) {
        result.client = clientKey;
        result.clientCode = clientInfo.code;
        result.clientName = clientInfo.fullName;
        result.confidence += 40;
        console.log(`✅ Cliente detectado: ${clientKey}`);
        break;
      }
    }

    if (!result.client) {
      result.errors.push('No se pudo identificar el cliente');
      console.log('❌ Cliente no detectado');
    }

    // 2. EXTRAER NÚMERO DE PEDIDO
    const orderPatterns = [
      /Pedido\s+de\s+compra:\s*(\d+)/i,
      /Pedido\s+de\s+compra\s*\(Nuevo\)\s*(\d+)/i,
      /(\d{10})/g // Números de 10 dígitos
    ];

    for (const pattern of orderPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        result.orderNumber = match[1];
        result.confidence += 30;
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
      /Importe:\s*\$\s*([\d,]+\.?\d*)\s*MXN/i,
      /Total.*?\$\s*([\d,]+\.?\d*)/i,
      /Suma\s+total.*?\$\s*([\d,]+\.?\d*)/i
    ];

    for (const pattern of amountPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        result.totalAmount = this.parseAmount(match[1]);
        result.confidence += 30;
        console.log(`✅ Importe detectado: $${result.totalAmount}`);
        break;
      }
    }

    if (!result.totalAmount) {
      result.errors.push('No se encontró el importe total');
      console.log('❌ Importe no detectado');
    }

    console.log(`📊 Confianza total: ${result.confidence}%`);
    return result;
  }

  static parseAmount(amountStr) {
    // Remover comas y convertir a número
    return parseFloat(amountStr.replace(/,/g, ''));
  }

  static validateExtractedData(analysis) {
    const validation = {
      isValid: true,
      errors: [],
      warnings: [],
      confidence: analysis.confidence
    };

    // Validaciones críticas
    if (!analysis.client) {
      validation.isValid = false;
      validation.errors.push('Cliente no identificado');
    }

    if (!analysis.orderNumber) {
      validation.isValid = false;
      validation.errors.push('Número de pedido no encontrado');
    }

    if (!analysis.totalAmount) {
      validation.warnings.push('Importe no encontrado');
    }

    // Validación de confianza mínima
    if (analysis.confidence < 50) {
      validation.isValid = false;
      validation.errors.push('Confianza muy baja en los datos extraídos');
    }

    return validation;
  }

  static generateInvoiceData(analysis) {
    if (analysis.confidence < 70) {
      return null; // No suficiente confianza para procesar automáticamente
    }

    return {
      clientCode: analysis.clientCode,
      clientName: analysis.clientName,
      orderNumber: analysis.orderNumber,
      totalAmount: analysis.totalAmount,
      confidence: analysis.confidence
    };
  }

  // Método para mapear cliente a ID interno (usar IDs reales de FacturAPI)
  static getClientMapping(clientCode) {
    // IDs reales de clientes en FacturAPI (hexadecimales)
    const clientMap = {
      'SOS': {
        // Estos IDs deben reemplazarse con los IDs reales de FacturAPI
        id: '67d8f315808be76519b559c9', // ID de ejemplo, debe ser un ID real
        name: 'PROTECCION S.O.S. JURIDICO',
        satKey: '78101803' // Siempre usar esta clave SAT para todos
      },
      'ARSA': {
        id: '67d8f315808be76519b559c9', // ID de ejemplo, debe ser un ID real
        name: 'ARSA ASESORIA INTEGRAL PROFESIONAL',
        satKey: '78101803' // Siempre usar esta clave SAT para todos
      },
      'INFO': {
        id: '67d8f315808be76519b559c9', // ID de ejemplo, debe ser un ID real
        name: 'INFOASIST INFORMACION Y ASISTENCIA', 
        satKey: '78101803' // Siempre usar esta clave SAT para todos
      }
    };

    return clientMap[clientCode] || null;
  }
}

export default PDFAnalysisService;