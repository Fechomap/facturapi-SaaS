// services/onboarding-progress.service.js
import { prisma } from '../config/database.js';
import logger from '../core/utils/logger.js';

// Logger específico para el servicio
const progressLogger = logger.child({ module: 'onboarding-progress' });

// Estados del proceso de onboarding
export const OnboardingSteps = {
  // Organización
  ORGANIZATION_CREATED: 'organization_created',

  // Tenant
  TENANT_CREATED: 'tenant_created',

  // Certificados
  CERTIFICATE_UPLOADED: 'certificate_uploaded',
  CERTIFICATE_VERIFIED: 'certificate_verified',

  // Clientes
  CLIENTS_CONFIGURED: 'clients_configured',

  // API Keys
  TEST_API_KEY_CONFIGURED: 'test_api_key_configured',
  LIVE_API_KEY_CONFIGURED: 'live_api_key_configured',

  // Suscripción
  SUBSCRIPTION_CREATED: 'subscription_created',
  PAYMENT_METHOD_CONFIGURED: 'payment_method_configured',

  // Finalización
  ONBOARDING_COMPLETED: 'onboarding_completed',
};

// Requisitos para completar el onboarding
const REQUIRED_STEPS = [
  OnboardingSteps.ORGANIZATION_CREATED,
  OnboardingSteps.TENANT_CREATED,
  OnboardingSteps.CERTIFICATE_UPLOADED,
  OnboardingSteps.CERTIFICATE_VERIFIED,
  OnboardingSteps.CLIENTS_CONFIGURED,
  OnboardingSteps.LIVE_API_KEY_CONFIGURED,
  OnboardingSteps.SUBSCRIPTION_CREATED,
];

/**
 * Servicio para gestionar el progreso del onboarding
 */
class OnboardingProgressService {
  /**
   * Calcula el progreso basado en datos reales de la BD (sin depender de eventos manuales)
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Estado del onboarding calculado automáticamente
   */
  static async calculateProgressFromData(tenantId) {
    try {
      progressLogger.info({ tenantId }, 'Calculando progreso automático desde datos de BD');

      // Obtener datos completos del tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          subscriptions: {
            include: { plan: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          customers: true,
          invoices: true,
        },
      });

      if (!tenant) {
        throw new Error(`Tenant no encontrado: ${tenantId}`);
      }

      // Verificar cada paso automáticamente basado en datos reales
      const steps = {
        [OnboardingSteps.ORGANIZATION_CREATED]: !!tenant, // Si existe tenant, existe organización
        [OnboardingSteps.TENANT_CREATED]: !!tenant,
        [OnboardingSteps.CERTIFICATE_UPLOADED]: !!tenant.facturapiApiKey, // Tiene API key configurada
        [OnboardingSteps.CERTIFICATE_VERIFIED]: !!(tenant.facturapiApiKey && tenant.facturapiOrganizationId), // API key + Org ID
        [OnboardingSteps.CLIENTS_CONFIGURED]: tenant.customers?.length > 0, // Tiene clientes configurados
        [OnboardingSteps.LIVE_API_KEY_CONFIGURED]: !!(
          tenant.facturapiApiKey && 
          !tenant.facturapiApiKey.startsWith('sk_test') && 
          !tenant.facturapiApiKey.startsWith('test_')
        ), // API key LIVE (no TEST)
        [OnboardingSteps.SUBSCRIPTION_CREATED]: tenant.subscriptions?.length > 0, // Tiene suscripción
      };

      // Calcular estadísticas
      const completedStepsArray = Object.entries(steps).filter(([_, completed]) => completed);
      const pendingStepsArray = Object.entries(steps).filter(([_, completed]) => !completed);
      
      const completedCount = completedStepsArray.length;
      const totalRequired = REQUIRED_STEPS.length;
      const progress = Math.round((completedCount / totalRequired) * 100);
      const isCompleted = progress === 100;

      // Información adicional útil
      const additionalInfo = {
        totalCustomers: tenant.customers?.length || 0,
        totalInvoices: tenant.invoices?.length || 0,
        subscriptionStatus: tenant.subscriptions?.[0]?.status || 'none',
        planName: tenant.subscriptions?.[0]?.plan?.name || 'Sin plan',
        isLiveMode: !!(tenant.facturapiApiKey && !tenant.facturapiApiKey.startsWith('sk_test')),
      };

      return {
        tenantId,
        isCompleted,
        progress,
        completedSteps: completedStepsArray.map(([step, _]) => step),
        pendingSteps: pendingStepsArray.map(([step, _]) => step),
        stepDetails: steps,
        additionalInfo,
        calculatedAt: new Date().toISOString(),
        method: 'automatic_calculation', // Identificar que fue calculado automáticamente
      };
    } catch (error) {
      progressLogger.error({ error, tenantId }, 'Error al calcular progreso automático');
      throw error;
    }
  }
  /**
   * Actualiza el progreso de onboarding para un tenant
   * @param {string} tenantId - ID del tenant
   * @param {string} step - Paso completado
   * @param {Object} metadata - Metadatos adicionales
   * @returns {Promise<Object>} - Estado actualizado del onboarding
   */
  static async updateProgress(tenantId, step, metadata = {}) {
    try {
      progressLogger.info({ tenantId, step }, 'Actualizando progreso de onboarding');

      // Buscar el registro existente o crear uno nuevo
      let progress = await prisma.tenantSetting.findFirst({
        where: {
          tenantId,
          settingKey: 'onboarding_progress',
        },
      });

      let currentSteps = [];

      if (progress) {
        try {
          currentSteps = JSON.parse(progress.settingValue || '[]');
          if (!Array.isArray(currentSteps)) {
            currentSteps = [];
          }
        } catch (e) {
          progressLogger.warn(
            { tenantId, error: e.message },
            'Error al parsear progreso existente, iniciando nuevo'
          );
          currentSteps = [];
        }
      }

      // Verificar si el paso ya está registrado
      const stepExists = currentSteps.some((s) => s.step === step);

      if (!stepExists) {
        // Añadir el nuevo paso
        currentSteps.push({
          step,
          completedAt: new Date().toISOString(),
          metadata,
        });

        // Guardar el progreso actualizado
        if (progress) {
          progress = await prisma.tenantSetting.update({
            where: {
              id: progress.id,
            },
            data: {
              settingValue: JSON.stringify(currentSteps),
            },
          });
        } else {
          progress = await prisma.tenantSetting.create({
            data: {
              tenantId,
              settingKey: 'onboarding_progress',
              settingValue: JSON.stringify(currentSteps),
            },
          });
        }

        // Verificar si se han completado todos los pasos requeridos
        const completedSteps = currentSteps.map((s) => s.step);
        const allRequiredCompleted = REQUIRED_STEPS.every((step) => completedSteps.includes(step));

        if (
          allRequiredCompleted &&
          !completedSteps.includes(OnboardingSteps.ONBOARDING_COMPLETED)
        ) {
          // Marcar onboarding como completado
          currentSteps.push({
            step: OnboardingSteps.ONBOARDING_COMPLETED,
            completedAt: new Date().toISOString(),
            metadata: { autoCompleted: true },
          });

          // Actualizar el registro
          progress = await prisma.tenantSetting.update({
            where: {
              id: progress.id,
            },
            data: {
              settingValue: JSON.stringify(currentSteps),
            },
          });

          progressLogger.info({ tenantId }, 'Onboarding completado automáticamente');
        }
      }

      // Obtener información de los pasos completados para devolverla
      const completedSteps = currentSteps.map((s) => s.step);
      const pendingSteps = REQUIRED_STEPS.filter((step) => !completedSteps.includes(step));
      const isCompleted = completedSteps.includes(OnboardingSteps.ONBOARDING_COMPLETED);

      return {
        tenantId,
        isCompleted,
        completedSteps,
        pendingSteps,
        progress: Math.round(
          (completedSteps.filter((s) => REQUIRED_STEPS.includes(s)).length /
            REQUIRED_STEPS.length) *
            100
        ),
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      progressLogger.error({ error, tenantId, step }, 'Error al actualizar progreso de onboarding');
      throw error;
    }
  }

  /**
   * Obtiene el progreso de onboarding para un tenant
   * Usa cálculo automático como método principal, con fallback a eventos manuales
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Estado del onboarding
   */
  static async getProgress(tenantId) {
    try {
      // NUEVO MÉTODO: Calcular automáticamente desde datos de BD
      const automaticProgress = await this.calculateProgressFromData(tenantId);
      
      // Si el progreso automático muestra más del 50%, usarlo (más confiable)
      if (automaticProgress.progress >= 50) {
        progressLogger.info(
          { tenantId, progress: automaticProgress.progress }, 
          'Usando progreso automático calculado desde BD'
        );
        return automaticProgress;
      }

      // MÉTODO ORIGINAL: Buscar eventos manuales como fallback
      const progress = await prisma.tenantSetting.findFirst({
        where: {
          tenantId,
          settingKey: 'onboarding_progress',
        },
      });

      let currentSteps = [];

      if (progress && progress.settingValue) {
        try {
          currentSteps = JSON.parse(progress.settingValue);
          if (!Array.isArray(currentSteps)) {
            currentSteps = [];
          }
        } catch (e) {
          progressLogger.warn({ tenantId, error: e.message }, 'Error al parsear progreso, usando automático');
          return automaticProgress; // Fallback al automático si hay error
        }
      }

      // Obtener información sobre los pasos manuales
      const completedSteps = currentSteps.map((s) => s.step);
      const pendingSteps = REQUIRED_STEPS.filter((step) => !completedSteps.includes(step));
      const isCompleted = completedSteps.includes(OnboardingSteps.ONBOARDING_COMPLETED);
      const manualProgress = Math.round(
        (completedSteps.filter((s) => REQUIRED_STEPS.includes(s)).length / REQUIRED_STEPS.length) * 100
      );

      // Comparar progreso manual vs automático y usar el mayor
      if (automaticProgress.progress > manualProgress) {
        progressLogger.info(
          { tenantId, automaticProgress: automaticProgress.progress, manualProgress }, 
          'Progreso automático es mayor que manual, usando automático'
        );
        return automaticProgress;
      }

      // Usar progreso manual si es mayor
      progressLogger.info(
        { tenantId, automaticProgress: automaticProgress.progress, manualProgress }, 
        'Usando progreso manual existente'
      );

      return {
        tenantId,
        isCompleted,
        completedSteps,
        pendingSteps,
        progress: manualProgress,
        steps: currentSteps,
        method: 'manual_events', // Identificar método usado
      };
    } catch (error) {
      progressLogger.error({ error, tenantId }, 'Error al obtener progreso de onboarding');
      throw error;
    }
  }
}

export default OnboardingProgressService;
