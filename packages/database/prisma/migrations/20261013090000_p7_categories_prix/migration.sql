ALTER TABLE "products" ADD COLUMN "price_category" TEXT;
ALTER TABLE "company_profiles" ADD COLUMN "price_categories" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "price_rounding" INTEGER NOT NULL DEFAULT 5;
