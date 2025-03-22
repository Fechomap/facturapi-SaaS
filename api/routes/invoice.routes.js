// api/routes/invoice.routes.js
import express from 'express';
import invoiceController from '../controllers/invoice.controller.js';
import { validateRequest, createInvoiceSchema } from '../middlewares/validation.middleware.js';

const router = express.Router();

// Rutas para facturas
router.post('/', validateRequest(createInvoiceSchema), invoiceController.createInvoice);
router.post('/simple', invoiceController.createSimpleInvoice);
router.get('/', invoiceController.listInvoices);
router.get('/:id', invoiceController.getInvoice);
router.delete('/:id', invoiceController.cancelInvoice);
router.post('/:id/enviar', invoiceController.sendInvoiceByEmail);
router.get('/:id/pdf', invoiceController.downloadInvoicePdf);
router.get('/:id/xml', invoiceController.downloadInvoiceXml);
router.get('/by-folio/:folio', invoiceController.getInvoiceByFolio);

export default router;