-- Agregar columnas stripe_product_id y stripe_price_id a la tabla subscription_plans
ALTER TABLE "subscription_plans" ADD COLUMN "stripe_product_id" VARCHAR(100);
ALTER TABLE "subscription_plans" ADD COLUMN "stripe_price_id" VARCHAR(100);
