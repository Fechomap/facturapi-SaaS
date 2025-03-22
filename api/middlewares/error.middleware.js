// api/middlewares/error.middleware.js
/**
 * Middleware para manejo centralizado de errores
 */
function errorMiddleware(err, req, res, next) {
    // Si ya se envió una respuesta, pasar al siguiente middleware
    if (res.headersSent) {
      return next(err);
    }
  
    console.error('Error en la API:', err);
    
    // Errores específicos de FacturAPI
    if (err.response && err.response.data) {
      return res.status(err.response.status || 400).json({
        error: err.message,
        details: err.response.data
      });
    }
    
    // Determinar código de estado basado en el tipo de error
    let statusCode = 500;
    if (err.statusCode) {
      statusCode = err.statusCode;
    } else if (err.name === 'ValidationError') {
      statusCode = 400;
    } else if (err.name === 'UnauthorizedError') {
      statusCode = 401;
    } else if (err.name === 'ForbiddenError') {
      statusCode = 403;
    } else if (err.name === 'NotFoundError') {
      statusCode = 404;
    }
  
    // Respuesta de error
    res.status(statusCode).json({
      error: err.name || 'Error',
      message: err.message || 'Ha ocurrido un error inesperado',
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
  
  export default errorMiddleware;