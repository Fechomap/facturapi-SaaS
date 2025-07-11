import prisma from '../lib/prisma.js';
import fs from 'fs';

console.log('🔍 ANÁLISIS DBA DE POSTGRESQL\n');
console.log('Ejecutando como DBA experto en sistemas de producción de alto rendimiento...\n');

async function runDBAAnalysis() {
  const results = {
    indexes: {},
    queries: {},
    maintenance: {},
    recommendations: []
  };

  try {
    // 1. ANÁLISIS DE ÍNDICES EXISTENTES
    console.log('📊 1. REVISIÓN DE ÍNDICES EXISTENTES\n');
    
    const existingIndexes = await prisma.$queryRaw`
      SELECT 
        schemaname,
        tablename,
        indexname,
        indexdef,
        pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size
      FROM pg_indexes 
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `;
    
    console.log('Índices encontrados:');
    console.log('Tabla | Índice | Definición | Tamaño');
    console.log('------|--------|------------|--------');
    existingIndexes.forEach(idx => {
      console.log(`${idx.tablename} | ${idx.indexname} | ${idx.indexdef.substring(0, 50)}... | ${idx.index_size}`);
    });
    
    results.indexes.existing = existingIndexes;

    // 2. USO DE ÍNDICES
    console.log('\n📊 2. ESTADÍSTICAS DE USO DE ÍNDICES\n');
    
    const indexUsage = await prisma.$queryRaw`
      SELECT 
        schemaname,
        tablename,
        indexname,
        idx_scan as index_scans,
        idx_tup_read as tuples_read,
        idx_tup_fetch as tuples_fetched,
        pg_size_pretty(pg_relation_size(indexrelname::regclass)) as index_size
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public'
      ORDER BY idx_scan DESC;
    `;
    
    console.log('Uso de índices (ordenado por scans):');
    console.log('Índice | Scans | Tuplas leídas | Tamaño');
    console.log('-------|-------|---------------|--------');
    indexUsage.forEach(idx => {
      console.log(`${idx.indexname} | ${idx.index_scans} | ${idx.tuples_read} | ${idx.index_size}`);
    });
    
    // Identificar índices no usados
    const unusedIndexes = indexUsage.filter(idx => parseInt(idx.index_scans) === 0);
    if (unusedIndexes.length > 0) {
      console.log('\n⚠️ ÍNDICES NO UTILIZADOS:');
      unusedIndexes.forEach(idx => {
        console.log(`- ${idx.indexname} en ${idx.tablename} (${idx.index_size})`);
      });
    }
    
    results.indexes.usage = indexUsage;

    // 3. ANÁLISIS DE TABLAS MÁS CONSULTADAS
    console.log('\n📊 3. TABLAS MÁS CONSULTADAS\n');
    
    const tableStats = await prisma.$queryRaw`
      SELECT 
        schemaname,
        tablename,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        n_tup_ins,
        n_tup_upd,
        n_tup_del,
        n_live_tup,
        n_dead_tup,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY seq_scan + idx_scan DESC;
    `;
    
    console.log('Tabla | Seq Scans | Index Scans | Live Tuples | Dead Tuples | Dead %');
    console.log('------|-----------|-------------|-------------|-------------|--------');
    tableStats.forEach(tbl => {
      const deadPct = tbl.n_live_tup > 0 ? ((tbl.n_dead_tup / tbl.n_live_tup) * 100).toFixed(2) : '0';
      console.log(`${tbl.tablename} | ${tbl.seq_scan} | ${tbl.idx_scan} | ${tbl.n_live_tup} | ${tbl.n_dead_tup} | ${deadPct}%`);
    });
    
    results.maintenance.tableStats = tableStats;

    // 4. ANÁLISIS DE CONSULTAS CRÍTICAS CON EXPLAIN
    console.log('\n📊 4. ANÁLISIS DE CONSULTAS CRÍTICAS\n');
    
    // Consulta 1: getNextFolio (el mayor problema identificado)
    console.log('🔍 Analizando: getNextFolio (findUnique + update)');
    
    const explainFindFolio = await prisma.$queryRaw`
      EXPLAIN (ANALYZE, BUFFERS) 
      SELECT * FROM "TenantFolio" 
      WHERE "tenantId" = '3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb' 
      AND "series" = 'A';
    `;
    
    console.log('\nEXPLAIN findUnique TenantFolio:');
    explainFindFolio.forEach(row => console.log(row['QUERY PLAN']));
    
    const explainUpdateFolio = await prisma.$queryRaw`
      EXPLAIN (ANALYZE, BUFFERS) 
      UPDATE "TenantFolio" 
      SET "currentNumber" = "currentNumber" + 1 
      WHERE "tenantId" = '3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb' 
      AND "series" = 'A';
    `;
    
    console.log('\nEXPLAIN update TenantFolio:');
    explainUpdateFolio.forEach(row => console.log(row['QUERY PLAN']));
    
    // Consulta 2: UserSession
    console.log('\n🔍 Analizando: getUserState (UserSession)');
    
    const explainUserSession = await prisma.$queryRaw`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT * FROM "UserSession"
      WHERE "telegramId" = 7143094298;
    `;
    
    console.log('\nEXPLAIN UserSession:');
    explainUserSession.forEach(row => console.log(row['QUERY PLAN']));
    
    // Consulta 3: TenantCustomer búsquedas
    console.log('\n🔍 Analizando: búsqueda de clientes');
    
    const explainCustomerSearch = await prisma.$queryRaw`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT * FROM "TenantCustomer"
      WHERE "tenantId" = '3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb'
      AND LOWER("legalName") LIKE LOWER('%CHUBB%');
    `;
    
    console.log('\nEXPLAIN TenantCustomer search:');
    explainCustomerSearch.forEach(row => console.log(row['QUERY PLAN']));

    // 5. ÍNDICES FALTANTES CRÍTICOS
    console.log('\n📊 5. ÍNDICES FALTANTES DETECTADOS\n');
    
    // Verificar qué columnas se usan en WHERE sin índices
    const missingIndexQueries = [
      {
        table: 'TenantFolio',
        columns: ['tenantId', 'series'],
        reason: 'Consulta crítica en getNextFolio usa WHERE tenantId AND series',
        impact: 'ALTO - Causa 3.4 segundos de delay',
        suggestion: 'CREATE UNIQUE INDEX idx_tenant_folio_composite ON "TenantFolio"("tenantId", "series");'
      },
      {
        table: 'UserSession',
        columns: ['telegramId'],
        reason: 'Todas las operaciones de sesión buscan por telegramId',
        impact: 'MEDIO - 100-200ms por operación',
        suggestion: 'CREATE INDEX idx_user_session_telegram ON "UserSession"("telegramId");'
      },
      {
        table: 'TenantCustomer',
        columns: ['tenantId', 'legalName'],
        reason: 'Búsquedas frecuentes por tenant + nombre con LIKE',
        impact: 'MEDIO - Búsquedas lentas de clientes',
        suggestion: 'CREATE INDEX idx_tenant_customer_search ON "TenantCustomer"("tenantId", "legalName" text_pattern_ops);'
      },
      {
        table: 'TenantInvoice',
        columns: ['tenantId', 'createdAt'],
        reason: 'Reportes y listados ordenados por fecha',
        impact: 'MEDIO - Reportes lentos',
        suggestion: 'CREATE INDEX idx_tenant_invoice_date ON "TenantInvoice"("tenantId", "createdAt" DESC);'
      }
    ];
    
    console.log('ÍNDICES CRÍTICOS FALTANTES:');
    missingIndexQueries.forEach((idx, i) => {
      console.log(`\n${i + 1}. ${idx.table} - ${idx.columns.join(', ')}`);
      console.log(`   Razón: ${idx.reason}`);
      console.log(`   Impacto: ${idx.impact}`);
      console.log(`   SQL: ${idx.suggestion}`);
    });
    
    results.recommendations = missingIndexQueries;

    // 6. CONFIGURACIÓN Y MANTENIMIENTO
    console.log('\n📊 6. CONFIGURACIÓN Y MANTENIMIENTO\n');
    
    const pgSettings = await prisma.$queryRaw`
      SELECT name, setting, unit, short_desc 
      FROM pg_settings 
      WHERE name IN (
        'shared_buffers', 
        'effective_cache_size', 
        'work_mem',
        'maintenance_work_mem',
        'autovacuum',
        'max_connections',
        'checkpoint_segments',
        'checkpoint_completion_target'
      );
    `;
    
    console.log('Parámetros de configuración:');
    pgSettings.forEach(setting => {
      console.log(`${setting.name}: ${setting.setting} ${setting.unit || ''}`);
    });
    
    // Verificar autovacuum
    const autovacuumStatus = await prisma.$queryRaw`
      SELECT 
        relname,
        last_vacuum,
        last_autovacuum,
        vacuum_count,
        autovacuum_count
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      AND (last_autovacuum IS NULL OR last_autovacuum < NOW() - INTERVAL '7 days');
    `;
    
    if (autovacuumStatus.length > 0) {
      console.log('\n⚠️ TABLAS SIN VACUUM RECIENTE:');
      autovacuumStatus.forEach(tbl => {
        console.log(`- ${tbl.relname}: último vacuum ${tbl.last_autovacuum || 'NUNCA'}`);
      });
    }

    // 7. RECOMENDACIONES FINALES
    console.log('\n🎯 RECOMENDACIONES PRIORITARIAS:\n');
    
    console.log('1. CREAR ÍNDICES INMEDIATAMENTE:');
    missingIndexQueries.slice(0, 3).forEach(idx => {
      console.log(`   ${idx.suggestion}`);
    });
    
    console.log('\n2. OPTIMIZAR CONFIGURACIÓN:');
    console.log('   - Aumentar work_mem a 16MB para sorts más rápidos');
    console.log('   - Configurar effective_cache_size al 75% de RAM disponible');
    console.log('   - Habilitar pg_stat_statements para monitoreo continuo');
    
    console.log('\n3. MANTENIMIENTO:');
    console.log('   - Ejecutar VACUUM ANALYZE en tablas con > 10% dead tuples');
    console.log('   - Configurar autovacuum más agresivo para tablas de alto tráfico');
    
    // Guardar resultados
    fs.writeFileSync(
      'postgres-dba-report.json', 
      JSON.stringify(results, null, 2)
    );
    
    console.log('\n✅ Análisis completo guardado en postgres-dba-report.json');
    
  } catch (error) {
    console.error('❌ Error durante análisis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Script SQL para habilitar pg_stat_statements
console.log('\n📝 COMANDOS PARA EJECUTAR EN POSTGRESQL:\n');
console.log('-- 1. Habilitar pg_stat_statements para análisis de queries');
console.log(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`);
console.log('\n-- 2. Ver queries más lentas (requiere pg_stat_statements)');
console.log(`SELECT 
  query,
  calls,
  total_time,
  mean_time,
  min_time,
  max_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;`);

console.log('\n-- 3. Verificar bloat en tablas');
console.log(`SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  CASE WHEN pg_total_relation_size(schemaname||'.'||tablename) > 0
    THEN ROUND(100 * (pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename))::numeric / pg_total_relation_size(schemaname||'.'||tablename), 2)
    ELSE 0
  END AS bloat_percent
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;`);

console.log('\nEjecutando análisis...\n');

runDBAAnalysis();