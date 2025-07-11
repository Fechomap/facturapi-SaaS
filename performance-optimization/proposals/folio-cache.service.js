import NodeCache from 'node-cache';
import TenantService from './tenant.service.js';

// Cache de folios pre-generados
const folioCache = new NodeCache({ stdTTL: 3600 }); // 1 hora

class FolioCacheService {
  /**
   * Obtiene el siguiente folio del cache o genera uno nuevo
   * @param {string} tenantId - ID del tenant
   * @param {string} series - Serie del folio
   * @returns {Promise<number>} - Número de folio
   */
  static async getNextFolio(tenantId, series = 'A') {
    const cacheKey = `${tenantId}_${series}`;
    
    // Intentar obtener del cache
    let cachedFolios = folioCache.get(cacheKey) || [];
    
    if (cachedFolios.length > 0) {
      // Tomar el primer folio del cache
      const folio = cachedFolios.shift();
      folioCache.set(cacheKey, cachedFolios);
      
      // Si quedan pocos folios, pre-generar más en background
      if (cachedFolios.length < 5) {
        this.preGenerateFolios(tenantId, series).catch(console.error);
      }
      
      return folio;
    }
    
    // Si no hay en cache, generar uno directamente
    const folio = await TenantService.getNextFolio(tenantId, series);
    
    // Pre-generar más para el futuro
    this.preGenerateFolios(tenantId, series).catch(console.error);
    
    return folio;
  }
  
  /**
   * Pre-genera folios en background
   * @param {string} tenantId - ID del tenant
   * @param {string} series - Serie del folio
   */
  static async preGenerateFolios(tenantId, series = 'A') {
    const cacheKey = `${tenantId}_${series}`;
    const cachedFolios = folioCache.get(cacheKey) || [];
    
    // Si ya hay suficientes, no generar más
    if (cachedFolios.length >= 10) return;
    
    // Generar 10 folios
    const newFolios = [];
    for (let i = 0; i < 10; i++) {
      const folio = await TenantService.getNextFolio(tenantId, series);
      newFolios.push(folio);
    }
    
    // Agregar al cache
    folioCache.set(cacheKey, [...cachedFolios, ...newFolios]);
  }
}

export default FolioCacheService;