-- Row-Level Security -- ARCHITECTURE.md section 10 (multi-tenant) et section 21 (securite).
--
-- Ce fichier N'EST PAS applique automatiquement : Prisma ne genere pas de RLS depuis schema.prisma.
-- Procedure (une fois PostgreSQL disponible, ex. via docker compose) :
--   1. npm run db:migrate:dev -w @erp/database --name init
--   2. npx prisma migrate dev --create-only --name row_level_security   (dans packages/database)
--   3. Copier le contenu de ce fichier dans le migration.sql cree a l'etape 2
--   4. npm run db:migrate:dev -w @erp/database
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

-- Comparaison en texte (colonne castee, jamais le parametre externe) : voir la migration
-- fix_rls_empty_setting_cast -- current_setting() peut renvoyer '' (pas seulement NULL) sur
-- une connexion de pool deja utilisee, et ''::uuid leve une erreur SQL au lieu de filtrer.
CREATE POLICY tenant_isolation_memberships ON "memberships"
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_roles ON "roles"
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_refresh_tokens ON "refresh_tokens"
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_audit_logs ON "audit_logs"
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

-- Remarque : "permissions" et "role_permissions" ne portent pas de tenant_id direct (catalogue partage /
-- table de jointure). Ils restent hors RLS pour ce socle ; ne jamais y stocker de donnee sensible par tenant.
-- Le role applicatif (utilise par l'API, jamais un superuser) doit etre proprietaire NON-BYPASSRLS des tables.
