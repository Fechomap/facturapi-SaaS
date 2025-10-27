// api/routes/webhook.routes.js
import express from 'express';
import webhookController from '../controllers/webhook.controller.js';

const router = express.Router();

// Rutas para webhooks
router.post('/facturapi', webhookController.handleFacturapiWebhook);
router.post('/:source', webhookController.handleGenericWebhook);

export default router;
