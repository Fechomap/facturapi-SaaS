// services/onboarding-progress.service.ts
import { prisma } from '../config/database';
import logger from '../core/utils/logger';

const progressLogger = logger.child({ module: 'onboarding-progress' });

export const OnboardingSteps = {
  ORGANIZATION_CREATED: 'organization_created',
  TENANT_CREATED: 'tenant_created',
  CERTIFICATE_UPLOADED: 'certificate_uploaded',
  CERTIFICATE_VERIFIED: 'certificate_verified',
  CLIENTS_CONFIGURED: 'clients_configured',
  TEST_API_KEY_CONFIGURED: 'test_api_key_configured',
  LIVE_API_KEY_CONFIGURED: 'live_api_key_configured',
  SUBSCRIPTION_CREATED: 'subscription_created',
  PAYMENT_METHOD_CONFIGURED: 'payment_method_configured',
  ONBOARDING_COMPLETED: 'onboarding_completed',
} as const;

const REQUIRED_STEPS = [
  OnboardingSteps.ORGANIZATION_CREATED,
  OnboardingSteps.TENANT_CREATED,
  OnboardingSteps.CERTIFICATE_UPLOADED,
  OnboardingSteps.CERTIFICATE_VERIFIED,
  OnboardingSteps.CLIENTS_CONFIGURED,
  OnboardingSteps.LIVE_API_KEY_CONFIGURED,
  OnboardingSteps.SUBSCRIPTION_CREATED,
];

interface StepDetails {
  [key: string]: boolean;
}

interface ProgressResult {
  tenantId: string;
  isCompleted: boolean;
  progress: number;
  completedSteps: string[];
  pendingSteps: string[];
  stepDetails?: StepDetails;
  additionalInfo?: any;
  steps?: any[];
  calculatedAt?: string;
  method: string;
}

/**
 * Servicio para gestionar el progreso del onboarding
 */
class OnboardingProgressService {
  /**
   * Calcula el progreso basado en datos reales de la BD
   */
  static async calculateProgressFromData(tenantId: string): Promise<ProgressResult> {
    try {
      progressLogger.info({ tenantId }, 'Calculando progreso automático desde datos de BD');

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

      const steps: StepDetails = {
        [OnboardingSteps.ORGANIZATION_CREATED]: !!tenant,
        [OnboardingSteps.TENANT_CREATED]: !!tenant,
        [OnboardingSteps.CERTIFICATE_UPLOADED]: !!tenant.facturapiApiKey,
        [OnboardingSteps.CERTIFICATE_VERIFIED]: !!(
          tenant.facturapiApiKey && tenant.facturapiOrganizationId
        ),
        [OnboardingSteps.CLIENTS_CONFIGURED]: tenant.customers?.length > 0,
        [OnboardingSteps.LIVE_API_KEY_CONFIGURED]: !!(
          tenant.facturapiApiKey &&
          !tenant.facturapiApiKey.startsWith('sk_test') &&
          !tenant.facturapiApiKey.startsWith('test_')
        ),
        [OnboardingSteps.SUBSCRIPTION_CREATED]: tenant.subscriptions?.length > 0,
      };

      const completedStepsArray = Object.entries(steps).filter(([_, completed]) => completed);
      const pendingStepsArray = Object.entries(steps).filter(([_, completed]) => !completed);

      const completedCount = completedStepsArray.length;
      const totalRequired = REQUIRED_STEPS.length;
      const progress = Math.round((completedCount / totalRequired) * 100);
      const isCompleted = progress === 100;

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
        method: 'automatic_calculation',
      };
    } catch (error: any) {
      progressLogger.error({ error, tenantId }, 'Error al calcular progreso automático');
      throw error;
    }
  }

  /**
   * Actualiza el progreso de onboarding para un tenant
   */
  static async updateProgress(
    tenantId: string,
    step: string,
    metadata: any = {}
  ): Promise<ProgressResult> {
    try {
      progressLogger.info({ tenantId, step }, 'Actualizando progreso de onboarding');

      let progress = await prisma.tenantSetting.findFirst({
        where: {
          tenantId,
          settingKey: 'onboarding_progress',
        },
      });

      let currentSteps: any[] = [];

      if (progress) {
        try {
          currentSteps = JSON.parse(progress.settingValue || '[]');
          if (!Array.isArray(currentSteps)) {
            currentSteps = [];
          }
        } catch (e: any) {
          progressLogger.warn(
            { tenantId, error: e.message },
            'Error al parsear progreso existente, iniciando nuevo'
          );
          currentSteps = [];
        }
      }

      const stepExists = currentSteps.some((s) => s.step === step);

      if (!stepExists) {
        currentSteps.push({
          step,
          completedAt: new Date().toISOString(),
          metadata,
        });

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

        const completedSteps = currentSteps.map((s) => s.step);
        const allRequiredCompleted = REQUIRED_STEPS.every((step) => completedSteps.includes(step));

        if (
          allRequiredCompleted &&
          !completedSteps.includes(OnboardingSteps.ONBOARDING_COMPLETED)
        ) {
          currentSteps.push({
            step: OnboardingSteps.ONBOARDING_COMPLETED,
            completedAt: new Date().toISOString(),
            metadata: { autoCompleted: true },
          });

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
        method: 'manual_events',
      };
    } catch (error: any) {
      progressLogger.error({ error, tenantId, step }, 'Error al actualizar progreso de onboarding');
      throw error;
    }
  }

  /**
   * Obtiene el progreso de onboarding para un tenant
   */
  static async getProgress(tenantId: string): Promise<ProgressResult> {
    try {
      const automaticProgress = await this.calculateProgressFromData(tenantId);

      if (automaticProgress.progress >= 50) {
        progressLogger.info(
          { tenantId, progress: automaticProgress.progress },
          'Usando progreso automático calculado desde BD'
        );
        return automaticProgress;
      }

      const progress = await prisma.tenantSetting.findFirst({
        where: {
          tenantId,
          settingKey: 'onboarding_progress',
        },
      });

      let currentSteps: any[] = [];

      if (progress && progress.settingValue) {
        try {
          currentSteps = JSON.parse(progress.settingValue);
          if (!Array.isArray(currentSteps)) {
            currentSteps = [];
          }
        } catch (e: any) {
          progressLogger.warn(
            { tenantId, error: e.message },
            'Error al parsear progreso, usando automático'
          );
          return automaticProgress;
        }
      }

      const completedSteps = currentSteps.map((s) => s.step);
      const pendingSteps = REQUIRED_STEPS.filter((step) => !completedSteps.includes(step));
      const isCompleted = completedSteps.includes(OnboardingSteps.ONBOARDING_COMPLETED);
      const manualProgress = Math.round(
        (completedSteps.filter((s) => REQUIRED_STEPS.includes(s)).length / REQUIRED_STEPS.length) *
          100
      );

      if (automaticProgress.progress > manualProgress) {
        progressLogger.info(
          { tenantId, automaticProgress: automaticProgress.progress, manualProgress },
          'Progreso automático es mayor que manual, usando automático'
        );
        return automaticProgress;
      }

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
        method: 'manual_events',
      };
    } catch (error: any) {
      progressLogger.error({ error, tenantId }, 'Error al obtener progreso de onboarding');
      throw error;
    }
  }
}

export default OnboardingProgressService;
