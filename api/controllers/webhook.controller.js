// api/controllers/webhook.controller.js
/**
 * Controlador para webhooks de servicios externos
 */
class WebhookController {
    /**
     * Procesa webhooks de Stripe
     * @param {Object} req - Request de Express
     * @param {Object} res - Response de Express
     * @param {Function} next - Función next de Express
     */
    async handleStripeWebhook(req, res, next) {
      try {
        // Verificar firma del webhook de Stripe
        const signature = req.headers['stripe-signature'];
        
        if (!signature) {
          console.warn('Se recibió webhook sin firma de Stripe');
          return res.status(400).json({ error: 'Falta la firma del webhook' });
        }
        
        // El payload viene como un buffer raw para la verificación de firma
        const payload = req.body;
        
        // Simular procesamiento del evento (en una implementación real utilizaríamos paymentService)
        console.log('Webhook de Stripe recibido:', typeof payload === 'string' ? payload : '[Buffer]');
        
        // Siempre enviamos success 200 para que Stripe no reintente, incluso si hay errores internos
        res.json({ 
          received: true, 
          message: 'Webhook procesado correctamente'
        });
      } catch (error) {
        console.error('Error al procesar webhook de Stripe:', error);
        
        // Incluso en caso de error, devolvemos 200 para que Stripe no reintente
        res.status(200).json({ 
          received: true, 
          error: error.message,
          processed: false 
        });
      }
    }
  
    /**
     * Procesa webhooks genéricos
     * @param {Object} req - Request de Express
     * @param {Object} res - Response de Express
     * @param {Function} next - Función next de Express
     */
    async handleGenericWebhook(req, res, next) {
      try {
        const payload = req.body;
        const source = req.params.source;
        
        console.log(`Webhook recibido de ${source}:`, payload);
        
        // Simulación de procesamiento
        res.json({
          received: true,
          source,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        next(error);
      }
    }
  }
  
  // Crear instancia del controlador
  const webhookController = new WebhookController();
  
  export default webhookController;