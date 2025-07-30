// tests/unit/date-filter.utils.test.js
// Tests comprehensivos para DateFilterUtils para prevenir regresiones

import DateFilterUtils from '../../utils/date-filter.utils.js';

describe('DateFilterUtils', () => {
  describe('getCustomRange()', () => {
    it('debe crear rango personalizado con fechas válidas', () => {
      const result = DateFilterUtils.getCustomRange('2025-07-15', '2025-07-19');

      expect(result.start).toBeInstanceOf(Date);
      expect(result.end).toBeInstanceOf(Date);
      expect(result.start.getFullYear()).toBe(2025);
      expect(result.start.getMonth()).toBe(6); // Julio = 6 (0-based)
      expect(result.start.getDate()).toBe(15);
      expect(result.end.getDate()).toBe(19);
      expect(result.display).toContain('15/07/2025');
      expect(result.display).toContain('19/07/2025');
    });

    it('debe configurar horas correctamente (00:00:00 para inicio, 23:59:59 para fin)', () => {
      const result = DateFilterUtils.getCustomRange('2025-07-15', '2025-07-19');

      // Verificar inicio del día
      expect(result.start.getHours()).toBe(0);
      expect(result.start.getMinutes()).toBe(0);
      expect(result.start.getSeconds()).toBe(0);
      expect(result.start.getMilliseconds()).toBe(0);

      // Verificar final del día
      expect(result.end.getHours()).toBe(23);
      expect(result.end.getMinutes()).toBe(59);
      expect(result.end.getSeconds()).toBe(59);
      expect(result.end.getMilliseconds()).toBe(999);
    });

    it('debe rechazar fechas inválidas por formato', () => {
      expect(() => {
        DateFilterUtils.getCustomRange('2025-13-45', '2025-07-19');
      }).toThrow(); // Cualquier error está bien
    });

    it('debe rechazar cuando fecha inicio > fecha fin', () => {
      expect(() => {
        DateFilterUtils.getCustomRange('2025-07-20', '2025-07-15');
      }).toThrow('La fecha de inicio debe ser menor o igual a la fecha de fin');
    });

    it('debe permitir fechas iguales (mismo día)', () => {
      const result = DateFilterUtils.getCustomRange('2025-07-15', '2025-07-15');

      expect(result.start.getDate()).toBe(15);
      expect(result.end.getDate()).toBe(15);
      expect(result.start.getHours()).toBe(0);
      expect(result.end.getHours()).toBe(23);
    });
  });

  describe('parseUserDateInput()', () => {
    it('debe parsear formato DD/MM/YYYY', () => {
      const result = DateFilterUtils.parseUserDateInput('15/07/2025');

      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(6); // Julio
      expect(result.getDate()).toBe(15);
    });

    it('debe parsear formato YYYY-MM-DD', () => {
      const result = DateFilterUtils.parseUserDateInput('2025-07-15');

      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(6);
      expect(result.getDate()).toBe(15);
    });

    it('debe rechazar fechas inválidas', () => {
      expect(DateFilterUtils.parseUserDateInput('32/13/2025')).toBeNull();
      expect(DateFilterUtils.parseUserDateInput('2025-13-32')).toBeNull();
      expect(DateFilterUtils.parseUserDateInput('texto-inválido')).toBeNull();
    });

    it('debe parsear fechas con un dígito', () => {
      const result = DateFilterUtils.parseUserDateInput('5/7/2025');

      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(6);
      expect(result.getDate()).toBe(5);
    });
  });

  describe('getLastDaysRange()', () => {
    let originalDate;

    beforeEach(() => {
      // Mock Date para resultados consistentes
      originalDate = global.Date;
      global.Date = class extends Date {
        constructor(...args) {
          if (args.length === 0) {
            return new originalDate('2025-07-28T15:30:00.000Z');
          }
          return new originalDate(...args);
        }
        static now() {
          return new originalDate('2025-07-28T15:30:00.000Z').getTime();
        }
      };
    });

    afterEach(() => {
      global.Date = originalDate;
    });

    it('debe calcular últimos 7 días correctamente', () => {
      const result = DateFilterUtils.getLastDaysRange(7);

      expect(result.start.getDate()).toBe(22); // 28 - 7 + 1 = 22
      expect(result.end.getDate()).toBe(28);
      expect(result.display).toBe('Últimos 7 días');
      expect(result.key).toBe('last_7_days');
    });

    it('debe configurar horas correctas para rango de días', () => {
      const result = DateFilterUtils.getLastDaysRange(30);

      // Inicio del primer día
      expect(result.start.getHours()).toBe(0);
      expect(result.start.getMinutes()).toBe(0);

      // Final del último día
      expect(result.end.getHours()).toBe(23);
      expect(result.end.getMinutes()).toBe(59);
    });
  });

  describe('getCurrentMonthRange()', () => {
    let originalDate;

    beforeEach(() => {
      originalDate = global.Date;
      global.Date = class extends Date {
        constructor(...args) {
          if (args.length === 0) {
            return new originalDate('2025-07-28T15:30:00.000Z');
          }
          return new originalDate(...args);
        }
        static now() {
          return new originalDate('2025-07-28T15:30:00.000Z').getTime();
        }
      };
    });

    afterEach(() => {
      global.Date = originalDate;
    });

    it('debe calcular mes actual correctamente', () => {
      const result = DateFilterUtils.getCurrentMonthRange();

      expect(result.start.getDate()).toBe(1);
      expect(result.start.getMonth()).toBe(6); // Julio
      expect(result.end.getMonth()).toBe(6);
      expect(result.end.getDate()).toBe(31); // Último día de julio
      expect(result.display).toBe('Julio 2025');
    });
  });

  describe('getDateRangeForFilter() - CRITICAL for Excel Reports', () => {
    it('debe manejar dateRange con objetos Date existentes', () => {
      // Usar fechas locales para evitar problemas de zona horaria
      const startDate = new Date(2025, 6, 15, 0, 0, 0, 0);
      const endDate = new Date(2025, 6, 19, 23, 59, 59, 999);

      const dateRange = { start: startDate, end: endDate };
      const result = DateFilterUtils.getDateRangeForFilter(dateRange);

      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
      expect(result.startDate.getDate()).toBe(15);
      expect(result.endDate.getDate()).toBe(19);
    });

    it('debe convertir strings a Date objects', () => {
      const dateRange = {
        start: '2025-07-15T00:00:00.000Z',
        end: '2025-07-19T23:59:59.999Z',
      };
      const result = DateFilterUtils.getDateRangeForFilter(dateRange);

      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
      // Usar UTC para fechas string
      expect(result.startDate.getUTCDate()).toBe(15);
      expect(result.endDate.getUTCDate()).toBe(19);
    });

    it('debe manejar rangos predefinidos por key', () => {
      const dateRange = { key: 'last_7_days' };
      const result = DateFilterUtils.getDateRangeForFilter(dateRange);

      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
    });

    it('debe retornar null para dateRange inválido', () => {
      expect(DateFilterUtils.getDateRangeForFilter(null)).toEqual({
        startDate: null,
        endDate: null,
      });

      expect(DateFilterUtils.getDateRangeForFilter({})).toEqual({
        startDate: null,
        endDate: null,
      });
    });
  });

  describe('Edge Cases - Prevención de Regresiones', () => {
    it('debe manejar cambio de mes correctamente', () => {
      const result = DateFilterUtils.getCustomRange('2025-01-31', '2025-02-01');

      expect(result.start.getMonth()).toBe(0); // Enero
      expect(result.end.getMonth()).toBe(1); // Febrero
      expect(result.start.getDate()).toBe(31);
      expect(result.end.getDate()).toBe(1);
    });

    it('debe manejar año bisiesto', () => {
      const result = DateFilterUtils.getCustomRange('2024-02-28', '2024-02-29');

      expect(result.start.getDate()).toBe(28);
      expect(result.end.getDate()).toBe(29);
      expect(result.start.getMonth()).toBe(1); // Febrero
    });

    it('debe manejar cambio de año', () => {
      const result = DateFilterUtils.getCustomRange('2024-12-31', '2025-01-01');

      expect(result.start.getFullYear()).toBe(2024);
      expect(result.end.getFullYear()).toBe(2025);
      expect(result.start.getMonth()).toBe(11); // Diciembre
      expect(result.end.getMonth()).toBe(0); // Enero
    });

    it('debe manejar zona horaria local consistentemente', () => {
      const result1 = DateFilterUtils.getCustomRange('2025-07-15', '2025-07-15');
      const result2 = DateFilterUtils.getCustomRange('2025-07-15', '2025-07-15');

      expect(result1.start.getTime()).toBe(result2.start.getTime());
      expect(result1.end.getTime()).toBe(result2.end.getTime());
    });
  });

  describe('Regression Tests - Casos específicos del bug', () => {
    it('debe funcionar con el caso específico 15-19 julio', () => {
      const result = DateFilterUtils.getCustomRange('2025-07-15', '2025-07-19');

      // Verificar que 20 julio NO esté incluido (comparar con fecha local)
      const july20Local = new Date(2025, 6, 20, 0, 0, 0, 0);
      expect(july20Local.getTime()).toBeGreaterThan(result.end.getTime());

      // Verificar que 19 julio SÍ esté incluido (hasta 23:59:59.999)
      const july19Local = new Date(2025, 6, 19, 23, 59, 59, 999);
      expect(july19Local.getTime()).toBeLessThanOrEqual(result.end.getTime());
    });

    it('debe generar objetos Date válidos para usar con toISOString()', () => {
      const result = DateFilterUtils.getCustomRange('2025-07-15', '2025-07-19');

      // Esto NO debe lanzar error
      expect(() => {
        result.start.toISOString();
        result.end.toISOString();
      }).not.toThrow();

      // Verificar formato ISO correcto
      expect(result.start.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(result.end.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});
