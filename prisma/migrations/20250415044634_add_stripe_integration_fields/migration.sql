-- AlterTable: Add columns only if they don't exist
DO $$ 
BEGIN 
    -- Check if stripe_price_id column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='subscription_plans' AND column_name='stripe_price_id') THEN
        ALTER TABLE "subscription_plans" ADD COLUMN "stripe_price_id" VARCHAR(100);
    END IF;
    
    -- Check if stripe_product_id column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='subscription_plans' AND column_name='stripe_product_id') THEN
        ALTER TABLE "subscription_plans" ADD COLUMN "stripe_product_id" VARCHAR(100);
    END IF;
    
    -- Check if stripe_customer_id column exists in tenants table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='tenants' AND column_name='stripe_customer_id') THEN
        ALTER TABLE "tenants" ADD COLUMN "stripe_customer_id" VARCHAR(100);
    END IF;
END $$;

-- Handle potential duplicate values before creating unique index
DO $$
BEGIN
    -- Update NULL values to empty string to avoid NULL comparison issues
    UPDATE "tenants" SET "stripe_customer_id" = '' WHERE "stripe_customer_id" IS NULL;
    
    -- Find duplicates and keep only one record with the value, set others to unique values
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

-- CreateIndex: Only create if it doesn't exist and if the column exists
DO $$ 
BEGIN 
    -- Check if the column exists and the index doesn't exist
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name='tenants' AND column_name='stripe_customer_id')
       AND NOT EXISTS (SELECT 1 FROM pg_indexes 
                      WHERE indexname = 'tenants_stripe_customer_id_key') THEN
        -- Create the index only for non-null values
        CREATE UNIQUE INDEX "tenants_stripe_customer_id_key" ON "tenants"("stripe_customer_id") 
        WHERE "stripe_customer_id" IS NOT NULL AND "stripe_customer_id" != '';
    END IF;
END $$;
