// core/tenant/tenant.service.js
import prisma from '../../lib/prisma.js';
import logger from '../utils/logger.js';
import { withTransaction, auditLog } from '../utils/transaction.js';
import { legacyDecryptApiKey } from '../utils/encryption.js';

// Logger específico para el servicio de tenant
const tenantLogger = logger.child({ module: 'tenant-service' });

/**
 * Servicio para la gestión de tenants
 */
class TenantService {
  /**
   * Crea un nuevo tenant en el sistema
   * @param {Object} data - Datos para la creación del tenant
   * @returns {Promise<Object>} - Tenant creado
   */
  static async createTenant(data) {
    tenantLogger.info({ businessName: data.businessName, rfc: data.rfc }, 'Creando nuevo tenant');
    
    // Validación de datos
    if (!data.businessName) throw new Error('El nombre de la empresa es requerido');
    if (!data.rfc) throw new Error('El RFC es requerido');
    if (!data.email) throw new Error('El correo electrónico es requerido');

    // Usar la API key directamente sin encriptar
    const facturapiApiKey = data.facturapiApiKey;
    if (!facturapiApiKey) {
      tenantLogger.warn(`Creando tenant ${data.businessName} sin API key de FacturAPI - esto causará problemas al facturar.`);
    } else {
      tenantLogger.debug(`API key preparada para tenant ${data.businessName} (${data.rfc})`);
    }

    return withTransaction(async (tx) => {
      try {
        // Crear el tenant en la base de datos
        const tenant = await tx.tenant.create({
          data: {
            businessName: data.businessName,
            rfc: data.rfc,
            email: data.email,
            phone: data.phone,
            address: data.address,
            contactName: data.contactName,
            facturapiOrganizationId: data.facturapiOrganizationId,
            facturapiApiKey: facturapiApiKey, // Usar directamente la API key
            // Crear automáticamente un contador de folios para este tenant
            folios: {
              create: {
                series: 'A',
                currentNumber: 800
              }
            }
          }
        });

        tenantLogger.info(
          { 
            tenantId: tenant.id, 
            businessName: tenant.businessName, 
            hasApiKey: !!facturapiApiKey,
            organizationId: tenant.facturapiOrganizationId || 'No configurada'
          }, 
          'Tenant creado con éxito'
        );
        
        // Verificar que la API Key se haya guardado correctamente
        const createdTenant = await tx.tenant.findUnique({
          where: { id: tenant.id },
          select: { facturapiApiKey: true }
        });
        
        if (!createdTenant.facturapiApiKey && facturapiApiKey) {
          tenantLogger.warn(`ADVERTENCIA: La API key no se guardó correctamente para el tenant ${tenant.id}`);
        }

        // Registrar en auditoría
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
            hasOrgId: !!tenant.facturapiOrganizationId
          }
        });

        return tenant;
      } catch (error) {
        tenantLogger.error({ error, businessName: data.businessName, rfc: data.rfc }, 'Error al crear tenant');
        throw error;
      }
    }, { description: 'Crear nuevo tenant' });
  }

  /**
   * Crea un nuevo usuario vinculado a un tenant
   * @param {Object} data - Datos del usuario a crear
   * @returns {Promise<Object>} - Usuario creado
   */
  static async createTenantUser(data) {
    tenantLogger.info(
      { 
        tenantId: data.tenantId, 
        telegramId: data.telegramId,
        firstName: data.firstName,
        role: data.role || 'admin'
      }, 
      'Creando nuevo usuario para tenant'
    );

    return withTransaction(async (tx) => {
      // Verificar que el tenant existe
      const tenant = await tx.tenant.findUnique({
        where: { id: data.tenantId }
      });

      if (!tenant) {
        throw new Error(`No se encontró el tenant con ID ${data.tenantId}`);
      }

      // Crear el usuario
      const user = await tx.tenantUser.create({
        data: {
          tenantId: data.tenantId,
          telegramId: BigInt(data.telegramId),
          firstName: data.firstName,
          lastName: data.lastName,
          username: data.username,
          role: data.role || 'admin',
          isAuthorized: data.isAuthorized !== undefined ? data.isAuthorized : true
        }
      });

      // Registrar en auditoría
      await auditLog(tx, {
        tenantId: data.tenantId,
        action: 'tenant:user:create',
        entityType: 'tenant_user',
        entityId: user.id.toString(),
        details: {
          telegramId: user.telegramId.toString(),
          role: user.role,
          isAuthorized: user.isAuthorized
        }
      });

      tenantLogger.info(
        { userId: user.id, tenantId: user.tenantId, telegramId: user.telegramId.toString() },
        'Usuario creado exitosamente'
      );

      return user;
    }, { description: 'Crear usuario de tenant' });
  }

  /**
   * Busca un tenant por su RFC
   * @param {string} rfc - RFC a buscar
   * @returns {Promise<Object|null>} - Tenant encontrado o null
   */
  static async findTenantByRfc(rfc) {
    tenantLogger.debug({ rfc }, 'Buscando tenant por RFC');
    
    try {
      return await prisma.tenant.findUnique({
        where: { rfc }
      });
    } catch (error) {
      tenantLogger.error({ error, rfc }, 'Error al buscar tenant por RFC');
      throw error;
    }
  }

  /**
   * Busca un tenant por su ID con su suscripción actual
   * @param {string} id - ID del tenant
   * @returns {Promise<Object|null>} - Tenant con su suscripción o null
   */
  static async findTenantWithSubscription(id) {
    tenantLogger.debug({ tenantId: id }, 'Buscando tenant con suscripción');
    
    try {
      return await prisma.tenant.findUnique({
        where: { id },
        include: {
          subscriptions: {
            include: {
              plan: true
            },
            orderBy: {
              createdAt: 'desc'
            },
            take: 1
          }
        }
      });
    } catch (error) {
      tenantLogger.error({ error, tenantId: id }, 'Error al buscar tenant con suscripción');
      throw error;
    }
  }

  /**
   * Busca un usuario de tenant por su ID de Telegram
   * @param {BigInt|string|number} telegramId - ID de Telegram del usuario
   * @returns {Promise<Object|null>} - Usuario con su tenant o null
   */
  static async findUserByTelegramId(telegramId) {
    const telegramIdBigInt = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
    tenantLogger.debug({ telegramId: telegramIdBigInt.toString() }, 'Buscando usuario por Telegram ID');
    
    try {
      return await prisma.tenantUser.findUnique({
        where: { telegramId: telegramIdBigInt },
        include: {
          tenant: true
        }
      });
    } catch (error) {
      tenantLogger.error({ error, telegramId: telegramIdBigInt.toString() }, 'Error al buscar usuario por Telegram ID');
      throw error;
    }
  }

  /**
   * Crea una suscripción para un tenant
   * @param {string} tenantId - ID del tenant
   * @param {number} planId - ID del plan
   * @returns {Promise<Object>} - Suscripción creada
   */
  static async createSubscription(tenantId, planId) {
    tenantLogger.info({ tenantId, planId }, 'Creando suscripción para tenant');
    
    return withTransaction(async (tx) => {
      // Verificar si el tenant ya tiene una suscripción
      const existingSubscription = await tx.tenantSubscription.findFirst({
        where: { tenantId }
      });

      if (existingSubscription) {
        tenantLogger.warn({ tenantId, existingSubscriptionId: existingSubscription.id }, 'El tenant ya tiene una suscripción activa');
        throw new Error('El tenant ya tiene una suscripción activa');
      }

      // Obtener el plan
      const plan = await tx.subscriptionPlan.findUnique({
        where: { id: planId }
      });

      if (!plan) {
        tenantLogger.error({ planId }, 'El plan seleccionado no existe');
        throw new Error('El plan seleccionado no existe');
      }

      // Calcular fechas para el período de prueba (14 días)
      const now = new Date();
      const trialEndsAt = new Date(now);
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);

      // Crear la suscripción
      const subscription = await tx.tenantSubscription.create({
        data: {
          tenantId,
          planId,
          status: 'trial',
          trialEndsAt,
          currentPeriodStartsAt: now,
          currentPeriodEndsAt: trialEndsAt
        },
        include: {
          plan: true
        }
      });

      // Registrar en auditoría
      await auditLog(tx, {
        tenantId,
        action: 'subscription:create',
        entityType: 'tenant_subscription',
        entityId: subscription.id.toString(),
        details: {
          planId: planId,
          planName: plan.name,
          status: 'trial',
          trialEndsAt: trialEndsAt.toISOString()
        }
      });

      tenantLogger.info(
        { 
          subscriptionId: subscription.id, 
          tenantId, 
          planId, 
          trialEndsAt: trialEndsAt.toISOString() 
        }, 
        'Suscripción creada exitosamente'
      );

      return subscription;
    }, { description: 'Crear suscripción de tenant' });
  }

  /**
   * Incrementa el contador de facturas usadas en la suscripción actual
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Suscripción actualizada
   */
  static async incrementInvoiceCount(tenantId) {
    tenantLogger.debug({ tenantId }, 'Incrementando contador de facturas');
    
    return withTransaction(async (tx) => {
      // Obtener la suscripción activa
      const subscription = await tx.tenantSubscription.findFirst({
        where: {
          tenantId,
          OR: [
            { status: 'active' },
            { status: 'trial' }
          ]
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      if (!subscription) {
        tenantLogger.error({ tenantId }, 'No hay una suscripción activa para este tenant');
        throw new Error('No hay una suscripción activa para este tenant');
      }

      // Incrementar el contador
      const updatedSubscription = await tx.tenantSubscription.update({
        where: { id: subscription.id },
        data: {
          invoicesUsed: {
            increment: 1
          }
        }
      });

      tenantLogger.debug(
        { 
          subscriptionId: updatedSubscription.id, 
          tenantId, 
          invoicesUsed: updatedSubscription.invoicesUsed 
        }, 
        'Contador de facturas incrementado'
      );

      return updatedSubscription;
    }, { description: 'Incrementar contador de facturas' });
  }

  /**
   * Verifica si un tenant puede generar más facturas según su plan
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Resultado de la verificación
   */
  static async canGenerateInvoice(tenantId) {
    tenantLogger.debug({ tenantId }, 'Verificando si puede generar factura');
    
    try {
      // Obtener la suscripción activa con el plan
      const subscription = await prisma.tenantSubscription.findFirst({
        where: {
          tenantId,
          OR: [
            { status: 'active' },
            { status: 'trial' }
          ]
        },
        include: {
          plan: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      if (!subscription) {
        tenantLogger.warn({ tenantId }, 'No hay una suscripción activa para este tenant');
        return { 
          canGenerate: false, 
          reason: 'No hay una suscripción activa para este tenant' 
        };
      }

      // Verificar si la suscripción está activa
      if (subscription.status === 'trial') {
        // Verificar si el período de prueba ha terminado
        if (subscription.trialEndsAt && subscription.trialEndsAt < new Date()) {
          tenantLogger.warn({ tenantId, subscriptionId: subscription.id }, 'El período de prueba ha terminado');
          return { 
            canGenerate: false, 
            reason: 'El período de prueba ha terminado' 
          };
        }
      }

      // Verificar límite de facturas
      if (subscription.invoicesUsed >= subscription.plan.invoiceLimit) {
        tenantLogger.warn(
          { 
            tenantId, 
            subscriptionId: subscription.id, 
            invoicesUsed: subscription.invoicesUsed, 
            invoiceLimit: subscription.plan.invoiceLimit 
          }, 
          'Límite de facturas alcanzado'
        );
        return { 
          canGenerate: false, 
          reason: `Ha alcanzado el límite de ${subscription.plan.invoiceLimit} facturas de su plan` 
        };
      }

      tenantLogger.debug(
        { 
          tenantId, 
          subscriptionId: subscription.id, 
          invoicesUsed: subscription.invoicesUsed, 
          invoiceLimit: subscription.plan.invoiceLimit 
        }, 
        'Puede generar factura'
      );
      return { canGenerate: true };
    } catch (error) {
      tenantLogger.error({ error, tenantId }, 'Error al verificar si puede generar factura');
      throw error;
    }
  }

  /**
   * Obtiene o crea un folio para un tenant
   * @param {string} tenantId - ID del tenant
   * @param {string} series - Serie del folio (por defecto 'A')
   * @returns {Promise<number>} - Siguiente número de folio
   */
  static async getNextFolio(tenantId, series = 'A') {
    tenantLogger.debug({ tenantId, series }, 'Obteniendo siguiente folio');
    
    return withTransaction(async (tx) => {
      // Intentar obtener el contador de folios existente
      let folio = await tx.tenantFolio.findUnique({
        where: {
          tenantId_series: {
            tenantId,
            series
          }
        }
      });

      // Si no existe, crear uno nuevo
      if (!folio) {
        tenantLogger.info({ tenantId, series }, 'Creando nuevo contador de folios');
        folio = await tx.tenantFolio.create({
          data: {
            tenantId,
            series,
            currentNumber: 800 // Valor inicial por defecto
          }
        });
      }

      // Incrementar el contador y guardar
      const currentNumber = folio.currentNumber;
      await tx.tenantFolio.update({
        where: { id: folio.id },
        data: {
          currentNumber: {
            increment: 1
          }
        }
      });

      tenantLogger.debug({ tenantId, series, folio: currentNumber }, 'Folio reservado');
      return currentNumber;
    }, { description: 'Obtener siguiente folio' });
  }

  /**
   * Registra una factura generada para un tenant
   * @param {string} tenantId - ID del tenant
   * @param {string} facturapiInvoiceId - ID de la factura en FacturAPI
   * @param {string} series - Serie de la factura
   * @param {number} folioNumber - Número de folio
   * @param {number|null} customerId - ID del cliente (opcional)
   * @param {number} total - Monto total de la factura
   * @param {BigInt|string|number|null} createdById - ID de Telegram del usuario que creó la factura (opcional)
   * @returns {Promise<Object>} - Factura registrada
   */
  static async registerInvoice(
    tenantId, 
    facturapiInvoiceId, 
    series, 
    folioNumber, 
    customerId, 
    total, 
    createdById
  ) {
    tenantLogger.info(
      { 
        tenantId, 
        facturapiInvoiceId, 
        series, 
        folioNumber, 
        customerId, 
        total 
      }, 
      'Registrando factura'
    );
    
    return withTransaction(async (tx) => {
      // Convertir createdById a BigInt si existe
      const createdByIdBigInt = createdById ? BigInt(createdById) : null;
      
      // Registrar la factura
      const invoice = await tx.tenantInvoice.create({
        data: {
          tenantId,
          facturapiInvoiceId,
          series,
          folioNumber,
          customerId,
          total,
          status: 'valid',
          createdById: createdByIdBigInt,
          invoiceDate: new Date()
        }
      });

      // Incrementar el contador de facturas usadas
      await this.incrementInvoiceCount(tenantId);

      // Registrar en auditoría
      await auditLog(tx, {
        tenantId,
        userId: createdByIdBigInt ? (await tx.tenantUser.findUnique({ where: { telegramId: createdByIdBigInt } }))?.id : null,
        action: 'invoice:create',
        entityType: 'tenant_invoice',
        entityId: invoice.id.toString(),
        details: {
          facturapiInvoiceId,
          series,
          folioNumber,
          customerId,
          total
        }
      });

      tenantLogger.info(
        { 
          invoiceId: invoice.id, 
          tenantId, 
          facturapiInvoiceId 
        }, 
        'Factura registrada exitosamente'
      );

      return invoice;
    }, { description: 'Registrar factura' });
  }

  /**
   * Obtiene una API key desencriptada para un tenant
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<string>} - API key desencriptada
   */
  static async getApiKey(tenantId) {
    tenantLogger.debug({ tenantId }, 'Obteniendo API key');
    
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { 
          facturapiApiKey: true,
          businessName: true
        }
      });
      
      if (!tenant) {
        tenantLogger.error({ tenantId }, 'Tenant no encontrado al obtener API key');
        throw new Error(`No se encontró el tenant con ID ${tenantId}`);
      }
      
      if (!tenant.facturapiApiKey) {
        tenantLogger.error({ tenantId, businessName: tenant.businessName }, 'El tenant no tiene una API key configurada');
        throw new Error('El tenant no tiene una API key configurada');
      }
      
      // Devolver la API key directamente sin desencriptar
      return tenant.facturapiApiKey;
    } catch (error) {
      tenantLogger.error({ error, tenantId }, 'Error al obtener API key');
      throw error;
    }
  }

    /**
   * Obtiene una API key desencriptada para un tenant
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<string>} - API key desencriptada
   */
  static async getDecryptedApiKey(tenantId) {
    tenantLogger.debug({ tenantId }, 'Obteniendo API key desencriptada');
    
    try {
      // Simplemente usamos el método getApiKey que ya tenemos
      // Dado que ya no estamos encriptando la API key, solo la devolvemos directamente
      const apiKey = await this.getApiKey(tenantId);
      tenantLogger.debug({ tenantId }, 'API key obtenida correctamente');
      return apiKey;
    } catch (error) {
      tenantLogger.error({ error, tenantId }, 'Error al obtener API key desencriptada');
      throw error;
    }
  }
}

// Exportar el servicio
export default TenantService;
