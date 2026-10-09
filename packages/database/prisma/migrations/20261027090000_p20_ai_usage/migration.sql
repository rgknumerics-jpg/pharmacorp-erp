-- Suivi des couts de l'assistant IA, par pharmacie et par mois (plafond mensuel configurable).
CREATE TABLE "ai_usage_monthly" (
    "tenant_id" UUID NOT NULL,
    "year_month" TEXT NOT NULL,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "cost_usd_millicents" BIGINT NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ai_usage_monthly_pkey" PRIMARY KEY ("tenant_id", "year_month")
);
ALTER TABLE "ai_usage_monthly" ADD CONSTRAINT "ai_usage_monthly_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
