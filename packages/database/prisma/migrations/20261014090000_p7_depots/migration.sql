ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'transfer';
ALTER TABLE "inventory_movements" ADD COLUMN "depot_id" UUID;
CREATE INDEX "inventory_movements_depot_id_idx" ON "inventory_movements"("depot_id");
ALTER TABLE "company_profiles" ADD COLUMN "supplier_visibility" JSONB NOT NULL DEFAULT '{}', ADD COLUMN "depot_visibility" JSONB NOT NULL DEFAULT '{}';
CREATE TABLE "depots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'reserve',
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "depots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "depots_tenant_id_name_key" ON "depots"("tenant_id", "name");
ALTER TABLE "depots" ADD CONSTRAINT "depots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "depots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "depots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_depots ON "depots" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "depots" TO erp_app;