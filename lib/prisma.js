// lib/prisma.js
import { PrismaClient } from '@prisma/client';

// Verificar si ya existe una instancia en globalThis para evitar múltiples conexiones en desarrollo
const prisma = globalThis.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
    globalThis.prisma = prisma;
}

export default prisma;