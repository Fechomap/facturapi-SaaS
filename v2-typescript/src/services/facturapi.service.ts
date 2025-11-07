/**
 * FacturAPI Service
 * Multi-tenant service for FacturAPI integration
 */

import { prisma } from '@config/database.js';
import { createModuleLogger } from '@core/utils/logger.js';
import axios from 'axios';
import Facturapi from 'facturapi';
const FacturapiConstructor = (Facturapi as any).default || Facturapi;
import type { Tenant } from '@prisma/client';

const logger = createModuleLogger('FacturapiService');

// Cache for FacturAPI clients
interface ClientCacheEntry {
  client: Facturapi;
  timestamp: number;
}

const clientCache = new Map<string, ClientCacheEntry>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface OrganizationInfo {
  legal: unknown;
  customization: unknown;
}

interface ConnectionTestResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: Error;
}

interface TaxCalculation {
  base: number;
  iva: number;
  retencion: number;
  total: number;
  taxesArray: TaxItem[];
}

interface TaxItem {
  base: number;
  type: string;
  factor: string;
  rate: number;
  withholding: boolean;
}

interface BalanceCalculation {
  totalPagado: number;
  saldoPendiente: number;
}

interface Payment {
  amount: number;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface RelatedDocument {
  uuid: string;
  amount: number;
  installment: number;
  last_balance: number;
  taxes: TaxItem[];
}

interface PaymentComplementData {
  customer: string | Record<string, unknown>;
  payment_form: string;
  date?: string;
  related_documents: RelatedDocument[];
}

interface SimplePaymentParams {
  customer: string | Record<string, unknown>;
  payment_form: string;
  invoice_uuid: string;
  amount: number;
  installment?: number;
  last_balance: number;
  tax_rate?: number;
  retention_rate?: number;
  include_retention?: boolean;
  date?: string;
}

interface InvoicePaymentData {
  uuid: string;
  amount: number;
  installment?: number;
  last_balance: number;
  tax_rate?: number;
  retention_rate?: number;
  include_retention?: boolean;
}

interface MultipleInvoicesPaymentParams {
  customer: string | Record<string, unknown>;
  payment_form: string;
  date?: string;
  invoices: InvoicePaymentData[];
}

interface PaymentComplementResult {
  success: boolean;
  data?: unknown;
  error?: string;
  uuid?: string;
  pagoData?: PaymentComplementData;
}

/**
 * FacturAPI Service Class
 * Handles all interactions with FacturAPI in multi-tenant mode
 */
class FacturapiService {
  /**
   * Get FacturAPI client instance for a specific tenant
   */
  static async getFacturapiClient(tenantId: string): Promise<Facturapi> {
    try {
      // Check cache
      const cacheKey = tenantId;
      const cached = clientCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        logger.debug({ tenantId }, 'FacturAPI client obtained from cache');
        return cached.client;
      }

      // Get tenant and credentials
      const tenant: Tenant | null = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!tenant) {
        logger.error({ tenantId }, 'Tenant not found');
        throw new Error('Tenant not found');
      }

      if (!tenant.facturapiApiKey) {
        logger.error(
          { tenantId, businessName: tenant.businessName },
          'Tenant has no API key configured'
        );
        throw new Error(
          'Tenant does not have an API key configured. Please contact the administrator.'
        );
      }

      const apiKey = tenant.facturapiApiKey;

      // Validate API key format
      if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10) {
        logger.error({ tenantId, apiKeyLength: apiKey?.length }, 'Invalid API key');
        throw new Error('Invalid tenant API key');
      }

      try {
        // Create instance with API key
        logger.debug(
          { tenantId, apiKeyPrefix: apiKey.substring(0, 10) },
          'Creating FacturAPI client'
        );
        const client = new FacturapiConstructor(apiKey);

        // Save to cache
        clientCache.set(cacheKey, {
          client,
          timestamp: Date.now(),
        });

        logger.info(
          { tenantId, businessName: tenant.businessName },
          'FacturAPI client created and cached successfully'
        );
        return client;
      } catch (error: any) {
        logger.error(
          {
            tenantId,
            errorMessage: error?.message,
            errorName: error?.name,
            errorStack: error?.stack,
            apiKeyPrefix: apiKey?.substring(0, 10),
          },
          'Error creating FacturAPI client'
        );
        throw new Error(
          `Error creating FacturAPI client: ${error instanceof Error ? error.message : JSON.stringify(error)}`
        );
      }
    } catch (error) {
      logger.error({ tenantId, error }, 'Error in getFacturapiClient');
      throw error;
    }
  }

  /**
   * Get organization information
   */
  static async getOrganizationInfo(tenantId: string): Promise<OrganizationInfo> {
    try {
      const facturapi = await this.getFacturapiClient(tenantId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const legal = await (facturapi.organizations as any).getLegal();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customization = await (facturapi.organizations as any).getCustomization();

      return {
        legal,
        customization,
      };
    } catch (error) {
      logger.error({ tenantId, error }, 'Error getting organization info');
      throw error;
    }
  }

  /**
   * Get SAT catalogs
   */
  static async getCatalog(tenantId: string, catalogType: string): Promise<unknown> {
    try {
      const facturapi = await this.getFacturapiClient(tenantId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const catalogs = facturapi.catalogs as any;

      switch (catalogType) {
        case 'products':
          return catalogs.getProducts();
        case 'units':
          return catalogs.getUnits();
        case 'payment_forms':
          return catalogs.getPaymentForms();
        case 'payment_methods':
          return catalogs.getPaymentMethods();
        case 'cfdi_uses':
          return catalogs.getCfdiUses();
        case 'tax_types':
          return catalogs.getTaxTypes();
        default:
          throw new Error(`Unsupported catalog type: ${catalogType}`);
      }
    } catch (error) {
      logger.error({ tenantId, catalogType, error }, 'Error getting catalog');
      throw error;
    }
  }

  /**
   * Test connection to FacturAPI
   */
  static async testConnection(tenantId: string): Promise<ConnectionTestResult> {
    try {
      const facturapi = await this.getFacturapiClient(tenantId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const products = await (facturapi.catalogs as any).getProducts();

      return {
        success: true,
        message: 'Connection established successfully with FacturAPI',
        data: { products_count: (products as unknown[]).length },
      };
    } catch (error) {
      logger.error({ tenantId, error }, 'Error testing connection');
      return {
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: error as Error,
      };
    }
  }

  /**
   * Update organization legal information
   */
  static async updateOrganizationLegal(
    organizationId: string,
    legalData: Record<string, unknown>
  ): Promise<unknown> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      if (!legalData || typeof legalData !== 'object') {
        throw new Error('Legal data must be a valid object');
      }

      const dataToSend = {
        name: legalData.name || legalData.legal_name,
        legal_name: legalData.legal_name,
        tax_system: legalData.tax_system || '601',
        phone: legalData.phone || '',
        website: legalData.website || '',
        address: {},
      };

      if (legalData.address && typeof legalData.address === 'object') {
        const addr = legalData.address as Record<string, unknown>;
        dataToSend.address = {
          street: addr.street || '',
          exterior: addr.exterior || '',
          interior: addr.interior || '',
          neighborhood: addr.neighborhood || '',
          zip: addr.zip || '',
          city: addr.city || '',
          municipality: addr.municipality || '',
          state: addr.state || '',
        };
      }

      const FACTURAPI_USER_KEY = process.env.FACTURAPI_USER_KEY;
      if (!FACTURAPI_USER_KEY) {
        throw new Error('FACTURAPI_USER_KEY is not configured in environment variables');
      }

      const response = await axios({
        method: 'PUT',
        url: `https://www.facturapi.io/v2/organizations/${organizationId}/legal`,
        headers: {
          Authorization: `Bearer ${FACTURAPI_USER_KEY}`,
          'Content-Type': 'application/json',
        },
        data: dataToSend,
      });

      return response.data;
    } catch (error) {
      logger.error({ organizationId, error }, 'Error updating legal data');
      throw error;
    }
  }

  /**
   * Clear client cache for specific tenant
   */
  static clearClientCache(tenantId: string): void {
    const cacheKey = tenantId;
    if (clientCache.has(cacheKey)) {
      clientCache.delete(cacheKey);
      logger.info({ tenantId }, 'Cache cleared for tenant');
    }
  }

  // ========== PAYMENT COMPLEMENT METHODS (TYPE "P") ==========

  /**
   * Calculate tax base and amounts from total amount
   */
  static calcularImpuestos(
    montoTotal: number,
    tasaIVA = 0.16,
    tasaRetencion = 0.04,
    incluirRetencion = true
  ): TaxCalculation {
    const base = montoTotal / (1 + tasaIVA);
    const iva = montoTotal - base;
    const retencion = incluirRetencion ? base * tasaRetencion : 0;

    const taxesArray: TaxItem[] = [
      {
        base: parseFloat(base.toFixed(2)),
        type: 'IVA',
        factor: 'Tasa',
        rate: tasaIVA,
        withholding: false,
      },
    ];

    if (incluirRetencion) {
      taxesArray.push({
        base: parseFloat(base.toFixed(2)),
        type: 'IVA',
        factor: 'Tasa',
        rate: tasaRetencion,
        withholding: true,
      });
    }

    return {
      base: parseFloat(base.toFixed(2)),
      iva: parseFloat(iva.toFixed(2)),
      retencion: parseFloat(retencion.toFixed(2)),
      total: parseFloat(montoTotal.toFixed(2)),
      taxesArray,
    };
  }

  /**
   * Calculate pending balance after previous payments
   */
  static calcularSaldos(totalFactura: number, pagosAnteriores: Payment[] = []): BalanceCalculation {
    const totalPagado = pagosAnteriores.reduce((sum, pago) => sum + pago.amount, 0);
    const saldoPendiente = totalFactura - totalPagado;

    return {
      totalPagado: parseFloat(totalPagado.toFixed(2)),
      saldoPendiente: parseFloat(saldoPendiente.toFixed(2)),
    };
  }

  /**
   * Validate payment complement data
   */
  static validarComplementoPago(pagoData: PaymentComplementData): ValidationResult {
    const errors: string[] = [];

    if (!pagoData.customer) {
      errors.push('Customer field is required');
    }

    if (!pagoData.payment_form) {
      errors.push('Payment form field is required');
    }

    if (!pagoData.related_documents || !Array.isArray(pagoData.related_documents)) {
      errors.push('Related documents must be an array');
    } else if (pagoData.related_documents.length === 0) {
      errors.push('Must include at least one invoice in related_documents');
    } else {
      pagoData.related_documents.forEach((doc, index) => {
        if (!doc.uuid) {
          errors.push(`Document ${index + 1}: missing uuid field`);
        }
        if (!doc.amount || doc.amount <= 0) {
          errors.push(`Document ${index + 1}: amount must be greater than 0`);
        }
        if (!doc.installment || doc.installment < 1) {
          errors.push(`Document ${index + 1}: installment must be >= 1`);
        }
        if (!doc.last_balance || doc.last_balance <= 0) {
          errors.push(`Document ${index + 1}: last_balance must be greater than 0`);
        }
        if (doc.amount > doc.last_balance) {
          errors.push(
            `Document ${index + 1}: payment amount (${doc.amount}) cannot be greater than pending balance (${doc.last_balance})`
          );
        }
        if (!doc.taxes || !Array.isArray(doc.taxes) || doc.taxes.length === 0) {
          errors.push(`Document ${index + 1}: must include at least one tax in taxes array`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Create payment complement (CFDI type "P")
   */
  static async createPaymentComplement(
    tenantId: string,
    pagoData: PaymentComplementData
  ): Promise<unknown> {
    try {
      const validacion = this.validarComplementoPago(pagoData);
      if (!validacion.valid) {
        logger.error(
          { tenantId, errors: validacion.errors },
          'Payment complement validation errors'
        );
        throw new Error(`Invalid data: ${validacion.errors.join(', ')}`);
      }

      const facturapi = await this.getFacturapiClient(tenantId);

      const complementoPago = {
        type: 'P',
        customer: pagoData.customer,
        complements: [
          {
            type: 'pago',
            data: [
              {
                date: pagoData.date || new Date().toISOString(),
                payment_form: pagoData.payment_form,
                related_documents: pagoData.related_documents,
              },
            ],
          },
        ],
      };

      logger.info({ tenantId }, 'Creating payment complement');
      const resultado = await facturapi.invoices.create(complementoPago);

      logger.info(
        {
          tenantId,
          uuid:
            (resultado as { id?: string; uuid?: string }).id ||
            (resultado as { id?: string; uuid?: string }).uuid,
        },
        'Payment complement created successfully'
      );

      return resultado;
    } catch (error) {
      logger.error({ tenantId, error }, 'Error creating payment complement');
      throw error;
    }
  }

  /**
   * Create simple payment complement (single invoice, full payment)
   */
  static async createSimplePaymentComplement(
    tenantId: string,
    params: SimplePaymentParams
  ): Promise<unknown> {
    try {
      const {
        customer,
        payment_form,
        invoice_uuid,
        amount,
        installment = 1,
        last_balance,
        tax_rate = 0.16,
        retention_rate = 0.04,
        include_retention = true,
        date,
      } = params;

      const { taxesArray } = this.calcularImpuestos(
        amount,
        tax_rate,
        retention_rate,
        include_retention
      );

      const pagoData: PaymentComplementData = {
        customer,
        payment_form,
        date: date || new Date().toISOString(),
        related_documents: [
          {
            uuid: invoice_uuid,
            amount: parseFloat(amount.toFixed(2)),
            installment,
            last_balance: parseFloat(last_balance.toFixed(2)),
            taxes: taxesArray,
          },
        ],
      };

      return await this.createPaymentComplement(tenantId, pagoData);
    } catch (error) {
      logger.error({ tenantId, error }, 'Error creating simple payment complement');
      throw error;
    }
  }

  /**
   * Create payment complement for multiple invoices
   */
  static async createMultipleInvoicesPaymentComplement(
    tenantId: string,
    params: MultipleInvoicesPaymentParams
  ): Promise<unknown> {
    try {
      const { customer, payment_form, invoices, date } = params;

      if (!invoices || invoices.length === 0) {
        throw new Error('Must provide at least one invoice to pay');
      }

      const related_documents: RelatedDocument[] = invoices.map((invoice) => {
        const tax_rate = invoice.tax_rate || 0.16;
        const retention_rate = invoice.retention_rate || 0.04;
        const include_retention =
          invoice.include_retention !== undefined ? invoice.include_retention : true;

        const { taxesArray } = this.calcularImpuestos(
          invoice.amount,
          tax_rate,
          retention_rate,
          include_retention
        );

        return {
          uuid: invoice.uuid,
          amount: parseFloat(invoice.amount.toFixed(2)),
          installment: invoice.installment || 1,
          last_balance: parseFloat(invoice.last_balance.toFixed(2)),
          taxes: taxesArray,
        };
      });

      const pagoData: PaymentComplementData = {
        customer,
        payment_form,
        date: date || new Date().toISOString(),
        related_documents,
      };

      return await this.createPaymentComplement(tenantId, pagoData);
    } catch (error) {
      logger.error({ tenantId, error }, 'Error creating multiple invoices payment complement');
      throw error;
    }
  }

  /**
   * Create multiple payment complements in batch
   */
  static async createMultiplePaymentComplements(
    tenantId: string,
    pagosData: PaymentComplementData[]
  ): Promise<PaymentComplementResult[]> {
    const results: PaymentComplementResult[] = [];

    for (const pagoData of pagosData) {
      try {
        const result = await this.createPaymentComplement(tenantId, pagoData);
        results.push({
          success: true,
          data: result,
          uuid:
            (result as { id?: string; uuid?: string }).id ||
            (result as { id?: string; uuid?: string }).uuid,
        });
      } catch (error) {
        results.push({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          pagoData,
        });
      }
    }

    const exitosos = results.filter((r) => r.success).length;
    const fallidos = results.filter((r) => !r.success).length;

    logger.info({ tenantId, exitosos, fallidos }, 'Batch payment complements processing completed');

    return results;
  }
}

export default FacturapiService;
