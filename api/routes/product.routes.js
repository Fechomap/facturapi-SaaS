// api/routes/product.routes.js
import express from 'express';
import productController from '../controllers/product.controller.js';

const router = express.Router();

// Rutas para productos
router.post('/', productController.createProduct);
router.get('/', productController.listProducts);
router.get('/:id', productController.getProduct);
router.put('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);

export default router;
