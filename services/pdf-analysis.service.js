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
      /Importe:\s*\$\s*([\d,.]+\.?\d*)\s*MXN/i,
      /Total.*?\$\s*([\d,.]+\.?\d*)/i,
      /Suma\s+total.*?\$\s*([\d,.]+\.?\d*)/i
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
    
    // Para depuración
    console.log(`Monto original: ${amountStr}, Monto limpio: ${cleanAmount}`);
    
    return parseFloat(cleanAmount);
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

  // Método para mapear código de cliente a nombre completo
  static getClientMapping(clientCode) {
    // Mapa de códigos cortos a nombres completos
    const clientMap = {
      'SOS': {
        name: 'PROTECCION S.O.S. JURIDICO',
        satKey: '78101803' // Siempre usar esta clave SAT para todos
      },
      'ARSA': {
        name: 'ARSA ASESORIA INTEGRAL PROFESIONAL',
        satKey: '78101803' // Siempre usar esta clave SAT para todos
      },
      'INFO': {
        name: 'INFOASIST INFORMACION Y ASISTENCIA', 
        satKey: '78101803' // Siempre usar esta clave SAT para todos
      }
    };

    return clientMap[clientCode] || null;
  }
}

export default PDFAnalysisService;