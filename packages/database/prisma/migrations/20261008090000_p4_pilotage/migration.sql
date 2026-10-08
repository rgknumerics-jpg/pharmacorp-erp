-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'insurer';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "payment_term_days" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "insurer_id" UUID;

-- CreateTable
CREATE TABLE "company_profiles" (
    "tenant_id" UUID NOT NULL,
    "legal_name" TEXT,
    "legal_form" TEXT,
    "niu" TEXT,
    "rccm" TEXT,
    "practice_authorization" TEXT,
    "cnss_employer_number" TEXT,
    "patente_number" TEXT,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "tax_regime" TEXT NOT NULL DEFAULT 'reel',
    "income_tax" TEXT NOT NULL DEFAULT 'IS',
    "vat_registered" BOOLEAN NOT NULL DEFAULT true,
    "employees_count" INTEGER NOT NULL DEFAULT 0,
    "zone" TEXT NOT NULL DEFAULT 'centre',
    "rents_premises" BOOLEAN NOT NULL DEFAULT true,
    "annual_rent" INTEGER NOT NULL DEFAULT 0,
    "owns_property" BOOLEAN NOT NULL DEFAULT false,
    "fiscal_year_end_month" INTEGER NOT NULL DEFAULT 12,
    "documents" JSONB NOT NULL DEFAULT '{}',
    "payroll_parameters" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "company_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_filings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "obligation" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "amount" INTEGER,
    "reference" TEXT,
    "filed_at" TIMESTAMP(3),
    "filed_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "job_title" TEXT,
    "category" TEXT,
    "cnss_number" TEXT,
    "niu" TEXT,
    "phone" TEXT,
    "hire_date" DATE,
    "base_salary" INTEGER NOT NULL,
    "tax_parts" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totals" JSONB NOT NULL DEFAULT '{}',
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "validated_at" TIMESTAMP(3),
    "validated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "gross" INTEGER NOT NULL,
    "bonuses" INTEGER NOT NULL DEFAULT 0,
    "net" INTEGER NOT NULL,
    "detail" JSONB NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "coverage_rate" INTEGER NOT NULL DEFAULT 80,
    "payment_term_days" INTEGER NOT NULL DEFAULT 60,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID,
    "number" TEXT NOT NULL,
    "patient_name" TEXT NOT NULL,
    "patient_phone" TEXT,
    "prescriber" TEXT NOT NULL,
    "prescriber_ref" TEXT,
    "facility" TEXT,
    "prescribed_at" DATE NOT NULL,
    "notes" TEXT,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_documents_tenant_id_key_key" ON "company_documents"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "tax_filings_tenant_id_obligation_period_key" ON "tax_filings"("tenant_id", "obligation", "period");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_tenant_id_period_key" ON "payroll_runs"("tenant_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_run_id_employee_id_key" ON "payslips"("run_id", "employee_id");

-- CreateIndex
CREATE INDEX "prescriptions_tenant_id_patient_name_idx" ON "prescriptions"("tenant_id", "patient_name");

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_tenant_id_number_key" ON "prescriptions"("tenant_id", "number");

-- AddForeignKey
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filings" ADD CONSTRAINT "tax_filings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurers" ADD CONSTRAINT "insurers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-Level Security (ARCHITECTURE.md section 10)
ALTER TABLE "company_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_company_profiles ON "company_profiles" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "company_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_company_documents ON "company_documents" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "tax_filings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_filings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tax_filings ON "tax_filings" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_employees ON "employees" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "payroll_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payroll_runs ON "payroll_runs" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "payslips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payslips" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payslips ON "payslips" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "insurers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "insurers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_insurers ON "insurers" USING (tenant_id::text = current_setting('app.current_tenant_id', true));
ALTER TABLE "prescriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prescriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_prescriptions ON "prescriptions" USING (tenant_id::text = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "company_profiles", "company_documents", "tax_filings", "employees", "payroll_runs", "payslips", "insurers", "prescriptions" TO erp_app;
