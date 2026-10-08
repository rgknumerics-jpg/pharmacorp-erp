import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Execute `fn` inside a transaction that has set the PostgreSQL session variable
 * `app.current_tenant_id` for the duration of that transaction (SET LOCAL semantics).
 *
 * Row-Level Security policies (see prisma/rls-policies.sql) filter every tenant-scoped
 * table on this variable. A query executed without going through `withTenant` never
 * sees tenant-scoped rows once RLS is enabled — this is intentional (ARCHITECTURE.md
 * section 10): isolation must hold even if an application-level `WHERE tenantId = ...`
 * clause is forgotten.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }, { timeout: 120_000, maxWait: 15_000 }); // grosses bases (dizaines de milliers de ventes) : les analyses dépassent les 5 s par défaut
}
