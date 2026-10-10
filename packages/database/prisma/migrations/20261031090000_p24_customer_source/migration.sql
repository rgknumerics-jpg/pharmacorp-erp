-- Dissociation clients "pos" (en pharmacie) / "online" (boutique en ligne) : ARCHITECTURE.md -- Clients.
-- Un client online n'est jamais eligible au credit et n'apparait pas dans la liste Clients par defaut.
ALTER TABLE "customers" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'pos';
-- Les comptes deja crees via l'inscription boutique en ligne sont reclasses : tout client qui a un
-- compte boutique (customer_accounts) mais aucune vente "pos" enregistree est presume venu en ligne.
UPDATE "customers" c SET "source" = 'online'
WHERE EXISTS (SELECT 1 FROM "customer_accounts" ca WHERE ca.customer_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM "sales" s WHERE s.customer_id = c.id);
