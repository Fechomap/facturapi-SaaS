// api/middlewares/tenant.middleware.js
import prisma from '../../lib/prisma.js';
import logger from '../../core/utils/logger.js'; // Added logger

const middlewareLogger = logger.child({ module: 'tenant-middleware' });

/**
 * Middleware para extraer y validar información del tenant (Opcional, puede no ser necesario si siempre se usa requireTenant)
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @param {Function} next - Función next de Express
 */
async function tenantMiddleware(req, res, next) {
  try {
    // Extraer tenant ID del header o query parameter
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId;
    
    // Si no hay tenant ID, continuar sin configurar contexto
    if (!tenantId) {
      return next();
    }
    
    // Verificar que el tenant existe en la base de datos
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true,
        isActive: true // Keep isActive check as an admin override maybe?
      }
    });
    
    if (!tenant) {
      // No need to log error here, just return 404
      return res.status(404).json({
        error: 'TenantNotFound',
        message: 'El tenant especificado no existe'
      });
    }
    
    // Optional: Keep the isActive check as a hard block by admin
    if (!tenant.isActive) {
       middlewareLogger.warn({ tenantId }, 'Acceso denegado: Tenant marcado como inactivo administrativamente.');
       return res.status(403).json({
         error: 'TenantInactive',
         message: 'El tenant especificado está inactivo'
       });
    }
    
    // Adjuntar información del tenant al request
    req.tenant = {
      id: tenant.id,
      name: tenant.businessName
    };
    
    next();
  } catch (error) {
    middlewareLogger.error({ error: error.message, stack: error.stack }, 'Error en tenant middleware');
    next(error); // Pass error to Express error handler
  }
}


/**
 * Middleware para validar que el usuario tenga un tenant asignado Y una suscripción válida.
 * Este middleware debe usarse en rutas que requieran una suscripción activa.
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @param {Function} next - Función next de Express
 */
async function requireTenant(req, res, next) {
  try {
    // Obtener el tenant ID del header o del cuerpo de la solicitud
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId || req.body?.tenantId;
    
    if (!tenantId) {
      return res.status(400).json({ 
        error: 'TenantRequired', 
        message: 'Debe proporcionar un tenant ID (X-Tenant-ID header, query param, or body)'
      });
    }
    
    // Verificar que el tenant existe y obtener su suscripción activa/relevante
    // Asumimos una suscripción por tenant para simplificar, o la más reciente.
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' }, // Get the latest subscription first
          take: 1, // Assuming one primary subscription per tenant
          include: { plan: true } // Include plan details if needed later
        }
      }
    });
    
    if (!tenant) {
      return res.status(404).json({
        error: 'TenantNotFound',
        message: 'El tenant especificado no existe'
      });
    }
    
    // --- Inicio: Lógica de Validación de Suscripción ---
    const subscription = tenant.subscriptions?.[0];
    const now = new Date();
    let allowAccess = false;
    let denialReason = 'NoSubscription'; // Default reason

    if (subscription) {
        middlewareLogger.debug({ tenantId, subscriptionId: subscription.id, status: subscription.status }, 'Verificando estado de suscripción');
        switch (subscription.status) {
            case 'trial':
                if (subscription.trialEndsAt && subscription.trialEndsAt > now) {
                    allowAccess = true;
                    middlewareLogger.debug({ tenantId }, 'Acceso permitido: En período de prueba.');
                } else {
                    denialReason = 'TrialExpired';
                    middlewareLogger.warn({ tenantId, trialEndsAt: subscription.trialEndsAt?.toISOString() }, 'Acceso denegado: Período de prueba expirado.');
                }
                break;
            case 'active':
                if (subscription.currentPeriodEndsAt && subscription.currentPeriodEndsAt > now) {
                    allowAccess = true;
                     middlewareLogger.debug({ tenantId }, 'Acceso permitido: Suscripción activa.');
                } else {
                    // Si terminó el período activo, podría estar en gracia o pendiente
                    denialReason = 'ActivePeriodEnded'; 
                    middlewareLogger.warn({ tenantId, currentPeriodEndsAt: subscription.currentPeriodEndsAt?.toISOString() }, 'Período activo terminado, verificando gracia.');
                    // Verificar período de gracia (3 días)
                    const gracePeriodEnd = subscription.currentPeriodEndsAt ? new Date(subscription.currentPeriodEndsAt) : new Date(0); // Handle null date
                    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 3); 
                    if (gracePeriodEnd > now) {
                        allowAccess = true; // Permitir acceso durante la gracia
                        denialReason = 'InGracePeriod';
                        middlewareLogger.info({ tenantId, gracePeriodEnd: gracePeriodEnd.toISOString() }, 'Acceso permitido: Dentro del período de gracia.');
                    } else {
                         middlewareLogger.warn({ tenantId, gracePeriodEnd: gracePeriodEnd.toISOString() }, 'Acceso denegado: Período de gracia expirado.');
                         denialReason = 'GracePeriodExpired';
                    }
                }
                break;
            case 'payment_pending':
                // Ya se verificó la gracia en el caso 'active' (cuando currentPeriodEndsAt < now)
                // Si llega aquí como 'payment_pending', significa que ya expiró la gracia o nunca estuvo activo.
                // Re-verificar gracia por si acaso el estado cambió directamente a pending.
                let referenceDateForGrace = subscription.currentPeriodEndsAt || subscription.trialEndsAt; // Use end date or trial end date
                if (referenceDateForGrace) {
                    const gracePeriodEnd = new Date(referenceDateForGrace);
                    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 3);
                    if (gracePeriodEnd > now) {
                        allowAccess = true; // Permitir acceso durante la gracia
                        denialReason = 'InGracePeriod (Pending)';
                         middlewareLogger.info({ tenantId, gracePeriodEnd: gracePeriodEnd.toISOString() }, 'Acceso permitido: Dentro del período de gracia (estado pendiente).');
                    } else {
                         middlewareLogger.warn({ tenantId, gracePeriodEnd: gracePeriodEnd.toISOString() }, 'Acceso denegado: Período de gracia expirado (estado pendiente).');
                         denialReason = 'GracePeriodExpired (Pending)';
                    }
                } else {
                     middlewareLogger.warn({ tenantId }, 'Acceso denegado: Pago pendiente sin fecha de referencia para gracia.');
                     denialReason = 'PaymentPendingUnknownGrace';
                }
                break;
            case 'suspended':
            case 'cancelled':
            default:
                allowAccess = false;
                denialReason = `Subscription${subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}`; // e.g., SubscriptionSuspended
                middlewareLogger.warn({ tenantId, status: subscription.status }, `Acceso denegado: Estado de suscripción ${subscription.status}.`);
                break;
        }
    } else {
        // No se encontró ninguna suscripción para el tenant
        allowAccess = false; // Denegar si no hay suscripción
        middlewareLogger.warn({ tenantId }, 'Acceso denegado: No se encontró suscripción para el tenant.');
    }

    // --- Fin: Lógica de Validación de Suscripción ---

    // Aplicar resultado de la validación
    if (!allowAccess) {
      // Considerar si el tenant.isActive debe ser verificado aquí también o antes.
      // Si se permite acceso, pero tenant.isActive es false, ¿qué debería pasar?
      // El middleware 'tenantMiddleware' ya lo verifica si se usa antes.
      return res.status(403).json({
        error: 'SubscriptionInvalid',
        message: `Acceso denegado. Estado de la suscripción: ${denialReason}.`,
        reason: denialReason // Código de razón para el cliente/frontend
      });
    }
    
    // Si se permite el acceso, adjuntar información del tenant al request si no existe ya
    // (tenantMiddleware podría haberlo hecho ya si se usa en la cadena)
    if (!req.tenant) {
      req.tenant = {
        id: tenant.id,
        name: tenant.businessName
        // Podríamos añadir isActive aquí si es útil
      };
    }
    // Adjuntar también la suscripción para uso posterior si es necesario
    req.subscription = subscription; 
    
    // Añadir la función getApiKey al objeto req (lógica existente)
    // Asegurarse que la ruta relativa sea correcta
    req.getApiKey = async () => {
      try {
        const { default: TenantService } = await import('../../core/tenant/tenant.service.js');
        return await TenantService.getDecryptedApiKey(tenantId);
      } catch (apiKeyError) {
         middlewareLogger.error({ tenantId, error: apiKeyError.message }, 'Error al obtener API Key en middleware');
         // Decidir si lanzar el error o devolver null/undefined
         throw new Error('Error interno al obtener la API Key'); 
      }
    };
    
    // Todo en orden, continuar con la siguiente ruta/middleware
    next();
    
  } catch (error) {
    middlewareLogger.error({ error: error.message, stack: error.stack }, `Error en middleware requireTenant`);
    next(error); // Pasar error al manejador de errores de Express
  }
}

// Exportar ambos middlewares
export { tenantMiddleware, requireTenant };
// Mantener exportación por defecto por si se usa en algún sitio, aunque es menos común para múltiples exports
export default { tenantMiddleware, requireTenant };
