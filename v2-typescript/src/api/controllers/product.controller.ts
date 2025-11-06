/**
 * Product Controller
 * Controller for product-related operations
 */

import type { Response, NextFunction } from 'express';
import { createModuleLogger } from '@core/utils/logger.js';
import type { TenantRequest } from '../../types/api.types.js';

const logger = createModuleLogger('product-controller');

// Types for product controller
interface CreateProductBody {
  description: string;
  product_key: string;
  price: number;
  unit_key?: string;
  unit_name?: string;
  tax_included?: boolean;
  taxes?: ProductTax[];
}

interface UpdateProductBody {
  description?: string;
  product_key?: string;
  price?: number;
  unit_key?: string;
  unit_name?: string;
  tax_included?: boolean;
  taxes?: ProductTax[];
  [key: string]: unknown;
}

interface ProductTax {
  type: string;
  rate: number;
  factor: string;
}

interface Product {
  id: string;
  description: string;
  product_key: string;
  price: number;
  unit_key?: string;
  unit_name?: string;
  tax_included?: boolean;
  taxes?: ProductTax[];
  created_at?: string;
  updated_at?: string;
}

interface ProductListResponse {
  data: Product[];
  pagination: {
    total: number;
    page: number;
    limit: number;
  };
}

interface DeleteProductResponse {
  success: boolean;
  message: string;
}

/**
 * Controller for product-related operations
 */
class ProductController {
  /**
   * Creates a new product
   */
  async createProduct(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      // Basic validation
      const { description, product_key, price } = req.body as CreateProductBody;

      if (!description || !product_key || price === undefined) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requieren los campos description, product_key y price',
        });
        return;
      }

      // Product creation simulation
      const product: Product = {
        id: `prod_${Date.now()}`,
        description,
        product_key,
        price: parseFloat(price.toString()),
        created_at: new Date().toISOString(),
      };

      logger.info({ tenantId, productId: product.id }, 'Product created');

      res.status(201).json(product);
    } catch (error) {
      logger.error({ error }, 'Error creating product');
      next(error);
    }
  }

  /**
   * Lists all products
   */
  async listProducts(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      // Pagination parameters
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      logger.debug({ tenantId, page, limit }, 'Listing products');

      // Product listing simulation
      const products: Product[] = [
        {
          id: 'prod_1',
          description: 'Producto de ejemplo 1',
          product_key: '01010101',
          price: 100,
        },
        {
          id: 'prod_2',
          description: 'Producto de ejemplo 2',
          product_key: '43211509',
          price: 200,
        },
      ];

      const response: ProductListResponse = {
        data: products,
        pagination: {
          total: products.length,
          page,
          limit,
        },
      };

      res.json(response);
    } catch (error) {
      logger.error({ error }, 'Error listing products');
      next(error);
    }
  }

  /**
   * Gets a product by its ID
   */
  async getProduct(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;
      const productId = req.params.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      if (!productId) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID del producto',
        });
        return;
      }

      logger.debug({ tenantId, productId }, 'Getting product');

      // Product simulation
      const product: Product = {
        id: productId,
        description: 'Producto de ejemplo',
        product_key: '01010101',
        unit_key: 'E48',
        unit_name: 'SERVICIO',
        price: 100,
        tax_included: false,
        taxes: [
          {
            type: 'IVA',
            rate: 0.16,
            factor: 'Tasa',
          },
        ],
      };

      res.json(product);
    } catch (error) {
      logger.error({ error }, 'Error getting product');
      next(error);
    }
  }

  /**
   * Updates an existing product
   */
  async updateProduct(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;
      const productId = req.params.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      if (!productId) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID del producto',
        });
        return;
      }

      logger.debug({ tenantId, productId }, 'Updating product');

      const updateData = req.body as UpdateProductBody;

      // Update simulation
      const updatedProduct: Product = {
        id: productId,
        description: updateData.description || 'Producto actualizado',
        product_key: updateData.product_key || '01010101',
        price: updateData.price || 100,
        updated_at: new Date().toISOString(),
      };

      logger.info({ tenantId, productId }, 'Product updated');

      res.json(updatedProduct);
    } catch (error) {
      logger.error({ error }, 'Error updating product');
      next(error);
    }
  }

  /**
   * Deletes a product
   */
  async deleteProduct(req: TenantRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tenantId = req.tenant?.id;
      const productId = req.params.id;

      if (!tenantId) {
        res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
        return;
      }

      if (!productId) {
        res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID del producto',
        });
        return;
      }

      logger.debug({ tenantId, productId }, 'Deleting product');

      // Delete simulation
      const response: DeleteProductResponse = {
        success: true,
        message: `Producto ${productId} eliminado correctamente`,
      };

      logger.info({ tenantId, productId }, 'Product deleted');

      res.json(response);
    } catch (error) {
      logger.error({ error }, 'Error deleting product');
      next(error);
    }
  }
}

// Create controller instance
const productController = new ProductController();

export default productController;
