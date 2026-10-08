/**
 * Reconnaissance automatique du contenu d'un tableau importe (produits, stock, clients et creances, fournisseurs,
 * historique des ventes, depenses, banque) et correspondance colonnes -> champs PHARMACORP, a partir des intitules
 * usuels des logiciels d'officine et des exports Excel (francais / anglais).
 */
export type Entity = 'products' | 'stock' | 'customers' | 'suppliers' | 'sales' | 'expenses' | 'bank';

export const ENTITY_LABEL: Record<Entity, string> = {
  products: 'Produits (catalogue et prix)', stock: 'Stock (quantités, lots, péremptions)', customers: 'Clients (créances, plafonds, avoirs)',
  suppliers: 'Fournisseurs (et soldes dus)', sales: 'Historique des ventes', expenses: 'Dépenses', bank: 'Banque et trésorerie',
};

export interface FieldDef { label: string; syn: string[]; required?: boolean }

export const FIELDS: Record<Entity, Record<string, FieldDef>> = {
  products: {
    sku: { label: 'Code interne', syn: ['code', 'code produit', 'ref', 'reference', 'référence', 'id produit', 'codeprod', 'cip', 'cip7', 'code article', 'sku', 'id'] },
    barcode: { label: 'Code-barres', syn: ['ean', 'ean13', 'code barre', 'code barres', 'codebarre', 'gencod', 'cip13', 'barcode'] },
    name: { label: 'Désignation', syn: ['designation', 'désignation', 'libelle', 'libellé', 'produit', 'nom', 'nom produit', 'article', 'description', 'name', 'product'], required: true },
    dci: { label: 'DCI', syn: ['dci', 'molecule', 'molécule', 'principe actif', 'generic'] },
    form: { label: 'Forme', syn: ['forme', 'forme galenique', 'galénique'] },
    dosage: { label: 'Dosage', syn: ['dosage', 'concentration'] },
    laboratory: { label: 'Laboratoire', syn: ['labo', 'laboratoire', 'fabricant', 'marque', 'manufacturer', 'brand'] },
    category: { label: 'Famille', syn: ['famille', 'categorie', 'catégorie', 'rayon', 'classe', 'groupe', 'category'] },
    salePrice: { label: 'Prix de vente', syn: ['prix vente', 'prix de vente', 'pv', 'pvttc', 'pv ttc', 'prix public', 'ppv', 'prix ttc', 'prix', 'sale price', 'price'] },
    purchasePrice: { label: 'Prix d\'achat', syn: ['prix achat', 'prix d achat', 'pa', 'paht', 'pa ht', 'cout', 'coût', 'prix revient', 'pght', 'cost', 'purchase price'] },
    vatRate: { label: 'TVA (%)', syn: ['tva', 'taux tva', 'vat'] },
    minStock: { label: 'Stock minimum', syn: ['stock mini', 'stock min', 'seuil', 'mini', 'minimum', 'stock alerte'] },
    supplierCode: { label: 'CIP du grossiste choisi', syn: ['cip grossiste', 'code grossiste', 'cip fournisseur', 'code fournisseur', 'cip laborex', 'cip ubipharm', 'cip sep'] },
  },
  stock: {
    product: { label: 'Produit (code, code-barres ou nom)', syn: ['code', 'code produit', 'ref', 'reference', 'cip', 'ean', 'code barre', 'designation', 'désignation', 'libelle', 'produit', 'article', 'nom'], required: true },
    quantity: { label: 'Quantité en stock', syn: ['stock', 'qte', 'qté', 'quantite', 'quantité', 'stock actuel', 'stock reel', 'stock réel', 'qty', 'quantity', 'en stock'], required: true },
    lotNumber: { label: 'N° de lot', syn: ['lot', 'n lot', 'numero lot', 'num lot', 'batch'] },
    expiryDate: { label: 'Date de péremption', syn: ['peremption', 'péremption', 'date peremption', 'dlc', 'dluo', 'exp', 'expiration', 'date exp', 'expiry'] },
    unitCost: { label: 'Coût unitaire', syn: ['prix achat', 'pa', 'cout', 'coût', 'valeur unitaire', 'cost'] },
  },
  customers: {
    name: { label: 'Nom', syn: ['nom', 'client', 'nom client', 'raison sociale', 'nom et prenom', 'nom prénom', 'name', 'customer'], required: true },
    phone: { label: 'Téléphone', syn: ['tel', 'tél', 'telephone', 'téléphone', 'portable', 'mobile', 'gsm', 'contact', 'phone'] },
    email: { label: 'E-mail', syn: ['email', 'e-mail', 'mail', 'courriel'] },
    creditLimit: { label: 'Plafond de crédit', syn: ['plafond', 'plafond credit', 'plafond crédit', 'limite credit', 'encours max', 'credit limit'] },
    balance: { label: 'Créance (solde dû)', syn: ['solde', 'creance', 'créance', 'du', 'dû', 'encours', 'reste a payer', 'reste à payer', 'dette', 'credit', 'crédit', 'balance', 'montant du'] },
    storeCredit: { label: 'Avoir', syn: ['avoir', 'avoirs', 'acompte', 'avance', 'store credit'] },
    paymentTermDays: { label: 'Délai de paiement (jours)', syn: ['delai', 'délai', 'echeance', 'échéance', 'jours'] },
  },
  suppliers: {
    name: { label: 'Nom', syn: ['fournisseur', 'nom', 'raison sociale', 'grossiste', 'supplier', 'name'], required: true },
    phone: { label: 'Téléphone', syn: ['tel', 'tél', 'telephone', 'téléphone', 'contact', 'phone'] },
    email: { label: 'E-mail', syn: ['email', 'mail'] },
    address: { label: 'Adresse', syn: ['adresse', 'address', 'ville'] },
    paymentTermDays: { label: 'Délai de paiement (jours, 0 = comptant)', syn: ['delai', 'délai', 'delai paiement', 'echeance', 'échéance', 'conditions'] },
    balance: { label: 'Solde dû au fournisseur', syn: ['solde', 'dette', 'du', 'dû', 'reste a payer', 'encours', 'balance'] },
  },
  sales: {
    date: { label: 'Date', syn: ['date', 'date vente', 'date facture', 'jour'], required: true },
    number: { label: 'N° de ticket / facture', syn: ['ticket', 'n ticket', 'numero', 'numéro', 'facture', 'n facture', 'piece', 'pièce', 'invoice'] },
    product: { label: 'Produit', syn: ['produit', 'designation', 'désignation', 'libelle', 'article', 'code', 'cip', 'ean'], required: true },
    quantity: { label: 'Quantité', syn: ['qte', 'qté', 'quantite', 'quantité', 'qty'] },
    unitPrice: { label: 'Prix unitaire', syn: ['pu', 'prix unitaire', 'prix', 'pv'] },
    total: { label: 'Montant', syn: ['montant', 'total', 'total ttc', 'montant ttc', 'net'] },
    customer: { label: 'Client', syn: ['client', 'nom client'] },
    paymentMethod: { label: 'Mode de paiement', syn: ['mode', 'reglement', 'règlement', 'paiement', 'mode paiement'] },
  },
  expenses: {
    date: { label: 'Date', syn: ['date', 'jour'], required: true },
    label: { label: 'Libellé', syn: ['libelle', 'libellé', 'designation', 'désignation', 'objet', 'description', 'motif', 'nature'], required: true },
    amount: { label: 'Montant', syn: ['montant', 'somme', 'depense', 'dépense', 'total', 'amount'], required: true },
    category: { label: 'Catégorie / compte', syn: ['categorie', 'catégorie', 'type', 'rubrique', 'compte', 'poste'] },
    paidWith: { label: 'Payé par (caisse, banque…)', syn: ['mode', 'reglement', 'règlement', 'paiement', 'caisse', 'banque'] },
  },
  bank: {
    date: { label: 'Date', syn: ['date', 'date operation', 'date opération', 'date valeur'], required: true },
    label: { label: 'Libellé', syn: ['libelle', 'libellé', 'operation', 'opération', 'description'] },
    debit: { label: 'Débit (sortie)', syn: ['debit', 'débit', 'sortie', 'retrait'] },
    credit: { label: 'Crédit (entrée)', syn: ['credit', 'crédit', 'entree', 'entrée', 'depot', 'dépôt', 'versement'] },
    amount: { label: 'Montant (signé)', syn: ['montant', 'amount'] },
    balance: { label: 'Solde', syn: ['solde', 'balance', 'solde final'] },
  },
};

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Correspondance automatique colonnes -> champs pour une entite (le meilleur intitule gagne, une colonne par champ). */
export function suggestMapping(entity: Entity, columns: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  const score = (col: string, syn: string[]) => {
    const c = norm(col);
    let best = 0;
    for (const s of syn.map(norm)) { if (c === s) best = Math.max(best, 3); else if (c.startsWith(s + ' ') || c.endsWith(' ' + s)) best = Math.max(best, 2); else if (s.length >= 3 && c.includes(s)) best = Math.max(best, 1); }
    return best;
  };
  const fields = Object.entries(FIELDS[entity]);
  const candidates: { field: string; col: string; s: number }[] = [];
  for (const [f, def] of fields) for (const col of columns) { const s = score(col, def.syn); if (s) candidates.push({ field: f, col, s }); }
  candidates.sort((a, b) => b.s - a.s);
  for (const c of candidates) if (!map[c.field] && !used.has(c.col)) { map[c.field] = c.col; used.add(c.col); }
  return map;
}

/** Entite la plus probable d'un tableau, selon le nom du tableau et la couverture des champs. */
export function detectEntity(tableName: string, columns: string[]): { entity: Entity; confidence: number } {
  const n = norm(tableName);
  const hint: Partial<Record<Entity, RegExp>> = { products: /produit|article|catalogue|item|medic/, stock: /stock|inventaire|lot/, customers: /client|patient|creance|debiteur|customer/, suppliers: /fourniss|grossiste|supplier/, sales: /vente|ticket|factur|sale|ligne/, expenses: /depense|charge|frais|expense/, bank: /banque|releve|bank|tresor/ };
  let best: { entity: Entity; confidence: number } = { entity: 'products', confidence: 0 };
  for (const e of Object.keys(FIELDS) as Entity[]) {
    const m = suggestMapping(e, columns);
    const req = Object.entries(FIELDS[e]).filter(([, d]) => d.required).map(([k]) => k);
    if (!req.every((r) => m[r])) continue;
    const coverage = Object.keys(m).length / Object.keys(FIELDS[e]).length;
    const confidence = Math.min(1, coverage + (hint[e]?.test(n) ? 0.35 : 0));
    if (confidence > best.confidence) best = { entity: e, confidence };
  }
  return { entity: best.entity, confidence: Math.round(best.confidence * 100) / 100 };
}

// ----- normalisation des valeurs -----
export function toNumber(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = String(v).replace(/[\s ]|FCFA|F CFA|XAF|F$/gi, '').replace(/[^\d,.-]/g, '');
  if (!/\d/.test(t)) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Dates : JJ/MM/AAAA, AAAA-MM-JJ, MM/AAAA (fin de mois), numero de serie Excel. */
export function toDate(v: string | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); if (Number(m[2]) <= 12) return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m && Number(m[1]) <= 12) { const y = Number(m[2]), mo = Number(m[1]); const last = new Date(Date.UTC(y, mo, 0)).getUTCDate(); return `${y}-${String(mo).padStart(2, '0')}-${last}`; }
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000); return d.toISOString().slice(0, 10); }
  return null;
}

export interface QualityReport { rows: number; usable: number; issues: { row: number; message: string }[]; duplicates: number; warnings: string[] }

/** Rapport de qualite AVANT import (ARCHITECTURE.md section 20 : nettoyage obligatoire, rapport presente au client). */
export function qualityReport(entity: Entity, mapping: Record<string, string>, rows: Record<string, string>[]): QualityReport {
  const issues: { row: number; message: string }[] = [];
  const get = (r: Record<string, string>, f: string) => (mapping[f] ? r[mapping[f]] ?? '' : '');
  const req = Object.entries(FIELDS[entity]).filter(([, d]) => d.required).map(([k, d]) => [k, d.label] as const);
  const missingMap = req.filter(([k]) => !mapping[k]);
  const warnings: string[] = missingMap.map(([, l]) => `Colonne obligatoire non associée : ${l}`);
  const keys = new Map<string, number>();
  let usable = 0, noExpiry = 0, badNumber = 0;
  rows.forEach((r, i) => {
    let ok = true;
    for (const [k, l] of req) if (mapping[k] && !get(r, k)) { ok = false; if (issues.length < 200) issues.push({ row: i + 2, message: `${l} manquant` }); }
    for (const f of ['salePrice', 'purchasePrice', 'quantity', 'creditLimit', 'balance', 'amount', 'debit', 'credit', 'unitPrice', 'total', 'storeCredit']) {
      const v = get(r, f); if (v && toNumber(v) === null) { badNumber++; if (issues.length < 200) issues.push({ row: i + 2, message: `Valeur numérique illisible (${FIELDS[entity][f]?.label ?? f}) : « ${v} »` }); }
    }
    if (entity === 'stock' && !get(r, 'expiryDate')) noExpiry++;
    for (const f of ['date', 'expiryDate']) { const v = get(r, f); if (v && !toDate(v) && issues.length < 200) issues.push({ row: i + 2, message: `Date illisible : « ${v} »` }); }
    const key = norm(get(r, entity === 'stock' || entity === 'sales' ? 'product' : entity === 'products' ? (mapping.sku ? 'sku' : 'name') : 'name') + (entity === 'stock' ? '|' + get(r, 'lotNumber') : ''));
    if (key && entity !== 'sales' && entity !== 'expenses' && entity !== 'bank') keys.set(key, (keys.get(key) ?? 0) + 1);
    if (ok) usable++;
  });
  if (noExpiry) warnings.push(`${noExpiry} ligne(s) de stock sans date de péremption : à compléter après import (le lot sera repris sans date).`);
  if (badNumber) warnings.push(`${badNumber} valeur(s) numérique(s) illisible(s) : ces champs seront ignorés.`);
  const duplicates = [...keys.values()].filter((n) => n > 1).reduce((s, n) => s + n - 1, 0);
  if (duplicates) warnings.push(`${duplicates} doublon(s) détecté(s) : les lignes en double seront fusionnées (la dernière l'emporte, les quantités de stock s'additionnent).`);
  return { rows: rows.length, usable, issues, duplicates, warnings };
}

/** Compte de charges SYSCOHADA pour une depense, d'apres son libelle ou sa categorie. */
export function expenseAccount(text: string): string {
  const t = norm(text);
  if (/loyer|bail/.test(t)) return '622';
  if (/electric|eau|snde|e2c|energie|courant|carburant|gasoil|essence/.test(t)) return '605';
  if (/transport|taxi|livraison|deplacement/.test(t)) return '618';
  if (/telephone|internet|airtime|credit tel|wifi|forfait/.test(t)) return '628';
  if (/salaire|paie|prime|personnel/.test(t)) return '661';
  if (/impot|taxe|patente|tva|cnss|camu|its|tus/.test(t)) return '641';
  if (/entretien|reparation|maintenance|nettoyage/.test(t)) return '624';
  if (/fourniture|papeterie|bureau|imprim/.test(t)) return '604';
  if (/banque|frais bancaire|agios|commission/.test(t)) return '631';
  if (/publicite|pub|marketing/.test(t)) return '627';
  if (/assurance/.test(t)) return '625';
  return '658';
}
