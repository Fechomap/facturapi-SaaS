// utils/date-filter.utils.js
// Utilidades para manejo de filtros de fecha en reportes

/**
 * Utilidades para filtros de fecha
 */
class DateFilterUtils {
  /**
   * Obtener rango de fechas para "últimos X días"
   * @param {number} days - Número de días hacia atrás
   * @returns {Object} - Objeto con fechas de inicio y fin
   */
  static getLastDaysRange(days) {
    const end = new Date();
    end.setHours(23, 59, 59, 999); // Final del día actual

    const start = new Date();
    start.setDate(start.getDate() - days + 1);
    start.setHours(0, 0, 0, 0); // Inicio del día

    return {
      start,
      end,
      display: `Últimos ${days} días`,
      key: `last_${days}_days`,
    };
  }

  /**
   * Obtener rango para mes actual
   * @returns {Object} - Objeto con fechas del mes actual
   */
  static getCurrentMonthRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);

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
   * Obtener rango para mes anterior
   * @returns {Object} - Objeto con fechas del mes anterior
   */
  static getPreviousMonthRange() {
    const now = new Date();
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const start = new Date(previousMonth.getFullYear(), previousMonth.getMonth(), 1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);

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
   * Obtener rango para año actual
   * @returns {Object} - Objeto con fechas del año actual
   */
  static getCurrentYearRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now.getFullYear(), 11, 31);
    end.setHours(23, 59, 59, 999);

    return {
      start,
      end,
      display: `Año ${now.getFullYear()}`,
      key: 'current_year',
    };
  }

  /**
   * Crear rango personalizado
   * @param {string} startDateStr - Fecha de inicio en formato YYYY-MM-DD
   * @param {string} endDateStr - Fecha de fin en formato YYYY-MM-DD
   * @returns {Object} - Objeto con fechas personalizadas
   */
  static getCustomRange(startDateStr, endDateStr) {
    // Construir fechas exactas usando año, mes, día para evitar problemas de zona horaria
    const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
    const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);
    
    // Crear fechas exactas sin zona horaria
    const start = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
    const end = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);

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
   * Formatear fecha para SQL/Prisma
   * @param {Date} date - Fecha a formatear
   * @returns {string} - Fecha en formato ISO
   */
  static formatDateForQuery(date) {
    return date.toISOString();
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
   * Obtener rangos de fecha populares basados en el día actual
   * @returns {Array} - Rangos recomendados
   */
  static getRecommendedRanges() {
    const today = new Date();
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
