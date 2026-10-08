-- Type de vente (V vente, A assurance / tiers payant, B bon de pharmacie), vendeur qui a saisi la vente,
-- tickets vendeur -> caisse, abreviation du fournisseur (etiquettes, rappels de lots), visibilite en ligne des produits.
ALTER TABLE "sales" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'V', ADD COLUMN "seller_id" UUID, ADD COLUMN "ticket_id" UUID;
UPDATE "sales" s SET "kind" = 'B' WHERE EXISTS (SELECT 1 FROM "payments" p WHERE p."sale_id" = s."id" AND p."method" = 'credit');
UPDATE "sales" s SET "kind" = 'A' WHERE EXISTS (SELECT 1 FROM "payments" p WHERE p."sale_id" = s."id" AND p."method" = 'insurer');
CREATE INDEX "sales_tenant_id_kind_idx" ON "sales"("tenant_id", "kind");

ALTER TABLE "suppliers" ADD COLUMN "abbreviation" TEXT;
ALTER TABLE "products" ADD COLUMN "online_visible" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "sale_tickets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "seller_id" UUID,
    "customer_id" UUID,
    "note" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'open',
    "sale_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    CONSTRAINT "sale_tickets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sale_tickets_tenant_id_number_key" ON "sale_tickets"("tenant_id", "number");
CREATE INDEX "sale_tickets_tenant_id_status_idx" ON "sale_tickets"("tenant_id", "status", "created_at");
ALTER TABLE "sale_tickets" ADD CONSTRAINT "sale_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sale_tickets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sale_tickets ON "sale_tickets" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "sale_tickets" TO erp_app;
