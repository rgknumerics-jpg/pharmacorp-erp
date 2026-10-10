-- Journal des ruptures : chaque recherche de vente qui tombe sur un produit a 0 en stock s'enregistre.
CREATE TABLE "stockout_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID,
    "product_name" TEXT NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stockout_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stockout_logs_tenant_id_created_at_idx" ON "stockout_logs"("tenant_id", "created_at");
CREATE INDEX "stockout_logs_tenant_id_product_id_idx" ON "stockout_logs"("tenant_id", "product_id");
ALTER TABLE "stockout_logs" ADD CONSTRAINT "stockout_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stockout_logs" ADD CONSTRAINT "stockout_logs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stockout_logs" ADD CONSTRAINT "stockout_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stockout_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stockout_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_stockout_logs ON "stockout_logs" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "stockout_logs" TO erp_app;
