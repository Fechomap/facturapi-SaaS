/**
 * API-related types and interfaces
 */

import { Request, Response } from 'express';

/**
 * Extended Express Request with tenant context
 */
export interface TenantRequest extends Request {
  tenant?: {
    id: string;
    businessName: string;
    email: string;
    isActive: boolean;
    facturapiApiKey: string | null;
  };
  user?: {
    id: string | number;
    telegramId?: number;
    username?: string;
    email?: string;
    role?: string;
    tenantId?: string;
  };
  getApiKey?: () => Promise<string>;
}

/**
 * Standard API Response structure
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  offset?: number;
}

/**
 * Filter parameters for list endpoints
 */
export interface FilterParams {
  search?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Sort parameters
 */
export interface SortParams {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Combined query parameters
 */
export interface QueryParams extends PaginationParams, FilterParams, SortParams {}

/**
 * Error response details
 */
export interface ErrorDetails {
  code: string;
  message: string;
  field?: string;
  value?: unknown;
}

/**
 * API middleware types
 */
export type AsyncRequestHandler = (
  req: TenantRequest,
  res: Response,
  next: (err?: Error) => void
) => Promise<void>;

export type RequestHandler = (
  req: TenantRequest,
  res: Response,
  next: (err?: Error) => void
) => void;
