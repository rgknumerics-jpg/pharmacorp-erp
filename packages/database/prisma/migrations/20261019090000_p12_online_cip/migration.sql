-- Referentiel CIP commun + comptes clients, commandes en ligne, livreurs et notifications.
CREATE TABLE "cip_reference" (
    "cip" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "dci" TEXT NOT NULL DEFAULT '',
    "providers" TEXT[],
    CONSTRAINT "cip_reference_pkey" PRIMARY KEY ("cip")
);
CREATE INDEX "cip_reference_designation_idx" ON "cip_reference"(lower("designation"));
GRANT SELECT, INSERT, UPDATE, DELETE ON "cip_reference" TO erp_app;

CREATE TABLE "customer_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),
    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_accounts_tenant_id_phone_key" ON "customer_accounts"("tenant_id", "phone");
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_customer_accounts ON "customer_accounts" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "customer_accounts" TO erp_app;

CREATE TABLE "couriers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "couriers_tenant_id_phone_key" ON "couriers"("tenant_id", "phone");
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "couriers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "couriers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_couriers ON "couriers" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "couriers" TO erp_app;

CREATE TABLE "online_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "items" JSONB NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "delivery_fee" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "fulfilment" TEXT NOT NULL DEFAULT 'delivery',
    "address" TEXT,
    "address_note" TEXT,
    "phone" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "payment_ref" TEXT,
    "payment_status" TEXT NOT NULL DEFAULT 'pending',
    "sale_id" UUID,
    "courier_id" UUID,
    "note" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "online_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "online_orders_tenant_id_number_key" ON "online_orders"("tenant_id", "number");
CREATE INDEX "online_orders_tenant_id_status_idx" ON "online_orders"("tenant_id", "status");
CREATE INDEX "online_orders_tenant_id_courier_id_idx" ON "online_orders"("tenant_id", "courier_id");
CREATE INDEX "online_orders_tenant_id_account_id_idx" ON "online_orders"("tenant_id", "account_id");
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "online_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_online_orders ON "online_orders" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "online_orders" TO erp_app;

CREATE TABLE "portal_notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "recipient_type" TEXT NOT NULL,
    "recipient_id" UUID NOT NULL,
    "order_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portal_notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "portal_notifications_tenant_id_recipient_type_recipient_id_created_at_idx" ON "portal_notifications"("tenant_id", "recipient_type", "recipient_id", "created_at");
ALTER TABLE "portal_notifications" ADD CONSTRAINT "portal_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_portal_notifications ON "portal_notifications" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "portal_notifications" TO erp_app;
