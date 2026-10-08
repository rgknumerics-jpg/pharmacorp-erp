-- Index manquants sur les clés étrangères : les analyses (cockpit, fournisseurs, risques) restaient lentes sur de grosses bases.
CREATE INDEX IF NOT EXISTS "sale_items_sale_id_idx" ON "sale_items"("sale_id");
CREATE INDEX IF NOT EXISTS "payments_sale_id_idx" ON "payments"("sale_id");
CREATE INDEX IF NOT EXISTS "goods_receipt_items_receipt_id_idx" ON "goods_receipt_items"("receipt_id");
CREATE INDEX IF NOT EXISTS "goods_receipt_items_product_id_idx" ON "goods_receipt_items"("product_id");
CREATE INDEX IF NOT EXISTS "goods_receipts_supplier_id_idx" ON "goods_receipts"("supplier_id");
CREATE INDEX IF NOT EXISTS "goods_receipts_purchase_order_id_idx" ON "goods_receipts"("purchase_order_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");
CREATE INDEX IF NOT EXISTS "supplier_invoices_supplier_id_idx" ON "supplier_invoices"("supplier_id");
CREATE INDEX IF NOT EXISTS "lots_product_id_idx" ON "lots"("product_id");
ANALYZE;
