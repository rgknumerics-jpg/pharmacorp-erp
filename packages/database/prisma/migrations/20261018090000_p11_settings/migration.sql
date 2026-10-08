-- Reglages generaux de l'etablissement (politique de caisse, verrouillage des postes, listes, ticket, catalogue en ligne).
ALTER TABLE "company_profiles" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';

ALTER TYPE "PaymentMethod" ADD VALUE 'cheque';
ALTER TYPE "PaymentMethod" ADD VALUE 'transfer';

ALTER TABLE "memberships" ADD COLUMN "pos_pin_hash" TEXT;
