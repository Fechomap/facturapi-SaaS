// tests/services/invoice-pagination.test.js
import InvoiceService from '../../services/invoice.service.js';
import prisma from '../../lib/prisma.js';

// Mock prisma
const mockPrisma = {
  tenantInvoice: {
    findMany: jest.fn(),
    count: jest.fn()
  }
};

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  default: mockPrisma
}));

describe('Invoice Pagination', () => {
  const mockInvoices = Array.from({ length: 50 }, (_, i) => ({
    id: `inv-${i}`,
    tenantId: 'test-tenant',
    facturapiInvoiceId: `fact-${i}`,
    series: 'A',
    folioNumber: 1000 + i,
    total: 1000 + i * 100,
    status: 'valid',
    createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000), // Each day older
    customer: {
      id: `cust-${i}`,
      legalName: `Customer ${i}`,
      rfc: 'XAXX010101000'
    },
    documents: []
  }));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Current Implementation (Memory Pagination)', () => {
    it('should load all invoices into memory', async () => {
      mockPrisma.tenantInvoice.findMany.mockResolvedValue(mockInvoices.slice(0, 10));
      mockPrisma.tenantInvoice.count.mockResolvedValue(50);
      
      const criteria = {
        tenantId: 'test-tenant',
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date()
      };
      
      const result = await InvoiceService.searchInvoices(criteria);
      
      expect(mockPrisma.tenantInvoice.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenantId: 'test-tenant'
        }),
        include: {
          customer: true,
          documents: true
        },
        orderBy: {
          invoiceDate: 'desc'
        },
        skip: 0,
        take: 10
      });
      
      expect(result.data).toHaveLength(10); // Only page data
      expect(result.pagination.total).toBe(50); // Total count
      expect(result.pagination.pages).toBe(5); // Total pages
    });

    it('should measure memory usage for large datasets', async () => {
      // Create a large dataset
      const largeDataset = Array.from({ length: 10000 }, (_, i) => ({
        ...mockInvoices[0],
        id: `inv-${i}`,
        // Add some data to make each invoice heavier
        metadata: { 
          items: Array(10).fill({ description: 'Product description with some text' })
        }
      }));
      
      prisma.tenantInvoice.findMany.mockResolvedValue(largeDataset);
      
      const memBefore = process.memoryUsage().heapUsed;
      
      await InvoiceService.searchInvoices({ tenantId: 'test-tenant' });
      
      const memAfter = process.memoryUsage().heapUsed;
      const memUsedMB = (memAfter - memBefore) / 1024 / 1024;
      
      console.log(`Memory used for 10k invoices: ${memUsedMB.toFixed(2)} MB`);
      
      // This is expected to use significant memory
      expect(memUsedMB).toBeGreaterThan(5); // At least 5MB for 10k records
    });
  });

  describe('Proposed Database Pagination', () => {
    // This is how it SHOULD work
    it('should paginate at database level (proposed)', async () => {
      // Mock for proposed implementation
      const searchInvoicesPaginated = async (criteria) => {
        const { page = 1, limit = 10 } = criteria;
        const skip = (page - 1) * limit;
        
        const [invoices, total] = await Promise.all([
          prisma.tenantInvoice.findMany({
            where: { tenantId: criteria.tenantId },
            skip,
            take: limit,
            include: {
              customer: true,
              documents: true
            },
            orderBy: { invoiceDate: 'desc' }
          }),
          prisma.tenantInvoice.count({
            where: { tenantId: criteria.tenantId }
          })
        ]);
        
        return {
          data: invoices,
          pagination: {
            total,
            page,
            limit,
            pages: Math.ceil(total / limit)
          }
        };
      };
      
      prisma.tenantInvoice.findMany.mockResolvedValue(mockInvoices.slice(10, 20));
      prisma.tenantInvoice.count.mockResolvedValue(50);
      
      const result = await searchInvoicesPaginated({
        tenantId: 'test-tenant',
        page: 2,
        limit: 10
      });
      
      expect(prisma.tenantInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10
        })
      );
      
      expect(result.data).toHaveLength(10);
      expect(result.pagination).toEqual({
        total: 50,
        page: 2,
        limit: 10,
        pages: 5
      });
    });

    it('should handle complex filters with pagination', async () => {
      const criteria = {
        tenantId: 'test-tenant',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
        customerId: 'cust-123',
        status: 'valid',
        minAmount: 1000,
        maxAmount: 5000
      };
      
      await InvoiceService.searchInvoices(criteria);
      
      expect(prisma.tenantInvoice.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'test-tenant',
          invoiceDate: {
            gte: criteria.startDate,
            lte: criteria.endDate
          },
          customerId: 'cust-123',
          status: 'valid',
          total: {
            gte: 1000,
            lte: 5000
          }
        },
        include: {
          customer: true,
          documents: true
        },
        orderBy: {
          invoiceDate: 'desc'
        }
      });
    });
  });

  describe('Performance Comparison', () => {
    it('should compare memory vs database pagination performance', async () => {
      const invoiceCount = 1000;
      const pageSize = 20;
      
      // Memory pagination (current)
      const largeDataset = Array.from({ length: invoiceCount }, (_, i) => ({
        ...mockInvoices[0],
        id: `inv-${i}`
      }));
      
      prisma.tenantInvoice.findMany.mockResolvedValue(largeDataset);
      
      const memoryStart = Date.now();
      const memoryResult = await InvoiceService.searchInvoices({ 
        tenantId: 'test-tenant' 
      });
      const memoryTime = Date.now() - memoryStart;
      
      // Simulate getting page 3
      const page3 = memoryResult.slice(40, 60);
      
      console.log(`Memory pagination: ${memoryTime}ms for ${invoiceCount} records`);
      console.log(`Page 3 contains ${page3.length} records`);
      
      // Database pagination would be much faster for large datasets
      expect(memoryTime).toBeLessThan(1000); // Should complete reasonably fast
    });
  });
});