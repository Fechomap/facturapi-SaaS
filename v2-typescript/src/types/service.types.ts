/**
 * Service-related types and interfaces
 */

/**
 * FacturAPI Invoice Data
 */
export interface InvoiceData {
  customer: {
    legal_name: string;
    tax_id: string;
    email: string;
    address?: {
      zip: string;
    };
  };
  items: InvoiceItem[];
  payment_form: string;
  use?: string;
  folio_number?: number;
  series?: string;
}

/**
 * FacturAPI Invoice Item
 */
export interface InvoiceItem {
  product: {
    description: string;
    product_key: string;
    price: number;
    sku?: string;
  };
  quantity: number;
  discount?: number;
  tax_included?: boolean;
}

/**
 * FacturAPI Customer Data
 */
export interface CustomerData {
  legal_name: string;
  tax_id: string;
  email: string;
  phone?: string;
  address?: {
    street?: string;
    exterior?: string;
    interior?: string;
    neighborhood?: string;
    city?: string;
    municipality?: string;
    zip: string;
    state?: string;
    country?: string;
  };
}

/**
 * PDF Analysis Result
 */
export interface PdfAnalysisResult {
  success: boolean;
  text?: string;
  lines?: string[];
  metadata?: {
    pages: number;
    size: number;
    format?: string;
  };
  error?: string;
}

/**
 * Parsed Invoice Data from PDF
 */
export interface ParsedInvoiceData {
  customerName?: string;
  taxId?: string;
  amount?: number;
  description?: string;
  items?: Array<{
    description: string;
    quantity: number;
    price: number;
  }>;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Notification Data
 */
export interface NotificationData {
  tenantId: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Queue Job Data
 */
export interface QueueJobData {
  type: string;
  payload: Record<string, unknown>;
  tenantId?: string;
  retries?: number;
}

/**
 * Subscription Data
 */
export interface SubscriptionData {
  tenantId: string;
  planId: string;
  status: 'active' | 'inactive' | 'suspended' | 'cancelled';
  startDate: Date;
  endDate?: Date;
}

/**
 * Tenant Configuration
 */
export interface TenantConfig {
  id: string;
  apiKey: string;
  organizationId: string;
  name: string;
  email: string;
  isActive: boolean;
  settings?: {
    autoInvoicing?: boolean;
    defaultPaymentForm?: string;
    defaultSeries?: string;
    notifications?: {
      email?: boolean;
      telegram?: boolean;
    };
  };
}

/**
 * Service Response
 */
export interface ServiceResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}
