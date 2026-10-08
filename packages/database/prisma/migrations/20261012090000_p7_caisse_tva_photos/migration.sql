ALTER TABLE "customers" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'particulier', ADD COLUMN "address" TEXT, ADD COLUMN "city" TEXT, ADD COLUMN "birth_date" DATE, ADD COLUMN "company" TEXT, ADD COLUMN "insurer_id" UUID, ADD COLUMN "insurance_number" TEXT, ADD COLUMN "whatsapp_opt_in" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "company_profiles" ADD COLUMN "vat_visibility" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "product_photos" (
    "product_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_photos_pkey" PRIMARY KEY ("product_id")
);
CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "register" TEXT NOT NULL DEFAULT 'Caisse 1',
    "cashier_id" UUID NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_float" INTEGER NOT NULL,
    "opening_detail" JSONB NOT NULL DEFAULT '{}',
    "closed_at" TIMESTAMP(3),
    "expected_cash" INTEGER,
    "counted_cash" INTEGER,
    "closing_detail" JSONB NOT NULL DEFAULT '{}',
    "diff" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT,
    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "cash_expenses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID,
    "amount" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "beneficiary" TEXT,
    "account_code" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_expenses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cash_sessions_tenant_id_number_key" ON "cash_sessions"("tenant_id", "number");
CREATE INDEX "cash_sessions_tenant_id_status_idx" ON "cash_sessions"("tenant_id", "status");
CREATE INDEX "cash_expenses_tenant_id_created_at_idx" ON "cash_expenses"("tenant_id", "created_at");
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_expenses" ADD CONSTRAINT "cash_expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_expenses" ADD CONSTRAINT "cash_expenses_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_photos" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_product_photos ON "product_photos" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "cash_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_cash_sessions ON "cash_sessions" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "cash_expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_expenses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_cash_expenses ON "cash_expenses" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_photos", "cash_sessions" TO erp_app;
-- depenses de caisse : piece comptable, ni modification ni suppression
GRANT SELECT, INSERT ON "cash_expenses" TO erp_app;
-- signature manuscrite de l'agent (image), apposee sur les pieces de caisse
ALTER TABLE "users" ADD COLUMN "signature" TEXT;
ALTER TABLE "cash_expenses" ADD COLUMN "number" TEXT NOT NULL DEFAULT '';
