/**
 * Validation Middleware
 * Request data validation
 */

import { Response, NextFunction } from 'express';
import type { TenantRequest } from '../../types/api.types.js';

interface ValidationResult {
  error?: string;
  value: unknown;
}

type ValidationSchema = (data: unknown) => ValidationResult;

function validateRequest(schema: ValidationSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: TenantRequest, res: Response, next: NextFunction): void => {
    const data = req[source];

    if (!schema || !data) {
      return next();
    }

    try {
      const { error, value } = schema(data);

      if (error) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid input data',
          details: error,
        });
        return;
      }

      req[source] = value;
      next();
    } catch (error) {
      res.status(500).json({
        error: 'ValidationError',
        message: 'Error validating input data',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}

function createInvoiceSchema(data: unknown): ValidationResult {
  const invoiceData = data as Record<string, unknown>;
  const requiredFields = ['customer', 'items', 'use', 'payment_form', 'payment_method'];
  const missingFields = requiredFields.filter((field) => !invoiceData[field]);

  if (missingFields.length > 0) {
    return {
      error: `Missing required fields: ${missingFields.join(', ')}`,
      value: data,
    };
  }

  if (!Array.isArray(invoiceData.items) || invoiceData.items.length === 0) {
    return {
      error: 'Field "items" must be a non-empty array',
      value: data,
    };
  }

  return { value: data };
}

export { validateRequest, createInvoiceSchema };
