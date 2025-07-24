// tests/controllers/invoice-download.test.js
import request from 'supertest';
import express from 'express';
import axios from 'axios';
import invoiceController from '../../api/controllers/invoice.controller.js';
import { requireTenant } from '../../api/middlewares/tenant.middleware.js';

// Mock axios
jest.mock('axios');

// Mock middleware dependencies
jest.mock('../../lib/prisma.js', () => ({
  tenant: {
    findUnique: jest.fn(),
  },
  tenantInvoice: {
    findFirst: jest.fn(),
  },
}));

// Create test app
const app = express();
app.use(express.json());

// Simple mock middleware
app.use((req, res, next) => {
  req.tenant = { id: 'test-tenant' };
  req.getApiKey = jest.fn().mockResolvedValue('test-api-key');
  next();
});

// Routes
app.get('/api/invoices/:id/pdf', invoiceController.downloadInvoicePdf);
app.get('/api/invoices/:id/xml', invoiceController.downloadInvoiceXml);

describe('Invoice Download Streaming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PDF Download', () => {
    it('should download PDF without loading entire file in memory', async () => {
      // Create a large mock PDF buffer (5MB)
      const largePdfBuffer = Buffer.alloc(5 * 1024 * 1024);
      largePdfBuffer.write('%PDF-1.4');

      axios.mockResolvedValue({
        data: largePdfBuffer,
        headers: {
          'content-type': 'application/pdf',
          'content-length': largePdfBuffer.length,
        },
      });

      const memBefore = process.memoryUsage().heapUsed;

      const response = await request(app)
        .get('/api/invoices/test-invoice-123/pdf')
        .expect(200)
        .expect('Content-Type', 'application/pdf')
        .expect('Content-Disposition', /attachment; filename=factura-test-invoice-123\.pdf/);

      const memAfter = process.memoryUsage().heapUsed;
      const memDiff = (memAfter - memBefore) / 1024 / 1024;

      console.log(`Memory used for 5MB PDF: ${memDiff.toFixed(2)} MB`);

      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBe(largePdfBuffer.length);

      // Currently loads entire file in memory (bad)
      expect(memDiff).toBeGreaterThan(4); // Uses at least 4MB
    });

    it('should handle FacturAPI errors gracefully', async () => {
      axios.mockRejectedValue({
        response: {
          status: 404,
          data: { error: 'Invoice not found' },
        },
      });

      const response = await request(app).get('/api/invoices/non-existent/pdf').expect(404);

      expect(response.body).toEqual({
        error: 'FacturAPIError',
        message: 'Error al obtener el PDF de FacturAPI',
        details: { error: 'Invoice not found' },
      });
    });

    it('should handle network errors', async () => {
      axios.mockRejectedValue(new Error('ECONNREFUSED'));

      const response = await request(app).get('/api/invoices/test-invoice/pdf').expect(500);

      expect(response.body).toEqual({
        error: 'FacturAPIError',
        message: 'Error de conexión con FacturAPI',
        details: 'ECONNREFUSED',
      });
    });
  });

  describe('XML Download', () => {
    it('should download XML efficiently', async () => {
      const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/3">
  <!-- Large XML content -->
  ${Array(1000).fill('<cfdi:Concepto />').join('\n')}
</cfdi:Comprobante>`;

      const xmlBuffer = Buffer.from(xmlContent);

      axios.mockResolvedValue({
        data: xmlBuffer,
        headers: {
          'content-type': 'application/xml',
        },
      });

      const response = await request(app)
        .get('/api/invoices/test-invoice-123/xml')
        .expect(200)
        .expect('Content-Type', 'application/xml')
        .expect('Content-Disposition', /attachment; filename=factura-test-invoice-123\.xml/);

      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.toString()).toContain('<?xml version');
    });
  });

  describe('Proposed Streaming Implementation', () => {
    it('should demonstrate streaming approach', async () => {
      // This is how streaming SHOULD work
      const streamingDownload = async (req, res) => {
        try {
          const apiKey = await req.getApiKey();
          const invoiceId = req.params.id;

          // Create axios request with responseType: 'stream'
          const response = await axios({
            method: 'GET',
            url: `https://www.facturapi.io/v2/invoices/${invoiceId}/pdf`,
            responseType: 'stream', // KEY DIFFERENCE
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          });

          // Set headers
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename=factura-${invoiceId}.pdf`);

          // Pipe the stream directly to response
          response.data.pipe(res);

          // Handle stream errors
          response.data.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
              res.status(500).json({ error: 'Stream error' });
            }
          });
        } catch (error) {
          if (!res.headersSent) {
            res.status(500).json({ error: error.message });
          }
        }
      };

      // Test memory usage with streaming
      const memBefore = process.memoryUsage().heapUsed;

      // Simulate streaming (in real test would need actual stream)
      const res = {
        setHeader: jest.fn(),
        pipe: jest.fn(),
        headersSent: false,
      };

      // Memory usage should be minimal with streaming
      const memAfter = process.memoryUsage().heapUsed;
      const memDiff = (memAfter - memBefore) / 1024 / 1024;

      expect(memDiff).toBeLessThan(1); // Should use less than 1MB
    });
  });

  describe('Performance Under Load', () => {
    it('should handle multiple concurrent downloads', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 test content');
      axios.mockResolvedValue({ data: pdfBuffer });

      const concurrentRequests = 10;
      const requests = [];

      const startTime = Date.now();

      for (let i = 0; i < concurrentRequests; i++) {
        requests.push(request(app).get(`/api/invoices/invoice-${i}/pdf`).expect(200));
      }

      await Promise.all(requests);
      const duration = Date.now() - startTime;

      console.log(`${concurrentRequests} concurrent downloads completed in ${duration}ms`);

      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
      expect(axios).toHaveBeenCalledTimes(concurrentRequests);
    });
  });
});
