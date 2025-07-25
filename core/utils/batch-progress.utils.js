// core/utils/batch-progress.utils.js
import { Markup } from 'telegraf';

// Constantes para animación de progreso
const PROGRESS_FRAMES = ['⏳', '⌛', '⏳', '⌛'];
const PROGRESS_BARS = [
  '▱▱▱▱▱▱▱▱▱▱',
  '▰▱▱▱▱▱▱▱▱▱',
  '▰▰▱▱▱▱▱▱▱▱',
  '▰▰▰▱▱▱▱▱▱▱',
  '▰▰▰▰▱▱▱▱▱▱',
  '▰▰▰▰▰▱▱▱▱▱',
  '▰▰▰▰▰▰▱▱▱▱',
  '▰▰▰▰▰▰▰▱▱▱',
  '▰▰▰▰▰▰▰▰▱▱',
  '▰▰▰▰▰▰▰▰▰▱',
  '▰▰▰▰▰▰▰▰▰▰',
];

const PHASE_EMOJIS = {
  validation: '🔍',
  download: '📥',
  analysis: '🔍',
  confirmation: '⏸️',
  invoice_generation: '🧾',
  zip_creation: '📦',
  completed: '✅',
  error: '❌',
};

/**
 * Utilidad para trackear progreso de procesamiento por lotes
 */
class BatchProgressTracker {
  constructor(ctx, batchId) {
    this.ctx = ctx;
    this.batchId = batchId;
    this.currentPhase = '';
    this.currentStep = 0;
    this.totalSteps = 0;
    this.progressMessageId = null;
    this.startTime = Date.now();
    this.phaseStartTime = Date.now();
  }

  /**
   * Inicia el tracking de progreso con un mensaje inicial
   */
  async startProgress(totalPDFs) {
    const initialMessage = this.buildInitialMessage(totalPDFs);

    try {
      const message = await this.ctx.reply(initialMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Cancelar Proceso', `cancel_batch_${this.batchId}`)],
        ]),
      });

      this.progressMessageId = message.message_id;
      console.log(`📊 Progress tracker iniciado para lote ${this.batchId}`);

      return this.progressMessageId;
    } catch (error) {
      console.error('Error iniciando progress tracker:', error.message);
      return null;
    }
  }

  /**
   * Actualiza el progreso para una fase específica
   */
  async updatePhase(phase, currentStep, totalSteps, details = '') {
    this.currentPhase = phase;
    this.currentStep = currentStep;
    this.totalSteps = totalSteps;
    this.phaseStartTime = Date.now();

    if (!this.progressMessageId) return;

    const progressText = this.buildProgressMessage(details);

    try {
      await this.ctx.telegram.editMessageText(
        this.ctx.chat.id,
        this.progressMessageId,
        null,
        progressText,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancelar Proceso', `cancel_batch_${this.batchId}`)],
          ]),
        }
      );
    } catch (error) {
      // Ignorar errores de mensaje no modificado
      if (!error.message.includes('message is not modified')) {
        console.error('Error actualizando progreso:', error.message);
      }
    }
  }

  /**
   * Incrementa el paso actual en la fase
   */
  async incrementStep(details = '') {
    this.currentStep = Math.min(this.currentStep + 1, this.totalSteps);
    await this.updatePhase(this.currentPhase, this.currentStep, this.totalSteps, details);
  }

  /**
   * Muestra los resultados del análisis y espera confirmación
   */
  async showAnalysisResults(batchResults) {
    const { successful, failed, total, results } = batchResults;

    const resultsText = this.buildAnalysisResultsMessage(successful, failed, total, results);

    try {
      if (this.progressMessageId) {
        await this.ctx.telegram.editMessageText(
          this.ctx.chat.id,
          this.progressMessageId,
          null,
          resultsText,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Generar Facturas', `confirm_batch_${this.batchId}`),
                Markup.button.callback('❌ Cancelar', `cancel_batch_${this.batchId}`),
              ],
            ]),
          }
        );
      }
    } catch (error) {
      console.error('Error mostrando resultados de análisis:', error.message);
    }
  }

  /**
   * Actualiza con los resultados finales
   */
  async showFinalResults(invoiceResults, zipInfo = null) {
    const finalText = this.buildFinalResultsMessage(invoiceResults, zipInfo);

    try {
      if (this.progressMessageId) {
        const buttons = [];

        if (zipInfo && invoiceResults.successful.length > 0) {
          buttons.push([
            Markup.button.callback('📄 Descargar PDFs', `download_pdf_zip_${this.batchId}`),
            Markup.button.callback('🗂️ Descargar XMLs', `download_xml_zip_${this.batchId}`),
          ]);
        }

        buttons.push([Markup.button.callback('🏠 Menú Principal', 'menu_principal')]);

        await this.ctx.telegram.editMessageText(
          this.ctx.chat.id,
          this.progressMessageId,
          null,
          finalText,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons),
          }
        );
      }
    } catch (error) {
      console.error('Error mostrando resultados finales:', error.message);
    }
  }

  /**
   * Muestra un error y termina el proceso
   */
  async showError(error) {
    const errorText = this.buildErrorMessage(error);

    try {
      if (this.progressMessageId) {
        await this.ctx.telegram.editMessageText(
          this.ctx.chat.id,
          this.progressMessageId,
          null,
          errorText,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🏠 Menú Principal', 'menu_principal')],
            ]),
          }
        );
      }
    } catch (editError) {
      console.error('Error mostrando mensaje de error:', editError.message);
    }
  }

  /**
   * Construye el mensaje inicial
   */
  buildInitialMessage(totalPDFs) {
    return (
      `🚀 **Procesamiento por Lotes Iniciado**\n\n` +
      `📊 **PDFs a procesar:** ${totalPDFs}\n` +
      `⏱️ **Tiempo estimado:** ${this.estimateProcessingTime(totalPDFs)}\n\n` +
      `${PHASE_EMOJIS.validation} Validando archivos...\n\n` +
      `🆔 **ID del lote:** \`${this.batchId}\``
    );
  }

  /**
   * Construye el mensaje de progreso
   */
  buildProgressMessage(details) {
    const percentage =
      this.totalSteps > 0 ? Math.round((this.currentStep / this.totalSteps) * 100) : 0;
    const progressBarIndex = Math.min(Math.floor((this.currentStep / this.totalSteps) * 10), 9);
    const frameIndex = Math.floor(Date.now() / 500) % PROGRESS_FRAMES.length;

    const elapsedTime = this.formatDuration(Date.now() - this.startTime);
    const phaseTime = this.formatDuration(Date.now() - this.phaseStartTime);

    let text = `${PROGRESS_FRAMES[frameIndex]} **Procesamiento por Lotes**\n\n`;

    text += `${PHASE_EMOJIS[this.currentPhase] || '🔄'} **${this.getPhaseDisplayName()}**\n`;
    text += `📊 Progreso: ${percentage}% ${PROGRESS_BARS[progressBarIndex]}\n`;
    text += `📈 ${this.currentStep}/${this.totalSteps}\n\n`;

    if (details) {
      text += `📝 ${details}\n\n`;
    }

    text += `⏱️ Tiempo transcurrido: ${elapsedTime}\n`;
    text += `⏳ Fase actual: ${phaseTime}\n\n`;
    text += `🆔 **Lote:** \`${this.batchId}\``;

    return text;
  }

  /**
   * Construye el mensaje de resultados de análisis
   */
  buildAnalysisResultsMessage(successful, failed, total, results) {
    let text = `📊 **Análisis Completado**\n\n`;

    text += `✅ **Exitosos:** ${successful}/${total}\n`;
    text += `❌ **Fallidos:** ${failed}/${total}\n\n`;

    if (successful > 0) {
      text += `📋 **PDFs analizados exitosamente:**\n`;
      const successfulResults = results.filter((r) => r.success);
      successfulResults.slice(0, 5).forEach((result, index) => {
        const client = result.analysis?.clientName || 'Cliente no identificado';
        const order = result.analysis?.orderNumber || 'S/N';
        const amount = result.analysis?.totalAmount || 0;
        text += `${index + 1}. ${result.fileName}\n`;
        text += `   👤 ${client}\n`;
        text += `   📋 Orden: ${order} | 💰 $${amount}\n\n`;
      });

      if (successfulResults.length > 5) {
        text += `... y ${successfulResults.length - 5} más\n\n`;
      }
    }

    if (failed > 0) {
      text += `⚠️ **Archivos con errores:**\n`;
      const failedResults = results.filter((r) => !r.success);
      failedResults.slice(0, 3).forEach((result, index) => {
        text += `${index + 1}. ${result.fileName}: ${result.error}\n`;
      });

      if (failedResults.length > 3) {
        text += `... y ${failedResults.length - 3} errores más\n\n`;
      }
    }

    if (successful > 0) {
      text += `💡 **¿Desea continuar generando ${successful} facturas?**`;
    } else {
      text += `❌ **No se pueden generar facturas**`;
    }

    return text;
  }

  /**
   * Construye el mensaje de resultados finales
   */
  buildFinalResultsMessage(invoiceResults, zipInfo) {
    const { successful, failed, total } = invoiceResults;
    const processingTime = this.formatDuration(Date.now() - this.startTime);

    let text = `🎉 **Procesamiento Completado**\n\n`;

    text += `📊 **Resumen Final:**\n`;
    text += `✅ Facturas generadas: ${successful.length}\n`;
    text += `❌ Errores: ${failed.length}\n`;
    text += `📝 Total procesado: ${total}\n`;
    text += `⏱️ Tiempo total: ${processingTime}\n\n`;

    if (successful.length > 0) {
      text += `📋 **Facturas generadas:**\n`;
      successful.slice(0, 5).forEach((result, index) => {
        const invoice = result.invoice;
        const folio = invoice.folio || invoice.folioNumber || 'S/F';
        const serie = invoice.series || 'A';
        text += `${index + 1}. ${result.fileName} → ${serie}${folio}\n`;
      });

      if (successful.length > 5) {
        text += `... y ${successful.length - 5} más\n\n`;
      }

      if (zipInfo) {
        text += `📦 **Archivos ZIP generados:**\n`;
        text += `📄 PDFs: ${zipInfo.pdfZip.fileName} (${zipInfo.pdfZip.fileSizeMB}MB)\n`;
        text += `🗂️ XMLs: ${zipInfo.xmlZip.fileName} (${zipInfo.xmlZip.fileSizeMB}MB)\n\n`;
        text += `💾 **Use los botones para descargar**`;
      }
    }

    if (failed.length > 0) {
      text += `\n⚠️ **Errores encontrados:**\n`;
      failed.slice(0, 3).forEach((result, index) => {
        text += `${index + 1}. ${result.fileName}: ${result.error}\n`;
      });

      if (failed.length > 3) {
        text += `... y ${failed.length - 3} errores más`;
      }
    }

    return text;
  }

  /**
   * Construye el mensaje de error
   */
  buildErrorMessage(error) {
    const processingTime = this.formatDuration(Date.now() - this.startTime);

    return (
      `❌ **Error en Procesamiento por Lotes**\n\n` +
      `🆔 **Lote:** \`${this.batchId}\`\n` +
      `⏱️ **Tiempo transcurrido:** ${processingTime}\n\n` +
      `💬 **Error:** ${error.message}\n\n` +
      `🔄 **Puede intentar nuevamente enviando los PDFs otra vez**`
    );
  }

  /**
   * Obtiene el nombre display de la fase actual
   */
  getPhaseDisplayName() {
    const phaseNames = {
      validation: 'Validando archivos',
      download: 'Descargando PDFs',
      analysis: 'Analizando contenido',
      confirmation: 'Esperando confirmación',
      invoice_generation: 'Generando facturas',
      zip_creation: 'Creando archivos ZIP',
      completed: 'Proceso completado',
      error: 'Error en procesamiento',
    };

    return phaseNames[this.currentPhase] || 'Procesando';
  }

  /**
   * Estima el tiempo de procesamiento
   */
  estimateProcessingTime(pdfCount) {
    const timePerPDF = 15; // segundos por PDF
    const totalSeconds = pdfCount * timePerPDF;

    if (totalSeconds < 60) {
      return `~${totalSeconds}s`;
    } else if (totalSeconds < 3600) {
      const minutes = Math.ceil(totalSeconds / 60);
      return `~${minutes}m`;
    } else {
      const hours = Math.ceil(totalSeconds / 3600);
      return `~${hours}h`;
    }
  }

  /**
   * Formatea duración en formato legible
   */
  formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);

    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const remainingMinutes = Math.floor((seconds % 3600) / 60);
      return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }
  }
}

/**
 * Función utilitaria para crear un tracker de progreso
 */
export function createBatchProgressTracker(ctx, batchId) {
  return new BatchProgressTracker(ctx, batchId);
}

/**
 * Función utilitaria para limpiar el estado de batch processing
 */
export function cleanupBatchProcessing(ctx) {
  if (ctx.userState?.batchProcessing) {
    delete ctx.userState.batchProcessing;
    console.log(`🧹 Estado de batch processing limpiado para usuario ${ctx.from.id}`);
  }
}

export default BatchProgressTracker;
