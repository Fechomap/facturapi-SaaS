// api/middlewares/tenant.middleware.js
/**
 * Middleware para extraer y validar información del tenant
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @param {Function} next - Función next de Express
 */
function tenantMiddleware(req, res, next) {
    // Extraer tenant ID del header o query parameter
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId;
    
    // Si no hay tenant ID, continuar sin configurar contexto
    if (!tenantId) {
      return next();
    }
    
    // En una implementación real, verificaríamos que el tenant existe en la base de datos
    // Por ahora, simplemente adjuntamos el ID al request
    req.tenant = {
      id: tenantId,
      // En la implementación real, agregaríamos más información del tenant
      name: `Tenant ${tenantId}`,
      environment: process.env.NODE_ENV || 'development'
    };
    
    next();
  }
  
  export default tenantMiddleware;