// utils/date-filter.utils.js
// Utilidades para manejo de filtros de fecha en reportes

/**
 * Utilidades para filtros de fecha con timezone México
 */
class DateFilterUtils {
  /**
   * Obtener fecha actual en timezone de México
   * @returns {Date} - Fecha actual en timezone México
   */
  static getCurrentMexicoDate() {
    // Obtener fecha actual en timezone de México (America/Mexico_City)
    const now = new Date();
    const mexicoTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Mexico_City"}));
    return mexicoTime;
  }

  /**
   * Crear fecha en timezone de México (CORREGIDO: Sin doble conversión)
   * @param {number} year - Año
   * @param {number} month - Mes (0-11)
   * @param {number} day - Día
   * @param {number} hour - Hora (0-23)
   * @param {number} minute - Minuto (0-59)
   * @param {number} second - Segundo (0-59)
   * @param {number} ms - Milisegundo (0-999)
   * @returns {Date} - Fecha en timezone México
   */
  static createMexicoDate(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
    // CORRECCIÓN: Crear fecha directamente sin conversión adicional
    // El sistema ya está configurado para timezone México
    return new Date(year, month, day, hour, minute, second, ms);
  }

  /**
   * Obtener rango de fechas para "últimos X días" en timezone México
   * @param {number} days - Número de días hacia atrás
   * @returns {Object} - Objeto con fechas de inicio y fin
   */
  static getLastDaysRange(days) {
    const now = this.getCurrentMexicoDate();
    
    // Final del día actual (23:59:59.999) en México
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    // Inicio del día X días atrás (00:00:00.000) en México
    const start = new Date(now);
    start.setDate(start.getDate() - days + 1);
    start.setHours(0, 0, 0, 0);

    return {
      start,
      end,
      display: `Últimos ${days} días`,
      key: `last_${days}_days`,
    };
  }

  /**
   * Obtener rango para mes actual en timezone México
   * @returns {Object} - Objeto con fechas del mes actual
   */
  static getCurrentMonthRange() {
    const now = this.getCurrentMexicoDate();
    
    // Primer día del mes actual a las 00:00:00.000
    const start = this.createMexicoDate(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    
    // Último día del mes actual a las 23:59:59.999
    const end = this.createMexicoDate(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const monthNames = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];

    return {
      start,
      end,
      display: `${monthNames[now.getMonth()]} ${now.getFullYear()}`,
      key: 'current_month',
    };
  }

  /**
   * Obtener rango para mes anterior en timezone México
   * @returns {Object} - Objeto con fechas del mes anterior
   */
  static getPreviousMonthRange() {
    const now = this.getCurrentMexicoDate();
    const previousMonth = new Date(now);
    previousMonth.setMonth(now.getMonth() - 1);

    // Primer día del mes anterior a las 00:00:00.000
    const start = this.createMexicoDate(previousMonth.getFullYear(), previousMonth.getMonth(), 1, 0, 0, 0, 0);
    
    // Último día del mes anterior a las 23:59:59.999
    const end = this.createMexicoDate(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0, 23, 59, 59, 999);

    const monthNames = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];

    return {
      start,
      end,
      display: `${monthNames[previousMonth.getMonth()]} ${previousMonth.getFullYear()}`,
      key: 'previous_month',
    };
  }

  /**
   * Obtener rango para año actual en timezone México
   * @returns {Object} - Objeto con fechas del año actual
   */
  static getCurrentYearRange() {
    const now = this.getCurrentMexicoDate();
    
    // Primer día del año a las 00:00:00.000
    const start = this.createMexicoDate(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    
    // Último día del año a las 23:59:59.999
    const end = this.createMexicoDate(now.getFullYear(), 11, 31, 23, 59, 59, 999);

    return {
      start,
      end,
      display: `Año ${now.getFullYear()}`,
      key: 'current_year',
    };
  }

  /**
   * Crear rango personalizado en timezone México
   * @param {string} startDateStr - Fecha de inicio en formato YYYY-MM-DD
   * @param {string} endDateStr - Fecha de fin en formato YYYY-MM-DD
   * @returns {Object} - Objeto con fechas personalizadas
   */
  static getCustomRange(startDateStr, endDateStr) {
    // Validar formato de fecha
    if (!this.isValidDateString(startDateStr) || !this.isValidDateString(endDateStr)) {
      throw new Error('Formato de fecha inválido. Use YYYY-MM-DD');
    }

    // Construir fechas exactas usando año, mes, día en timezone México
    const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
    const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);
    
    // Crear fechas exactas en timezone México
    const start = this.createMexicoDate(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
    const end = this.createMexicoDate(endYear, endMonth - 1, endDay, 23, 59, 59, 999);

    // Validar que las fechas sean válidas
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('Fechas inválidas proporcionadas');
    }

    // Validar que fecha de inicio sea menor o igual a fecha de fin
    if (start > end) {
      throw new Error('La fecha de inicio debe ser menor o igual a la fecha de fin');
    }

    return {
      start,
      end,
      display: `${this.formatDateForDisplay(start)} a ${this.formatDateForDisplay(end)}`,
      key: 'custom_range',
      startStr: startDateStr,
      endStr: endDateStr,
    };
  }

  /**
   * Obtener todos los rangos predefinidos
   * @returns {Object} - Todos los rangos disponibles
   */
  static getAllPredefinedRanges() {
    return {
      last7Days: this.getLastDaysRange(7),
      last30Days: this.getLastDaysRange(30),
      currentMonth: this.getCurrentMonthRange(),
      previousMonth: this.getPreviousMonthRange(),
      currentYear: this.getCurrentYearRange(),
    };
  }

  /**
   * Formatear fecha para mostrar al usuario
   * @param {Date} date - Fecha a formatear
   * @returns {string} - Fecha formateada
   */
  static formatDateForDisplay(date) {
    return date.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  /**
   * Formatear fecha para SQL/Prisma manteniendo timezone México
   * @param {Date} date - Fecha a formatear
   * @returns {Date} - Fecha como objeto Date para Prisma
   */
  static formatDateForQuery(date) {
    // Prisma puede manejar Date objects directamente
    // No convertir a ISO string para evitar problemas de timezone
    return date;
  }

  /**
   * Validar formato de fecha string
   * @param {string} dateStr - String de fecha a validar
   * @returns {boolean} - Si la fecha es válida
   */
  static isValidDateString(dateStr) {
    // Validar formato YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) {
      return false;
    }

    const date = new Date(dateStr);
    return !isNaN(date.getTime());
  }

  /**
   * Obtener cláusula WHERE para Prisma basada en rango de fechas
   * @param {Object} dateRange - Rango de fechas
   * @param {string} dateField - Campo de fecha en la base de datos
   * @returns {Object} - Cláusula WHERE para Prisma
   */
  static getPrismaDateClause(dateRange, dateField = 'invoiceDate') {
    if (!dateRange || !dateRange.start || !dateRange.end) {
      return {};
    }

    return {
      [dateField]: {
        gte: dateRange.start,
        lte: dateRange.end,
      },
    };
  }

  /**
   * Calcular número de días en un rango
   * @param {Object} dateRange - Rango de fechas
   * @returns {number} - Número de días
   */
  static getDaysInRange(dateRange) {
    if (!dateRange || !dateRange.start || !dateRange.end) {
      return 0;
    }

    const diffTime = Math.abs(dateRange.end - dateRange.start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  /**
   * Estimar tiempo de generación basado en rango de fechas
   * @param {Object} dateRange - Rango de fechas
   * @param {number} avgInvoicesPerDay - Promedio de facturas por día
   * @returns {Object} - Estimación de tiempo y facturas
   */
  static estimateGeneration(dateRange, avgInvoicesPerDay = 2) {
    const days = this.getDaysInRange(dateRange);
    const estimatedInvoices = Math.round(days * avgInvoicesPerDay);

    // Tiempo estimado: 300ms por factura base + overhead
    const baseTimePerInvoice = 300;
    const overhead = 2000; // 2 segundos de overhead
    const estimatedTimeMs = estimatedInvoices * baseTimePerInvoice + overhead;
    const estimatedTimeSeconds = Math.round(estimatedTimeMs / 1000);

    return {
      estimatedInvoices,
      estimatedTimeSeconds,
      days,
      timeCategory:
        estimatedTimeSeconds < 10 ? 'fast' : estimatedTimeSeconds < 30 ? 'medium' : 'slow',
    };
  }

  /**
   * Obtener rangos de fecha populares basados en el día actual en México
   * @returns {Array} - Rangos recomendados
   */
  static getRecommendedRanges() {
    const today = this.getCurrentMexicoDate();
    const dayOfMonth = today.getDate();
    const ranges = [];

    // Siempre incluir estos
    ranges.push(this.getLastDaysRange(7));
    ranges.push(this.getLastDaysRange(30));

    // Si estamos en la primera mitad del mes, sugerir mes anterior
    if (dayOfMonth <= 15) {
      ranges.push(this.getPreviousMonthRange());
    }

    // Siempre incluir mes actual
    ranges.push(this.getCurrentMonthRange());

    // Si estamos en el último trimestre, incluir año actual
    const month = today.getMonth();
    if (month >= 9) {
      // Octubre, Noviembre, Diciembre
      ranges.push(this.getCurrentYearRange());
    }

    return ranges;
  }

  /**
   * Procesar filtro de fecha y devolver fechas de inicio y fin
   * @param {Object} dateRange - Objeto con configuración de filtro de fecha
   * @returns {Object} - Objeto con startDate y endDate
   */
  static getDateRangeForFilter(dateRange) {
    if (!dateRange) {
      return { startDate: null, endDate: null };
    }

    // Si ya tiene start y end como Date objects
    if (dateRange.start && dateRange.end) {
      return {
        startDate: dateRange.start instanceof Date ? dateRange.start : new Date(dateRange.start),
        endDate: dateRange.end instanceof Date ? dateRange.end : new Date(dateRange.end),
      };
    }

    // Si tiene key para rangos predefinidos
    if (dateRange.key) {
      const predefinedRanges = this.getAllPredefinedRanges();

      switch (dateRange.key) {
        case 'last_7_days':
          return {
            startDate: predefinedRanges.last7Days.start,
            endDate: predefinedRanges.last7Days.end,
          };
        case 'last_30_days':
          return {
            startDate: predefinedRanges.last30Days.start,
            endDate: predefinedRanges.last30Days.end,
          };
        case 'current_month':
          return {
            startDate: predefinedRanges.currentMonth.start,
            endDate: predefinedRanges.currentMonth.end,
          };
        case 'previous_month':
          return {
            startDate: predefinedRanges.previousMonth.start,
            endDate: predefinedRanges.previousMonth.end,
          };
        case 'current_year':
          return {
            startDate: predefinedRanges.currentYear.start,
            endDate: predefinedRanges.currentYear.end,
          };
        default:
          return { startDate: null, endDate: null };
      }
    }

    return { startDate: null, endDate: null };
  }

  /**
   * Convertir string de fecha de usuario a Date
   * @param {string} userInput - Input del usuario (ej: "15/01/2025", "2025-01-15")
   * @returns {Date|null} - Fecha parseada o null si es inválida
   */
  static parseUserDateInput(userInput) {
    // Intentar diferentes formatos
    const formats = [
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // DD/MM/YYYY o D/M/YYYY
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/, // YYYY-MM-DD o YYYY-M-D
      /^(\d{1,2})-(\d{1,2})-(\d{4})$/, // DD-MM-YYYY o D-M-YYYY
    ];

    for (let i = 0; i < formats.length; i++) {
      const match = userInput.match(formats[i]);
      if (match) {
        let day, month, year;

        if (i === 0 || i === 2) {
          // DD/MM/YYYY o DD-MM-YYYY
          day = parseInt(match[1]);
          month = parseInt(match[2]) - 1; // JavaScript months are 0-based
          year = parseInt(match[3]);
        } else {
          // YYYY-MM-DD
          year = parseInt(match[1]);
          month = parseInt(match[2]) - 1;
          day = parseInt(match[3]);
        }

        const date = new Date(year, month, day);

        // Verificar que la fecha sea válida
        if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
          return date;
        }
      }
    }

    return null;
  }
}

export default DateFilterUtils;
