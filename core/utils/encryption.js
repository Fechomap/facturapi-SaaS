// core/utils/encryption.js
import crypto from 'crypto';
import logger from './logger.js';

// Logger específico para encriptación
const encryptionLogger = logger.child({ module: 'encryption' });

// Variables de entorno para la configuración del cifrado
// En producción, es recomendable establecer estas variables en el servidor
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'desarrolloFacturapiSaas2025Secret';
const ENCRYPTION_ALGORITHM = 'aes-256-cbc';

/**
 * Encripta una cadena usando AES-256-CBC
 * @param {string} text - Texto a encriptar
 * @returns {string} - Texto encriptado en formato Base64 con IV incluido
 */
export function encrypt(text) {
  if (!text || typeof text !== 'string') {
    encryptionLogger.error('Error: Intentando encriptar un valor inválido');
    throw new Error('El valor a encriptar es inválido');
  }

  try {
    // Generar un IV aleatorio
    const iv = crypto.randomBytes(16);

    // Crear clave a partir del secreto usando SHA-256
    const key = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();

    // Crear cipher con algoritmo, clave e IV
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

    // Encriptar el texto
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    // Combinar IV y texto cifrado (IV necesario para desencriptar)
    const result = iv.toString('base64') + ':' + encrypted;

    encryptionLogger.debug('Texto encriptado correctamente');
    return result;
  } catch (error) {
    encryptionLogger.error({ error }, 'Error durante la encriptación');
    throw new Error(`Error al encriptar: ${error.message}`);
  }
}

/**
 * Desencripta una cadena cifrada con AES-256-CBC
 * @param {string} encryptedText - Texto encriptado en formato Base64 con IV incluido
 * @returns {string} - Texto original desencriptado
 */
export function decrypt(encryptedText) {
  if (!encryptedText || typeof encryptedText !== 'string') {
    encryptionLogger.error('Error: Intentando desencriptar un valor inválido');
    throw new Error('El texto encriptado es inválido');
  }

  try {
    // Separar IV y texto cifrado
    const parts = encryptedText.split(':');

    if (parts.length !== 2) {
      throw new Error('Formato de texto encriptado inválido');
    }

    const iv = Buffer.from(parts[0], 'base64');
    const encryptedData = parts[1];

    // Crear clave a partir del secreto usando SHA-256
    const key = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();

    // Crear decipher con algoritmo, clave e IV
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);

    // Desencriptar el texto
    let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    encryptionLogger.debug('Texto desencriptado correctamente');
    return decrypted;
  } catch (error) {
    encryptionLogger.error({ error }, 'Error durante la desencriptación');
    throw new Error(`Error al desencriptar: ${error.message}`);
  }
}

/**
 * Encripta una API key específicamente (usa encrypt internamente)
 * @param {string} apiKey - API key a encriptar
 * @returns {string} - API key encriptada
 */
export function encryptApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    encryptionLogger.error('Error: Intentando encriptar una API key inválida');
    throw new Error('La API key a encriptar es inválida');
  }

  encryptionLogger.debug(`Encriptando API key de longitud: ${apiKey.length}`);

  try {
    return encrypt(apiKey);
  } catch (error) {
    encryptionLogger.error({ error }, 'Error al encriptar API key');
    throw new Error(`Error al encriptar la API key: ${error.message}`);
  }
}

/**
 * Desencripta una API key específicamente (usa decrypt internamente)
 * @param {string} encryptedApiKey - API key encriptada
 * @returns {string} - API key original
 */
export function decryptApiKey(encryptedApiKey) {
  if (!encryptedApiKey || typeof encryptedApiKey !== 'string') {
    encryptionLogger.error('Error: Intentando desencriptar una API key inválida');
    throw new Error('La API key encriptada es inválida');
  }

  try {
    const decrypted = decrypt(encryptedApiKey);

    encryptionLogger.debug(`API key desencriptada con longitud: ${decrypted.length}`);

    // Verificar si la API key tiene el formato correcto (comienza con 'sk_')
    if (!decrypted.startsWith('sk_')) {
      encryptionLogger.warn(
        'La API key desencriptada no tiene el formato esperado (no comienza con sk_)'
      );
    }

    return decrypted;
  } catch (error) {
    encryptionLogger.error({ error }, 'Error al desencriptar API key');
    throw new Error(`Error al desencriptar la API key: ${error.message}`);
  }
}

// Versión compatible con la función anterior (Base64 simple, menos segura)
export function legacyDecryptApiKey(encryptedApiKey) {
  if (!encryptedApiKey || typeof encryptedApiKey !== 'string') {
    encryptionLogger.error('Error: Intentando desencriptar una API key legada inválida');
    throw new Error('La API key encriptada es inválida');
  }

  try {
    // Simple desencriptación Base64
    const decrypted = Buffer.from(encryptedApiKey, 'base64').toString();

    encryptionLogger.debug(
      `API key desencriptada con método legado, longitud: ${decrypted.length}`
    );

    // Verificar si la API key tiene el formato correcto (comienza con 'sk_')
    if (!decrypted.startsWith('sk_')) {
      encryptionLogger.warn(
        'La API key desencriptada no tiene el formato esperado (no comienza con sk_)'
      );
    }

    return decrypted;
  } catch (error) {
    encryptionLogger.error({ error }, 'Error durante la desencriptación legada');
    throw new Error(`Error al desencriptar la API key (método legado): ${error.message}`);
  }
}

export default {
  encrypt,
  decrypt,
  encryptApiKey,
  decryptApiKey,
  legacyDecryptApiKey,
};
