// services/multi-user.service.ts
import prisma from '../lib/prisma';
import logger from '../core/utils/logger';
import redisSessionService from './redis-session.service';

const multiUserLogger = logger.child({ module: 'multi-user-service' });

export const USER_ROLES = {
  ADMIN: 'admin',
  OPERATOR: 'operator',
  VIEWER: 'viewer',
} as const;

type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

// Cache de usuarios para autenticación rápida
const userCache = new Map<string, any>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

export function invalidateUserCache(telegramId: string | number): boolean {
  const key = telegramId.toString();
  return userCache.delete(key);
}

interface UserDisplay {
  id: number;
  telegramId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  role: string;
  isAuthorized: boolean;
  createdAt: Date;
  updatedAt: Date;
  displayName: string;
}

interface UserWithTenant extends UserDisplay {
  tenantId: string;
  tenant: {
    id: string;
    businessName: string;
    isActive: boolean;
  };
}

interface UserStats {
  total: number;
  authorized: number;
  pending: number;
  byRole: Record<string, number>;
}

/**
 * Servicio para gestión de usuarios multiusuario
 */
class MultiUserService {
  /**
   * Obtiene todos los usuarios de un tenant
   */
  static async getTenantUsers(tenantId: string): Promise<UserDisplay[]> {
    try {
      const users = await prisma.tenantUser.findMany({
        where: { tenantId },
        select: {
          id: true,
          telegramId: true,
          firstName: true,
          lastName: true,
          username: true,
          role: true,
          isAuthorized: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return users.map((user) => ({
        ...user,
        telegramId: user.telegramId.toString(),
        displayName: this.getDisplayName(user),
      }));
    } catch (error: any) {
      multiUserLogger.error(
        { tenantId, error: error.message },
        'Error al obtener usuarios del tenant'
      );
      throw error;
    }
  }

  /**
   * Busca un usuario específico por Telegram ID y Tenant ID
   */
  static async findUser(
    tenantId: string,
    telegramId: string | number
  ): Promise<UserWithTenant | null> {
    try {
      const user = await prisma.tenantUser.findFirst({
        where: {
          tenantId,
          telegramId: BigInt(telegramId),
        },
        include: {
          tenant: {
            select: {
              id: true,
              businessName: true,
              isActive: true,
            },
          },
        },
      });

      if (!user) return null;

      return {
        ...user,
        telegramId: user.telegramId.toString(),
        displayName: this.getDisplayName(user),
      };
    } catch (error: any) {
      multiUserLogger.error(
        { tenantId, telegramId, error: error.message },
        'Error al buscar usuario'
      );
      return null;
    }
  }

  /**
   * Invita un nuevo usuario al tenant
   */
  static async inviteUser(
    tenantId: string,
    telegramId: string | number,
    role: UserRole = USER_ROLES.OPERATOR,
    invitedBy: string | number
  ): Promise<{ id: string; telegramId: string }> {
    try {
      const inviter = await this.findUser(tenantId, invitedBy);
      if (!inviter || inviter.role !== USER_ROLES.ADMIN) {
        throw new Error('Solo los administradores pueden invitar usuarios');
      }

      const existingUser = await this.findUser(tenantId, telegramId);
      if (existingUser) {
        throw new Error('El usuario ya está registrado en este tenant');
      }

      if (!Object.values(USER_ROLES).includes(role)) {
        throw new Error(`Rol inválido: ${role}`);
      }

      const newUser = await prisma.tenantUser.create({
        data: {
          tenantId,
          telegramId: BigInt(telegramId),
          role,
          isAuthorized: false,
        },
      });

      multiUserLogger.info(
        {
          tenantId,
          newUserId: telegramId,
          role,
          invitedBy,
        },
        'Usuario invitado al tenant'
      );

      return {
        id: newUser.id.toString(),
        telegramId: newUser.telegramId.toString(),
      };
    } catch (error: any) {
      multiUserLogger.error(
        { tenantId, telegramId, role, invitedBy, error: error.message },
        'Error al invitar usuario'
      );
      throw error;
    }
  }

  /**
   * Autoriza o desautoriza un usuario
   */
  static async authorizeUser(
    tenantId: string,
    telegramId: string | number,
    isAuthorized: boolean,
    authorizedBy: string | number
  ): Promise<UserWithTenant | null> {
    try {
      const authorizer = await this.findUser(tenantId, authorizedBy);
      if (!authorizer || authorizer.role !== USER_ROLES.ADMIN) {
        throw new Error('Solo los administradores pueden autorizar usuarios');
      }

      const updatedUser = await prisma.tenantUser.updateMany({
        where: {
          tenantId,
          telegramId: BigInt(telegramId),
        },
        data: {
          isAuthorized,
          updatedAt: new Date(),
        },
      });

      if (updatedUser.count === 0) {
        throw new Error('Usuario no encontrado');
      }

      multiUserLogger.info(
        {
          tenantId,
          telegramId,
          isAuthorized,
          authorizedBy,
        },
        `Usuario ${isAuthorized ? 'autorizado' : 'desautorizado'}`
      );

      return await this.findUser(tenantId, telegramId);
    } catch (error: any) {
      multiUserLogger.error(
        { tenantId, telegramId, isAuthorized, authorizedBy, error: error.message },
        'Error al autorizar usuario'
      );
      throw error;
    }
  }

  /**
   * Cambia el rol de un usuario
   */
  static async changeUserRole(
    tenantId: string,
    telegramId: string | number,
    newRole: UserRole,
    changedBy: string | number
  ): Promise<UserWithTenant | null> {
    try {
      const changer = await this.findUser(tenantId, changedBy);
      if (!changer || changer.role !== USER_ROLES.ADMIN) {
        throw new Error('Solo los administradores pueden cambiar roles');
      }

      if (!Object.values(USER_ROLES).includes(newRole)) {
        throw new Error(`Rol inválido: ${newRole}`);
      }

      if (changer.telegramId === telegramId.toString() && newRole !== USER_ROLES.ADMIN) {
        const adminCount = await prisma.tenantUser.count({
          where: {
            tenantId,
            role: USER_ROLES.ADMIN,
            isAuthorized: true,
          },
        });

        if (adminCount <= 1) {
          throw new Error('No puedes quitar el rol de admin del último administrador');
        }
      }

      const updatedUser = await prisma.tenantUser.updateMany({
        where: {
          tenantId,
          telegramId: BigInt(telegramId),
        },
        data: {
          role: newRole,
          updatedAt: new Date(),
        },
      });

      if (updatedUser.count === 0) {
        throw new Error('Usuario no encontrado');
      }

      multiUserLogger.info(
        {
          tenantId,
          telegramId,
          newRole,
          changedBy,
        },
        'Rol de usuario actualizado'
      );

      return await this.findUser(tenantId, telegramId);
    } catch (error: any) {
      multiUserLogger.error(
        { tenantId, telegramId, newRole, changedBy, error: error.message },
        'Error al cambiar rol de usuario'
      );
      throw error;
    }
  }

  /**
   * Remueve un usuario del tenant
   */
  static async removeUser(
    tenantId: string,
    telegramId: string | number,
    removedBy: string | number
  ): Promise<boolean> {
    try {
      const remover = await this.findUser(tenantId, removedBy);
      if (!remover || remover.role !== USER_ROLES.ADMIN) {
        throw new Error('Solo los administradores pueden remover usuarios');
      }

      if (remover.telegramId === telegramId.toString()) {
        const adminCount = await prisma.tenantUser.count({
          where: {
            tenantId,
            role: USER_ROLES.ADMIN,
            isAuthorized: true,
          },
        });

        if (adminCount <= 1) {
          throw new Error('No puedes remover el último administrador');
        }
      }

      const deletedUser = await prisma.tenantUser.deleteMany({
        where: {
          tenantId,
          telegramId: BigInt(telegramId),
        },
      });

      if (deletedUser.count === 0) {
        throw new Error('Usuario no encontrado');
      }

      await prisma.userSession.deleteMany({
        where: {
          telegramId: BigInt(telegramId),
        },
      });

      const authCacheInvalidated = invalidateUserCache(telegramId);
      const redisResult = await redisSessionService.deleteSession(telegramId.toString());

      multiUserLogger.info(
        {
          tenantId,
          telegramId,
          removedBy,
          authCacheInvalidated,
          redisCacheInvalidated: redisResult.success,
        },
        'Usuario removido del tenant y TODOS los cachés invalidados'
      );

      return true;
    } catch (error: any) {
      multiUserLogger.error(
        { tenantId, telegramId, removedBy, error: error.message },
        'Error al remover usuario'
      );
      throw error;
    }
  }

  /**
   * Obtiene estadísticas de usuarios del tenant
   */
  static async getTenantStats(tenantId: string): Promise<UserStats> {
    try {
      const [total, authorized, byRole] = await Promise.all([
        prisma.tenantUser.count({
          where: { tenantId },
        }),

        prisma.tenantUser.count({
          where: { tenantId, isAuthorized: true },
        }),

        prisma.tenantUser.groupBy({
          by: ['role'],
          where: { tenantId },
          _count: true,
        }),
      ]);

      const roleStats: Record<string, number> = {};
      byRole.forEach((item) => {
        roleStats[item.role] = item._count;
      });

      return {
        total,
        authorized,
        pending: total - authorized,
        byRole: roleStats,
      };
    } catch (error: any) {
      multiUserLogger.error({ tenantId, error: error.message }, 'Error al obtener estadísticas');
      throw error;
    }
  }

  /**
   * Genera nombre para mostrar del usuario
   */
  static getDisplayName(user: {
    firstName: string | null;
    lastName?: string | null;
    username?: string | null;
    telegramId: bigint | string;
  }): string {
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    if (user.firstName) {
      return user.firstName;
    }
    if (user.username) {
      return `@${user.username}`;
    }
    const telegramIdStr =
      typeof user.telegramId === 'bigint' ? user.telegramId.toString() : user.telegramId;
    return `Usuario ${telegramIdStr.slice(-4)}`;
  }
}

export default MultiUserService;
