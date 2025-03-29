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
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    // Buscar el usuario en la base de datos
    const user = await prisma.tenantUser.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isAuthorized: true,
        tenantId: true
      }
    });
    
    if (!user) {
      return res.status(401).json({
        error: 'AuthorizationError',
        message: 'Usuario no encontrado'
      });
    }
    
    if (!user.isAuthorized) {
      return res.status(403).json({
        error: 'AuthorizationError',
        message: 'Usuario no autorizado'
      });
    }
    
    // Añadir el usuario al request
    req.user = user;
    
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