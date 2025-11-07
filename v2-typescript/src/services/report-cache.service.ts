// services/report-cache.service.ts
import type { RedisClientType } from 'redis';
import crypto from 'crypto';

interface CacheTTL {
  INVOICE_DATA: number;
  CUSTOMER_LIST: number;
  REPORT_RESULT: number;
}

/**
 * Servicio de cache Redis para reportes
 */
class ReportCacheService {
  private client: RedisClientType | null = null;
  private isConnected = false;
  private TTL: CacheTTL = {
    INVOICE_DATA: 3600,
    CUSTOMER_LIST: 1800,
    REPORT_RESULT: 900,
  };

  async initialize() {
    try {
      const redis = await import('redis');
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

      this.client = redis.createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 5000,
        },
      }) as RedisClientType;

      this.client.on('error', (err: Error) => {
        console.warn('⚠️ Redis no disponible, cache deshabilitado:', err.message);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('✅ Redis conectado para cache de reportes');
        this.isConnected = true;
      });

      await this.client.connect();
    } catch (error: any) {
      console.warn('⚠️ Cache Redis no disponible, continuando sin cache:', error.message);
      this.isConnected = false;
    }
  }

  generateCacheKey(tenantId: string, filters: any): string {
    const filterString = JSON.stringify({
      tenantId,
      dateRange: filters.dateRange,
      clientIds: filters.clientIds?.sort(),
      limit: filters.limit,
      includeDetails: filters.includeDetails,
    });

    const hash = crypto.createHash('md5').update(filterString).digest('hex');
    return `report_excel:${tenantId}:${hash}`;
  }

  async getCachedInvoiceData(tenantId: string, filters: any) {
    if (!this.isConnected || !this.client) return null;

    try {
      const cacheKey = this.generateCacheKey(tenantId, filters);
      const cachedData = await this.client.get(cacheKey);

      if (cachedData) {
        console.log(`🚀 Cache HIT para reporte: ${cacheKey}`);
        return JSON.parse(cachedData);
      }

      console.log(`💿 Cache MISS para reporte: ${cacheKey}`);
      return null;
    } catch (error: any) {
      console.warn('⚠️ Error obteniendo cache:', error.message);
      return null;
    }
  }

  async setCachedInvoiceData(tenantId: string, filters: any, data: any): Promise<boolean> {
    if (!this.isConnected || !this.client) return false;

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
    } catch (error: any) {
      console.warn('⚠️ Error guardando en cache:', error.message);
      return false;
    }
  }

  async getCachedCustomers(tenantId: string) {
    if (!this.isConnected || !this.client) return null;

    try {
      const cacheKey = `customers:${tenantId}`;
      const cachedData = await this.client.get(cacheKey);

      if (cachedData) {
        console.log(`🚀 Cache HIT para clientes: ${tenantId}`);
        return JSON.parse(cachedData);
      }

      return null;
    } catch (error: any) {
      console.warn('⚠️ Error obteniendo clientes desde cache:', error.message);
      return null;
    }
  }

  async setCachedCustomers(tenantId: string, customers: any): Promise<boolean> {
    if (!this.isConnected || !this.client) return false;

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
    } catch (error: any) {
      console.warn('⚠️ Error guardando clientes en cache:', error.message);
      return false;
    }
  }

  async invalidateTenantCache(tenantId: string): Promise<boolean> {
    if (!this.isConnected || !this.client) return false;

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
    } catch (error: any) {
      console.warn('⚠️ Error invalidando cache:', error.message);
      return false;
    }
  }

  async getCacheStats() {
    if (!this.isConnected || !this.client) {
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
    } catch (error: any) {
      return {
        connected: false,
        error: error.message,
      };
    }
  }

  async cleanupOldCache(): Promise<boolean> {
    if (!this.isConnected || !this.client) return false;

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
          await this.client.del(key);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`🧹 Cache limpiado: ${cleanedCount} claves antiguas eliminadas`);
      }

      return true;
    } catch (error: any) {
      console.warn('⚠️ Error limpiando cache:', error.message);
      return false;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.disconnect();
        console.log('✅ Conexión Redis cerrada');
      } catch (error: any) {
        console.warn('⚠️ Error cerrando Redis:', error.message);
      }
    }
  }

  isAvailable(): boolean {
    return this.isConnected && !!this.client;
  }

  getFilterCacheKey(tenantId: string, filterType: string, filterValue: any): string {
    return `filter:${tenantId}:${filterType}:${crypto.createHash('md5').update(JSON.stringify(filterValue)).digest('hex')}`;
  }
}

const reportCacheService = new ReportCacheService();

if (process.env.NODE_ENV !== 'test') {
  reportCacheService.initialize().catch((err: Error) => {
    console.warn('⚠️ No se pudo inicializar cache Redis:', err.message);
  });

  setInterval(
    () => {
      reportCacheService.cleanupOldCache();
    },
    60 * 60 * 1000
  );
}

export default reportCacheService;
