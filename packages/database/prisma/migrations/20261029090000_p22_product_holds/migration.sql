-- Toute FK vers une table existante exige le droit REFERENCES sur cette table, accorde AVANT de creer la
-- contrainte (pas apres : lecon du 2026-10-09 et du 2026-10-10 -- un GRANT place plus bas dans ce meme fichier
-- arrive trop tard pour les ALTER TABLE qui le precedent). Idempotent, donc sans risque a rejouer.
GRANT REFERENCES ON "tenants" TO erp_app;
GRANT REFERENCES ON "products" TO erp_app;
GRANT REFERENCES ON "users" TO erp_app;
GRANT REFERENCES ON "customers" TO erp_app;

-- Avoirs clients : produit indisponible mais trouvable chez un grossiste. Document imprimable (2 exemplaires),
-- retrait trace ; ne touche ni le stock ni la caisse (la vente reelle se fait au retrait, normalement).
CREATE TABLE "product_holds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" UUID,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT,
    "product_id" UUID,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "due_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" UUID,
    "fulfilled_by_id" UUID,
    "fulfilled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_holds_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_holds_tenant_id_number_key" ON "product_holds"("tenant_id", "number");
CREATE INDEX "product_holds_tenant_id_status_due_at_idx" ON "product_holds"("tenant_id", "status", "due_at");
ALTER TABLE "product_holds" ADD CONSTRAINT "product_holds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_holds" ADD CONSTRAINT "product_holds_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_holds" ADD CONSTRAINT "product_holds_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_holds" ADD CONSTRAINT "product_holds_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_holds" ADD CONSTRAINT "product_holds_fulfilled_by_id_fkey" FOREIGN KEY ("fulfilled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_holds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_holds" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_product_holds ON "product_holds" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_holds" TO erp_app;
