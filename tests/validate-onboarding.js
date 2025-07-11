// tests/validate-onboarding.js
import OnboardingProgressService from '../services/onboarding-progress.service.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { initConfig } from '../config/index.js';
import logger from '../core/utils/logger.js';

const testLogger = logger.child({ module: 'onboarding-validation' });

async function validateOnboarding() {
  testLogger.info('Iniciando validación de sistema de onboarding');

  try {
    // Inicializar configuración y base de datos
    await initConfig();
    await connectDatabase();

    // Solicitar ID del tenant para la prueba
    const readline = (await import('readline')).createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const tenantId = await new Promise((resolve) => {
      readline.question('Ingresa el ID del tenant para validar el onboarding: ', resolve);
    });

    // Obtener estado actual
    const initialProgress = await OnboardingProgressService.getProgress(tenantId);
    console.log('\nEstado actual del onboarding:');
    console.log(`- Completado: ${initialProgress.isCompleted ? 'Sí' : 'No'}`);
    console.log(`- Progreso: ${initialProgress.progress}%`);
    console.log(
      `- Pasos completados: ${initialProgress.completedSteps.length} de ${initialProgress.completedSteps.length + initialProgress.pendingSteps.length}`
    );

    // Simular completar un paso
    const response = await new Promise((resolve) => {
      readline.question('\n¿Quieres simular completar un paso del onboarding? (s/n): ', resolve);
    });

    if (response.toLowerCase() === 's') {
      // Mostrar pasos pendientes
      console.log('\nPasos pendientes:');
      initialProgress.pendingSteps.forEach((step, index) => {
        console.log(`${index + 1}. ${step}`);
      });

      if (initialProgress.pendingSteps.length === 0) {
        console.log('No hay pasos pendientes para completar.');
      } else {
        const stepIndex = await new Promise((resolve) => {
          readline.question(
            `\nSelecciona un paso para completar (1-${initialProgress.pendingSteps.length}): `,
            resolve
          );
        });

        const selectedStep = initialProgress.pendingSteps[parseInt(stepIndex) - 1];

        if (selectedStep) {
          // Completar el paso seleccionado
          const updatedProgress = await OnboardingProgressService.updateProgress(
            tenantId,
            selectedStep,
            { source: 'validation_test' }
          );

          console.log(`\n✅ Paso "${selectedStep}" marcado como completado.`);
          console.log(`Nuevo progreso: ${updatedProgress.progress}%`);
        }
      }
    }

    readline.close();
    console.log('\n✅ Validación de onboarding completada');
  } catch (error) {
    testLogger.error({ error }, 'Error al validar sistema de onboarding');
    console.error('❌ Error en la validación de onboarding:', error.message);
  } finally {
    await disconnectDatabase();
  }
}

validateOnboarding()
  .then(() => {
    console.log('Script de validación finalizado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error en el script de validación:', error);
    process.exit(1);
  });
