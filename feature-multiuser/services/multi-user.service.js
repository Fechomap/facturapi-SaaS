// feature-multiuser/services/multi-user.service.js
// Servicio para gestión de múltiples usuarios por tenant

import prisma from '../../lib/prisma.js';
import logger from '../../core/utils/logger.js';
import { USER_ROLES } from '../middleware/multi-auth.middleware.js';

// Logger específico
const multiUserLogger = logger.child({ module: 'multi-user-service' });

/**
 * Servicio para gestión de usuarios multiusuario
 */
class MultiUserService {
  
  /**
   * Obtiene todos los usuarios de un tenant
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Array>} Lista de usuarios
   */
  static async getTenantUsers(tenantId) {
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
          updatedAt: true
        },
        orderBy: { createdAt: 'desc' }
      });

      return users.map(user => ({
        ...user,
        telegramId: user.telegramId.toString(), // Convertir BigInt a string
        displayName: this.getDisplayName(user)
      }));

    } catch (error) {
      multiUserLogger.error(
        { tenantId, error: error.message },
        'Error al obtener usuarios del tenant'
      );
      throw error;
    }
  }

  /**
   * Busca un usuario específico por Telegram ID y Tenant ID
   * @param {string} tenantId - ID del tenant  
   * @param {string|number} telegramId - ID de Telegram
   * @returns {Promise<Object|null>} Usuario encontrado o null
   */
  static async findUser(tenantId, telegramId) {
    try {
      // DESPUÉS DE MIGRACIÓN: Usaremos constraint compuesto
      // Por ahora, simulamos la búsqueda con el constraint único actual
      const user = await prisma.tenantUser.findFirst({
        where: { 
          tenantId,
          telegramId: BigInt(telegramId)
        },
        include: {
          tenant: {
            select: {
              id: true,
              businessName: true,
              isActive: true
            }
          }
        }
      });

      if (!user) return null;

      return {
        ...user,
        telegramId: user.telegramId.toString(),
        displayName: this.getDisplayName(user)
      };

    } catch (error) {
      multiUserLogger.error(
        { tenantId, telegramId, error: error.message },
        'Error al buscar usuario'
      );
      return null;
    }
  }

  /**
   * Invita un nuevo usuario al tenant
   * NOTA: Por ahora solo genera el registro, después se implementará invitación real
   * @param {string} tenantId - ID del tenant
   * @param {string|number} telegramId - ID de Telegram del nuevo usuario
   * @param {string} role - Rol del usuario (default: 'operator')
   * @param {string|number} invitedBy - ID de Telegram del que invita
   * @returns {Promise<Object>} Usuario creado
   */
  static async inviteUser(tenantId, telegramId, role = USER_ROLES.OPERATOR, invitedBy) {
    try {
      // Verificar que el que invita sea admin
      const inviter = await this.findUser(tenantId, invitedBy);
      if (!inviter || inviter.role !== USER_ROLES.ADMIN) {
        throw new Error('Solo los administradores pueden invitar usuarios');
      }

      // Verificar que el usuario no exista ya
      const existingUser = await this.findUser(tenantId, telegramId);
      if (existingUser) {
        throw new Error('El usuario ya está registrado en este tenant');
      }

      // Validar rol
      if (!Object.values(USER_ROLES).includes(role)) {
        throw new Error(`Rol inválido: ${role}`);
      }

      // DESPUÉS DE MIGRACIÓN: Esto funcionará con múltiples usuarios
      // Por ahora, registramos el usuario con isAuthorized = false
      const newUser = await prisma.tenantUser.create({
        data: {
          tenantId,
          telegramId: BigInt(telegramId),
          role,
          isAuthorized: false, // Requerirá autorización del admin
          // firstName, lastName, username se llenarán cuando el usuario interactúe
        }
      });

      multiUserLogger.info(
        { 
          tenantId, 
          newUserId: telegramId, 
          role, 
          invitedBy 
        },
        'Usuario invitado al tenant'
      );

      return {
        ...newUser,
        telegramId: newUser.telegramId.toString()
      };

    } catch (error) {
      multiUserLogger.error(
        { tenantId, telegramId, role, invitedBy, error: error.message },
        'Error al invitar usuario'
      );
      throw error;
    }
  }

  /**
   * Autoriza o desautoriza un usuario
   * @param {string} tenantId - ID del tenant
   * @param {string|number} telegramId - ID de Telegram del usuario
   * @param {boolean} isAuthorized - Si autorizar o no
   * @param {string|number} authorizedBy - ID de Telegram del que autoriza
   * @returns {Promise<Object>} Usuario actualizado
   */
  static async authorizeUser(tenantId, telegramId, isAuthorized, authorizedBy) {
    try {
      // Verificar que el que autoriza sea admin
      const authorizer = await this.findUser(tenantId, authorizedBy);
      if (!authorizer || authorizer.role !== USER_ROLES.ADMIN) {
        throw new Error('Solo los administradores pueden autorizar usuarios');
      }

      // Actualizar autorización
      const updatedUser = await prisma.tenantUser.updateMany({
        where: {
          tenantId,
          telegramId: BigInt(telegramId)
        },
        data: {
          isAuthorized,
          updatedAt: new Date()
        }
      });

      if (updatedUser.count === 0) {
        throw new Error('Usuario no encontrado');
      }

      multiUserLogger.info(
        { 
          tenantId, 
          telegramId, 
          isAuthorized, 
          authorizedBy 
        },
        `Usuario ${isAuthorized ? 'autorizado' : 'desautorizado'}`
      );

      return await this.findUser(tenantId, telegramId);

    } catch (error) {
      multiUserLogger.error(
        { tenantId, telegramId, isAuthorized, authorizedBy, error: error.message },
        'Error al autorizar usuario'
      );
      throw error;
    }
  }

  /**
   * Cambia el rol de un usuario
   * @param {string} tenantId - ID del tenant
   * @param {string|number} telegramId - ID de Telegram del usuario
   * @param {string} newRole - Nuevo rol
   * @param {string|number} changedBy - ID de Telegram del que cambia el rol
   * @returns {Promise<Object>} Usuario actualizado
   */
  static async changeUserRole(tenantId, telegramId, newRole, changedBy) {
    try {
      // Verificar que el que cambia sea admin
      const changer = await this.findUser(tenantId, changedBy);
      if (!changer || changer.role !== USER_ROLES.ADMIN) {
        throw new Error('Solo los administradores pueden cambiar roles');
      }

      // Validar nuevo rol
      if (!Object.values(USER_ROLES).includes(newRole)) {
        throw new Error(`Rol inválido: ${newRole}`);
      }

      // No permitir que se quite el último admin
      if (changer.telegramId === telegramId.toString() && newRole !== USER_ROLES.ADMIN) {
        const adminCount = await prisma.tenantUser.count({
          where: {
            tenantId,
            role: USER_ROLES.ADMIN,
            isAuthorized: true
          }
        });

        if (adminCount <= 1) {
          throw new Error('No puedes quitar el rol de admin del último administrador');
        }
      }

      // Actualizar rol
      const updatedUser = await prisma.tenantUser.updateMany({
        where: {
          tenantId,
          telegramId: BigInt(telegramId)
        },
        data: {
          role: newRole,
          updatedAt: new Date()
        }
      });

      if (updatedUser.count === 0) {
        throw new Error('Usuario no encontrado');
      }

      multiUserLogger.info(
        { 
          tenantId, 
          telegramId, 
          newRole, 
          changedBy 
        },
        'Rol de usuario actualizado'
      );

      return await this.findUser(tenantId, telegramId);

    } catch (error) {
      multiUserLogger.error(
        { tenantId, telegramId, newRole, changedBy, error: error.message },
        'Error al cambiar rol de usuario'
      );
      throw error;
    }
  }

  /**
   * Remueve un usuario del tenant
   * @param {string} tenantId - ID del tenant
   * @param {string|number} telegramId - ID de Telegram del usuario
   * @param {string|number} removedBy - ID de Telegram del que remueve
   * @returns {Promise<boolean>} True si se removió exitosamente
   */
  static async removeUser(tenantId, telegramId, removedBy) {
    try {
      // Verificar que el que remueve sea admin
      const remover = await this.findUser(tenantId, removedBy);
      if (!remover || remover.role !== USER_ROLES.ADMIN) {
        throw new Error('Solo los administradores pueden remover usuarios');
      }

      // No permitir auto-remoción del último admin
      if (remover.telegramId === telegramId.toString()) {
        const adminCount = await prisma.tenantUser.count({
          where: {
            tenantId,
            role: USER_ROLES.ADMIN,
            isAuthorized: true
          }
        });

        if (adminCount <= 1) {
          throw new Error('No puedes remover el último administrador');
        }
      }

      // Remover usuario
      const deletedUser = await prisma.tenantUser.deleteMany({
        where: {
          tenantId,
          telegramId: BigInt(telegramId)
        }
      });

      if (deletedUser.count === 0) {
        throw new Error('Usuario no encontrado');
      }

      multiUserLogger.info(
        { 
          tenantId, 
          telegramId, 
          removedBy 
        },
        'Usuario removido del tenant'
      );

      return true;

    } catch (error) {
      multiUserLogger.error(
        { tenantId, telegramId, removedBy, error: error.message },
        'Error al remover usuario'
      );
      throw error;
    }
  }

  /**
   * Obtiene estadísticas de usuarios del tenant
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} Estadísticas
   */
  static async getTenantStats(tenantId) {
    try {
      const [total, authorized, byRole] = await Promise.all([
        // Total de usuarios
        prisma.tenantUser.count({
          where: { tenantId }
        }),
        
        // Usuarios autorizados
        prisma.tenantUser.count({
          where: { tenantId, isAuthorized: true }
        }),

        // Por rol
        prisma.tenantUser.groupBy({
          by: ['role'],
          where: { tenantId },
          _count: true
        })
      ]);

      const roleStats = {};
      byRole.forEach(item => {
        roleStats[item.role] = item._count;
      });

      return {
        total,
        authorized,
        pending: total - authorized,
        byRole: roleStats
      };

    } catch (error) {
      multiUserLogger.error(
        { tenantId, error: error.message },
        'Error al obtener estadísticas'
      );
      throw error;
    }
  }

  /**
   * Genera nombre para mostrar del usuario
   * @param {Object} user - Objeto usuario
   * @returns {string} Nombre para mostrar
   */
  static getDisplayName(user) {
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    if (user.firstName) {
      return user.firstName;
    }
    if (user.username) {
      return `@${user.username}`;
    }
    return `Usuario ${user.telegramId.toString().slice(-4)}`;
  }
}

export default MultiUserService;