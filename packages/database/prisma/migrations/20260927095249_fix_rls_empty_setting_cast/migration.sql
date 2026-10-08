-- Corrige un bug trouve pendant la verification e2e du 2026-09-27 (ARCHITECTURE.md section 10).
--
-- Les policies de la migration row_level_security comparaient
--   tenant_id = current_setting('app.current_tenant_id', true)::uuid
-- Sur une connexion issue du pool ou app.current_tenant_id avait deja ete positionne au moins
-- une fois par une transaction precedente (SET LOCAL / set_config(..., true)), PostgreSQL cree
-- un "placeholder" pour ce GUC personnalise : une fois la transaction qui l'a positionne
-- terminee, la valeur ne redevient pas NULL mais une CHAINE VIDE ''. Le cast ''::uuid leve une
-- erreur SQL (22P02) au lieu de filtrer proprement les lignes -- une requete sans contexte
-- tenant plantait donc avec une erreur 500 au lieu de renvoyer 0 ligne.
--
-- Correction : comparer en texte (caster la COLONNE, toujours un uuid valide, jamais le
-- parametre externe) -- aucune valeur de current_setting() ne peut faire echouer ce cast.

DROP POLICY IF EXISTS tenant_isolation_memberships ON "memberships";
DROP POLICY IF EXISTS tenant_isolation_roles ON "roles";
DROP POLICY IF EXISTS tenant_isolation_refresh_tokens ON "refresh_tokens";
DROP POLICY IF EXISTS tenant_isolation_audit_logs ON "audit_logs";

CREATE POLICY tenant_isolation_memberships ON "memberships"
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_roles ON "roles"
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_refresh_tokens ON "refresh_tokens"
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_audit_logs ON "audit_logs"
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));
