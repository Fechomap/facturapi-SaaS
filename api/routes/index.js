// api/routes/index.js
import express from 'express';
import clientRoutes from './client.routes.js';
import invoiceRoutes from './invoice.routes.js';
import productRoutes from './product.routes.js';
import webhookRoutes from './webhook.routes.js';

const router = express.Router();

// Ruta base para verificar estado
router.get('/', (req, res) => {
  res.json({
    status: 'API activa',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Registrar todas las rutas bajo sus respectivos prefijos
router.use('/clientes', clientRoutes);
router.use('/facturas', invoiceRoutes);
router.use('/productos', productRoutes);
router.use('/webhooks', webhookRoutes);

export default router;