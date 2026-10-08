-- Habillage de la structure (logo, slogan, messages de ticket, modeles de bon / etiquette) et documents libres.
ALTER TABLE "company_profiles" ADD COLUMN "branding" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "company_documents" ADD COLUMN "label" TEXT;
