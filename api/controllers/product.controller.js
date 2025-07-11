// api/controllers/product.controller.js
/**
 * Controlador para operaciones relacionadas con productos
 */
class ProductController {
  /**
   * Crea un nuevo producto
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async createProduct(req, res, next) {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      // Validación básica
      const { description, product_key, price } = req.body;

      if (!description || !product_key || price === undefined) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requieren los campos description, product_key y price',
        });
      }

      // Simulación de creación de producto
      const product = {
        id: `prod_${Date.now()}`,
        description,
        product_key,
        price: parseFloat(price),
        created_at: new Date().toISOString(),
      };

      res.status(201).json(product);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lista todos los productos
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async listProducts(req, res, next) {
    try {
      const tenantId = req.tenant?.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      // Parámetros de paginación
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;

      // Simulación de listado de productos
      const products = [
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

      res.json({
        data: products,
        pagination: {
          total: products.length,
          page,
          limit,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Obtiene un producto por su ID
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async getProduct(req, res, next) {
    try {
      const tenantId = req.tenant?.id;
      const productId = req.params.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      if (!productId) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID del producto',
        });
      }

      // Simulación de producto
      const product = {
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
      next(error);
    }
  }

  /**
   * Actualiza un producto existente
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async updateProduct(req, res, next) {
    try {
      const tenantId = req.tenant?.id;
      const productId = req.params.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      if (!productId) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID del producto',
        });
      }

      // Simulación de actualización
      const updatedProduct = {
        id: productId,
        ...req.body,
        updated_at: new Date().toISOString(),
      };

      res.json(updatedProduct);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Elimina un producto
   * @param {Object} req - Request de Express
   * @param {Object} res - Response de Express
   * @param {Function} next - Función next de Express
   */
  async deleteProduct(req, res, next) {
    try {
      const tenantId = req.tenant?.id;
      const productId = req.params.id;

      if (!tenantId) {
        return res.status(401).json({
          error: 'UnauthorizedError',
          message: 'Se requiere un tenant válido para esta operación',
        });
      }

      if (!productId) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Se requiere el ID del producto',
        });
      }

      // Simulación de eliminación
      res.json({
        success: true,
        message: `Producto ${productId} eliminado correctamente`,
      });
    } catch (error) {
      next(error);
    }
  }
}

// Crear instancia del controlador
const productController = new ProductController();

export default productController;
