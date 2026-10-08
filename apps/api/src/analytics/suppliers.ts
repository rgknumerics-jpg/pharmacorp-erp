/**
 * Analyse des fournisseurs a partir des commandes et receptions : prix, delais, fiabilite, et comparaison sur le panier
 * habituel de l'officine.
 */
export interface ReceiptLine { supplierId: string; productId: string; date: Date; quantity: number; unitCost: number }
export interface OrderFact { supplierId: string; createdAt: Date; expectedAt: Date | null; firstReceiptAt: Date | null; orderedQty: number; receivedQty: number; missingProducts: number }

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const day = 86_400_000;

export function supplierStats(supplierId: string, lines: ReceiptLine[], orders: OrderFact[], now = new Date()) {
  const L = lines.filter((l) => l.supplierId === supplierId);
  const O = orders.filter((o) => o.supplierId === supplierId);
  const delivered = O.filter((o) => o.firstReceiptAt);
  const leads = delivered.map((o) => (o.firstReceiptAt!.getTime() - o.createdAt.getTime()) / day).sort();
  const byDate = [...delivered].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const recent = byDate.slice(-3).map((o) => (o.firstReceiptAt!.getTime() - o.createdAt.getTime()) / day);
  const before = byDate.slice(-8, -3).map((o) => (o.firstReceiptAt!.getTime() - o.createdAt.getTime()) / day);

  // evolution des prix : cout moyen pondere des 90 derniers jours vs les 90 jours precedents, sur les memes produits
  const inWindow = (l: ReceiptLine, from: number, to: number) => { const age = (now.getTime() - l.date.getTime()) / day; return age >= from && age < to; };
  const recentL = L.filter((l) => inWindow(l, 0, 90)), olderL = L.filter((l) => inWindow(l, 90, 180));
  const common = [...new Set(recentL.map((l) => l.productId))].filter((p) => olderL.some((l) => l.productId === p));
  const wavg = (ls: ReceiptLine[], p: string) => { const x = ls.filter((l) => l.productId === p); const q = x.reduce((s, l) => s + l.quantity, 0); return q ? x.reduce((s, l) => s + l.quantity * l.unitCost, 0) / q : 0; };
  const priceChanges = common.map((p) => (wavg(recentL, p) - wavg(olderL, p)) / Math.max(1, wavg(olderL, p)));

  const amount = L.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  return {
    orders: O.length,
    receipts: new Set(L.map((l) => l.date.toISOString().slice(0, 10))).size,
    purchasedAmount: amount,
    products: new Set(L.map((l) => l.productId)).size,
    avgLeadTimeDays: leads.length ? Math.round(mean(leads) * 10) / 10 : null,
    recentLeadTimeDays: recent.length ? Math.round(mean(recent) * 10) / 10 : null,
    previousLeadTimeDays: before.length ? Math.round(mean(before) * 10) / 10 : null,
    completeRate: delivered.length ? Math.round((delivered.filter((o) => o.receivedQty >= o.orderedQty).length / delivered.length) * 100) : null,
    lateRate: delivered.filter((o) => o.expectedAt).length ? Math.round((delivered.filter((o) => o.expectedAt && o.firstReceiptAt! > new Date(o.expectedAt.getTime() + day)).length / delivered.filter((o) => o.expectedAt).length) * 100) : null,
    missingProducts: O.reduce((s, o) => s + o.missingProducts, 0),
    priceEvolutionPct: priceChanges.length ? Math.round(mean(priceChanges) * 1000) / 10 : null,
  };
}

/**
 * Compare deux fournisseurs sur le panier habituel : produits achetes chez les deux sur 180 jours, valorises aux
 * quantites habituelles de l'officine. Resultat > 0 : A est plus cher que B de x %.
 */
export function basketComparison(a: string, b: string, lines: ReceiptLine[], now = new Date()) {
  const recent = lines.filter((l) => now.getTime() - l.date.getTime() < 180 * day);
  const last = (s: string, p: string) => recent.filter((l) => l.supplierId === s && l.productId === p).sort((x, y) => y.date.getTime() - x.date.getTime())[0]?.unitCost;
  const qty = new Map<string, number>();
  for (const l of recent) qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.quantity);
  let costA = 0, costB = 0, n = 0;
  for (const [p, q] of qty) {
    const pa = last(a, p), pb = last(b, p);
    if (pa === undefined || pb === undefined) continue;
    costA += pa * q; costB += pb * q; n += 1;
  }
  if (!n || !costB) return null;
  return { commonProducts: n, basketA: costA, basketB: costB, diffPct: Math.round(((costA - costB) / costB) * 1000) / 10 };
}
