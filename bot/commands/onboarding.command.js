// bot/commands/onboarding.command.js
import OnboardingProgressService from '../../services/onboarding-progress.service.js';
import { onboardingProgressView, nextStepView } from '../views/onboarding.view.js';

/**
 * Registra comandos relacionados con el progreso de onboarding
 * @param {Object} bot - Instancia del bot
 */
export function registerOnboardingCommands(bot) {
  // Comando para ver el progreso de onboarding
  bot.command('progreso', async (ctx) => {
    if (!ctx.hasTenant()) {
      return ctx.reply('Para ver tu progreso, primero debes registrar tu empresa.');
    }

    try {
      const tenantId = ctx.getTenantId();
      const progress = await OnboardingProgressService.getProgress(tenantId);

      const { message, keyboard, parse_mode } = onboardingProgressView(progress);
      return ctx.reply(message, { parse_mode, ...keyboard });
    } catch (error) {
      console.error('Error al obtener progreso de onboarding:', error);
      return ctx.reply(
        '❌ Ocurrió un error al consultar tu progreso. Por favor, intenta nuevamente.'
      );
    }
  });

  // Acción para ver progreso completo
  bot.action('view_onboarding_progress', async (ctx) => {
    await ctx.answerCbQuery();

    if (!ctx.hasTenant()) {
      return ctx.reply('Para ver tu progreso, primero debes registrar tu empresa.');
    }

    try {
      const tenantId = ctx.getTenantId();
      const progress = await OnboardingProgressService.getProgress(tenantId);

      const { message, keyboard, parse_mode } = onboardingProgressView(progress);
      return ctx.reply(message, { parse_mode, ...keyboard });
    } catch (error) {
      console.error('Error al obtener progreso de onboarding:', error);
      return ctx.reply(
        '❌ Ocurrió un error al consultar tu progreso. Por favor, intenta nuevamente.'
      );
    }
  });

  // Acción para ver siguiente paso recomendado
  bot.action('next_step', async (ctx) => {
    await ctx.answerCbQuery();

    if (!ctx.hasTenant()) {
      return ctx.reply('Para ver tu próximo paso, primero debes registrar tu empresa.');
    }

    try {
      const tenantId = ctx.getTenantId();
      const progress = await OnboardingProgressService.getProgress(tenantId);

      const { message, keyboard, parse_mode } = nextStepView(progress);
      return ctx.reply(message, { parse_mode, ...keyboard });
    } catch (error) {
      console.error('Error al obtener siguiente paso de onboarding:', error);
      return ctx.reply(
        '❌ Ocurrió un error al consultar tu próximo paso. Por favor, intenta nuevamente.'
      );
    }
  });

  // Registrar estos comandos es útil para los usuarios
  console.log('✅ Comandos de progreso de onboarding registrados');
}
