#!/usr/bin/env node
// scripts/cleanup-sessions.js - Limpieza automática de sesiones expiradas

import { prisma } from '../config/database.js';

/**
 * Limpia sesiones expiradas automáticamente
 */
async function cleanupExpiredSessions() {
  try {
    console.log('🧹 Iniciando limpieza de sesiones expiradas...');
    
    // Eliminar sesiones más viejas de 2 horas
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    
    const result = await prisma.userSession.deleteMany({
      where: {
        updatedAt: {
          lt: twoHoursAgo
        }
      }
    });
    
    console.log(`✅ Eliminadas ${result.count} sesiones expiradas`);
    
    // Mostrar estadísticas actuales
    const totalSessions = await prisma.userSession.count();
    console.log(`📊 Sesiones activas restantes: ${totalSessions}`);
    
  } catch (error) {
    console.error('❌ Error en limpieza de sesiones:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar si se llama directamente
if (process.argv[1].endsWith('cleanup-sessions.js')) {
  cleanupExpiredSessions();
}

export default cleanupExpiredSessions;