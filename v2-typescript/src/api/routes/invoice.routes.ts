import { Router } from 'express';
import invoiceController from '../controllers/invoice.controller';
import { validateRequest, createInvoiceSchema } from '../middlewares/validation.middleware';
import { requireTenant } from '../middlewares/tenant.middleware';

const router = Router();

// Rutas para facturas con requireTenant aplicado
router.post(
  '/',
  requireTenant,
  validateRequest(createInvoiceSchema),
  invoiceController.createInvoice
);
router.post('/simple', requireTenant, invoiceController.createSimpleInvoice);
router.get('/', requireTenant, invoiceController.listInvoices);
router.get('/:id', requireTenant, invoiceController.getInvoice);
router.delete('/:id', requireTenant, invoiceController.cancelInvoice);
router.post('/:id/enviar', requireTenant, invoiceController.sendInvoiceByEmail);
router.get('/:id/pdf', requireTenant, invoiceController.downloadInvoicePdf);
router.get('/:id/xml', requireTenant, invoiceController.downloadInvoiceXml);
router.get('/by-folio/:folio', requireTenant, invoiceController.getInvoiceByFolio);
router.get('/search', requireTenant, invoiceController.searchInvoices);

export default router;
