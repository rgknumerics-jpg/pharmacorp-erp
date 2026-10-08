-- Messagerie interne.
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "recipient_id" UUID,
    "kind" TEXT NOT NULL DEFAULT 'message',
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "chat_messages_tenant_id_created_at_idx" ON "chat_messages"("tenant_id", "created_at");
CREATE INDEX "chat_messages_tenant_id_recipient_id_created_at_idx" ON "chat_messages"("tenant_id", "recipient_id", "created_at");
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_chat_messages ON "chat_messages" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "chat_messages" TO erp_app;

CREATE TABLE "chat_reads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "conv_key" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chat_reads_tenant_id_user_id_conv_key_key" ON "chat_reads"("tenant_id", "user_id", "conv_key");
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_reads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_reads" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_chat_reads ON "chat_reads" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "chat_reads" TO erp_app;
