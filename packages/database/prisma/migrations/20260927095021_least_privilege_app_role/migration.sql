-- Role applicatif a privileges limites (ARCHITECTURE.md section 10 et 21).
--
-- BUG TROUVE PENDANT LA VERIFICATION DU 2026-09-27 : le role qui execute les migrations
-- (POSTGRES_USER du conteneur Docker, "erp") est un SUPERUSER de l'instance PostgreSQL --
-- c'est le comportement par defaut de l'image officielle postgres pour le premier role cree.
-- Or un superuser (ou tout role avec l'attribut BYPASSRLS) CONTOURNE TOUJOURS la Row-Level
-- Security, meme sur une table en FORCE ROW LEVEL SECURITY. Les policies de la migration
-- precedente (row_level_security) existaient donc en base mais n'avaient jamais ete
-- appliquees en pratique : un test e2e utilisant le role "erp" pour se connecter voyait
-- les lignes de TOUS les tenants, contexte ou pas.
--
-- Correction : un role dedie, non-superuser, non-BYPASSRLS, est cree ici pour que
-- l'application runtime (jamais les migrations) s'y connecte. DATABASE_URL de .env /
-- .env.test doit utiliser ce role -- voir README.md, section "Migrations".
--
-- Mot de passe de developpement en clair, coherent avec les identifiants Postgres deja en
-- clair dans docker-compose.yml : a remplacer par un secret gere hors depot en production.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app LOGIN PASSWORD 'erp_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;

-- Les tables/sequences creees par de futures migrations heritent automatiquement des memes droits.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app;
