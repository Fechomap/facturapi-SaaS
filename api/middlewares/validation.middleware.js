// api/middlewares/validation.middleware.js
/**
 * Crea un middleware para validar datos de entrada según esquema
 * @param {Function} schema - Función de validación que recibe data y retorna {error, value}
 * @param {string} source - Fuente de datos a validar ('body', 'query', 'params')
 * @returns {Function} - Middleware Express
 */
function validateRequest(schema, source = 'body') {
    return (req, res, next) => {
      const data = req[source];
      
      // Si no hay esquema o datos, continuar
      if (!schema || !data) {
        return next();
      }
      
      try {
        // Validar datos (implementación básica, puede expandirse con bibliotecas como Joi o Zod)
        const { error, value } = schema(data);
        
        // Si hay error, devolver respuesta de error
        if (error) {
          return res.status(400).json({
            error: 'ValidationError',
            message: 'Datos de entrada inválidos',
            details: error
          });
        }
        
        // Reemplazar datos con los validados
        req[source] = value;
        next();
      } catch (error) {
        // Error en la validación
        res.status(500).json({
          error: 'ValidationError',
          message: 'Error al validar datos de entrada',
          details: error.message
        });
      }
    };
  }
  
  // Ejemplo de un esquema básico
  function createInvoiceSchema(data) {
    // Verificar campos requeridos
    const requiredFields = ['customer', 'items', 'use', 'payment_form', 'payment_method'];
    const missingFields = requiredFields.filter(field => !data[field]);
    
    if (missingFields.length > 0) {
      return {
        error: `Campos requeridos faltantes: ${missingFields.join(', ')}`,
        value: data
      };
    }
    
    // Validar que items sea un array no vacío
    if (!Array.isArray(data.items) || data.items.length === 0) {
      return {
        error: 'El campo "items" debe ser un array no vacío',
        value: data
      };
    }
    
    // Si todo está bien, retornar valor sin error
    return { value: data };
  }
  
  export { 
    validateRequest,
    createInvoiceSchema
  };