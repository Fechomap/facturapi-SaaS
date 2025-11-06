// core/tenant/tenant.service.ts
import prisma from '../../lib/prisma';
import logger from '../utils/logger';
import { withTransaction, auditLog } from '../utils/transaction';

const tenantLogger = logger.child({ module: 'tenant-service' });

interface CreateTenantData {
  businessName: string;
  rfc: string;
  email: string;
  phone?: string;
  address?: string;
  contactName?: string;
  facturapiOrganizationId?: string;
  facturapiApiKey?: string;
}

interface CreateTenantUserData {
  tenantId: string;
  telegramId: bigint | string | number;
  firstName: string;
  lastName?: string;
  username?: string;
  role?: string;
  isAuthorized?: boolean;
}

interface CanGenerateResult {
  canGenerate: boolean;
  reason?: string;
}

/**
 * Servicio para la gestión de tenants
 */
class TenantService {
  /**
   * Crea un nuevo tenant en el sistema
   */
  static async createTenant(data: CreateTenantData) {
    tenantLogger.info({ businessName: data.businessName, rfc: data.rfc }, 'Creando nuevo tenant');

    if (!data.businessName) throw new Error('El nombre de la empresa es requerido');
    if (!data.rfc) throw new Error('El RFC es requerido');
    if (!data.email) throw new Error('El correo electrónico es requerido');

    const facturapiApiKey = data.facturapiApiKey;
    if (!facturapiApiKey) {
      tenantLogger.warn(
        `Creando tenant ${data.businessName} sin API key de FacturAPI - esto causará problemas al facturar.`
      );
    } else {
      tenantLogger.debug(`API key preparada para tenant ${data.businessName} (${data.rfc})`);
    }

    return withTransaction(
      async (tx) => {
        try {
          const tenant = await tx.tenant.create({
            data: {
              businessName: data.businessName,
              rfc: data.rfc,
              email: data.email,
              phone: data.phone,
              address: data.address,
              contactName: data.contactName,
              facturapiOrganizationId: data.facturapiOrganizationId,
              facturapiApiKey: facturapiApiKey,
              folios: {
                create: {
                  series: 'A',
                  currentNumber: 800,
                },
              },
            },
          });

          tenantLogger.info(
            {
              tenantId: tenant.id,
              businessName: tenant.businessName,
              hasApiKey: !!facturapiApiKey,
              organizationId: tenant.facturapiOrganizationId || 'No configurada',
            },
            'Tenant creado con éxito'
          );

          const createdTenant = await tx.tenant.findUnique({
            where: { id: tenant.id },
            select: { facturapiApiKey: true },
          });

          if (!createdTenant?.facturapiApiKey && facturapiApiKey) {
            tenantLogger.warn(
              `ADVERTENCIA: La API key no se guardó correctamente para el tenant ${tenant.id}`
            );
          }

          await auditLog(tx, {
            tenantId: tenant.id,
            action: 'tenant:create',
            entityType: 'tenant',
            entityId: tenant.id,
            details: {
              businessName: tenant.businessName,
              rfc: tenant.rfc,
              email: tenant.email,
              hasApiKey: !!tenant.facturapiApiKey,
              hasOrgId: !!tenant.facturapiOrganizationId,
            },
          });

          return tenant;
        } catch (error: any) {
          tenantLogger.error(
            { error, businessName: data.businessName, rfc: data.rfc },
            'Error al crear tenant'
          );
          throw error;
        }
      },
      { description: 'Crear nuevo tenant' }
    );
  }

  /**
   * Crea un nuevo usuario vinculado a un tenant
   */
  static async createTenantUser(data: CreateTenantUserData) {
    tenantLogger.info(
      {
        tenantId: data.tenantId,
        telegramId: data.telegramId.toString(),
        firstName: data.firstName,
        role: data.role || 'admin',
      },
      'Creando nuevo usuario para tenant'
    );

    return withTransaction(
      async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: data.tenantId },
        });

        if (!tenant) {
          throw new Error(`No se encontró el tenant con ID ${data.tenantId}`);
        }

        const user = await tx.tenantUser.create({
          data: {
            tenantId: data.tenantId,
            telegramId: BigInt(data.telegramId),
            firstName: data.firstName,
            lastName: data.lastName,
            username: data.username,
            role: data.role || 'admin',
            isAuthorized: data.isAuthorized !== undefined ? data.isAuthorized : true,
          },
        });

        await auditLog(tx, {
          tenantId: data.tenantId,
          action: 'tenant:user:create',
          entityType: 'tenant_user',
          entityId: user.id.toString(),
          details: {
            telegramId: user.telegramId.toString(),
            role: user.role,
            isAuthorized: user.isAuthorized,
          },
        });

        tenantLogger.info(
          { userId: user.id, tenantId: user.tenantId, telegramId: user.telegramId.toString() },
          'Usuario creado exitosamente'
        );

        return user;
      },
      { description: 'Crear usuario de tenant' }
    );
  }

  /**
   * Busca un tenant por su RFC
   */
  static async findTenantByRfc(rfc: string) {
    tenantLogger.debug({ rfc }, 'Buscando tenant por RFC');

    try {
      return await prisma.tenant.findUnique({
        where: { rfc },
      });
    } catch (error: any) {
      tenantLogger.error({ error, rfc }, 'Error al buscar tenant por RFC');
      throw error;
    }
  }

  /**
   * Busca un tenant por su ID con su suscripción actual
   */
  static async findTenantWithSubscription(id: string) {
    tenantLogger.debug({ tenantId: id }, 'Buscando tenant con suscripción');

    try {
      return await prisma.tenant.findUnique({
        where: { id },
        include: {
          subscriptions: {
            include: {
              plan: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
            take: 1,
          },
        },
      });
    } catch (error: any) {
      tenantLogger.error({ error, tenantId: id }, 'Error al buscar tenant con suscripción');
      throw error;
    }
  }

  /**
   * Busca un usuario de tenant por su ID de Telegram
   */
  static async findUserByTelegramId(telegramId: bigint | string | number) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
    tenantLogger.debug(
      { telegramId: telegramIdBigInt.toString() },
      'Buscando usuario por Telegram ID'
    );

    try {
      const users = await prisma.tenantUser.findMany({
        where: { telegramId: telegramIdBigInt },
        include: {
          tenant: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (users.length === 0) return null;

      const authorizedUser = users.find((user) => user.isAuthorized && user.tenant.isActive);
      if (authorizedUser) return authorizedUser;

      return users[0];
    } catch (error: any) {
      tenantLogger.error(
        { error, telegramId: telegramIdBigInt.toString() },
        'Error al buscar usuario por Telegram ID'
      );
      throw error;
    }
  }

  /**
   * Crea una suscripción para un tenant
   */
  static async createSubscription(tenantId: string, planId: number) {
    tenantLogger.info({ tenantId, planId }, 'Creando suscripción para tenant');

    return withTransaction(
      async (tx) => {
        const existingSubscription = await tx.tenantSubscription.findFirst({
          where: { tenantId },
        });

        if (existingSubscription) {
          tenantLogger.warn(
            { tenantId, existingSubscriptionId: existingSubscription.id },
            'El tenant ya tiene una suscripción activa'
          );
          throw new Error('El tenant ya tiene una suscripción activa');
        }

        const plan = await tx.subscriptionPlan.findUnique({
          where: { id: planId },
        });

        if (!plan) {
          tenantLogger.error({ planId }, 'El plan seleccionado no existe');
          throw new Error('El plan seleccionado no existe');
        }

        const now = new Date();
        const trialEndsAt = new Date(now);
        trialEndsAt.setDate(trialEndsAt.getDate() + 14);

        const subscription = await tx.tenantSubscription.create({
          data: {
            tenantId,
            planId,
            status: 'trial',
            trialEndsAt,
            currentPeriodStartsAt: now,
            currentPeriodEndsAt: trialEndsAt,
          },
          include: {
            plan: true,
          },
        });

        await auditLog(tx, {
          tenantId,
          action: 'subscription:create',
          entityType: 'tenant_subscription',
          entityId: subscription.id.toString(),
          details: {
            planId: planId,
            planName: plan.name,
            status: 'trial',
            trialEndsAt: trialEndsAt.toISOString(),
          },
        });

        tenantLogger.info(
          {
            subscriptionId: subscription.id,
            tenantId,
            planId,
            trialEndsAt: trialEndsAt.toISOString(),
          },
          'Suscripción creada exitosamente'
        );

        return subscription;
      },
      { description: 'Crear suscripción de tenant' }
    );
  }

  /**
   * Incrementa el contador de facturas usadas
   */
  static async incrementInvoiceCount(tenantId: string) {
    tenantLogger.debug({ tenantId }, 'Incrementando contador de facturas');

    return withTransaction(
      async (tx) => {
        const subscription = await tx.tenantSubscription.findFirst({
          where: {
            tenantId,
            OR: [{ status: 'active' }, { status: 'trial' }],
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        if (!subscription) {
          tenantLogger.error({ tenantId }, 'No hay una suscripción activa para este tenant');
          throw new Error('No hay una suscripción activa para este tenant');
        }

        const updatedSubscription = await tx.tenantSubscription.update({
          where: { id: subscription.id },
          data: {
            invoicesUsed: {
              increment: 1,
            },
          },
        });

        tenantLogger.debug(
          {
            subscriptionId: updatedSubscription.id,
            tenantId,
            invoicesUsed: updatedSubscription.invoicesUsed,
          },
          'Contador de facturas incrementado'
        );

        return updatedSubscription;
      },
      { description: 'Incrementar contador de facturas' }
    );
  }

  /**
   * Verifica si un tenant puede generar más facturas
   */
  static async canGenerateInvoice(tenantId: string): Promise<CanGenerateResult> {
    tenantLogger.debug({ tenantId }, 'Verificando si puede generar factura');

    try {
      const subscription = await prisma.tenantSubscription.findFirst({
        where: {
          tenantId,
          OR: [{ status: 'active' }, { status: 'trial' }],
        },
        include: {
          plan: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!subscription) {
        tenantLogger.warn({ tenantId }, 'No hay una suscripción activa para este tenant');
        return {
          canGenerate: false,
          reason: 'No hay una suscripción activa para este tenant',
        };
      }

      if (subscription.status === 'trial') {
        if (subscription.trialEndsAt && subscription.trialEndsAt < new Date()) {
          tenantLogger.warn(
            { tenantId, subscriptionId: subscription.id },
            'El período de prueba ha terminado'
          );
          return {
            canGenerate: false,
            reason: 'El período de prueba ha terminado',
          };
        }
      }

      if (subscription.invoicesUsed >= subscription.plan.invoiceLimit) {
        tenantLogger.warn(
          {
            tenantId,
            subscriptionId: subscription.id,
            invoicesUsed: subscription.invoicesUsed,
            invoiceLimit: subscription.plan.invoiceLimit,
          },
          'Límite de facturas alcanzado'
        );
        return {
          canGenerate: false,
          reason: `Ha alcanzado el límite de ${subscription.plan.invoiceLimit} facturas de su plan`,
        };
      }

      tenantLogger.debug(
        {
          tenantId,
          subscriptionId: subscription.id,
          invoicesUsed: subscription.invoicesUsed,
          invoiceLimit: subscription.plan.invoiceLimit,
        },
        'Puede generar factura'
      );
      return { canGenerate: true };
    } catch (error: any) {
      tenantLogger.error({ error, tenantId }, 'Error al verificar si puede generar factura');
      throw error;
    }
  }

  /**
   * Obtiene o crea un folio para un tenant
   */
  static async getNextFolio(tenantId: string, series: string = 'A'): Promise<number> {
    tenantLogger.debug({ tenantId, series }, 'Obteniendo siguiente folio');

    return withTransaction(
      async (tx) => {
        let folio = await tx.tenantFolio.findUnique({
          where: {
            tenantId_series: {
              tenantId,
              series,
            },
          },
        });

        if (!folio) {
          tenantLogger.info({ tenantId, series }, 'Creando nuevo contador de folios');
          folio = await tx.tenantFolio.create({
            data: {
              tenantId,
              series,
              currentNumber: 800,
            },
          });
        }

        const currentNumber = folio.currentNumber;
        await tx.tenantFolio.update({
          where: { id: folio.id },
          data: {
            currentNumber: {
              increment: 1,
            },
          },
        });

        tenantLogger.debug({ tenantId, series, folio: currentNumber }, 'Folio reservado');
        return currentNumber;
      },
      { description: 'Obtener siguiente folio' }
    );
  }

  /**
   * Registra una factura generada para un tenant
   */
  static async registerInvoice(
    tenantId: string,
    facturapiInvoiceId: string,
    series: string,
    folioNumber: number,
    customerId: number | null,
    total: number,
    createdById: bigint | string | number | null
  ) {
    tenantLogger.info(
      {
        tenantId,
        facturapiInvoiceId,
        series,
        folioNumber,
        customerId,
        total,
      },
      'Registrando factura'
    );

    return withTransaction(
      async (tx) => {
        const createdByIdInt =
          createdById && parseInt(createdById.toString()) <= 2147483647
            ? parseInt(createdById.toString())
            : null;

        const createdByIdBigInt =
          createdById && typeof createdById !== 'bigint' ? BigInt(createdById) : createdById;

        const invoice = await tx.tenantInvoice.create({
          data: {
            tenantId,
            facturapiInvoiceId,
            series,
            folioNumber,
            customerId,
            total,
            status: 'valid',
            createdById: createdByIdInt,
            invoiceDate: new Date(),
          },
        });

        await this.incrementInvoiceCount(tenantId);

        const userRecord = createdByIdBigInt
          ? await tx.tenantUser.findFirst({ where: { telegramId: createdByIdBigInt as bigint } })
          : null;
        const userId = userRecord?.id || null;

        await auditLog(tx, {
          tenantId,
          userId,
          action: 'invoice:create',
          entityType: 'tenant_invoice',
          entityId: invoice.id.toString(),
          details: {
            facturapiInvoiceId,
            series,
            folioNumber,
            customerId,
            total,
          },
        });

        tenantLogger.info(
          {
            invoiceId: invoice.id,
            tenantId,
            facturapiInvoiceId,
          },
          'Factura registrada exitosamente'
        );

        return invoice;
      },
      { description: 'Registrar factura' }
    );
  }

  /**
   * Obtiene una API key para un tenant
   */
  static async getApiKey(tenantId: string): Promise<string> {
    tenantLogger.debug({ tenantId }, 'Obteniendo API key');

    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          facturapiApiKey: true,
          businessName: true,
        },
      });

      if (!tenant) {
        tenantLogger.error({ tenantId }, 'Tenant no encontrado al obtener API key');
        throw new Error(`No se encontró el tenant con ID ${tenantId}`);
      }

      if (!tenant.facturapiApiKey) {
        tenantLogger.error(
          { tenantId, businessName: tenant.businessName },
          'El tenant no tiene una API key configurada'
        );
        throw new Error('El tenant no tiene una API key configurada');
      }

      return tenant.facturapiApiKey;
    } catch (error: any) {
      tenantLogger.error({ error, tenantId }, 'Error al obtener API key');
      throw error;
    }
  }

  /**
   * Obtiene una API key desencriptada para un tenant (alias de getApiKey)
   */
  static async getDecryptedApiKey(tenantId: string): Promise<string> {
    tenantLogger.debug({ tenantId }, 'Obteniendo API key desencriptada');

    try {
      const apiKey = await this.getApiKey(tenantId);
      tenantLogger.debug({ tenantId }, 'API key obtenida correctamente');
      return apiKey;
    } catch (error: any) {
      tenantLogger.error({ error, tenantId }, 'Error al obtener API key desencriptada');
      throw error;
    }
  }

  /**
   * Obtiene el conteo de facturas emitidas por un tenant
   */
  static async getTenantInvoiceCount(tenantId: string): Promise<number> {
    try {
      return await prisma.tenantInvoice.count({
        where: { tenantId },
      });
    } catch (error: any) {
      tenantLogger.error({ error, tenantId }, 'Error al obtener conteo de facturas');
      throw error;
    }
  }
}

export default TenantService;
