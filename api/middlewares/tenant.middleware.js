// api/middlewares/tenant.middleware.js
import prisma from '../../lib/prisma.js';

/**
 * Middleware para extraer y validar información del tenant
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @param {Function} next - Función next de Express
 */
async function tenantMiddleware(req, res, next) {
  try {
    // Extraer tenant ID del header o query parameter
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId;
    
    // Si no hay tenant ID, continuar sin configurar contexto
    if (!tenantId) {
      return next();
    }
    
    // Verificar que el tenant existe en la base de datos
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true,
        isActive: true
      }
    });
    
    if (!tenant) {
      return res.status(404).json({
        error: 'TenantNotFound',
        message: 'El tenant especificado no existe'
      });
    }
    
    if (!tenant.isActive) {
      return res.status(403).json({
        error: 'TenantInactive',
        message: 'El tenant especificado está inactivo'
      });
    }
    
    // Adjuntar información del tenant al request
    req.tenant = {
      id: tenant.id,
      name: tenant.businessName
    };
    
    next();
  } catch (error) {
    console.error('Error en tenant middleware:', error);
    next(error);
  }
}

/**
 * Middleware para validar que el usuario tenga un tenant asignado
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @param {Function} next - Función next de Express
 */
async function requireTenant(req, res, next) {
  try {
    // Obtener el tenant ID del header o del cuerpo de la solicitud
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId || req.body?.tenantId;
    
    if (!tenantId) {
      return res.status(400).json({ 
        error: 'TenantRequired', 
        message: 'Debe proporcionar un tenant ID en el header X-Tenant-ID o en el cuerpo de la solicitud'
      });
    }
    
    // Verificar que el tenant existe en la base de datos
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true,
        isActive: true,
        facturapiApiKey: true
      }
    });
    
    if (!tenant) {
      return res.status(404).json({
        error: 'TenantNotFound',
        message: 'El tenant especificado no existe'
      });
    }
    
    if (!tenant.isActive) {
      return res.status(403).json({
        error: 'TenantInactive',
        message: 'El tenant especificado está inactivo'
      });
    }
    
    // Adjuntar información del tenant al request si no existe ya
    if (!req.tenant) {
      req.tenant = {
        id: tenant.id,
        name: tenant.businessName
      };
    }
    
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
