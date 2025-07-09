// api/routes/index.js (actualización)
import express from 'express';
import clientRoutes from './client.routes.js';
import invoiceRoutes from './invoice.routes.js';
import productRoutes from './product.routes.js';
import webhookRoutes from './webhook.routes.js';
import authRoutes from './auth.routes.js'; // Añadir rutas de autenticación
import clusterRoutes from './cluster.routes.js'; // Rutas de monitoreo de cluster

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
router.use('/auth', authRoutes); // Añadir rutas de autenticación
router.use('/cluster', clusterRoutes); // Rutas de monitoreo de cluster
router.use('/clientes', clientRoutes);
router.use('/facturas', invoiceRoutes);
router.use('/productos', productRoutes);
router.use('/webhooks', webhookRoutes);

export default router;