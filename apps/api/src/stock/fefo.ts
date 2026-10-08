import { ConflictException } from '@nestjs/common';

export interface LotStock {
  lotId: string;
  lotNumber: string;
  expiryDate: Date | null;
  available: number;
}

export interface Allocation {
  /** null = sortie sans lot (produit non suivi par lot, ou survente toleree). */
  lotId: string | null;
  quantity: number;
  oversold?: boolean;
}

/**
 * Allocation FEFO (First Expired, First Out) : on sort d'abord le lot qui expire en premier
 * (ARCHITECTURE.md section 17). Les lots deja perimes ne sont jamais proposes a la vente.
 * Si le stock disponible est insuffisant, le manque est accepte uniquement dans la limite de la
 * tolerance de survente du produit (ARCHITECTURE.md section 11) ; au-dela on refuse (409).
 */
export function allocateFefo(
  lots: LotStock[],
  quantity: number,
  tolerance = 0,
  today: Date = new Date(),
): Allocation[] {
  const startOfToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const usable = lots
    .filter((l) => l.available > 0 && (!l.expiryDate || l.expiryDate.getTime() >= startOfToday.getTime()))
    .sort((a, b) => {
      const ea = a.expiryDate ? a.expiryDate.getTime() : Number.POSITIVE_INFINITY;
      const eb = b.expiryDate ? b.expiryDate.getTime() : Number.POSITIVE_INFINITY;
      return ea - eb || a.lotNumber.localeCompare(b.lotNumber);
    });

  const out: Allocation[] = [];
  let remaining = quantity;
  for (const lot of usable) {
    if (remaining <= 0) break;
    const take = Math.min(lot.available, remaining);
    out.push({ lotId: lot.lotId, quantity: take });
    remaining -= take;
  }
  if (remaining > 0) {
    const available = quantity - remaining;
    if (remaining > tolerance) {
      throw new ConflictException(
        `Stock insuffisant : ${quantity} demande(s), ${available} disponible(s) a la vente (lots perimes ou en attente de validation exclus).`,
      );
    }
    out.push({ lotId: null, quantity: remaining, oversold: true });
  }
  return out;
}
