/*
  Warnings:

  - A unique constraint covering the columns `[stripe_customer_id]` on the table `tenants` will be added. If there are existing duplicate values, this will fail.

*/
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
END $$;

-- CreateIndex: Only create if it doesn't exist
DO $$ 
BEGIN 
    -- Check if the index exists
    IF NOT EXISTS (SELECT 1 FROM pg_indexes 
                   WHERE indexname = 'tenants_stripe_customer_id_key') THEN
        CREATE UNIQUE INDEX "tenants_stripe_customer_id_key" ON "tenants"("stripe_customer_id");
    END IF;
END $$;
