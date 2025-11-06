import { Router } from 'express';
import clientController from '../controllers/client.controller';

const router = Router();

// Rutas para clientes
router.post('/', clientController.createClient);
router.get('/', clientController.listClients);
router.get('/:id', clientController.getClient);
router.put('/:id', clientController.updateClient);
router.delete('/:id', clientController.deleteClient);

export default router;
