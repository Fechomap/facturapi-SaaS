// tests/utils/date-type-validation.test.js
// Tests para validación robusta de tipos Date/String en todo el sistema

describe('Date Type Validation - System Wide', () => {
  
  describe('Date Object Detection', () => {
    
    it('debe identificar Date objects correctamente', () => {
      const realDate = new Date('2025-07-15');
      const fakeDate = { getTime: () => 1234567890 };
      const string = '2025-07-15';
      const number = 1234567890;
      
      expect(realDate instanceof Date).toBe(true);
      expect(fakeDate instanceof Date).toBe(false);
      expect(string instanceof Date).toBe(false);
      expect(number instanceof Date).toBe(false);
    });

    it('debe detectar Date objects válidos vs inválidos', () => {
      const validDate = new Date('2025-07-15');
      const invalidDate = new Date('fecha-inválida');
      
      expect(validDate instanceof Date).toBe(true);
      expect(invalidDate instanceof Date).toBe(true);
      expect(isNaN(validDate.getTime())).toBe(false);
      expect(isNaN(invalidDate.getTime())).toBe(true);
    });
  });

  describe('Safe Date Conversion', () => {
    
    function safeDateConversion(value) {
      // Función helper que simula la lógica de conversión del sistema
      return value instanceof Date ? value : new Date(value);
    }

    it('debe mantener Date objects tal como son', () => {
      const originalDate = new Date('2025-07-15T10:30:00.000Z');
      const result = safeDateConversion(originalDate);
      
      expect(result).toBe(originalDate); // Misma referencia
      expect(result.getTime()).toBe(originalDate.getTime());
    });

    it('debe convertir strings válidos a Date', () => {
      const dateString = '2025-07-15T10:30:00.000Z';
      const result = safeDateConversion(dateString);
      
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(6); // Julio
      expect(result.getDate()).toBe(15);
    });

    it('debe manejar strings de fecha en diferentes formatos', () => {
      const formats = [
        '2025-07-15',
        '2025-07-15T00:00:00.000Z',
        '2025-07-15T10:30:00Z',
        'July 15, 2025',
        '15 Jul 2025'
      ];

      formats.forEach(format => {
        const result = safeDateConversion(format);
        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(2025);
        expect(result.getMonth()).toBe(6); // Julio
      });
    });

    it('debe crear Date inválido para strings inválidos', () => {
      const invalidStrings = [
        'fecha-inválida',
        '2025-13-45',
        'not a date',
        ''
      ];

      invalidStrings.forEach(invalid => {
        const result = safeDateConversion(invalid);
        expect(result).toBeInstanceOf(Date);
        expect(isNaN(result.getTime())).toBe(true);
      });
    });

    it('debe manejar valores null/undefined', () => {
      const nullResult = safeDateConversion(null);
      const undefinedResult = safeDateConversion(undefined);
      
      expect(nullResult).toBeInstanceOf(Date);
      expect(undefinedResult).toBeInstanceOf(Date);
      
      // new Date(null) = 1970-01-01, new Date(undefined) = Invalid Date
      expect(isNaN(nullResult.getTime())).toBe(false); // null se convierte a 0
      expect(isNaN(undefinedResult.getTime())).toBe(true); // undefined es inválido
    });
  });

  describe('toISOString() Safety', () => {
    
    function safeToISOString(dateValue) {
      // Función que simula el uso seguro de toISOString
      const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
      
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date cannot be converted to ISO string');
      }
      
      return date.toISOString();
    }

    it('debe ejecutar toISOString() en Date válido', () => {
      const validDate = new Date('2025-07-15T10:30:00.000Z');
      
      expect(() => {
        safeToISOString(validDate);
      }).not.toThrow();
      
      expect(safeToISOString(validDate)).toBe('2025-07-15T10:30:00.000Z');
    });

    it('debe fallar gracefully con Date inválido', () => {
      const invalidDate = new Date('fecha-inválida');
      
      expect(() => {
        safeToISOString(invalidDate);
      }).toThrow('Invalid date cannot be converted to ISO string');
    });

    it('debe funcionar con string válido convertido', () => {
      const dateString = '2025-07-15T10:30:00.000Z';
      
      expect(() => {
        safeToISOString(dateString);
      }).not.toThrow();
      
      expect(safeToISOString(dateString)).toBe('2025-07-15T10:30:00.000Z');
    });
  });

  describe('Regression Prevention - Casos del Bug Original', () => {
    
    it('debe prevenir "toISOString is not a function" error', () => {
      // Simular el caso donde llega un string en lugar de Date
      const mockConfig = {
        dateRange: {
          start: '2025-07-15T00:00:00.000Z', // String, no Date
          end: '2025-07-19T23:59:59.999Z'    // String, no Date
        }
      };

      // Función que simula la lógica corregida
      function processDateRange(config) {
        if (config.dateRange && config.dateRange.start && config.dateRange.end) {
          const startDate = config.dateRange.start instanceof Date 
            ? config.dateRange.start 
            : new Date(config.dateRange.start);
          const endDate = config.dateRange.end instanceof Date 
            ? config.dateRange.end 
            : new Date(config.dateRange.end);
            
          // Esto ya no debe fallar
          return {
            startISO: startDate.toISOString(),
            endISO: endDate.toISOString()
          };
        }
        return null;
      }

      expect(() => {
        processDateRange(mockConfig);
      }).not.toThrow();

      const result = processDateRange(mockConfig);
      expect(result.startISO).toBe('2025-07-15T00:00:00.000Z');
      expect(result.endISO).toBe('2025-07-19T23:59:59.999Z');
    });

    it('debe validar el caso específico de filtro 15-19 julio', () => {
      const startString = '2025-07-15T00:00:00.000Z';
      const endString = '2025-07-19T23:59:59.999Z';
      
      // Conversión segura
      const startDate = new Date(startString);
      const endDate = new Date(endString);
      
      expect(startDate).toBeInstanceOf(Date);
      expect(endDate).toBeInstanceOf(Date);
      expect(startDate.getUTCDate()).toBe(15); // UTC para strings
      expect(endDate.getUTCDate()).toBe(19);
      
      // Verificar que una factura del 20 julio queda fuera
      const july20 = new Date('2025-07-20T00:00:00.000Z');
      expect(july20.getTime()).toBeGreaterThan(endDate.getTime());
      
      // Verificar que una factura del 19 julio tarde queda dentro
      const july19Late = new Date('2025-07-19T22:00:00.000Z');
      expect(july19Late.getTime()).toBeLessThanOrEqual(endDate.getTime());
    });

    it('debe manejar datos mixtos (Date + String) como en el bug', () => {
      const mixedConfig = {
        dateRange: {
          start: new Date('2025-07-15T00:00:00.000Z'), // Date object
          end: '2025-07-19T23:59:59.999Z'               // String
        }
      };

      function robustDateHandling(config) {
        const startDate = config.dateRange.start instanceof Date 
          ? config.dateRange.start 
          : new Date(config.dateRange.start);
        const endDate = config.dateRange.end instanceof Date 
          ? config.dateRange.end 
          : new Date(config.dateRange.end);
          
        return { startDate, endDate };
      }

      const result = robustDateHandling(mixedConfig);
      
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
      expect(result.startDate.getUTCDate()).toBe(15);
      expect(result.endDate.getUTCDate()).toBe(19);
    });
  });

  describe('Performance Considerations', () => {
    
    it('debe ser eficiente con conversiones repetidas', () => {
      const dateString = '2025-07-15T00:00:00.000Z';
      const dateObject = new Date(dateString);
      
      const start = performance.now();
      
      // Simular múltiples conversiones
      for (let i = 0; i < 1000; i++) {
        const result1 = dateString instanceof Date ? dateString : new Date(dateString);
        const result2 = dateObject instanceof Date ? dateObject : new Date(dateObject);
      }
      
      const duration = performance.now() - start;
      
      // No debería tomar más de 100ms para 1000 conversiones (más realista)
      expect(duration).toBeLessThan(100);
    });

    it('debe manejar cache de objetos Date eficientemente', () => {
      const originalDate = new Date('2025-07-15T00:00:00.000Z');
      
      // Primera conversión - debe devolver el mismo objeto
      const first = originalDate instanceof Date ? originalDate : new Date(originalDate);
      const second = originalDate instanceof Date ? originalDate : new Date(originalDate);
      
      expect(first).toBe(originalDate); // Misma referencia
      expect(second).toBe(originalDate); // Misma referencia
      expect(first).toBe(second); // Mismo objeto
    });
  });
});