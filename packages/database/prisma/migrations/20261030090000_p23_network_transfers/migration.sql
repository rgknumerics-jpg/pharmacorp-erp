-- REFERENCES toujours en premier dans ce fichier (lecon du 2026-10-09/10 : un GRANT place apres les contraintes
-- qui en ont besoin arrive trop tard, meme dans le meme fichier). Idempotent, sans risque a rejouer.
GRANT REFERENCES ON "tenants" TO erp_app;
GRANT REFERENCES ON "users" TO erp_app;

-- Reseau de pharmacies : code de reseau choisi par le titulaire (null = pas en reseau).
ALTER TABLE "tenants" ADD COLUMN "network_code" TEXT;
CREATE INDEX "tenants_network_code_idx" ON "tenants"("network_code");

-- Transferts de stock entre pharmacies d'un meme reseau. Hors RLS tenant_id classique : policy dediee
-- (requesting OU target = tenant courant), voir le commentaire du modele Prisma.
CREATE TABLE "transfer_requests" (
    "id" UUID NOT NULL,
    "requesting_tenant_id" UUID NOT NULL,
    "requesting_tenant_name" TEXT NOT NULL,
    "target_tenant_id" UUID NOT NULL,
    "target_tenant_name" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "target_product_id" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "requested_by_id" UUID,
    "responded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "transfer_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "transfer_requests_requesting_tenant_id_status_idx" ON "transfer_requests"("requesting_tenant_id", "status");
CREATE INDEX "transfer_requests_target_tenant_id_status_idx" ON "transfer_requests"("target_tenant_id", "status");
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_requesting_tenant_id_fkey" FOREIGN KEY ("requesting_tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_target_tenant_id_fkey" FOREIGN KEY ("target_tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_responded_by_id_fkey" FOREIGN KEY ("responded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transfer_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transfer_requests" FORCE ROW LEVEL SECURITY;
-- Deux tenants legitimes sur la meme ligne : ni l'un ni l'autre n'est "le" proprietaire au sens habituel.
CREATE POLICY network_visibility_transfer_requests ON "transfer_requests"
  USING (
    requesting_tenant_id::text = current_setting('app.current_tenant_id', true)
    OR target_tenant_id::text = current_setting('app.current_tenant_id', true)
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON "transfer_requests" TO erp_app;
