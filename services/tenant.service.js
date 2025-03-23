import prisma from '../lib/prisma.js';

/**
 * Servicio para gestión de tenants
 */
class TenantService {
  /**
   * Busca un usuario por su ID de Telegram
   * @param {number} telegramId - ID de Telegram del usuario
   * @returns {Promise<Object>} - Usuario encontrado con su tenant
   */
  static async findUserByTelegramId(telegramId) {
    return prisma.tenantUser.findUnique({
      where: { telegramId },
      include: {
        tenant: true
      }
    });
  }
  
  /**
   * Obtiene el próximo folio disponible para un tenant
   * @param {string} tenantId - ID del tenant
   * @param {string} series - Serie del folio (default: 'A')
   * @returns {Promise<number>} - Próximo número de folio
   */
  static async getNextFolio(tenantId, series = 'A') {
    // Buscar folio existente
    let folio = await prisma.tenantFolio.findUnique({
      where: {
        tenantId_series: {
          tenantId,
          series
        }
      }
    });
    
    // Si no existe, crear uno nuevo
    if (!folio) {
      folio = await prisma.tenantFolio.create({
        data: {
          tenantId,
          series,
          currentNumber: 800 // Valor inicial
        }
      });
    }
    
    // Obtener el valor actual
    const currentValue = folio.currentNumber;
    
    // Incrementar para el próximo uso
    await prisma.tenantFolio.update({
      where: { id: folio.id },
      data: { currentNumber: { increment: 1 } }
    });
    
    return currentValue;
  }
  
  /**
   * Verifica si un tenant puede generar más facturas según su plan
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Resultado de la verificación
   */
  static async canGenerateInvoice(tenantId) {
    // En un caso real, aquí se verificaría el límite de facturas, plan, etc.
    // Para esta simulación, permitimos generar facturas
    return { canGenerate: true };
  }
  
  /**
   * Registra una factura generada
   * @param {string} tenantId - ID del tenant
   * @param {string} facturapiInvoiceId - ID de la factura en FacturAPI
   * @param {string} series - Serie de la factura
   * @param {number} folioNumber - Número de folio
   * @param {number} customerId - ID del cliente (opcional)
   * @param {number} total - Monto total de la factura
   * @param {number} createdById - ID del usuario que generó la factura (opcional)
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
    console.log(
      `Registrando factura: ${series}-${folioNumber} para tenant ${tenantId}`
    );
    
    try {
      // Guardar realmente en la base de datos usando Prisma
      const invoice = await prisma.tenantInvoice.create({
        data: {
          tenantId,
          facturapiInvoiceId,
          series,
          folioNumber,
          customerId, // Si es null, Prisma lo manejará adecuadamente
          total,
          status: 'valid',
          createdById, // Si es null, Prisma lo manejará
          invoiceDate: new Date()
        }
      });
      
      console.log(`Factura guardada en base de datos con ID: ${invoice.id}`);
      
      // Incrementar el contador de facturas (mantener esta funcionalidad)
      await this.incrementInvoiceCount(tenantId);
      
      return invoice;
    } catch (error) {
      console.error(`Error al registrar factura en base de datos: ${error.message}`);
      // En caso de error, devolver un objeto con los datos básicos para mantener compatibilidad
      return {
        tenantId,
        facturapiInvoiceId,
        series,
        folioNumber,
        customerId,
        total,
        createdById,
        status: 'valid',
        createdAt: new Date()
      };
    }
  }
  
  /**
   * Crea una suscripción para un tenant
   * @param {string} tenantId - ID del tenant
   * @param {number} planId - ID del plan
   * @returns {Promise<Object>} - Suscripción creada
   */
  static async createSubscription(tenantId, planId) {
    // Simular la creación de una suscripción
    console.log(`Creando suscripción para tenant ${tenantId} con plan ${planId}`);
    
    // En un caso real, aquí se guardaría en la base de datos
    return {
      tenantId,
      planId,
      status: 'trial',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 días
      invoicesUsed: 0
    };
  }
  
  /**
   * Encuentra un tenant con su suscripción
   * @param {string} id - ID del tenant
   * @returns {Promise<Object>} - Tenant con suscripción
   */
  static async findTenantWithSubscription(id) {
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
      console.error(`Error al buscar tenant con suscripción: ${error.message}`);
      throw error;
    }
  }
  
    /**
   * Incrementa el contador de facturas usadas en la suscripción actual
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Suscripción actualizada
   */
  static async incrementInvoiceCount(tenantId) {
    console.log(`Incrementando contador de facturas para tenant ${tenantId}`);
    
    try {
      // Obtener la suscripción activa
      const subscription = await prisma.tenantSubscription.findFirst({
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
        console.warn(`No se encontró suscripción activa para tenant ${tenantId}`);
        return null;
      }

      // Incrementar el contador
      const updatedSubscription = await prisma.tenantSubscription.update({
        where: { id: subscription.id },
        data: {
          invoicesUsed: {
            increment: 1
          }
        }
      });

      console.log(`Contador incrementado para tenant ${tenantId}: ${updatedSubscription.invoicesUsed} facturas`);
      return updatedSubscription;
    } catch (error) {
      console.error(`Error al incrementar contador de facturas para tenant ${tenantId}:`, error);
      throw error;
    }
  }
}

export default TenantService;