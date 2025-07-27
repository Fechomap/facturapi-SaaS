// services/report-cache.service.js
// Servicio de cache Redis para optimizar reportes Excel

import redis from 'redis';
import crypto from 'crypto';

/**
 * Servicio de cache Redis para reportes
 */
class ReportCacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.TTL = {
      INVOICE_DATA: 3600, // 1 hora - Datos de facturas
      CUSTOMER_LIST: 1800, // 30 minutos - Lista de clientes
      REPORT_RESULT: 900, // 15 minutos - Resultado final del reporte
    };
  }

  /**
   * Inicializar conexión Redis
   */
  async initialize() {
    try {
      // Verificar si Redis está disponible
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

      this.client = redis.createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 5000,
          lazyConnect: true,
        },
      });

      this.client.on('error', (err) => {
        console.warn('⚠️ Redis no disponible, cache deshabilitado:', err.message);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('✅ Redis conectado para cache de reportes');
        this.isConnected = true;
      });

      await this.client.connect();
    } catch (error) {
      console.warn('⚠️ Cache Redis no disponible, continuando sin cache:', error.message);
      this.isConnected = false;
    }
  }

  /**
   * Generar clave de cache basada en filtros
   */
  generateCacheKey(tenantId, filters) {
    const filterString = JSON.stringify({
      tenantId,
      dateRange: filters.dateRange,
      clientIds: filters.clientIds?.sort(), // Ordenar para consistencia
      limit: filters.limit,
      includeDetails: filters.includeDetails,
    });

    const hash = crypto.createHash('md5').update(filterString).digest('hex');
    return `report_excel:${tenantId}:${hash}`;
  }

  /**
   * Obtener datos de facturas desde cache
   */
  async getCachedInvoiceData(tenantId, filters) {
    if (!this.isConnected) return null;

    try {
      const cacheKey = this.generateCacheKey(tenantId, filters);
      const cachedData = await this.client.get(cacheKey);

      if (cachedData) {
        console.log(`🚀 Cache HIT para reporte: ${cacheKey}`);
        return JSON.parse(cachedData);
      }

      console.log(`💿 Cache MISS para reporte: ${cacheKey}`);
      return null;
    } catch (error) {
      console.warn('⚠️ Error obteniendo cache:', error.message);
      return null;
    }
  }

  /**
   * Guardar datos de facturas en cache
   */
  async setCachedInvoiceData(tenantId, filters, data) {
    if (!this.isConnected) return false;

    try {
      const cacheKey = this.generateCacheKey(tenantId, filters);
      const serializedData = JSON.stringify({
        data,
        timestamp: Date.now(),
        filters,
        tenantId,
      });

      await this.client.setEx(cacheKey, this.TTL.INVOICE_DATA, serializedData);
      console.log(`💾 Datos guardados en cache: ${cacheKey}`);
      return true;
    } catch (error) {
      console.warn('⚠️ Error guardando en cache:', error.message);
      return false;
    }
  }

  /**
   * Obtener lista de clientes desde cache
   */
  async getCachedCustomers(tenantId) {
    if (!this.isConnected) return null;

    try {
      const cacheKey = `customers:${tenantId}`;
      const cachedData = await this.client.get(cacheKey);

      if (cachedData) {
        console.log(`🚀 Cache HIT para clientes: ${tenantId}`);
        return JSON.parse(cachedData);
      }

      return null;
    } catch (error) {
      console.warn('⚠️ Error obteniendo clientes desde cache:', error.message);
      return null;
    }
  }

  /**
   * Guardar lista de clientes en cache
   */
  async setCachedCustomers(tenantId, customers) {
    if (!this.isConnected) return false;

    try {
      const cacheKey = `customers:${tenantId}`;
      const serializedData = JSON.stringify({
        customers,
        timestamp: Date.now(),
        tenantId,
      });

      await this.client.setEx(cacheKey, this.TTL.CUSTOMER_LIST, serializedData);
      console.log(`💾 Clientes guardados en cache: ${tenantId}`);
      return true;
    } catch (error) {
      console.warn('⚠️ Error guardando clientes en cache:', error.message);
      return false;
    }
  }

  /**
   * Invalidar cache de un tenant específico
   */
  async invalidateTenantCache(tenantId) {
    if (!this.isConnected) return false;

    try {
      const pattern = `*:${tenantId}:*`;
      const keys = await this.client.keys(pattern);

      if (keys.length > 0) {
        await this.client.del(keys);
        console.log(
          `🗑️ Cache invalidado para tenant ${tenantId}: ${keys.length} claves eliminadas`
        );
      }

      return true;
    } catch (error) {
      console.warn('⚠️ Error invalidando cache:', error.message);
      return false;
    }
  }

  /**
   * Obtener estadísticas de cache
   */
  async getCacheStats() {
    if (!this.isConnected) {
      return {
        connected: false,
        message: 'Cache Redis no disponible',
      };
    }

    try {
      const info = await this.client.info('memory');
      const keyCount = await this.client.dbSize();

      return {
        connected: true,
        keyCount,
        memoryInfo: info,
        uptime: await this.client.info('server'),
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
      };
    }
  }

  /**
   * Limpiar cache antiguo (más de 24 horas)
   */
  async cleanupOldCache() {
    if (!this.isConnected) return false;

    try {
      const pattern = 'report_excel:*';
      const keys = await this.client.keys(pattern);
      let cleanedCount = 0;

      for (const key of keys) {
        try {
          const data = await this.client.get(key);
          if (data) {
            const parsed = JSON.parse(data);
            const age = Date.now() - parsed.timestamp;
            const oneDayMs = 24 * 60 * 60 * 1000;

            if (age > oneDayMs) {
              await this.client.del(key);
              cleanedCount++;
            }
          }
        } catch (error) {
          // Eliminar claves corruptas
          await this.client.del(key);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`🧹 Cache limpiado: ${cleanedCount} claves antiguas eliminadas`);
      }

      return true;
    } catch (error) {
      console.warn('⚠️ Error limpiando cache:', error.message);
      return false;
    }
  }

  /**
   * Cerrar conexión Redis
   */
  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.disconnect();
        console.log('✅ Conexión Redis cerrada');
      } catch (error) {
        console.warn('⚠️ Error cerrando Redis:', error.message);
      }
    }
  }

  /**
   * Verificar si el cache está disponible
   */
  isAvailable() {
    return this.isConnected && this.client;
  }

  /**
   * Generar clave para filtros específicos
   */
  getFilterCacheKey(tenantId, filterType, filterValue) {
    return `filter:${tenantId}:${filterType}:${crypto.createHash('md5').update(JSON.stringify(filterValue)).digest('hex')}`;
  }
}

// Instancia singleton
const reportCacheService = new ReportCacheService();

// Inicializar al importar (solo si no estamos en testing)
if (process.env.NODE_ENV !== 'test') {
  reportCacheService.initialize().catch((err) => {
    console.warn('⚠️ No se pudo inicializar cache Redis:', err.message);
  });

  // Limpieza automática cada hora
  setInterval(
    () => {
      reportCacheService.cleanupOldCache();
    },
    60 * 60 * 1000
  );
}

export default reportCacheService;
