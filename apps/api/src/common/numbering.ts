import { Prisma } from '@erp/database';

/**
 * Numero de document sequentiel par tenant (ex. V-2026-000123). Le compteur est incremente par un UPDATE atomique
 * (verrou de ligne PostgreSQL) : deux caisses simultanees n'obtiennent jamais le meme numero.
 */
export async function nextNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  prefix: string,
  perYear = true,
): Promise<string> {
  const year = new Date().getFullYear();
  const key = perYear ? `${prefix}:${year}` : prefix;
  const counter = await tx.tenantCounter.upsert({
    where: { tenantId_key: { tenantId, key } },
    create: { tenantId, key, value: 1 },
    update: { value: { increment: 1 } },
  });
  const seq = String(counter.value).padStart(6, '0');
  return perYear ? `${prefix}-${year}-${seq}` : `${prefix}-${seq}`;
}
