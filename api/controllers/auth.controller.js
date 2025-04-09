// api/controllers/auth.controller.js
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/database.js';
import { config } from '../../config/index.js';

// Clave secreta para JWT
const JWT_SECRET = process.env.JWT_SECRET || 'facturapi-saas-secret-dev';

/**
 * Función para iniciar sesión
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 */
export function login(req, res) {
  const { email, password } = req.body;

  // Modo desarrollo: acepta cualquier credencial
  if (process.env.NODE_ENV === 'development') {
    const token = jwt.sign(
      { 
        email: email || 'dev-user@example.com',
        role: 'admin',
        isDev: true,
        tenantId: '56838cf6-6073-4118-92fb-0cf2abbd9b59' // Tenant fijo
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    return res.json({
      success: true,
      token,
      user: {
        email: email || 'dev-user@example.com',
        role: 'admin'
      },
      tenant: {
        id: '56838cf6-6073-4118-92fb-0cf2abbd9b59',
        name: 'Tenant de Desarrollo'
      }
    });
  }

  // Modo producción: validación real
  if (email && password) {
    const token = jwt.sign(
      { 
        email,
        role: 'admin'
      }, 
      JWT_SECRET, 
      { expiresIn: '1h' }
    );
    
    return res.json({
      success: true,
      token,
      user: {
        email,
        role: 'admin'
      }
    });
  }
  
  return res.status(401).json({
    success: false,
    message: 'Credenciales inválidas'
  });
}

/**
 * Función para registrar un nuevo usuario
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 */
export function register(req, res) {
  const { email, password, name } = req.body;
  
  // Aquí implementarías la lógica real de registro
  return res.json({
    success: true,
    message: 'Usuario registrado correctamente',
    user: {
      email,
      name
    }
  });
}

/**
 * Verifica que un token sea válido
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 */
export function verifyToken(req, res) {
  // El middleware authMiddleware ya verificó el token
  // Solo devolvemos la información del usuario
  return res.json({
    success: true,
    user: req.user
  });
}
