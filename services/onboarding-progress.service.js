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
   * @param {string} tenantId - ID del tenant
   * @returns {Promise<Object>} - Estado del onboarding
   */
  static async getProgress(tenantId) {
    try {
      // Buscar el registro en la base de datos
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
          progressLogger.warn({ tenantId, error: e.message }, 'Error al parsear progreso');
          currentSteps = [];
        }
      }

      // Obtener información sobre los pasos
      const completedSteps = currentSteps.map((s) => s.step);
      const pendingSteps = REQUIRED_STEPS.filter((step) => !completedSteps.includes(step));
      const isCompleted = completedSteps.includes(OnboardingSteps.ONBOARDING_COMPLETED);

      // Formatear la respuesta
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
        steps: currentSteps,
      };
    } catch (error) {
      progressLogger.error({ error, tenantId }, 'Error al obtener progreso de onboarding');
      throw error;
    }
  }
}

export default OnboardingProgressService;
