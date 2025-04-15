# Fixing Heroku Deployment Issues

This document explains how to fix the Prisma migration issues that are preventing the application from deploying to Heroku.

## The Problem

The deployment is failing due to a failed Prisma migration: `20250415044634_add_stripe_integration_fields`. The error message is:

```
Error: P3009
migrate found failed migrations in the target database, new migrations will not be applied. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve
The `20250415044634_add_stripe_integration_fields` migration started at 2025-04-15 05:09:42.286925 UTC failed
```

This migration is attempting to add Stripe integration fields to the database schema.

## Solution: Complete Database Reset

The most reliable solution is to completely reset the database and run migrations from scratch. This approach is recommended for development or staging environments where you can safely drop all data.

### Steps to Fix:

1. **Add the pg package to dependencies**:
   - We've added the PostgreSQL client library to package.json
   - This is required for the database reset script to work

2. **Create a database reset script**:
   - We've created `reset-heroku-db.js` which:
     - Drops all tables in the database
     - Runs Prisma migrations from scratch
     - Regenerates the Prisma client

3. **Create a shell script for easy execution**:
   - We've created `reset-heroku-db.sh` which runs the reset script on Heroku
   - Usage: `./reset-heroku-db.sh your-app-name`

4. **Update package.json**:
   - We've added a `reset-heroku-db` script to package.json
   - We've simplified the `heroku-postbuild` script to use standard Prisma migrations

5. **Update documentation**:
   - We've updated the Heroku deployment guide with instructions for resetting the database

### How to Use:

1. **Commit the changes**:
   ```bash
   git add package.json reset-heroku-db.js reset-heroku-db.sh README-HEROKU-DEPLOYMENT.md HEROKU-DEPLOYMENT-FIX.md
   git commit -m "Add database reset functionality for Heroku deployment"
   ```

2. **Push to Heroku**:
   ```bash
   git push heroku main
   ```

3. **Reset the database**:
   ```bash
   ./reset-heroku-db.sh your-app-name
   ```

4. **Deploy again**:
   ```bash
   git push heroku main
   ```

## Alternative Solution: Manual Migration Fix

If you need to preserve data, you can try to manually fix the migration issues:

1. **Connect to the Heroku PostgreSQL database**:
   ```bash
   heroku pg:psql --app your-app-name
   ```

2. **Check the status of Prisma migrations**:
   ```sql
   SELECT * FROM _prisma_migrations ORDER BY started_at DESC;
   ```

3. **Mark the problematic migration as applied**:
   ```sql
   UPDATE _prisma_migrations 
   SET applied = 1, finished_at = NOW(), rolled_back_at = NULL 
   WHERE migration_name = '20250415044634_add_stripe_integration_fields';
   ```

4. **Manually apply the schema changes**:
   ```sql
   -- Add columns if they don't exist
   DO $$ 
   BEGIN 
       IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_name='subscription_plans' AND column_name='stripe_price_id') THEN
           ALTER TABLE "subscription_plans" ADD COLUMN "stripe_price_id" VARCHAR(100);
       END IF;
       
       IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_name='subscription_plans' AND column_name='stripe_product_id') THEN
           ALTER TABLE "subscription_plans" ADD COLUMN "stripe_product_id" VARCHAR(100);
       END IF;
       
       IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_name='tenants' AND column_name='stripe_customer_id') THEN
           ALTER TABLE "tenants" ADD COLUMN "stripe_customer_id" VARCHAR(100);
       END IF;
   END $$;
   
   -- Handle potential duplicate values before creating unique index
   DO $$
   BEGIN
       UPDATE "tenants" SET "stripe_customer_id" = '' WHERE "stripe_customer_id" IS NULL;
       
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
   END $$;
   
   -- Create unique index if it doesn't exist
   DO $$ 
   BEGIN 
       IF EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='tenants' AND column_name='stripe_customer_id')
          AND NOT EXISTS (SELECT 1 FROM pg_indexes 
                         WHERE indexname = 'tenants_stripe_customer_id_key') THEN
           CREATE UNIQUE INDEX "tenants_stripe_customer_id_key" ON "tenants"("stripe_customer_id") 
           WHERE "stripe_customer_id" IS NOT NULL AND "stripe_customer_id" != '';
       END IF;
   END $$;
   ```

5. **Deploy again**:
   ```bash
   git push heroku main
   ```

## Preventing Future Issues

To prevent similar issues in the future:

1. **Test migrations locally before deploying**:
   - Run `npx prisma migrate dev` locally to test migrations
   - Ensure all migrations apply successfully

2. **Use the `--create-only` flag for complex migrations**:
   - For complex schema changes, use `npx prisma migrate dev --create-only`
   - This allows you to edit the migration SQL before applying it

3. **Consider using SQL transactions**:
   - Wrap complex migrations in transactions to ensure atomicity
   - This helps prevent partial migrations that can leave the database in an inconsistent state

4. **Implement a CI/CD pipeline**:
   - Test migrations in a CI/CD pipeline before deploying to production
   - This helps catch issues early
