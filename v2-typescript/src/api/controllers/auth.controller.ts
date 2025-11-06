/**
 * Auth Controller
 * Controller for authentication-related operations
 */

import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import type { TenantUser } from '@prisma/client';
import { prisma } from '@config/database.js';
import { createModuleLogger } from '@core/utils/logger.js';
import { config } from '@config/index.js';
import type { TenantRequest } from '../../types/api.types.js';

const logger = createModuleLogger('auth-controller');

// JWT Secret key
const JWT_SECRET = config.auth.jwtSecret || 'facturapi-saas-secret-dev';

// Types for auth controller
interface LoginBody {
  email: string;
  tenantId: string;
}

interface RegisterBody {
  email: string;
  name: string;
}

interface LoginResponse {
  success: boolean;
  token?: string;
  user?: {
    id: number;
    email: string;
    name: string;
    role: string;
  };
  tenant?: {
    id: string;
    name: string;
  };
  message?: string;
}

interface RegisterResponse {
  success: boolean;
  message: string;
  user?: {
    email: string;
    name: string;
  };
}

interface VerifyTokenResponse {
  success: boolean;
  user?: {
    id: string | number;
    email?: string;
    role?: string;
    tenantId?: string;
    telegramId?: number;
    username?: string;
  };
}

interface JwtPayload {
  userId: number;
  email: string;
  role: string;
  tenantId: string;
}

/**
 * Extended tenant user with additional fields
 */
interface TenantUserData extends Partial<TenantUser> {
  id: number;
  role: string;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Login function
 */
export async function login(req: TenantRequest, res: Response): Promise<void> {
  const { email, tenantId } = req.body as LoginBody;

  // Validate that email and tenantId were provided
  if (!email || !tenantId) {
    res.status(400).json({
      success: false,
      message: 'Email y Tenant ID son requeridos',
    } as LoginResponse);
    return;
  }

  // Production mode: real validation
  try {
    // Search for tenant by ID
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      res.status(401).json({
        success: false,
        message: 'Tenant ID no encontrado',
      } as LoginResponse);
      return;
    }

    // Verify that email matches the tenant email
    if (tenant.email !== email) {
      res.status(401).json({
        success: false,
        message: 'Email no coincide con el Tenant ID proporcionado',
      } as LoginResponse);
      return;
    }

    // Search for a user associated with this tenant
    const user = await prisma.tenantUser.findFirst({
      where: {
        tenantId: tenantId,
      },
    });

    // If no user exists, create basic data for token
    const userData: TenantUserData = user || {
      id: 0,
      role: 'admin',
      firstName: tenant.contactName || '',
      lastName: '',
    };

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: userData.id,
        email: tenant.email,
        role: userData.role || 'admin',
        tenantId: tenant.id,
      } as JwtPayload,
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    logger.info({ tenantId, email }, 'User logged in successfully');

    res.json({
      success: true,
      token,
      user: {
        id: userData.id,
        email: tenant.email,
        name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
        role: userData.role || 'admin',
      },
      tenant: {
        id: tenant.id,
        name: tenant.businessName,
      },
    } as LoginResponse);
  } catch (error) {
    logger.error({ error }, 'Error in login');
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
    } as LoginResponse);
  }
}

/**
 * Function to register a new user
 */
export function register(req: TenantRequest, res: Response): void {
  const { email, name } = req.body as RegisterBody;

  logger.info({ email, name }, 'User registration request');

  // Here you would implement the real registration logic
  res.json({
    success: true,
    message: 'Usuario registrado correctamente',
    user: {
      email,
      name,
    },
  } as RegisterResponse);
}

/**
 * Verifies that a token is valid
 */
export function verifyToken(req: TenantRequest, res: Response): void {
  // The authMiddleware already verified the token
  // We just return the user information
  logger.debug({ userId: req.user?.id }, 'Token verified successfully');

  res.json({
    success: true,
    user: req.user,
  } as VerifyTokenResponse);
}
