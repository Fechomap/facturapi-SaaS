// lib/prisma.js
import { PrismaClient } from '@prisma/client';

// Determinar el nivel de logging en base a variables de entorno
const isPrismaDebug = process.env.DEBUG_DATABASE === 'true';
const isDevelopment = process.env.NODE_ENV === 'development';

// Configurar el nivel de logging adecuado
const logOptions = ['error']; // Siempre loggear errores
if (isPrismaDebug || isDevelopment) {
  logOptions.push('warn');
  
  // Solo incluir queries en modo de debug explícito o en desarrollo con DEBUG_DATABASE
  if (isPrismaDebug) {
    logOptions.push('query');
  }
}

// Configuración básica para connection pooling (sin dependencias circulares)
const prismaConfig = {
  log: logOptions,
};

// Verificar si ya existe una instancia en globalThis para evitar múltiples conexiones en desarrollo
const prisma = globalThis.prisma || new PrismaClient(prismaConfig);

// Solo guardar la instancia en globalThis en entorno de desarrollo
// para evitar múltiples conexiones durante recargas de servidor
if (isDevelopment) {
  globalThis.prisma = prisma;
}

export default prisma;