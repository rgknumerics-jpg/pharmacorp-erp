-- Les analyses clients (cockpit, relances) joignent les ventes par client : sans index, 4 s par requête sur 50 000 ventes.
CREATE INDEX IF NOT EXISTS "sales_customer_id_idx" ON "sales"("customer_id");
ANALYZE "sales";
