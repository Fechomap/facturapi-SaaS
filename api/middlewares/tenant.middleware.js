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

/**
 * Middleware para validar que el usuario tenga un tenant asignado
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @param {Function} next - Función next de Express
 */
function requireTenant(req, res, next) {
  try {
    // Obtener el tenant ID del header o del cuerpo de la solicitud
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId || req.body?.tenantId;
    
    if (!tenantId) {
      return res.status(400).json({ 
        error: 'Tenant ID requerido', 
        message: 'Debe proporcionar un tenant ID en el header X-Tenant-ID o en el cuerpo de la solicitud'
      });
    }
    
    // Verificar que el tenant existe
    // Esto ya lo tienes implementado, así que lo mantengo igual
    
    // Añadir la función getApiKey al objeto req
    req.getApiKey = async () => {
      // Importar TenantService si no está disponible globalmente
      const TenantService = await import('../../core/tenant/tenant.service.js').then(m => m.default);
      return await TenantService.getDecryptedApiKey(tenantId);
    };
    
    next();
  } catch (error) {
    console.error(`Error en middleware requireTenant:`, error);
    next(error);
  }
}

export default tenantMiddleware;
export { requireTenant };