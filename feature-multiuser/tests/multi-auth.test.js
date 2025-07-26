// feature-multiuser/tests/multi-auth.test.js
// Tests unitarios para middleware de autorización multiusuario

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import multiUserAuthMiddleware, {
  USER_ROLES,
  ROLE_PERMISSIONS,
} from '../middleware/multi-auth.middleware.js';

// Mock de Prisma
const mockPrisma = {
  tenantUser: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
};

// Mock del contexto de Telegram
function createMockContext(telegramId = 123456789, message = null, callbackQuery = null) {
  return {
    from: { id: telegramId },
    message,
    callbackQuery,
    userState: {},
    reply: vi.fn(),
    getTenantId: vi.fn(),
    getUserRole: vi.fn(),
    hasPermission: vi.fn(),
    isAdmin: vi.fn(),
    isUserAuthorized: vi.fn(),
    hasTenant: vi.fn(),
  };
}

describe('MultiUserAuthMiddleware', () => {
  let mockNext;

  beforeEach(() => {
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Comandos públicos', () => {
    it('debería permitir comando /start sin autenticación', async () => {
      const ctx = createMockContext(123, { text: '/start' });

      await multiUserAuthMiddleware(ctx, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it('debería permitir comando /help sin autenticación', async () => {
      const ctx = createMockContext(123, { text: '/help' });

      await multiUserAuthMiddleware(ctx, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('debería permitir acción start_registration', async () => {
      const ctx = createMockContext(123, null, { data: 'start_registration' });

      await multiUserAuthMiddleware(ctx, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('debería permitir mensajes durante registro', async () => {
      const ctx = createMockContext(123, { text: 'Mi empresa' });
      ctx.userState.esperando = 'reg_company_name';

      await multiUserAuthMiddleware(ctx, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Autenticación de usuarios', () => {
    it('debería rechazar usuario sin telegram ID', async () => {
      const ctx = createMockContext(null);

      await multiUserAuthMiddleware(ctx, mockNext);

      expect(ctx.reply).toHaveBeenCalledWith('⛔ Error de autenticación');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('debería rechazar usuario no registrado', async () => {
      const ctx = createMockContext(123, { text: '/menu' });

      // Mock de usuario no encontrado
      mockPrisma.tenantUser.findUnique.mockResolvedValue(null);

      // Temporarily replace the import
      vi.doMock('../../lib/prisma.js', () => ({ default: mockPrisma }));

      await multiUserAuthMiddleware(ctx, mockNext);

      expect(ctx.reply).toHaveBeenCalledWith(
        '⛔ No estás registrado en el sistema. Usa /registro para comenzar.'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('debería rechazar usuario no autorizado', async () => {
      const ctx = createMockContext(123, { text: '/menu' });

      // Mock de usuario encontrado pero no autorizado
      mockPrisma.tenantUser.findUnique.mockResolvedValue({
        tenantId: 'tenant-123',
        role: USER_ROLES.OPERATOR,
        isAuthorized: false,
        tenant: {
          id: 'tenant-123',
          businessName: 'Test Company',
          isActive: true,
        },
      });

      vi.doMock('../../lib/prisma.js', () => ({ default: mockPrisma }));

      await multiUserAuthMiddleware(ctx, mockNext);

      expect(ctx.reply).toHaveBeenCalledWith(
        '⛔ Tu cuenta está pendiente de autorización por el administrador.'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('debería autorizar usuario válido y adjuntar contexto', async () => {
      const ctx = createMockContext(123, { text: '/menu' });

      // Mock de usuario autorizado
      mockPrisma.tenantUser.findUnique.mockResolvedValue({
        tenantId: 'tenant-123',
        role: USER_ROLES.ADMIN,
        isAuthorized: true,
        tenant: {
          id: 'tenant-123',
          businessName: 'Test Company',
          isActive: true,
        },
      });

      vi.doMock('../../lib/prisma.js', () => ({ default: mockPrisma }));

      await multiUserAuthMiddleware(ctx, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(ctx.getTenantId()).toBe('tenant-123');
      expect(ctx.getUserRole()).toBe(USER_ROLES.ADMIN);
      expect(ctx.isAdmin()).toBe(true);
      expect(ctx.hasPermission('user:manage')).toBe(true);
    });
  });

  describe('Sistema de permisos', () => {
    it('debería asignar permisos correctos por rol ADMIN', () => {
      const adminPerms = ROLE_PERMISSIONS[USER_ROLES.ADMIN];

      expect(adminPerms).toContain('invoice:create');
      expect(adminPerms).toContain('user:manage');
      expect(adminPerms).toContain('invoice:cancel');
    });

    it('debería asignar permisos correctos por rol OPERATOR', () => {
      const operatorPerms = ROLE_PERMISSIONS[USER_ROLES.OPERATOR];

      expect(operatorPerms).toContain('invoice:create');
      expect(operatorPerms).toContain('invoice:view');
      expect(operatorPerms).not.toContain('user:manage');
    });

    it('debería asignar permisos limitados por rol VIEWER', () => {
      const viewerPerms = ROLE_PERMISSIONS[USER_ROLES.VIEWER];

      expect(viewerPerms).toContain('invoice:view');
      expect(viewerPerms).toContain('report:view');
      expect(viewerPerms).not.toContain('invoice:create');
      expect(viewerPerms).not.toContain('user:manage');
    });
  });

  describe('Cache de permisos', () => {
    it('debería usar cache en segunda solicitud del mismo usuario', async () => {
      const ctx1 = createMockContext(123, { text: '/menu' });
      const ctx2 = createMockContext(123, { text: '/facturas' });

      // Mock de usuario autorizado
      const mockUser = {
        tenantId: 'tenant-123',
        role: USER_ROLES.OPERATOR,
        isAuthorized: true,
        tenant: {
          id: 'tenant-123',
          businessName: 'Test Company',
          isActive: true,
        },
      };

      mockPrisma.tenantUser.findUnique.mockResolvedValue(mockUser);
      vi.doMock('../../lib/prisma.js', () => ({ default: mockPrisma }));

      // Primera solicitud
      await multiUserAuthMiddleware(ctx1, mockNext);
      expect(mockPrisma.tenantUser.findUnique).toHaveBeenCalledTimes(1);

      // Segunda solicitud (debería usar cache)
      await multiUserAuthMiddleware(ctx2, mockNext);
      expect(mockPrisma.tenantUser.findUnique).toHaveBeenCalledTimes(1); // No se llama de nuevo

      expect(mockNext).toHaveBeenCalledTimes(2);
    });
  });

  describe('Manejo de errores', () => {
    it('debería manejar errores de base de datos gracefully', async () => {
      const ctx = createMockContext(123, { text: '/menu' });

      // Mock de error de BD
      mockPrisma.tenantUser.findUnique.mockRejectedValue(new Error('DB Error'));
      vi.doMock('../../lib/prisma.js', () => ({ default: mockPrisma }));

      await multiUserAuthMiddleware(ctx, mockNext);

      expect(ctx.reply).toHaveBeenCalledWith('❌ Error interno de autorización. Intenta de nuevo.');
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});

describe('checkPermission middleware', () => {
  it('debería permitir acceso con permiso correcto', async () => {
    const { checkPermission } = await import('../middleware/multi-auth.middleware.js');
    const middleware = checkPermission('invoice:create');

    const ctx = createMockContext();
    ctx.hasPermission = vi.fn().mockReturnValue(true);

    await middleware(ctx, mockNext);

    expect(ctx.hasPermission).toHaveBeenCalledWith('invoice:create');
    expect(mockNext).toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('debería denegar acceso sin permiso', async () => {
    const { checkPermission } = await import('../middleware/multi-auth.middleware.js');
    const middleware = checkPermission('user:manage');

    const ctx = createMockContext();
    ctx.hasPermission = vi.fn().mockReturnValue(false);
    ctx.getUserRole = vi.fn().mockReturnValue(USER_ROLES.OPERATOR);

    await middleware(ctx, mockNext);

    expect(ctx.reply).toHaveBeenCalledWith('⛔ No tienes permisos para esta acción: user:manage');
    expect(mockNext).not.toHaveBeenCalled();
  });
});
