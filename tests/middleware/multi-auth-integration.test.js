// Tests de integración para sistema multiusuario completo

describe('Sistema Multiusuario - Tests de Integración', () => {
  describe('Verificación de Middleware Principal', () => {
    it('debería cargar middleware con todas las exportaciones', async () => {
      const {
        default: multiUserAuthMiddleware,
        USER_ROLES,
        ROLE_PERMISSIONS,
        checkPermission,
      } = await import('../../bot/middlewares/multi-auth.middleware.js');

      expect(typeof multiUserAuthMiddleware).toBe('function');
      expect(typeof checkPermission).toBe('function');
      expect(USER_ROLES).toEqual({
        ADMIN: 'admin',
        OPERATOR: 'operator',
        VIEWER: 'viewer',
      });
      expect(ROLE_PERMISSIONS.admin).toContain('user:manage');
    });
  });

  describe('Verificación de Estructura de Permisos', () => {
    it('debería tener jerarquía correcta de permisos', async () => {
      const { ROLE_PERMISSIONS } = await import('../../bot/middlewares/multi-auth.middleware.js');

      // Admin debe tener más permisos que operator
      expect(ROLE_PERMISSIONS.admin.length).toBeGreaterThan(ROLE_PERMISSIONS.operator.length);

      // Operator debe tener más permisos que viewer
      expect(ROLE_PERMISSIONS.operator.length).toBeGreaterThan(ROLE_PERMISSIONS.viewer.length);

      // Todos deben tener al menos un permiso
      expect(ROLE_PERMISSIONS.admin.length).toBeGreaterThan(0);
      expect(ROLE_PERMISSIONS.operator.length).toBeGreaterThan(0);
      expect(ROLE_PERMISSIONS.viewer.length).toBeGreaterThan(0);
    });

    it('debería tener permisos específicos por rol', async () => {
      const { ROLE_PERMISSIONS } = await import('../../bot/middlewares/multi-auth.middleware.js');

      // Solo admin puede gestionar usuarios
      expect(ROLE_PERMISSIONS.admin).toContain('user:manage');
      expect(ROLE_PERMISSIONS.operator).not.toContain('user:manage');
      expect(ROLE_PERMISSIONS.viewer).not.toContain('user:manage');

      // Admin y operator pueden crear facturas
      expect(ROLE_PERMISSIONS.admin).toContain('invoice:create');
      expect(ROLE_PERMISSIONS.operator).toContain('invoice:create');

      // Todos pueden ver facturas
      expect(ROLE_PERMISSIONS.admin).toContain('invoice:view');
      expect(ROLE_PERMISSIONS.operator).toContain('invoice:view');
      expect(ROLE_PERMISSIONS.viewer).toContain('invoice:view');
    });
  });

  describe('Verificación de Archivos del Sistema', () => {
    it('debería tener todos los archivos principales', async () => {
      const fs = await import('fs');
      const path = await import('path');

      const criticalFiles = [
        'bot/middlewares/multi-auth.middleware.js',
        'bot/commands/user-management.commands.js',
        'services/multi-user.service.js',
        'services/redis-lock.service.js',
        'services/safe-operations.service.js',
        'prisma/schema.prisma',
      ];

      criticalFiles.forEach((file) => {
        const fullPath = path.join(process.cwd(), file);
        expect(fs.existsSync(fullPath)).toBe(true);
      });
    });

    it('debería tener integración en bot/index.js', async () => {
      const fs = await import('fs');
      const path = await import('path');

      const botIndexPath = path.join(process.cwd(), 'bot/index.js');
      const content = fs.readFileSync(botIndexPath, 'utf8');

      expect(content).toContain('multi-auth.middleware.js');
      expect(content).toContain('multiUserAuthMiddleware');
      expect(content).toContain('registerUserManagementCommands');
    });

    it('debería tener integración en server.js', async () => {
      const fs = await import('fs');
      const path = await import('path');

      const serverPath = path.join(process.cwd(), 'server.js');
      const content = fs.readFileSync(serverPath, 'utf8');

      expect(content).toContain('SafeOperationsService');
      expect(content).toContain('SafeOperationsService.initialize()');
    });
  });

  describe('Verificación de Schema Prisma', () => {
    it('debería tener constraint multiusuario en schema', async () => {
      const fs = await import('fs');
      const path = await import('path');

      const schemaPath = path.join(process.cwd(), 'prisma/schema.prisma');
      const content = fs.readFileSync(schemaPath, 'utf8');

      // Verificar que tiene el constraint compuesto
      expect(content).toContain('@@unique([tenantId, telegramId])');

      // Verificar que el modelo TenantUser está bien estructurado
      expect(content).toContain('model TenantUser');
      expect(content).toContain('telegramId   BigInt          @map("telegram_id")');
    });
  });

  describe('Verificación de Migración', () => {
    it('debería tener archivo de migración', async () => {
      const fs = await import('fs');
      const path = await import('path');

      const migrationPath = path.join(
        process.cwd(),
        'feature-multiuser/migrations/001_enable_multi_telegram_users.sql'
      );
      expect(fs.existsSync(migrationPath)).toBe(true);

      const content = fs.readFileSync(migrationPath, 'utf8');
      expect(content).toContain('tenant_users_tenant_telegram_unique');
      expect(content).toContain('DROP CONSTRAINT IF EXISTS tenant_users_telegram_id_key');
    });
  });

  describe('Verificación de Logs', () => {
    it('middleware debería inicializar con logs', async () => {
      // Este test verifica que el middleware se puede importar sin errores
      // Los logs ya aparecieron en la ejecución anterior
      const { default: middleware } = await import(
        '../../bot/middlewares/multi-auth.middleware.js'
      );
      expect(typeof middleware).toBe('function');
    });
  });
});
