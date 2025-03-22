// services/folio.service.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../lib/prisma.js';

// Para compatibilidad con el sistema actual, mantenemos la funcionalidad de archivo
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FOLIO_FILE = path.join(__dirname, '..', 'data', 'folio-counter.json');
const DEFAULT_COUNTERS = { 'A': 800 };

/**
 * Inicializa el contador de folios en el sistema de archivos (compatibilidad)
 */
function initFolioCounter() {
  const dir = path.dirname(FOLIO_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  if (!fs.existsSync(FOLIO_FILE)) {
    try {
      fs.writeFileSync(FOLIO_FILE, JSON.stringify(DEFAULT_COUNTERS, null, 2));
      console.log('Archivo de contador de folios inicializado correctamente');
    } catch (error) {
      console.error('Error al inicializar el contador de folios:', error);
    }
  }
}

/**
 * Obtiene el próximo folio disponible para un tenant específico sin reservarlo
 * @param {string} tenantId - ID del tenant
 * @param {string} series - Serie del folio (por defecto 'A')
 * @returns {Promise<number>} - El próximo número de folio
 */
async function peekNextFolioDb(tenantId, series = 'A') {
  try {
    // Buscar el folio en la base de datos
    const folio = await prisma.tenantFolio.findUnique({
      where: {
        tenantId_series: {
          tenantId,
          series
        }
      }
    });
    
    // Si existe, devolver el número actual
    if (folio) {
      return folio.currentNumber;
    }
    
    // Si no existe, crear uno nuevo con el valor predeterminado
    const newFolio = await prisma.tenantFolio.create({
      data: {
        tenantId,
        series,
        currentNumber: DEFAULT_COUNTERS[series] || 800
      }
    });
    
    return newFolio.currentNumber;
  } catch (error) {
    console.error(`Error al obtener próximo folio para tenant ${tenantId}:`, error);
    // En caso de error, usar valor predeterminado
    return DEFAULT_COUNTERS[series] || 800;
  }
}

/**
 * Reserva y devuelve el próximo folio para un tenant específico
 * @param {string} tenantId - ID del tenant
 * @param {string} series - Serie del folio (por defecto 'A')
 * @returns {Promise<number>} - El número de folio reservado
 */
async function reserveNextFolioDb(tenantId, series = 'A') {
  try {
    // Obtener el folio actual
    const currentFolio = await peekNextFolioDb(tenantId, series);
    
    // Actualizar el contador en la base de datos
    await prisma.tenantFolio.updateMany({
      where: {
        tenantId,
        series
      },
      data: {
        currentNumber: {
          increment: 1
        }
      }
    });
    
    return currentFolio;
  } catch (error) {
    console.error(`Error al reservar folio para tenant ${tenantId}:`, error);
    throw new Error(`No se pudo reservar un folio: ${error.message}`);
  }
}

// Mantener compatibilidad con el sistema antiguo basado en archivos
function peekNextFolio(serie = 'A') {
  try {
    if (fs.existsSync(FOLIO_FILE)) {
      const data = fs.readFileSync(FOLIO_FILE, 'utf8');
      const counters = JSON.parse(data);
      return counters[serie] || DEFAULT_COUNTERS[serie];
    }
    return DEFAULT_COUNTERS[serie];
  } catch (error) {
    console.error('Error al leer el archivo de folios:', error);
    return DEFAULT_COUNTERS[serie];
  }
}

function reserveNextFolio(serie = 'A') {
  let counters;
  
  try {
    if (fs.existsSync(FOLIO_FILE)) {
      const data = fs.readFileSync(FOLIO_FILE, 'utf8');
      counters = JSON.parse(data);
    } else {
      counters = { ...DEFAULT_COUNTERS };
    }
  } catch (error) {
    console.error('Error al leer el archivo de folios:', error);
    counters = { ...DEFAULT_COUNTERS };
  }
  
  if (!counters[serie]) {
    counters[serie] = DEFAULT_COUNTERS[serie] || 1;
  }
  
  const nextFolio = counters[serie];
  counters[serie] += 1;
  
  const dir = path.dirname(FOLIO_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  try {
    fs.writeFileSync(FOLIO_FILE, JSON.stringify(counters, null, 2));
  } catch (error) {
    console.error('Error al guardar el contador de folios:', error);
  }
  
  return nextFolio;
}

export {
  initFolioCounter,
  peekNextFolio,
  reserveNextFolio,
  peekNextFolioDb,
  reserveNextFolioDb
};