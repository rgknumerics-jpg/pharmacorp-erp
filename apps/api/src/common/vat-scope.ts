import { Prisma } from '@erp/database';

/**
 * Perimetre de visibilite d'un role, regle par l'administrateur (Equipe et acces) :
 *  - rates     : taux de TVA visibles ;
 *  - suppliers : fournisseurs visibles (produits portant un code de ces fournisseurs) ;
 *  - depots    : depots visibles ('main' = comptoir / rayons).
 * `null` = pas de restriction sur ce critere. S'applique au catalogue, au stock, aux ventes, au cockpit et a la comptabilite.
 */
export interface Scope { rates: number[] | null; suppliers: string[] | null; depots: string[] | null }

export async function scopeOf(tx: Prisma.TransactionClient, roleId: string): Promise<Scope> {
  const p = await tx.companyProfile.findFirst({ select: { vatVisibility: true, supplierVisibility: true, depotVisibility: true } });
  const pick = <T,>(j: unknown, conv: (x: unknown) => T): T[] | null => { const v = ((j ?? {}) as Record<string, unknown[]>)[roleId]; return Array.isArray(v) ? v.map(conv) : null; };
  return { rates: pick(p?.vatVisibility, Number), suppliers: pick(p?.supplierVisibility, String), depots: pick(p?.depotVisibility, String) };
}

/** Compatibilite : taux de TVA visibles seulement. */
export async function vatScope(tx: Prisma.TransactionClient, roleId: string): Promise<number[] | null> {
  return (await scopeOf(tx, roleId)).rates;
}

export const unrestricted = (s: Scope) => !s.rates && !s.suppliers && !s.depots;

/** Produits visibles (TVA + fournisseurs) ; `null` = tous. */
export async function visibleProductIds(tx: Prisma.TransactionClient, s: Scope): Promise<string[] | null> {
  if (!s.rates && !s.suppliers) return null;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM products
    WHERE (${s.rates}::int[] IS NULL OR vat_rate = ANY(${s.rates}::int[]))
      AND (${s.suppliers}::text[] IS NULL OR supplier_codes ?| ${s.suppliers}::text[])`;
  return rows.map((r) => r.id);
}

/** Filtre Prisma des mouvements de stock pour le perimetre (produits + depots). */
export function movementWhere(s: Scope, productIds: string[] | null): Prisma.InventoryMovementWhereInput {
  const depots = s.depots ? { OR: [...(s.depots.includes('main') ? [{ depotId: null }] : []), { depotId: { in: s.depots.filter((d) => d !== 'main') } }] } : {};
  return { ...(productIds ? { productId: { in: productIds } } : {}), ...depots };
}
