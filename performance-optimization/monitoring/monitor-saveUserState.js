#!/usr/bin/env node
// scripts/debug/monitor-saveUserState.js
// Monitor en tiempo real de saveUserState para detectar locks

import prisma from '../../lib/prisma.js';

let monitoringActive = true;

console.log('🔍 MONITOR DE saveUserState INICIADO');
console.log('=====================================');
console.log('Monitoreando locks y queries lentas cada 2 segundos...');
console.log('Ctrl+C para salir\n');

async function monitorDatabase() {
  try {
    const timestamp = new Date().toISOString().substring(11, 19);
    
    // 1. Verificar conexiones activas
    const connections = await prisma.$queryRaw`
      SELECT 
        count(*) as total,
        count(*) FILTER (WHERE state = 'active') as active,
        count(*) FILTER (WHERE query LIKE '%upsert%' OR query LIKE '%user_sessions%') as session_queries
      FROM pg_stat_activity 
      WHERE datname = current_database()
    `;
    
    const conn = connections[0];
    
    // 2. Detectar queries lentas
    const slowQueries = await prisma.$queryRaw`
      SELECT 
        pid,
        query_start,
        EXTRACT(EPOCH FROM (now() - query_start)) as duration_seconds,
        state,
        substring(query, 1, 100) as query_preview
      FROM pg_stat_activity 
      WHERE state = 'active' 
      AND query NOT LIKE '%pg_stat_activity%'
      AND EXTRACT(EPOCH FROM (now() - query_start)) > 0.5
      ORDER BY query_start
    `;
    
    // 3. Detectar locks específicos en user_sessions
    const sessionLocks = await prisma.$queryRaw`
      SELECT 
        l.locktype,
        l.mode,
        l.granted,
        a.query_start,
        EXTRACT(EPOCH FROM (now() - a.query_start)) as duration_seconds,
        substring(a.query, 1, 80) as query_preview
      FROM pg_locks l
      JOIN pg_stat_activity a ON l.pid = a.pid
      WHERE l.relation::regclass::text = 'user_sessions'
      AND NOT l.granted
    `;
    
    // Solo mostrar si hay algo interesante
    let hasIssues = false;
    
    if (conn.active > 5 || conn.session_queries > 2) {
      console.log(`[${timestamp}] ⚠️ Conexiones: ${conn.total} total, ${conn.active} activas, ${conn.session_queries} session queries`);
      hasIssues = true;
    }
    
    if (slowQueries.length > 0) {
      console.log(`[${timestamp}] 🐌 QUERIES LENTAS DETECTADAS:`);
      slowQueries.forEach((q, i) => {
        console.log(`  ${i+1}. PID ${q.pid}: ${q.duration_seconds.toFixed(1)}s - ${q.query_preview}...`);
      });
      hasIssues = true;
    }
    
    if (sessionLocks.length > 0) {
      console.log(`[${timestamp}] 🔒 LOCKS EN user_sessions:`);
      sessionLocks.forEach((lock, i) => {
        console.log(`  ${i+1}. ${lock.mode} lock, duración: ${lock.duration_seconds.toFixed(1)}s`);
        console.log(`     Query: ${lock.query_preview}...`);
      });
      hasIssues = true;
    }
    
    if (!hasIssues) {
      process.stdout.write(`[${timestamp}] ✅ Normal (${conn.total} conn, ${conn.active} activas)\r`);
    } else {
      console.log(''); // Nueva línea después de issues
    }
    
  } catch (error) {
    console.error(`❌ Error en monitor: ${error.message}`);
  }
}

// Monitor cada 2 segundos
const monitorInterval = setInterval(monitorDatabase, 2000);

// Cleanup al salir
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Deteniendo monitor...');
  clearInterval(monitorInterval);
  await prisma.$disconnect();
  process.exit(0);
});

// Ejecutar una vez inmediatamente
monitorDatabase();