// lib/mcpClient.js
/**
 * Cliente para comunicarse con el servidor MCP de Stripe
 * 
 * Este archivo proporciona funciones para interactuar con el servidor MCP
 * que expone las herramientas de Stripe a través del Model Context Protocol.
 */

import axios from 'axios';
import logger from '../core/utils/logger.js';

// Logger específico para el cliente MCP
const mcpLogger = logger.child({ module: 'mcp-client' });

/**
 * Configuración del cliente MCP
 */
const MCP_CONFIG = {
  // URL base del servidor MCP (puede ser sobreescrita por variables de entorno)
  baseUrl: process.env.MCP_SERVER_URL || 'http://localhost:3000/mcp',
  // Nombre del servidor MCP de Stripe
  serverName: process.env.MCP_STRIPE_SERVER_NAME || 'github.com/stripe/agent-toolkit',
  // Tiempo de espera para las solicitudes en milisegundos
  timeout: parseInt(process.env.MCP_REQUEST_TIMEOUT || '10000', 10)
};

// Registrar la configuración para depuración
mcpLogger.info({ 
  baseUrl: MCP_CONFIG.baseUrl,
  serverName: MCP_CONFIG.serverName,
  timeout: MCP_CONFIG.timeout
}, 'Configuración del cliente MCP');

/**
 * Llama a una herramienta del servidor MCP de Stripe
 * @param {string} toolName - Nombre de la herramienta a llamar (ej: 'create_customer', 'create_payment_link')
 * @param {object} args - Argumentos para la herramienta
 * @returns {Promise<object>} - Respuesta de la herramienta
 */
export async function callStripeMcpTool(toolName, args) {
  mcpLogger.info({ toolName, args }, `Llamando a herramienta MCP: ${toolName}`);
  
  try {
    // Configurar la solicitud
    const requestConfig = {
      timeout: MCP_CONFIG.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    // Preparar el cuerpo de la solicitud según el formato MCP
    const requestBody = {
      server_name: MCP_CONFIG.serverName,
      tool_name: toolName,
      arguments: args
    };
    
    // Realizar la solicitud al servidor MCP
    const response = await axios.post(
      `${MCP_CONFIG.baseUrl}/stripe`, 
      requestBody,
      requestConfig
    );
    
    // Verificar si la respuesta contiene un error
    if (response.data.error) {
      throw new Error(`Error en MCP: ${response.data.error}`);
    }
    
    mcpLogger.info({ toolName, responseStatus: response.status }, 'Respuesta de MCP recibida correctamente');
    return response.data;
    
  } catch (error) {
    // Manejar errores de red o del servidor MCP
    if (error.response) {
      // El servidor respondió con un código de estado fuera del rango 2xx
      mcpLogger.error({ 
        toolName, 
        statusCode: error.response.status,
        responseData: error.response.data
      }, `Error en respuesta MCP: ${error.message}`);
    } else if (error.request) {
      // La solicitud se realizó pero no se recibió respuesta
      mcpLogger.error({ 
        toolName, 
        timeout: MCP_CONFIG.timeout
      }, `No se recibió respuesta del servidor MCP: ${error.message}`);
    } else {
      // Error al configurar la solicitud
      mcpLogger.error({ 
        toolName, 
        error: error.message
      }, `Error al configurar solicitud MCP: ${error.message}`);
    }
    
    throw error;
  }
}

/**
 * Verifica la conexión con el servidor MCP
 * @returns {Promise<boolean>} - true si la conexión es exitosa, false en caso contrario
 */
export async function checkMcpConnection() {
  // Lista de URLs a probar
  const urlsToTry = [
    `${MCP_CONFIG.baseUrl}/stripe`,
    `${MCP_CONFIG.baseUrl}`,
    'http://localhost:3000/stripe',
    'http://localhost:3000/mcp/stripe',
    'http://localhost:3000'
  ];
  
  // Intentar cada URL
  for (const url of urlsToTry) {
    try {
      mcpLogger.info({ url }, `Intentando conectar a: ${url}`);
      
  // Intentar una solicitud POST simple con un tool_name que debería existir
      const testResponse = await axios.post(
        url,
        {
          server_name: MCP_CONFIG.serverName,
          tool_name: 'products.read', // Nombre correcto de la herramienta
          arguments: { limit: 1 }
        },
        {
          timeout: MCP_CONFIG.timeout,
          validateStatus: status => status < 500 // Aceptar cualquier respuesta que no sea error del servidor
        }
      );
      
      // Si recibimos una respuesta (incluso un error 4xx), significa que el servidor está en ejecución
      mcpLogger.info({ url, statusCode: testResponse.status }, 'Conexión con servidor MCP verificada');
      
      // Actualizar la URL base si encontramos una que funciona
      if (url !== `${MCP_CONFIG.baseUrl}/stripe`) {
        mcpLogger.info({ oldUrl: MCP_CONFIG.baseUrl, newUrl: url.replace('/stripe', '') }, 'Actualizando URL base del servidor MCP');
        MCP_CONFIG.baseUrl = url.replace('/stripe', '');
      }
      
      return true;
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        mcpLogger.error({ url, error: error.message, code: error.code }, 'No se pudo conectar al servidor MCP: Conexión rechazada');
      } else if (error.code === 'ETIMEDOUT') {
        mcpLogger.error({ url, error: error.message, code: error.code }, 'No se pudo conectar al servidor MCP: Tiempo de espera agotado');
      } else if (error.response) {
        mcpLogger.error({ 
          url,
          error: error.message, 
          statusCode: error.response.status,
          data: error.response.data
        }, 'Error en respuesta del servidor MCP');
      } else {
        mcpLogger.error({ url, error: error.message, code: error.code }, 'Error al verificar conexión con servidor MCP');
      }
      
      // Continuar con la siguiente URL
      continue;
    }
  }
  
  // Si llegamos aquí, ninguna URL funcionó
  mcpLogger.error('No se pudo conectar al servidor MCP con ninguna de las URLs probadas');
  return false;
}

export default {
  callStripeMcpTool,
  checkMcpConnection
};
