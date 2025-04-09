// api/middlewares/auth.middleware.js
import jwt from 'jsonwebtoken';
import prisma from '../../lib/prisma.js';

/**
 * Middleware para verificar autenticación vía JWT
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @param {Function} next - Función next de Express
 */
async function authMiddleware(req, res, next) {
  try {
    // Obtener el token del header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'AuthorizationError',
        message: 'No se proporcionó token de autenticación'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verificar el token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'facturapi-saas-secret-dev');
    
    // Verificar si tenemos un tenantId en el token
    if (!decoded.tenantId) {
      return res.status(401).json({
        error: 'AuthorizationError',
        message: 'Token inválido: falta tenantId'
      });
    }
    
    // Buscar el tenant en la base de datos
    const tenant = await prisma.tenant.findUnique({
      where: { id: decoded.tenantId }
    });
    
    if (!tenant) {
      return res.status(401).json({
        error: 'AuthorizationError',
        message: 'Tenant no encontrado'
      });
    }
    
    // Si hay un userId en el token, buscar el usuario
    let user = null;
    if (decoded.userId) {
      user = await prisma.tenantUser.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          isAuthorized: true,
          tenantId: true
        }
      });
      
      // Si se especificó un userId pero no se encontró el usuario, es un error
      if (!user && decoded.userId !== 0) {
        return res.status(401).json({
          error: 'AuthorizationError',
          message: 'Usuario no encontrado'
        });
      }
      
      // Verificar autorización solo si encontramos un usuario real
      if (user && !user.isAuthorized && !decoded.isDev) {
        return res.status(403).json({
          error: 'AuthorizationError',
          message: 'Usuario no autorizado'
        });
      }
    }
    
    // Crear un objeto de usuario para el request, incluso si no encontramos uno en la BD
    req.user = user || {
      id: decoded.userId || 0,
      email: decoded.email,
      role: decoded.role || 'admin',
      tenantId: decoded.tenantId
    };
    
    // Si el token tiene tenantId, añadirlo también al request
    if (decoded.tenantId) {
      req.tenant = { id: decoded.tenantId };
    }
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'AuthorizationError',
        message: 'Token inválido o expirado'
      });
    }
    
    next(error);
  }
}

/**
 * Middleware para verificar roles
 * @param {...string} roles - Roles permitidos
 * @returns {Function} - Middleware de Express
 */
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'AuthorizationError',
        message: 'Usuario no autenticado'
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'AuthorizationError',
        message: 'No tienes permisos para realizar esta acción'
      });
    }
    
    next();
  };
}

export { authMiddleware, requireRoles };
