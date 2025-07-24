#!/usr/bin/env node
// scripts/debug/simple-monitor.js
// Monitor simplificado sin problemas de Prisma

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

console.log('🔍 MONITOR SIMPLE DE BD INICIADO');
console.log('================================');

async function simpleMonitor() {
  try {
    const timestamp = new Date().toISOString().substring(11, 19);

    // Query simple para conexiones
    const { stdout } = await execAsync(
      `psql "${process.env.DATABASE_URL}" -c "SELECT count(*) as total, count(*) FILTER (WHERE state = 'active') as active, count(*) FILTER (WHERE query LIKE '%user_sessions%' OR query LIKE '%upsert%') as session_queries FROM pg_stat_activity WHERE datname = current_database();"`
    );

    const lines = stdout.trim().split('\n');
    const dataLine = lines[2].trim(); // Skip headers
    const [total, active, sessionQueries] = dataLine.split('|').map((s) => s.trim());

    console.log(
      `[${timestamp}] 📊 BD: ${total} total, ${active} activas, ${sessionQueries} session queries`
    );

    // Query para locks en user_sessions
    const { stdout: locksOutput } = await execAsync(
      `psql "${process.env.DATABASE_URL}" -c "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON l.pid = a.pid WHERE l.relation::regclass::text = 'user_sessions' AND NOT l.granted;"`
    );

    const locksLines = locksOutput.trim().split('\n');
    const locksCount = parseInt(locksLines[2].trim());

    if (locksCount > 0) {
      console.log(`[${timestamp}] 🔒 LOCKS DETECTADOS: ${locksCount} en user_sessions`);
    }

    // Query lentas
    const { stdout: slowOutput } = await execAsync(
      `psql "${process.env.DATABASE_URL}" -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query NOT LIKE '%pg_stat_activity%' AND now() - query_start > interval '1 second';"`
    );

    const slowLines = slowOutput.trim().split('\n');
    const slowCount = parseInt(slowLines[2].trim());

    if (slowCount > 0) {
      console.log(`[${timestamp}] 🐌 QUERIES LENTAS: ${slowCount} > 1 segundo`);
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Monitor cada 2 segundos
setInterval(simpleMonitor, 2000);

// Cleanup
process.on('SIGINT', () => {
  console.log('\n🛑 Monitor detenido');
  process.exit(0);
});

// Ejecutar inmediatamente
simpleMonitor();
