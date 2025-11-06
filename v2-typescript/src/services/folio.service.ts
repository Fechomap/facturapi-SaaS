// services/folio.service.ts
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../lib/prisma';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FOLIO_FILE = path.join(__dirname, '..', 'data', 'folio-counter.json');
const DEFAULT_COUNTERS: Record<string, number> = { A: 800 };

/**
 * Inicializa el contador de folios en el sistema de archivos
 */
export function initFolioCounter(): void {
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
 * Obtiene el próximo folio sin reservarlo
 */
export async function peekNextFolioDb(tenantId: string, series: string = 'A'): Promise<number> {
  try {
    const folio = await prisma.tenantFolio.findUnique({
      where: {
        tenantId_series: {
          tenantId,
          series,
        },
      },
    });

    if (folio) {
      return folio.currentNumber;
    }

    const newFolio = await prisma.tenantFolio.create({
      data: {
        tenantId,
        series,
        currentNumber: DEFAULT_COUNTERS[series] || 800,
      },
    });

    return newFolio.currentNumber;
  } catch (error) {
    console.error(`Error al obtener próximo folio para tenant ${tenantId}:`, error);
    return DEFAULT_COUNTERS[series] || 800;
  }
}

/**
 * Reserva y devuelve el próximo folio
 */
export async function reserveNextFolioDb(tenantId: string, series: string = 'A'): Promise<number> {
  try {
    const currentFolio = await peekNextFolioDb(tenantId, series);

    await prisma.tenantFolio.updateMany({
      where: {
        tenantId,
        series,
      },
      data: {
        currentNumber: {
          increment: 1,
        },
      },
    });

    return currentFolio;
  } catch (error: any) {
    console.error(`Error al reservar folio para tenant ${tenantId}:`, error);
    throw new Error(`No se pudo reservar un folio: ${error.message}`);
  }
}

/**
 * Obtiene el próximo folio del sistema de archivos (legacy)
 */
export function peekNextFolio(serie: string = 'A'): number {
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

/**
 * Reserva el próximo folio del sistema de archivos (legacy)
 */
export function reserveNextFolio(serie: string = 'A'): number {
  let counters: Record<string, number>;

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

export default {
  initFolioCounter,
  peekNextFolio,
  reserveNextFolio,
  peekNextFolioDb,
  reserveNextFolioDb,
};
