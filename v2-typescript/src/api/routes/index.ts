import { Router, Request, Response } from 'express';
import clientRoutes from './client.routes';
import invoiceRoutes from './invoice.routes';
import productRoutes from './product.routes';
import webhookRoutes from './webhook.routes';
import authRoutes from './auth.routes';
import clusterRoutes from './cluster.routes';

const router = Router();

// Ruta base para verificar estado
router.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'API activa',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

// Registrar todas las rutas bajo sus respectivos prefijos
router.use('/auth', authRoutes);
router.use('/cluster', clusterRoutes);
router.use('/clientes', clientRoutes);
router.use('/facturas', invoiceRoutes);
router.use('/productos', productRoutes);
router.use('/webhooks', webhookRoutes);

export default router;
