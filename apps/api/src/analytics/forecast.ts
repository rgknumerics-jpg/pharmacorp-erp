/**
 * Prevision de la demande et proposition de commande, par produit.
 *
 *   ventes historiques + saisonnalite + stock actuel + delai fournisseur + stock de securite
 *     -> demande journaliere prevue -> jours de couverture / date de rupture -> quantite a commander
 *
 * Methode volontairement explicable (un pharmacien doit pouvoir verifier le calcul) :
 *  - demande de base = moyenne ponderee 30 j (poids 0,6) et 90 j (0,4) ;
 *  - saisonnalite = ventes des 30 jours equivalents l'an dernier / moyenne journaliere de l'an dernier, bornee [0,5 ; 2],
 *    appliquee seulement si l'historique couvre au moins 300 jours ;
 *  - stock de securite = z x ecart-type journalier x racine(delai), z = 1,65 (service ~95 %) ;
 *  - quantite a commander = demande x (delai + periode de revision) + securite - stock disponible.
 */
export interface ForecastInput {
  /** Ventes par jour, du plus ancien au plus recent ; le dernier element = hier. Longueur libre (jusqu'a 400). */
  dailySales: number[];
  stock: number;
  leadTimeDays: number;
  reviewDays?: number;
  /** Hausse de demande attendue (ex. semaine de garde) appliquee sur `boostDays` jours. */
  boostPct?: number;
  boostDays?: number;
  /** Nombre de jours d'historique reel (depuis la premiere vente) : au-dela, les zeros ne sont pas des jours sans vente. */
  historyDays?: number;
}

export type StockStatus = 'rupture' | 'critique' | 'a_commander' | 'ok' | 'surstock' | 'sans_vente';

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = (a: number[]) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0; };

export function forecast(input: ForecastInput) {
  // on ne retient que la periode ou le produit existait : un produit recent ne doit pas etre "dilue" par des zeros
  const s = input.historyDays !== undefined ? input.dailySales.slice(Math.max(0, input.dailySales.length - Math.max(1, input.historyDays))) : input.dailySales;
  const last = (n: number) => s.slice(Math.max(0, s.length - n));
  const avg30 = mean(last(30)), avg90 = mean(last(90));
  const base = s.length >= 30 ? 0.6 * avg30 + 0.4 * avg90 : avg90;

  let seasonal = 1;
  if (s.length >= 365) {
    const yearAvg = mean(s.slice(-365));
    // fenetre equivalente l'an dernier : les 30 jours qui commencent 365 jours avant demain
    const start = s.length - 365, window = s.slice(Math.max(0, start), Math.max(0, start + 30));
    if (yearAvg > 0 && window.length >= 20) seasonal = Math.min(2, Math.max(0.5, mean(window) / yearAvg));
  }
  const daily = base * seasonal;
  const lead = Math.max(1, input.leadTimeDays), review = input.reviewDays ?? 7;
  const safety = Math.ceil(1.65 * stdev(last(90)) * Math.sqrt(lead));
  const boost = input.boostPct && input.boostDays ? (daily * input.boostPct * input.boostDays) / 100 : 0;
  const need = daily * (lead + review) + safety + boost;
  const orderQty = Math.max(0, Math.ceil(need - input.stock));
  const daysOfCover = daily > 0 ? input.stock / daily : Number.POSITIVE_INFINITY;
  const ruptureInDays = daily > 0 ? Math.floor(input.stock / daily) : null;

  let status: StockStatus;
  if (daily === 0) status = input.stock > 0 ? 'sans_vente' : 'ok';
  else if (input.stock <= 0) status = 'rupture';
  else if (daysOfCover < lead) status = 'critique'; // la rupture arrivera avant la livraison
  else if (orderQty > 0) status = 'a_commander';
  else if (daysOfCover > 120) status = 'surstock';
  else status = 'ok';

  return {
    dailyDemand: Math.round(daily * 100) / 100,
    seasonalFactor: Math.round(seasonal * 100) / 100,
    safetyStock: safety,
    daysOfCover: Number.isFinite(daysOfCover) ? Math.round(daysOfCover) : null,
    monthsOfStock: Number.isFinite(daysOfCover) ? Math.round((daysOfCover / 30) * 10) / 10 : null,
    ruptureInDays,
    orderQty,
    status,
  };
}
