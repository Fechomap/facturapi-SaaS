import { Router } from 'express';
import webhookController from '../controllers/webhook.controller';

const router = Router();

// Rutas para webhooks (Stripe routes removed)
router.post('/facturapi', webhookController.handleFacturapiWebhook);
router.post('/:source', webhookController.handleGenericWebhook);

export default router;
