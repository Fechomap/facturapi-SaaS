// api/controllers/auth.controller.js
import jwt from 'jsonwebtoken';
import prisma from '../../lib/prisma.js';
import { config } from '../../config/index.js';

// Clave secreta para JWT
const JWT_SECRET = process.env.JWT_SECRET || 'facturapi-saas-secret-dev';

/**
 * Función para iniciar sesión
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 */
export async function login(req, res) {
  const { email, tenantId } = req.body;

  // Validar que se proporcionaron email y tenantId
  if (!email || !tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Email y Tenant ID son requeridos'
    });
  }

  // Modo producción: validación real
  try {
    // Buscar el tenant por ID
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId }
    });

    if (!tenant) {
      return res.status(401).json({
        success: false,
        message: 'Tenant ID no encontrado'
      });
    }

    // Verificar que el email coincide con el email del tenant
    if (tenant.email !== email) {
      return res.status(401).json({
        success: false,
        message: 'Email no coincide con el Tenant ID proporcionado'
      });
    }

    // Buscar un usuario asociado a este tenant
    const user = await prisma.tenantUser.findFirst({
      where: {
        tenantId: tenantId
      }
    });

    // Si no hay usuario, creamos uno básico para el token
    const userData = user || {
      id: 0,
      role: 'admin',
      firstName: tenant.contactName || '',
      lastName: ''
    };

    // Generar token JWT
    const token = jwt.sign(
      { 
        userId: userData.id,
        email: tenant.email,
        role: userData.role || 'admin',
        tenantId: tenant.id
      }, 
      JWT_SECRET, 
      { expiresIn: '8h' }
    );
    
    return res.json({
      success: true,
      token,
      user: {
        id: userData.id,
        email: tenant.email,
        name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
        role: userData.role || 'admin'
      },
      tenant: {
        id: tenant.id,
        name: tenant.businessName
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
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
