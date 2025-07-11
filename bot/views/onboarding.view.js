// bot/views/onboarding.view.js
import { Markup } from 'telegraf';

/**
 * Genera la vista de progreso de onboarding
 * @param {Object} progress - Datos de progreso de onboarding
 * @returns {Object} - Mensaje formateado y teclado
 */
export function onboardingProgressView(progress) {
  // Emojis para los diferentes estados
  const emojis = {
    completed: '✅',
    pending: '⏳',
    notStarted: '❌',
  };

  // Traducción amigable de los pasos
  const stepTranslations = {
    organization_created: 'Organización creada',
    tenant_created: 'Empresa registrada',
    certificate_uploaded: 'Certificado (CSD) subido',
    certificate_verified: 'Certificado verificado',
    clients_configured: 'Clientes configurados',
    test_api_key_configured: 'API Key de pruebas',
    live_api_key_configured: 'API Key de producción',
    subscription_created: 'Suscripción creada',
    payment_method_configured: 'Método de pago configurado',
    onboarding_completed: 'Proceso completado',
  };

  // Calcular porcentaje de progreso
  const percentComplete = progress.progress || 0;

  // Construir mensaje con barra de progreso
  let progressBar = '';
  const barLength = 10;
  const filledBars = Math.round((percentComplete / 100) * barLength);

  for (let i = 0; i < barLength; i++) {
    progressBar += i < filledBars ? '█' : '▒';
  }

  // Crear mensaje principal
  let message = `📋 *Progreso de configuración* \n\n`;
  message += `${progressBar} ${percentComplete}%\n\n`;

  // Formato para los pasos requeridos
  const requiredSteps = [
    'organization_created',
    'tenant_created',
    'certificate_uploaded',
    'certificate_verified',
    'clients_configured',
    'test_api_key_configured',
    'live_api_key_configured',
    'subscription_created',
  ];

  // Añadir cada paso con su estado
  requiredSteps.forEach((step) => {
    const isCompleted = progress.completedSteps.includes(step);
    const emoji = isCompleted ? emojis.completed : emojis.pending;
    message += `${emoji} ${stepTranslations[step] || step}\n`;
  });

  // Mensajes especiales según estado
  message += '\n';

  if (progress.isCompleted) {
    message +=
      '🎉 *¡Felicidades!* Tu configuración está completa.\nYa puedes usar todas las funciones del sistema.';
  } else if (percentComplete >= 75) {
    message += '👍 Estás muy cerca de completar la configuración.';
  } else if (percentComplete >= 50) {
    message += '👌 Vas por buen camino. Continúa con los pasos pendientes.';
  } else if (percentComplete >= 25) {
    message += '🔄 Has iniciado el proceso. Sigue los pasos para completar la configuración.';
  } else {
    message += '🚀 ¡Comienza tu configuración! Sigue los pasos indicados.';
  }

  // Crear botones según el progreso
  const keyboard = Markup.inlineKeyboard(
    [
      // Si tiene organización pero no empresa
      progress.completedSteps.includes('organization_created') &&
      !progress.completedSteps.includes('tenant_created')
        ? [Markup.button.callback('📝 Registrar mi empresa', 'start_registration')]
        : [],

      // Si tiene empresa pero no clientes
      progress.completedSteps.includes('tenant_created') &&
      !progress.completedSteps.includes('clients_configured')
        ? [Markup.button.callback('👥 Configurar clientes', 'configure_clients')]
        : [],

      // Si no ha subido certificado
      progress.completedSteps.includes('tenant_created') &&
      !progress.completedSteps.includes('certificate_uploaded')
        ? [Markup.button.callback('🔐 Subir certificado (CSD)', 'setup_production')]
        : [],

      // Si no ha completado suscripción
      progress.completedSteps.includes('tenant_created') &&
      !progress.completedSteps.includes('subscription_created')
        ? [Markup.button.callback('💳 Configurar suscripción', 'menu_suscripcion')]
        : [],

      // Siempre mostrar el botón de volver
      [Markup.button.callback('🔙 Volver al menú principal', 'menu_principal')],
    ].filter((buttons) => buttons.length > 0)
  ); // Filtrar filas vacías

  return {
    message,
    keyboard,
    parse_mode: 'Markdown',
  };
}

/**
 * Genera un mensaje con el siguiente paso recomendado
 * @param {Object} progress - Datos de progreso de onboarding
 * @returns {Object} - Mensaje formateado y teclado
 */
export function nextStepView(progress) {
  let nextStep = '';
  let actionButton = [];

  // Determinar siguiente paso
  if (!progress.completedSteps.includes('organization_created')) {
    nextStep = 'Crear tu organización en FacturAPI';
    actionButton = [Markup.button.callback('📝 Crear organización', 'create_organization')];
  } else if (!progress.completedSteps.includes('tenant_created')) {
    nextStep = 'Registrar tu empresa';
    actionButton = [Markup.button.callback('📝 Registrar empresa', 'start_registration')];
  } else if (!progress.completedSteps.includes('certificate_uploaded')) {
    nextStep = 'Subir tu certificado CSD';
    actionButton = [Markup.button.callback('🔐 Subir certificado', 'setup_production')];
  } else if (!progress.completedSteps.includes('certificate_verified')) {
    nextStep = 'Esperar la verificación de tu certificado por un administrador';
    // No hay acción para esto, debe esperar
  } else if (!progress.completedSteps.includes('clients_configured')) {
    nextStep = 'Configurar tus clientes';
    actionButton = [Markup.button.callback('👥 Configurar clientes', 'configure_clients')];
  } else if (!progress.completedSteps.includes('live_api_key_configured')) {
    nextStep = 'Completar la configuración de facturación real';
    actionButton = [Markup.button.callback('🔑 Completar configuración', 'setup_production')];
  } else if (!progress.completedSteps.includes('subscription_created')) {
    nextStep = 'Configurar tu suscripción y método de pago';
    actionButton = [Markup.button.callback('💳 Configurar suscripción', 'menu_suscripcion')];
  } else {
    nextStep = '¡Tu configuración está completa! Ya puedes usar todas las funciones.';
  }

  const message = `🔄 *Siguiente paso recomendado*\n\n${nextStep}`;

  const keyboardButtons = [];
  if (actionButton.length > 0) {
    keyboardButtons.push(actionButton);
  }
  keyboardButtons.push([
    Markup.button.callback('📊 Ver progreso completo', 'view_onboarding_progress'),
  ]);

  const keyboard = Markup.inlineKeyboard(keyboardButtons);

  return {
    message,
    keyboard,
    parse_mode: 'Markdown',
  };
}

export default {
  onboardingProgressView,
  nextStepView,
};
