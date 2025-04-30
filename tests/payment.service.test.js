import { jest } from '@jest/globals';

// Mock dependencies before importing the service
const mockStripe = {
  webhooks: {
    constructEvent: jest.fn(),
  },
  paymentIntents: {
    retrieve: jest.fn(),
  },
  // Add other Stripe methods if needed by handlers
};

// Mock Prisma client methods
const mockPrisma = {
  tenant: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  tenantSubscription: {
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  tenantPayment: {
    create: jest.fn(),
  },
  subscriptionPlan: {
      findFirst: jest.fn(),
  },
  tenantUser: {
      findMany: jest.fn(),
  }
  // Add other models/methods if needed
};

// Mock NotificationService
const mockNotificationService = {
  sendTelegramNotification: jest.fn(),
  notifySystemAdmins: jest.fn(), // Add if used directly by handlers
};

// Mock logger
const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => mockLogger), // Return itself for chained calls like .child()
};

// Apply mocks using jest.unstable_mockModule (ESM compatible)
jest.unstable_mockModule('stripe', () => ({
  __esModule: true,
  default: jest.fn(() => mockStripe), // Mock the default export (Stripe class constructor)
}));

jest.unstable_mockModule('../lib/prisma.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.unstable_mockModule('../services/notification.service.js', () => ({
  __esModule: true,
  default: mockNotificationService,
}));

jest.unstable_mockModule('../core/utils/logger.js', () => ({
    __esModule: true,
    default: mockLogger,
}));


// Import the service *after* mocks are defined
const paymentService = await import('../services/payment.service.js');

// --- Test Suite ---
describe('Payment Service - Webhook Handling', () => {
  // Reset mocks and initialize Stripe client before each test
  beforeEach(() => {
    jest.clearAllMocks();
    // Initialize the stripe client within the service module for each test
    paymentService.initializeStripe('sk_test_mock'); 
    // Reset specific mock implementations if needed
    mockStripe.webhooks.constructEvent.mockReset();
    mockPrisma.tenant.findFirst.mockReset();
    mockPrisma.tenantSubscription.findFirst.mockReset();
    mockPrisma.tenantSubscription.update.mockReset();
    mockPrisma.tenantPayment.create.mockReset();
    mockPrisma.tenantUser.findMany.mockReset();
    mockNotificationService.sendTelegramNotification.mockReset();
  });

  // --- Tests for handleWebhookEvent ---
  describe('handleWebhookEvent', () => {
    const mockPayload = '{"id": "evt_test", "type": "checkout.session.completed"}';
    const mockSignature = 'mock_signature';
    const mockWebhookSecret = 'whsec_mock';

    it('should verify and construct the event', async () => {
      // Minimal data for handler to run enough
      const mockEvent = { id: 'evt_test', type: 'checkout.session.completed', data: { object: { id: 'cs_test', customer: 'cus_test', payment_status: 'paid' } } }; 
      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);
      
      // Provide minimal mocks for handleCheckoutSessionCompleted to run past the tenant check
      mockPrisma.tenant.findFirst.mockResolvedValueOnce({ id: 'tenant_abc' }); 
      mockPrisma.tenantSubscription.findFirst.mockResolvedValueOnce(null); // Let it ignore finding a pending sub

      await paymentService.handleWebhookEvent(mockPayload, mockSignature, mockWebhookSecret);

      // Verify constructEvent was called
      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        mockPayload,
        mockSignature,
        mockWebhookSecret
      );
      // Verify that a mock *inside* the expected handler was called (as a proxy for the handler being called)
      expect(mockPrisma.tenant.findFirst).toHaveBeenCalled(); 
    });

    it('should throw error if signature verification fails', async () => {
      const verificationError = new Error('Signature verification failed');
      verificationError.type = 'StripeSignatureVerificationError';
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw verificationError;
      });

      await expect(
        paymentService.handleWebhookEvent(mockPayload, mockSignature, mockWebhookSecret)
      ).rejects.toThrow('Signature verification failed');
       expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledTimes(1);
    });

    it('should call handleCheckoutSessionCompleted for checkout.session.completed event', async () => {
        // Add amount_total and currency to the mock event data
        const mockEvent = { 
            id: 'evt_checkout', 
            type: 'checkout.session.completed', 
            data: { 
                object: { 
                    id: 'cs_test', 
                    customer: 'cus_1',
                    payment_status: 'paid',
                    amount_total: 59900,
                    currency: 'mxn',
                    payment_intent: 'pi_test_intent' // Add payment_intent ID
                }
            }
        };
        mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

        // Mock dependencies for the handler to run without error
        mockPrisma.tenant.findFirst.mockResolvedValue({ id: 't1' });
        mockPrisma.tenantSubscription.findFirst.mockResolvedValue({ id: 'sub1', tenantId: 't1', plan: { price: 599.00, currency: 'MXN'} });
        mockPrisma.tenantSubscription.update.mockResolvedValue({});
        mockPrisma.tenantPayment.create.mockResolvedValue({ id: 'p1' });
        mockStripe.paymentIntents.retrieve.mockResolvedValue({ payment_method: { type: 'card', card: { brand: 'visa' } } });
        mockPrisma.tenantUser.findMany.mockResolvedValue([]);

        await paymentService.handleWebhookEvent(mockPayload, mockSignature, mockWebhookSecret);

        // Verify a mock specific to this handler was called
        expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalled();
        // Verify other handlers' specific mocks were NOT called (if applicable)
        // e.g., expect(mockPrisma.tenant.update).not.toHaveBeenCalled(); // If tenant update is specific to another handler
    });

    it('should call handleInvoicePaymentSucceeded for invoice.payment_succeeded event', async () => {
        const mockEvent = { id: 'evt_invoice', type: 'invoice.payment_succeeded', data: { object: { id: 'in_test', subscription: 'sub_1', customer: 'cus_1', payment_intent: 'pi_1', amount_paid: 1000, currency: 'mxn' } } };
        const mockPayloadInvoice = '{"id": "evt_invoice", "type": "invoice.payment_succeeded"}'; // Payload matching the event type
        mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent);

        // Mock dependencies for the handler
        mockPrisma.tenantSubscription.findFirst.mockResolvedValue({ id: 'sub1', tenantId: 't1', tenant: { isActive: true } });
        mockPrisma.tenantPayment.create.mockResolvedValue({ id: 'p2' });
        mockPrisma.tenantSubscription.update.mockResolvedValue({});

        await paymentService.handleWebhookEvent(mockPayloadInvoice, mockSignature, mockWebhookSecret);

        // Verify a mock specific to this handler was called
        expect(mockPrisma.tenantPayment.create).toHaveBeenCalled();
        // Verify mocks specific to other handlers were NOT called
        expect(mockStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    });

  });

  // --- Tests for handleCheckoutSessionCompleted ---
  describe('handleCheckoutSessionCompleted', () => {
    const mockSession = {
      id: 'cs_test_123',
      payment_status: 'paid',
      customer: 'cus_test_customer',
      subscription: 'sub_test_subscription', // Can be null if link didn't create one
      amount_total: 59900, // Example: 599.00 MXN in cents
      currency: 'mxn',
      payment_intent: 'pi_test_intent',
      invoice: 'in_test_invoice', // Can be null
      metadata: {
        // Potentially useful metadata if you add it during session creation
      },
      payment_method_types: ['card']
    };

    const mockTenant = {
        id: 'tenant_abc',
        businessName: 'Test Business',
        stripeCustomerId: 'cus_test_customer',
        isActive: false, // Start as inactive
    };

    const mockPlan = {
        id: 'plan_xyz',
        price: 599.00, // Decimal type in Prisma
        currency: 'MXN',
    };

    const mockDbSubscription = {
        id: 'dbsub_123',
        tenantId: 'tenant_abc',
        planId: 'plan_xyz',
        status: 'payment_pending', // Expecting activation
        stripeSubscriptionId: null, // Might get updated
        plan: mockPlan, // Include nested plan data
    };
    
    const mockPaymentIntent = {
        id: 'pi_test_intent',
        payment_method: {
            id: 'pm_test',
            type: 'card',
            card: {
                brand: 'visa'
            }
        }
    };
    
    const mockAdminUser = {
        telegramId: '123456789'
    };

    it('should activate subscription, save payment, and send notification on successful checkout', async () => {
      // Arrange: Setup mock return values
      mockPrisma.tenant.findFirst.mockResolvedValue(mockTenant);
      mockPrisma.tenantSubscription.findFirst.mockResolvedValue(mockDbSubscription);
      mockPrisma.tenantSubscription.update.mockResolvedValue({ ...mockDbSubscription, status: 'active' }); // Simulate update result
      mockPrisma.tenantPayment.create.mockResolvedValue({ id: 'payment_record_1' }); // Simulate payment record creation
      mockStripe.paymentIntents.retrieve.mockResolvedValue(mockPaymentIntent); // Simulate PI retrieval
      mockPrisma.tenantUser.findMany.mockResolvedValue([mockAdminUser]); // Simulate finding admin user

      // Act: Call the handler
      const result = await paymentService.handleCheckoutSessionCompleted(mockSession);

      // Assert: Verify outcomes
      // 1. Tenant was searched correctly
      expect(mockPrisma.tenant.findFirst).toHaveBeenCalledWith({
        where: { stripeCustomerId: mockSession.customer },
      });

      // 2. Pending subscription was searched correctly
      expect(mockPrisma.tenantSubscription.findFirst).toHaveBeenCalledWith({
        where: { tenantId: mockTenant.id, status: 'payment_pending' },
        include: { plan: true }
      });

      // 3. Subscription was updated to active with correct dates
      expect(mockPrisma.tenantSubscription.update).toHaveBeenCalledWith({
        where: { id: mockDbSubscription.id },
        data: expect.objectContaining({
          status: 'active',
          stripeSubscriptionId: mockSession.subscription, // Ensure Stripe Sub ID is saved/updated
          currentPeriodStartsAt: expect.any(Date),
          currentPeriodEndsAt: expect.any(Date), // We trust calculateNextBillingDate for the exact value
          updatedAt: expect.any(Date),
        }),
      });

      // 4. Payment Intent was retrieved
      expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledWith(mockSession.payment_intent, { expand: ['payment_method'] });

      // 5. Payment was saved correctly
      expect(mockPrisma.tenantPayment.create).toHaveBeenCalledWith({
        data: {
          tenantId: mockTenant.id,
          subscriptionId: mockDbSubscription.id,
          stripePaymentId: mockSession.payment_intent,
          stripeInvoiceId: mockSession.invoice,
          amount: 599.00, // Check amount is correct base unit
          currency: 'MXN',
          paymentMethod: 'visa', // Check correct method/brand
          status: 'succeeded',
          paymentDate: expect.any(Date),
        },
      });
      
      // 6. Admin users were searched for notification
      expect(mockPrisma.tenantUser.findMany).toHaveBeenCalledWith({
          where: { tenantId: mockTenant.id, role: 'admin' },
          select: { telegramId: true }
      });

      // 7. Notification was sent
      expect(mockNotificationService.sendTelegramNotification).toHaveBeenCalledWith(
          mockAdminUser.telegramId.toString(), // Ensure it's a string if needed
          expect.stringContaining('¡Pago Confirmado!') // Check content basics
      );

      // 8. Result object is correct
      expect(result).toEqual(expect.objectContaining({
        success: true,
        action: 'subscription_activated',
        tenantId: mockTenant.id,
        subscriptionId: mockDbSubscription.id,
        paymentId: 'payment_record_1',
        notifyAdmins: true,
      }));
    });

    it('should ignore session if payment_status is not "paid"', async () => {
        const unpaidSession = { ...mockSession, payment_status: 'unpaid' };
        const result = await paymentService.handleCheckoutSessionCompleted(unpaidSession);
        expect(result).toEqual({ success: true, action: 'ignored', reason: 'payment_not_paid' });
        expect(mockPrisma.tenant.findFirst).not.toHaveBeenCalled();
        expect(mockPrisma.tenantSubscription.update).not.toHaveBeenCalled();
    });

    it('should return error if tenant is not found', async () => {
        mockPrisma.tenant.findFirst.mockResolvedValue(null); // Simulate tenant not found
        const result = await paymentService.handleCheckoutSessionCompleted(mockSession);
        expect(result).toEqual({ success: false, error: 'Tenant no encontrado' });
        expect(mockPrisma.tenantSubscription.findFirst).not.toHaveBeenCalled();
    });
    
    it('should ignore if no pending subscription is found for the tenant', async () => {
        mockPrisma.tenant.findFirst.mockResolvedValue(mockTenant);
        // Simulate findFirst returning null for BOTH pending and active checks in this specific test case
        mockPrisma.tenantSubscription.findFirst.mockResolvedValue(null); 

        const result = await paymentService.handleCheckoutSessionCompleted(mockSession);

        // It should check for pending first
        expect(mockPrisma.tenantSubscription.findFirst).toHaveBeenCalledWith({
            where: { tenantId: mockTenant.id, status: 'payment_pending' },
            include: { plan: true }
        });
        // Then it should check for recently active
         expect(mockPrisma.tenantSubscription.findFirst).toHaveBeenCalledWith({
            where: { tenantId: mockTenant.id, status: 'active' },
            orderBy: { updatedAt: 'desc' }
        });

        expect(result).toEqual({ success: true, action: 'ignored', reason: 'no_pending_subscription_found' });
        expect(mockPrisma.tenantSubscription.update).not.toHaveBeenCalled();
        expect(mockPrisma.tenantPayment.create).not.toHaveBeenCalled();
    });

    // Add more tests for:
    // - Amount/currency mismatch (if strict checking is desired)
    // - Failure to retrieve Payment Intent
    // - Failure during notification sending (should still succeed overall)
    // - Cases where session.subscription or session.invoice are null
  });

  // --- Tests for handleInvoicePaymentSucceeded ---
  describe('handleInvoicePaymentSucceeded', () => {
      // TODO: Add tests similar to handleCheckoutSessionCompleted but for invoice events
      // - Find subscription by stripeSubscriptionId
      // - Save payment
      // - Update subscription status/dates (especially if it was pending/suspended)
      // - Reactivate tenant if needed
  });

  // --- Tests for handleInvoicePaymentFailed ---
  describe('handleInvoicePaymentFailed', () => {
      // TODO: Add tests
      // - Find subscription
      // - Save failed payment record
      // - Update subscription status to payment_pending or suspended
      // - Deactivate tenant if suspended
      // - Send appropriate notification
  });

  // --- Tests for handleSubscriptionUpdated ---
  describe('handleSubscriptionUpdated', () => {
      // TODO: Add tests
      // - Find subscription
      // - Update status and dates
      // - Deactivate tenant if status becomes suspended
      // - Reactivate tenant if status becomes active from suspended
  });

  // --- Tests for handleSubscriptionDeleted ---
  describe('handleSubscriptionDeleted', () => {
      // TODO: Add tests
      // - Find subscription
      // - Update status to cancelled
      // - (Optional) Deactivate tenant based on business rules
  });

});
