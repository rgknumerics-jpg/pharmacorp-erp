-- Onglet Fournisseurs : contacts, format d'export des commandes, catalogue du grossiste (CIP), reclamations / retours / avoirs.
ALTER TABLE "suppliers" ADD COLUMN "contacts" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "export_format" JSONB NOT NULL DEFAULT '{}', ADD COLUMN "is_wholesaler" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "supplier_catalog_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "cip" TEXT NOT NULL,
    "designation" TEXT NOT NULL DEFAULT '',
    "dci" TEXT NOT NULL DEFAULT '',
    "available" BOOLEAN NOT NULL DEFAULT true,
    "product_id" UUID,
    "match_state" TEXT NOT NULL DEFAULT 'none',
    "suggested_product_id" UUID,
    "score" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_catalog_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "supplier_catalog_items_tenant_id_supplier_id_cip_key" ON "supplier_catalog_items"("tenant_id", "supplier_id", "cip");
CREATE INDEX "supplier_catalog_items_tenant_id_supplier_id_match_state_idx" ON "supplier_catalog_items"("tenant_id", "supplier_id", "match_state");
CREATE INDEX "supplier_catalog_items_tenant_id_product_id_idx" ON "supplier_catalog_items"("tenant_id", "product_id");
ALTER TABLE "supplier_catalog_items" ADD CONSTRAINT "supplier_catalog_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_catalog_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_catalog_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_supplier_catalog_items ON "supplier_catalog_items" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_catalog_items" TO erp_app;

CREATE TABLE "supplier_claims" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "receipt_id" UUID,
    "bl_number" TEXT,
    "product_id" UUID,
    "product_name" TEXT NOT NULL,
    "cip" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "nature" TEXT NOT NULL,
    "detail" TEXT,
    "return_goods" BOOLEAN NOT NULL DEFAULT false,
    "delivered_at" DATE NOT NULL,
    "deadline" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'a_traiter',
    "declared_at" TIMESTAMP(3),
    "declared_via" TEXT,
    "credit_note_ref" TEXT,
    "credit_amount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_claims_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "supplier_claims_tenant_id_number_key" ON "supplier_claims"("tenant_id", "number");
CREATE INDEX "supplier_claims_tenant_id_status_deadline_idx" ON "supplier_claims"("tenant_id", "status", "deadline");
CREATE INDEX "supplier_claims_tenant_id_supplier_id_idx" ON "supplier_claims"("tenant_id", "supplier_id");
ALTER TABLE "supplier_claims" ADD CONSTRAINT "supplier_claims_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_claims" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_supplier_claims ON "supplier_claims" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_claims" TO erp_app;
