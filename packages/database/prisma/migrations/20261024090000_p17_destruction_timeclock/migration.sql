-- Procès-verbaux de destruction, postes de pointage, pointages.
CREATE TABLE "destructions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "total_value" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'Péremption',
    "method" TEXT,
    "witness" TEXT,
    "notes" TEXT,
    "pharmacist_id" UUID,
    "pharmacist_name" TEXT,
    "signature" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "destructions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "destructions_tenant_id_number_key" ON "destructions"("tenant_id", "number");
ALTER TABLE "destructions" ADD CONSTRAINT "destructions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "destructions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "destructions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_destructions ON "destructions" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "destructions" TO erp_app;

CREATE TABLE "clock_stations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    CONSTRAINT "clock_stations_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "clock_stations" ADD CONSTRAINT "clock_stations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clock_stations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clock_stations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_clock_stations ON "clock_stations" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "clock_stations" TO erp_app;

CREATE TABLE "time_clocks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "in_at" TIMESTAMP(3) NOT NULL,
    "out_at" TIMESTAMP(3),
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "station" TEXT,
    "ip" TEXT,
    "note" TEXT,
    CONSTRAINT "time_clocks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "time_clocks_tenant_id_day_idx" ON "time_clocks"("tenant_id", "day");
CREATE INDEX "time_clocks_tenant_id_user_id_day_idx" ON "time_clocks"("tenant_id", "user_id", "day");
ALTER TABLE "time_clocks" ADD CONSTRAINT "time_clocks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "time_clocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_clocks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_time_clocks ON "time_clocks" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "time_clocks" TO erp_app;
