-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID,
    "user_id" INTEGER,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50),
    "entity_id" VARCHAR(100),
    "details" JSONB,
    "ip_address" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "recipient_id" VARCHAR(100) NOT NULL,
    "tenant_id" UUID,
    "channel" VARCHAR(20) NOT NULL,
    "message" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_complements" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facturapi_complement_id" VARCHAR(100) NOT NULL,
    "uuid" VARCHAR(100) NOT NULL,
    "series" VARCHAR(5),
    "folio_number" INTEGER,
    "customer_id" VARCHAR(100) NOT NULL,
    "customer_name" VARCHAR(255) NOT NULL,
    "payment_form" VARCHAR(10) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "related_invoices" JSONB NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_complements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "billingPeriod" VARCHAR(20) NOT NULL DEFAULT 'monthly',
    "invoiceLimit" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "stripe_product_id" VARCHAR(100),
    "stripe_price_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_customers" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facturapi_customer_id" VARCHAR(100) NOT NULL,
    "legal_name" VARCHAR(255) NOT NULL,
    "rfc" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_documents" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" VARCHAR(50) NOT NULL,
    "upload_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_folios" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "series" VARCHAR(5) NOT NULL DEFAULT 'A',
    "current_number" INTEGER NOT NULL DEFAULT 800,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_folios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_invoices" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facturapi_invoice_id" VARCHAR(100) NOT NULL,
    "series" VARCHAR(5) NOT NULL,
    "folio_number" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "total" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3),
    "invoice_date" TIMESTAMP(3),
    "last_downloaded" TIMESTAMP(3),
    "payment_date" TIMESTAMP(3),
    "payment_status" VARCHAR(20),
    "tags" TEXT,
    "uuid" VARCHAR(100),

    CONSTRAINT "tenant_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_payments" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "stripe_payment_id" VARCHAR(100),
    "stripe_invoice_id" VARCHAR(100),
    "payment_method" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL,
    "payment_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "setting_key" VARCHAR(50) NOT NULL,
    "setting_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "stripe_customer_id" VARCHAR(100),
    "stripe_subscription_id" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'trial',
    "trial_ends_at" TIMESTAMP(3),
    "current_period_starts_at" TIMESTAMP(3),
    "current_period_ends_at" TIMESTAMP(3),
    "invoices_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_users" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "username" VARCHAR(100),
    "role" VARCHAR(20) NOT NULL DEFAULT 'admin',
    "is_authorized" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "business_name" VARCHAR(255) NOT NULL,
    "rfc" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "address" TEXT,
    "contact_name" VARCHAR(255),
    "facturapi_organization_id" VARCHAR(100),
    "facturapi_api_key" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripe_customer_id" VARCHAR(100),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "session_data" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_idx" ON "notifications"("recipient_id");

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_idx" ON "notifications"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_complements_tenant_id_customer_id_idx" ON "payment_complements"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "payment_complements_uuid_idx" ON "payment_complements"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "payment_complements_tenant_id_facturapi_complement_id_key" ON "payment_complements"("tenant_id", "facturapi_complement_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_customers_tenant_id_facturapi_customer_id_key" ON "tenant_customers"("tenant_id", "facturapi_customer_id");

-- CreateIndex
CREATE INDEX "tenant_documents_tenant_id_type_idx" ON "tenant_documents"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "tenant_folios_tenant_id_idx" ON "tenant_folios"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_folios_tenant_id_series_key" ON "tenant_folios"("tenant_id", "series");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_invoices_tenant_id_facturapi_invoice_id_key" ON "tenant_invoices"("tenant_id", "facturapi_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_invoices_tenant_id_series_folio_number_key" ON "tenant_invoices"("tenant_id", "series", "folio_number");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenant_id_setting_key_key" ON "tenant_settings"("tenant_id", "setting_key");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_users_tenant_id_telegram_id_key" ON "tenant_users"("tenant_id", "telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_rfc_key" ON "tenants"("rfc");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_stripe_customer_id_key" ON "tenants"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_telegram_id_key" ON "user_sessions"("telegram_id");

-- CreateIndex
CREATE INDEX "user_sessions_telegram_id_idx" ON "user_sessions"("telegram_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_complements" ADD CONSTRAINT "payment_complements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_customers" ADD CONSTRAINT "tenant_customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_documents" ADD CONSTRAINT "tenant_documents_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "tenant_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_documents" ADD CONSTRAINT "tenant_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_folios" ADD CONSTRAINT "tenant_folios_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invoices" ADD CONSTRAINT "tenant_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invoices" ADD CONSTRAINT "tenant_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "tenant_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invoices" ADD CONSTRAINT "tenant_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_payments" ADD CONSTRAINT "tenant_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "tenant_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_payments" ADD CONSTRAINT "tenant_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

