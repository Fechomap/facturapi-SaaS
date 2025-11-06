/**
 * Prisma Client Instance
 * Singleton pattern to avoid multiple database connections
 */

import { PrismaClient } from '@prisma/client';

// Determine logging level based on environment
const isPrismaDebug = process.env.DEBUG_DATABASE === 'true';
const isDevelopment = process.env.NODE_ENV === 'development';

// Configure appropriate logging level
const logOptions: Array<'error' | 'warn' | 'query'> = ['error']; // Always log errors

if (isPrismaDebug || isDevelopment) {
  logOptions.push('warn');

  // Only include queries in explicit debug mode
  if (isPrismaDebug) {
    logOptions.push('query');
  }
}

// Basic configuration for connection pooling
const prismaConfig = {
  log: logOptions,
};

// Extend global type to include prisma
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Check if instance already exists in globalThis to avoid multiple connections in development
const prisma = globalThis.prisma || new PrismaClient(prismaConfig);

// Only save instance in globalThis in development environment
// to avoid multiple connections during server reloads
if (isDevelopment) {
  globalThis.prisma = prisma;
}

export default prisma;
