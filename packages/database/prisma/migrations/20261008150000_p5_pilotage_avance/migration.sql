-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "lead_time_days" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "payment_term_days" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "receipt_id" UUID,
    "number" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "paid_amount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garde_periods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "uplift_pct" INTEGER NOT NULL DEFAULT 50,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garde_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "answer_index" INTEGER,
    "explanation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL DEFAULT 'pharmacorp',
    "created_by_id" UUID,
    "validated_by_id" UUID,
    "validated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "answer" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "answered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_settings" (
    "tenant_id" UUID NOT NULL,
    "auto_enabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency_hours" INTEGER NOT NULL DEFAULT 24,
    "drive_token_enc" TEXT,
    "drive_folder_id" TEXT,
    "drive_account" TEXT,
    "last_backup_at" TIMESTAMP(3),
    "last_status" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "backup_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "drive_file_id" TEXT,
    "data" BYTEA,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_invoices_tenant_id_status_due_date_idx" ON "supplier_invoices"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "garde_periods_tenant_id_start_date_idx" ON "garde_periods"("tenant_id", "start_date");

-- CreateIndex
CREATE INDEX "training_items_tenant_id_status_kind_idx" ON "training_items"("tenant_id", "status", "kind");

-- CreateIndex
CREATE INDEX "training_attempts_tenant_id_user_id_answered_at_idx" ON "training_attempts"("tenant_id", "user_id", "answered_at");

-- CreateIndex
CREATE INDEX "backup_records_tenant_id_created_at_idx" ON "backup_records"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garde_periods" ADD CONSTRAINT "garde_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_items" ADD CONSTRAINT "training_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attempts" ADD CONSTRAINT "training_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_attempts" ADD CONSTRAINT "training_attempts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "training_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_settings" ADD CONSTRAINT "backup_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_records" ADD CONSTRAINT "backup_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-Level Security (ARCHITECTURE.md section 10)
ALTER TABLE "supplier_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_supplier_invoices ON "supplier_invoices" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "garde_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "garde_periods" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_garde_periods ON "garde_periods" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "training_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_training_items ON "training_items" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "training_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_attempts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_training_attempts ON "training_attempts" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "backup_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backup_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_backup_settings ON "backup_settings" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "backup_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backup_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_backup_records ON "backup_records" USING (tenant_id::text = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_invoices", "garde_periods", "training_items", "training_attempts", "backup_settings", "backup_records" TO erp_app;

-- Restauration d'une sauvegarde : seule voie de suppression des ecritures comptables (le role applicatif n'a ni UPDATE
-- ni DELETE sur journal_entries / journal_lines). Fonction SECURITY DEFINER limitee au tenant passe en parametre,
-- qui doit etre egal au contexte tenant de la transaction (impossible de purger un autre etablissement).
CREATE OR REPLACE FUNCTION erp_purge_tenant_journal(t uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF t::text IS DISTINCT FROM current_setting('app.current_tenant_id', true) THEN
    RAISE EXCEPTION 'tenant hors contexte';
  END IF;
  DELETE FROM journal_lines WHERE tenant_id = t;
  DELETE FROM journal_entries WHERE tenant_id = t;
END;
$$;
REVOKE ALL ON FUNCTION erp_purge_tenant_journal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_purge_tenant_journal(uuid) TO erp_app;