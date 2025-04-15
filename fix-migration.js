import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

async function fixMigration() {
  // Obtener la URL de la base de datos del entorno
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
    // Verificar si la migración ya está marcada como aplicada
    const checkResult = await pool.query(
      "SELECT * FROM _prisma_migrations WHERE migration_name = '20250415044634_add_stripe_integration_fields'"
    );

    if (checkResult.rows.length > 0) {
      const migration = checkResult.rows[0];
      
      if (migration.applied === 1) {
        console.log('La migración ya está marcada como aplicada, pero con errores.');
        
        // Actualizar el registro para marcar la migración como aplicada correctamente
        await pool.query(
          "UPDATE _prisma_migrations SET applied = 1, finished_at = NOW(), rolled_back_at = NULL WHERE migration_name = '20250415044634_add_stripe_integration_fields'"
        );
        
        console.log('Migración marcada como aplicada correctamente.');
      } else {
        console.log('La migración ya está marcada como aplicada correctamente.');
      }
    } else {
      // Insertar un nuevo registro para marcar la migración como aplicada
      await pool.query(
        `INSERT INTO _prisma_migrations (migration_name, started_at, applied, finished_at)
         VALUES ('20250415044634_add_stripe_integration_fields', NOW(), 1, NOW())`
      );
      
      console.log('Migración marcada como aplicada correctamente.');
    }

    // Verificar si las columnas existen y crearlas si es necesario
    console.log('Verificando y aplicando cambios de esquema manualmente...');
    
    // Verificar y agregar columna stripe_price_id a subscription_plans
    await pool.query(`
      DO $$ 
      BEGIN 
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                        WHERE table_name='subscription_plans' AND column_name='stripe_price_id') THEN
              ALTER TABLE "subscription_plans" ADD COLUMN "stripe_price_id" VARCHAR(100);
              RAISE NOTICE 'Columna stripe_price_id agregada a subscription_plans';
          ELSE
              RAISE NOTICE 'Columna stripe_price_id ya existe en subscription_plans';
          END IF;
      END $$;
    `);
    
    // Verificar y agregar columna stripe_product_id a subscription_plans
    await pool.query(`
      DO $$ 
      BEGIN 
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                        WHERE table_name='subscription_plans' AND column_name='stripe_product_id') THEN
              ALTER TABLE "subscription_plans" ADD COLUMN "stripe_product_id" VARCHAR(100);
              RAISE NOTICE 'Columna stripe_product_id agregada a subscription_plans';
          ELSE
              RAISE NOTICE 'Columna stripe_product_id ya existe en subscription_plans';
          END IF;
      END $$;
    `);
    
    // Verificar y agregar columna stripe_customer_id a tenants
    await pool.query(`
      DO $$ 
      BEGIN 
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                        WHERE table_name='tenants' AND column_name='stripe_customer_id') THEN
              ALTER TABLE "tenants" ADD COLUMN "stripe_customer_id" VARCHAR(100);
              RAISE NOTICE 'Columna stripe_customer_id agregada a tenants';
          ELSE
              RAISE NOTICE 'Columna stripe_customer_id ya existe en tenants';
          END IF;
      END $$;
    `);
    
    // Verificar y crear índice único en stripe_customer_id
    await pool.query(`
      DO $$ 
      BEGIN 
          IF EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name='tenants' AND column_name='stripe_customer_id')
            AND NOT EXISTS (SELECT 1 FROM pg_indexes 
                          WHERE indexname = 'tenants_stripe_customer_id_key') THEN
              
              -- Actualizar valores NULL a cadena vacía
              UPDATE "tenants" SET "stripe_customer_id" = '' WHERE "stripe_customer_id" IS NULL;
              
              -- Manejar duplicados
              WITH duplicates AS (
                  SELECT "id", "stripe_customer_id", 
                        ROW_NUMBER() OVER (PARTITION BY "stripe_customer_id" ORDER BY "id") as row_num
                  FROM "tenants"
                  WHERE "stripe_customer_id" != ''
              )
              UPDATE "tenants" t
              SET "stripe_customer_id" = t."stripe_customer_id" || '_' || d.row_num
              FROM duplicates d
              WHERE t."id" = d."id" AND d.row_num > 1;
              
              -- Crear índice único
              CREATE UNIQUE INDEX "tenants_stripe_customer_id_key" ON "tenants"("stripe_customer_id") 
              WHERE "stripe_customer_id" IS NOT NULL AND "stripe_customer_id" != '';
              
              RAISE NOTICE 'Índice único creado para stripe_customer_id en tenants';
          ELSE
              RAISE NOTICE 'El índice único para stripe_customer_id ya existe o la columna no existe';
          END IF;
      END $$;
    `);

    console.log('Cambios de esquema aplicados manualmente con éxito.');
    console.log('Proceso completado. Ahora deberías poder desplegar en Heroku sin problemas.');
    
  } catch (error) {
    console.error('Error al ejecutar el script:', error);
  } finally {
    await pool.end();
  }
}

fixMigration().catch(console.error);
