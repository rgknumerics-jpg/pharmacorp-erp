/**
 * Moteur fiscal : SOURCE UNIQUE des regles de taxe (ARCHITECTURE.md principe 7). Consomme par la caisse (TVA d'une
 * ligne), la comptabilite (TVA collectee) et le connecteur SFEC (facture normalisee). Les prix de vente sont TTC.
 * Chaque pays deviendra un plugin versionne (section 14) ; pour l'instant : Congo, montants entiers en FCFA.
 */
export const FISCAL_VERSION = 'CG-2026.1';

/** TVA contenue dans un montant TTC au taux `rate` (%), arrondie au franc. */
export function vatIncluded(amountTtc: number, rate: number): number {
  if (!rate) return 0;
  return Math.round((amountTtc * rate) / (100 + rate));
}

export interface FiscalLine { name: string; quantity: number; unitPrice: number; vatRate: number; lineTotal: number }

export interface FiscalDocument {
  version: string;
  kind: 'invoice' | 'credit_note';
  number: string;
  issuedAt: string;
  seller: { tenantId: string; name: string; country: string };
  customer: { name: string | null; phone: string | null } | null;
  lines: (FiscalLine & { amountHt: number; vat: number })[];
  totalsByRate: { rate: number; ht: number; vat: number; ttc: number }[];
  total: { ht: number; vat: number; ttc: number };
  /** Pour un avoir : numero de la facture d'origine. */
  originalNumber?: string;
}

export function buildFiscalDocument(input: {
  kind: 'invoice' | 'credit_note';
  number: string;
  issuedAt: Date;
  seller: { tenantId: string; name: string; country: string };
  customer?: { name: string | null; phone: string | null } | null;
  lines: FiscalLine[];
  originalNumber?: string;
}): FiscalDocument {
  const sign = input.kind === 'credit_note' ? -1 : 1;
  const lines = input.lines.map((l) => {
    const vat = vatIncluded(l.lineTotal, l.vatRate);
    return { ...l, lineTotal: sign * l.lineTotal, vat: sign * vat, amountHt: sign * (l.lineTotal - vat) };
  });
  const byRate = new Map<number, { rate: number; ht: number; vat: number; ttc: number }>();
  for (const l of lines) {
    const t = byRate.get(l.vatRate) ?? { rate: l.vatRate, ht: 0, vat: 0, ttc: 0 };
    t.ht += l.amountHt; t.vat += l.vat; t.ttc += l.lineTotal;
    byRate.set(l.vatRate, t);
  }
  const totalsByRate = [...byRate.values()].sort((a, b) => a.rate - b.rate);
  return {
    version: FISCAL_VERSION,
    kind: input.kind,
    number: input.number,
    issuedAt: input.issuedAt.toISOString(),
    seller: input.seller,
    customer: input.customer ?? null,
    lines,
    totalsByRate,
    total: totalsByRate.reduce((s, t) => ({ ht: s.ht + t.ht, vat: s.vat + t.vat, ttc: s.ttc + t.ttc }), { ht: 0, vat: 0, ttc: 0 }),
    ...(input.originalNumber ? { originalNumber: input.originalNumber } : {}),
  };
}