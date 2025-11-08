-- AlterTable
ALTER TABLE "tenant_invoices" ADD COLUMN     "currency" VARCHAR(3),
ADD COLUMN     "discount" DECIMAL(12,2),
ADD COLUMN     "exportacion" VARCHAR(10),
ADD COLUMN     "items" JSONB,
ADD COLUMN     "iva_amount" DECIMAL(12,2),
ADD COLUMN     "payment_form" VARCHAR(50),
ADD COLUMN     "payment_method" VARCHAR(50),
ADD COLUMN     "retencion_amount" DECIMAL(12,2),
ADD COLUMN     "sat_cert_number" VARCHAR(50),
ADD COLUMN     "subtotal" DECIMAL(12,2),
ADD COLUMN     "tipo_comprobante" VARCHAR(10),
ADD COLUMN     "uso_cfdi" VARCHAR(10),
ADD COLUMN     "verification_url" VARCHAR(500);

-- CreateIndex
CREATE INDEX "tenant_invoices_currency_idx" ON "tenant_invoices"("currency");

-- CreateIndex
CREATE INDEX "tenant_invoices_payment_method_idx" ON "tenant_invoices"("payment_method");

-- CreateIndex
CREATE INDEX "tenant_invoices_uso_cfdi_idx" ON "tenant_invoices"("uso_cfdi");
