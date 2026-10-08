-- Row-Level Security -- ARCHITECTURE.md section 10 (multi-tenant) et section 21 (securite).
-- Contenu source : packages/database/prisma/rls-policies.sql (voir ce fichier pour la procedure complete).
--
-- Principe : chaque requete applicative tourne dans une transaction qui execute
--   SET LOCAL app.current_tenant_id = '<uuid du tenant actif>';
-- avant toute lecture/ecriture (voir packages/database/src/tenant-context.ts).
-- Une connexion qui n'a pas positionne cette variable ne voit AUCUNE ligne des tables ci-dessous.

ALTER TABLE "memberships"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs"     ENABLE ROW LEVEL SECURITY;

ALTER TABLE "memberships"    FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs"     FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_memberships ON "memberships"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_roles ON "roles"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_refresh_tokens ON "refresh_tokens"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_audit_logs ON "audit_logs"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Remarque : "permissions" et "role_permissions" ne portent pas de tenant_id direct (catalogue partage /
-- table de jointure). Ils restent hors RLS pour ce socle ; ne jamais y stocker de donnee sensible par tenant.
-- Le role applicatif (utilise par l'API, jamais un superuser) doit etre proprietaire NON-BYPASSRLS des tables.
