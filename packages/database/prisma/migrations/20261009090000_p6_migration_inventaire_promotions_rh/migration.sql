-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MovementType" ADD VALUE 'opening';
ALTER TYPE "MovementType" ADD VALUE 'inventory';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'loyalty';
ALTER TYPE "PaymentMethod" ADD VALUE 'store_credit';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "loyalty_points" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "store_credit" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "imported" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "company_profiles" ADD COLUMN     "alert_recipients" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "gardes_pharmacy_id" TEXT,
ADD COLUMN     "loyalty_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "loyalty_point_value" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "loyalty_spend_per_point" INTEGER NOT NULL DEFAULT 1000;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "contract_end" DATE,
ADD COLUMN     "contract_type" TEXT;

-- AlterTable
ALTER TABLE "garde_periods" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "inventory_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'full',
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT,
    "created_by_id" UUID,
    "validated_by_id" UUID,
    "validated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_counts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_id" UUID,
    "expected" INTEGER NOT NULL,
    "counted" INTEGER NOT NULL,
    "counted_by_id" UUID,
    "counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "buy_qty" INTEGER NOT NULL DEFAULT 0,
    "free_qty" INTEGER NOT NULL DEFAULT 0,
    "product_ids" JSONB NOT NULL DEFAULT '[]',
    "category_ids" JSONB NOT NULL DEFAULT '[]',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "note" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_garde" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "table_name" TEXT NOT NULL DEFAULT '',
    "entity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'analyzed',
    "columns" JSONB NOT NULL DEFAULT '[]',
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "report" JSONB NOT NULL DEFAULT '{}',
    "rows_total" INTEGER NOT NULL DEFAULT 0,
    "rows_imported" INTEGER NOT NULL DEFAULT 0,
    "data" BYTEA NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_at" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_sessions_tenant_id_number_key" ON "inventory_sessions"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_counts_session_id_product_id_lot_id_key" ON "inventory_counts"("session_id", "product_id", "lot_id");

-- CreateIndex
CREATE INDEX "promotions_tenant_id_is_active_start_date_end_date_idx" ON "promotions"("tenant_id", "is_active", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "leave_requests_tenant_id_start_date_idx" ON "leave_requests"("tenant_id", "start_date");

-- CreateIndex
CREATE INDEX "shifts_tenant_id_date_idx" ON "shifts"("tenant_id", "date");

-- CreateIndex
CREATE INDEX "import_jobs_tenant_id_created_at_idx" ON "import_jobs"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "inventory_sessions" ADD CONSTRAINT "inventory_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-Level Security (ARCHITECTURE.md section 10)
ALTER TABLE "inventory_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_inventory_sessions ON "inventory_sessions" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "inventory_counts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_counts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_inventory_counts ON "inventory_counts" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "promotions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promotions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_promotions ON "promotions" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_leave_requests ON "leave_requests" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shifts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_shifts ON "shifts" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_import_jobs ON "import_jobs" USING (tenant_id::text = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_sessions", "inventory_counts", "promotions", "leave_requests", "shifts", "import_jobs" TO erp_app;
