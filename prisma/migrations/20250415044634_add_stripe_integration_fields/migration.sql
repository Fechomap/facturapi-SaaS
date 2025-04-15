/*
  Warnings:

  - A unique constraint covering the columns `[stripe_customer_id]` on the table `tenants` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN     "stripe_price_id" VARCHAR(100),
ADD COLUMN     "stripe_product_id" VARCHAR(100);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_stripe_customer_id_key" ON "tenants"("stripe_customer_id");
