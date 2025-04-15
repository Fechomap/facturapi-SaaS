import pg from 'pg';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

dotenv.config();

const execPromise = promisify(exec);
const { Pool } = pg;

async function resetHerokuDatabase() {
  // Get the DATABASE_URL from environment variables
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('ERROR: No se encontró DATABASE_URL en las variables de entorno');
    process.exit(1);
  }

  console.log('Conectando a la base de datos...');
  
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('Obteniendo lista de tablas...');
    
    // Get all tables in the public schema
    const tablesResult = await pool.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    
    const tables = tablesResult.rows.map(row => row.tablename);
    
    if (tables.length === 0) {
      console.log('No se encontraron tablas para eliminar.');
    } else {
      console.log(`Se encontraron ${tables.length} tablas para eliminar.`);
      
      // Drop the _prisma_migrations table last to avoid foreign key constraints
      const otherTables = tables.filter(table => table !== '_prisma_migrations');
      const sortedTables = [...otherTables];
      
      if (tables.includes('_prisma_migrations')) {
        sortedTables.push('_prisma_migrations');
      }
      
      // Disable foreign key checks
      await pool.query('SET session_replication_role = replica;');
      
      // Drop each table
      for (const table of sortedTables) {
        console.log(`Eliminando tabla: ${table}`);
        await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
      }
      
      // Re-enable foreign key checks
      await pool.query('SET session_replication_role = DEFAULT;');
      
      console.log('Todas las tablas han sido eliminadas correctamente.');
    }
    
    // Run Prisma migrations
    console.log('Ejecutando migraciones de Prisma...');
    try {
      await execPromise('npx prisma migrate deploy');
      console.log('Migraciones de Prisma ejecutadas correctamente.');
    } catch (error) {
      console.error('Error al ejecutar migraciones de Prisma:', error.message);
      throw error;
    }
    
    // Generate Prisma client
    console.log('Generando cliente de Prisma...');
    try {
      await execPromise('npx prisma generate');
      console.log('Cliente de Prisma generado correctamente.');
    } catch (error) {
      console.error('Error al generar cliente de Prisma:', error.message);
      throw error;
    }
    
    console.log('Base de datos recreada correctamente.');
    
  } catch (error) {
    console.error('Error al resetear la base de datos:', error);
  } finally {
    await pool.end();
  }
}

resetHerokuDatabase().catch(console.error);
