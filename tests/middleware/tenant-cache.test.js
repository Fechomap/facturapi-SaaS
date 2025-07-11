// tests/middleware/tenant-cache.test.js
import { requireTenant } from '../../api/middlewares/tenant.middleware.js';
import prisma from '../../lib/prisma.js';

// Mock prisma
jest.mock('../../lib/prisma.js', () => ({
  tenant: {
    findUnique: jest.fn()
  }
}));

describe('Tenant Middleware Cache', () => {
  let req, res, next;
  const mockTenant = {
    id: 'test-tenant-id',
    businessName: 'Test Business',
    isActive: true,
    subscriptions: [{
      id: 'sub-1',
      status: 'active',
      currentPeriodEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days future
      plan: {
        id: 'plan-1',
        name: 'Professional',
        invoiceLimit: 1000
      }
    }]
  };

  beforeEach(() => {
    req = {
      headers: { 'x-tenant-id': 'test-tenant-id' },
      body: {},
      query: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
    
    // Clear mocks
    jest.clearAllMocks();
  });

  it('should cache tenant data between requests', async () => {
    prisma.tenant.findUnique.mockResolvedValue(mockTenant);
    
    // Primera llamada
    await requireTenant(req, res, next);
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalled();
    
    // Segunda llamada con el mismo tenant (debería usar cache)
    const req2 = { ...req };
    await requireTenant(req2, res, next);
    
    // Si el cache estuviera implementado, no debería llamar de nuevo
    // TODO: Implementar cache y cambiar expectativa
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(2); // Actualmente llama 2 veces
  });

  it('should validate subscription status correctly', async () => {
    const expiredTenant = {
      ...mockTenant,
      subscriptions: [{
        ...mockTenant.subscriptions[0],
        status: 'active',
        currentPeriodEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
      }]
    };
    
    prisma.tenant.findUnique.mockResolvedValue(expiredTenant);
    
    await requireTenant(req, res, next);
    
    // Should allow access during grace period (3 days)
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should deny access after grace period', async () => {
    const veryExpiredTenant = {
      ...mockTenant,
      subscriptions: [{
        ...mockTenant.subscriptions[0],
        status: 'active',
        currentPeriodEndsAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
      }]
    };
    
    prisma.tenant.findUnique.mockResolvedValue(veryExpiredTenant);
    
    await requireTenant(req, res, next);
    
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'SubscriptionInvalid'
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should handle trial subscriptions correctly', async () => {
    const trialTenant = {
      ...mockTenant,
      subscriptions: [{
        ...mockTenant.subscriptions[0],
        status: 'trial',
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days future
        currentPeriodEndsAt: null
      }]
    };
    
    prisma.tenant.findUnique.mockResolvedValue(trialTenant);
    
    await requireTenant(req, res, next);
    
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should measure middleware execution time', async () => {
    prisma.tenant.findUnique.mockResolvedValue(mockTenant);
    
    const startTime = Date.now();
    await requireTenant(req, res, next);
    const duration = Date.now() - startTime;
    
    expect(duration).toBeLessThan(100); // Should complete in less than 100ms
  });
});