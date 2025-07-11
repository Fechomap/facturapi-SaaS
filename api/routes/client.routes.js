// api/routes/client.routes.js
import express from 'express';
import clientController from '../controllers/client.controller.js';

const router = express.Router();

// Rutas para clientes
router.post('/', clientController.createClient);
router.get('/', clientController.listClients);
router.get('/:id', clientController.getClient);
router.put('/:id', clientController.updateClient);
router.delete('/:id', clientController.deleteClient);

export default router;
