/**
 * Calendrier des obligations fiscales et sociales -- Republique du Congo, annee 2026.
 * Source : note ACPCE n° 0063/MPMEA/ACPCE/DG du 25/02/2026 "Calendrier des obligations fiscales et sociales 2026"
 * (mise a jour de la loi n° 42-2025 du 31/12/2025 portant loi de finances 2026) et article 461 bis du CGI
 * (declaration et paiement au plus tard le 15 de chaque mois, le 20 pour le mois d'aout).
 * Les obligations sans application pour la structure (selon son profil) ne sont pas proposees.
 * Echeance qui tombe un samedi, un dimanche ou un jour ferie : on retient le DERNIER JOUR OUVRE QUI PRECEDE
 * (l'article 461 bis ne prevoit pas de report).
 */

export interface TaxProfileInput {
  taxRegime: string; // reel | forfait
  incomeTax: string; // IS | IBA
  vatRegistered: boolean;
  employeesCount: number;
  rentsPremises: boolean;
  ownsProperty: boolean;
}

export interface Occurrence {
  obligation: string;
  label: string;
  authority: string;
  basis: string;
  period: string;
  /** Date limite legale (AAAA-MM-JJ). */
  legalDue: string;
  /** Date a retenir en pratique (dernier jour ouvre si la date legale tombe un jour non ouvre). */
  due: string;
  note?: string;
}

interface Obligation {
  code: string;
  label: string;
  authority: string;
  basis: string;
  note?: string;
  applies: (p: TaxProfileInput) => boolean;
  /** Echeances de l'annee civile `year` : [periode, date limite]. */
  schedule: (year: number) => [string, Date][];
}

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const iso = (x: Date) => x.toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');
const hasStaff = (p: TaxProfileInput) => p.employeesCount > 0;
const reel = (p: TaxProfileInput) => p.taxRegime !== 'forfait';

/** Echeance mensuelle de l'article 461 bis : le 15 du mois suivant la periode (le 20 en août). */
const monthly = (year: number): [string, Date][] =>
  Array.from({ length: 12 }, (_, i) => {
    const m = i + 1; // mois de l'echeance
    const pm = m === 1 ? 12 : m - 1, py = m === 1 ? year - 1 : year;
    return [`${py}-${pad(pm)}`, d(year, m, m === 8 ? 20 : 15)];
  });
const quarters = (year: number, dates: [number, number][], labels: string[]): [string, Date][] =>
  dates.map(([m, day], i) => [`${year}-${labels[i]}`, d(year, m, day)]);

export const OBLIGATIONS: Obligation[] = [
  // --- mensuelles ---
  { code: 'TVA', label: 'TVA et centimes additionnels', authority: 'Bureau des impôts compétent', basis: 'TVA 18 % / 5 % / 0 % du CA HT ; centimes additionnels 5 % de la TVA', applies: (p) => reel(p) && p.vatRegistered, schedule: monthly },
  { code: 'ITS', label: 'ITS — impôt sur les traitements et salaires (retenue)', authority: 'Bureau des impôts compétent', basis: 'Selon bareme', applies: hasStaff, schedule: monthly },
  { code: 'TUS', label: 'TUS — taxe unique sur les salaires', authority: 'Bureau des impôts (2,025 %) et CNSS (5,475 %)', basis: '2,025 % + 5,475 % du salaire brut', applies: hasStaff, schedule: monthly },
  { code: 'CAMU', label: 'Contribution CAMU (assurance maladie universelle)', authority: 'Bureau des impôts compétent', basis: '2,27 % part salariale, 4,55 % part patronale', applies: hasStaff, schedule: monthly },
  { code: 'TOL_SAL', label: 'TOL — retenue sur salaires', authority: 'Bureau des impôts compétent', basis: '1 000 F/employé (peripherie), 5 000 F/employé (centre-ville)', applies: hasStaff, schedule: monthly },
  {
    code: 'CNSS', label: 'Cotisations CNSS', authority: 'CNSS', basis: '24,28 % du salaire brut',
    note: 'Article 22 du Code de sécurité sociale : mensuel au-delà de 20 travailleurs, trimestriel sinon (a confirmer auprès de la CNSS).',
    applies: hasStaff, schedule: monthly,
  },
  { code: 'TAXE_IMMO', label: 'Taxe immobilière sur les loyers', authority: 'Bureau de l\'enregistrement, des domaines et du timbre', basis: '1/12e du loyer annuel', applies: (p) => p.rentsPremises, schedule: monthly },
  // --- annuelles et echeances variees ---
  { code: 'TAXE_REG', label: 'Taxe régionale', authority: 'Bureau des impôts compétent', basis: '2 400 F par employé, payable en début d\'année', applies: hasStaff, schedule: (y) => [[`${y}`, d(y, 1, 15)]] },
  { code: 'TOL_PRO', label: 'TOL à usage professionnel', authority: 'Bureau des impôts compétent', basis: '60 000 F (TPE/PE), 120 000 F (ME), 500 000 F (GE)', note: 'Date du mois à confirmer auprès du centre des impôts.', applies: () => true, schedule: (y) => [[`${y}`, d(y, 1, 15)]] },
  { code: 'DAS', label: 'Déclaration annuelle des salaires (DAS 1, 2 et 3)', authority: 'Bureau des impôts / CNSS', basis: 'Salaires de l\'année precedente', applies: hasStaff, schedule: (y) => [[`${y - 1}`, d(y, 2, 15)]] },
  {
    code: 'IMF_IS', label: 'Impôt minimum forfaitaire (IS) — acompte', authority: 'Bureau des impôts compétent', basis: '1/4 de 1 % des produits',
    applies: (p) => reel(p) && p.incomeTax === 'IS', schedule: (y) => quarters(y, [[3, 15], [6, 15], [9, 15], [12, 15]], ['T1', 'T2', 'T3', 'T4']),
  },
  {
    code: 'IMF_IBA', label: 'Impôt minimum forfaitaire (IBA) — acompte', authority: 'Bureau des impôts compétent', basis: '1/4 de 1,5 % des produits d\'exploitation',
    applies: (p) => reel(p) && p.incomeTax === 'IBA', schedule: (y) => quarters(y, [[3, 15], [6, 15], [9, 15], [12, 15]], ['T1', 'T2', 'T3', 'T4']),
  },
  {
    code: 'IGF', label: 'Impôt global forfaitaire (IGF) — échéance', authority: 'Bureau des impôts compétent', basis: '5 % du CA HT / 8 % de la marge globale annuelle HT',
    applies: (p) => p.taxRegime === 'forfait', schedule: (y) => quarters(y, [[3, 20], [6, 20], [9, 15], [12, 15]], ['E1', 'E2', 'E3', 'E4']),
  },
  { code: 'PATENTE', label: 'Patente', authority: 'Bureau des impôts compétent', basis: 'Selon bareme', applies: () => true, schedule: (y) => [[`${y}`, d(y, 4, 20)]] },
  { code: 'CAMU_PM', label: 'Contribution CAMU des personnes morales', authority: 'Bureau des impôts compétent', basis: '0,5 % de la patente due', applies: (p) => p.incomeTax === 'IS', schedule: (y) => [[`${y}`, d(y, 4, 20)]] },
  { code: 'IS', label: 'Impôt sur les sociétés — solde', authority: 'Bureau des impôts compétent', basis: '28 % du résultat fiscal', applies: (p) => reel(p) && p.incomeTax === 'IS', schedule: (y) => [[`${y - 1}`, d(y, 5, 15)]] },
  { code: 'IBA', label: 'Impôt sur le bénéfice d\'affaires — solde', authority: 'Bureau des impôts compétent', basis: '30 % du résultat fiscal', applies: (p) => reel(p) && p.incomeTax === 'IBA', schedule: (y) => [[`${y - 1}`, d(y, 5, 15)]] },
  { code: 'DSF', label: 'États financiers (DSF)', authority: 'Bureau des impôts, Domaines et timbre, INS', basis: 'Exercice clos', applies: reel, schedule: (y) => [[`${y - 1}`, d(y, 5, 15)]] },
  { code: 'IRF', label: 'Impôt sur le revenu foncier', authority: 'Bureau de l\'enregistrement / conservation foncière', basis: 'Revenus locatifs', applies: (p) => p.ownsProperty, schedule: (y) => [[`${y - 1}`, d(y, 3, 15)]] },
  { code: 'CFPB', label: 'Contributions foncières (CFPB / CFPNB)', authority: 'Bureau des impôts compétent', basis: '20 % / 40 % de la valeur locative ou cadastrale', applies: (p) => p.ownsProperty, schedule: (y) => [[`${y}`, d(y, 9, 15)]] },
];

// ----- Jours non ouvres -----

function easter(y: number): Date {
  // algorithme de Meeus (calendrier gregorien)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - dd - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return d(y, month, day);
}

/** Jours feries legaux au Congo (fixes + mobiles lies a Paques). */
export function holidays(y: number): Set<string> {
  const e = easter(y), plus = (n: number) => iso(new Date(e.getTime() + n * 86_400_000));
  return new Set([`${y}-01-01`, `${y}-05-01`, `${y}-06-10`, `${y}-08-15`, `${y}-11-01`, `${y}-11-28`, `${y}-12-25`, plus(1), plus(39), plus(50)]);
}

/** Dernier jour ouvre a la date donnee ou avant (samedi, dimanche, jour ferie exclus). */
export function lastWorkingDayOnOrBefore(x: Date): Date {
  let cur = new Date(x);
  for (let i = 0; i < 10; i++) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays(cur.getUTCFullYear()).has(iso(cur))) return cur;
    cur = new Date(cur.getTime() - 86_400_000);
  }
  return cur;
}

export function occurrences(profile: TaxProfileInput, years: number[]): Occurrence[] {
  const out: Occurrence[] = [];
  for (const o of OBLIGATIONS.filter((x) => x.applies(profile))) {
    for (const y of years) {
      for (const [period, legal] of o.schedule(y)) {
        if (o.code === 'CNSS' && profile.employeesCount <= 20 && ![1, 4, 7, 10].includes(legal.getUTCMonth() + 1)) continue; // trimestriel
        out.push({ obligation: o.code, label: o.label, authority: o.authority, basis: o.basis, note: o.note, period: o.code === 'CNSS' && profile.employeesCount <= 20 ? `${period} (trimestre)` : period, legalDue: iso(legal), due: iso(lastWorkingDayOnOrBefore(legal)) });
      }
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.label.localeCompare(b.label));
}

export type AlertLevel = 'overdue' | 'j7' | 'j14' | 'j30';

/** Niveau de rappel : 1 mois, 2 semaines, 1 semaine avant, puis retard. */
export function alertLevel(due: string, today: Date): { level: AlertLevel | null; daysLeft: number } {
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const daysLeft = Math.round((Date.parse(`${due}T00:00:00Z`) - t) / 86_400_000);
  if (daysLeft < 0) return { level: 'overdue', daysLeft };
  if (daysLeft <= 7) return { level: 'j7', daysLeft };
  if (daysLeft <= 14) return { level: 'j14', daysLeft };
  if (daysLeft <= 30) return { level: 'j30', daysLeft };
  return { level: null, daysLeft };
}
