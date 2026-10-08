-- Fonds de roulement (tresorerie de reserve qui approvisionne les caisses) et registre des ecarts de caisse (deficit/excedent).
CREATE TABLE "cash_reserve_moves" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "to_register" TEXT,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "cash_reserve_moves_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cash_reserve_moves_tenant_id_created_at_idx" ON "cash_reserve_moves"("tenant_id", "created_at");
ALTER TABLE "cash_reserve_moves" ADD CONSTRAINT "cash_reserve_moves_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "cash_variances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "cash_variances_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cash_variances_tenant_id_status_idx" ON "cash_variances"("tenant_id", "status");
ALTER TABLE "cash_variances" ADD CONSTRAINT "cash_variances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_variances" ADD CONSTRAINT "cash_variances_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
