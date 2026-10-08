/**
 * Calcul de paie -- Congo. Les TAUX GLOBAUX viennent de la note ACPCE 2026 (CNSS 24,28 % du brut, CAMU 2,27 % / 4,55 %,
 * TUS 2,025 % + 5,475 %, TOL 1 000 / 5 000 F). La REPARTITION de la CNSS par branche, les PLAFONDS et le BAREME ITS
 * sont des valeurs par defaut a faire confirmer par le comptable : ils sont modifiables par etablissement
 * (parametres de la paie) et figes dans chaque bulletin valide.
 */
export interface PayrollParameters {
  version: string;
  cnss: { employeePension: number; employerPension: number; family: number; workAccident: number; pensionCeiling: number; otherCeiling: number };
  camu: { employee: number; employer: number };
  tus: { tax: number; social: number };
  tol: { centre: number; peripherie: number };
  its: { abatementRate: number; maxParts: number; brackets: { upTo: number | null; rate: number }[] };
  verified: boolean;
}

export const DEFAULT_PAYROLL_PARAMETERS: PayrollParameters = {
  version: 'CG-2026-defaut',
  // 4 + 8 + 10,03 + 2,25 = 24,28 % (taux global de la note ACPCE 2026)
  cnss: { employeePension: 4, employerPension: 8, family: 10.03, workAccident: 2.25, pensionCeiling: 1_200_000, otherCeiling: 600_000 },
  camu: { employee: 2.27, employer: 4.55 },
  tus: { tax: 2.025, social: 5.475 },
  tol: { centre: 5000, peripherie: 1000 },
  // bareme annuel par part (CGI) -- A CONFIRMER au regard de la loi de finances 2026
  its: { abatementRate: 20, maxParts: 6.5, brackets: [{ upTo: 464_000, rate: 1 }, { upTo: 1_000_000, rate: 10 }, { upTo: 3_000_000, rate: 25 }, { upTo: null, rate: 40 }] },
  verified: false,
};

const pct = (base: number, rate: number) => Math.round((base * rate) / 100);

/** Impot annuel par application du bareme progressif sur un revenu annuel imposable (par part). */
export function progressiveTax(income: number, brackets: PayrollParameters['its']['brackets']): number {
  let tax = 0, lower = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Number.POSITIVE_INFINITY;
    if (income > lower) tax += (Math.min(income, upper) - lower) * (b.rate / 100);
    lower = upper;
    if (income <= upper) break;
  }
  return Math.round(tax);
}

/** Element de salaire soumis (prime de risque, de caisse, responsabilite, diplome, conges payes, heures sup...). */
export interface PayItem { label: string; amount: number }
/** Retenue apres net (acompte quinzaine, avance, pret, achats a la pharmacie, avantages en nature). */
export interface PayDeduction extends PayItem { kind?: 'acompte' | 'avance' | 'pret' | 'pharmacie' | 'nature' | 'autre' }

export interface PayslipInput {
  baseSalary: number;
  /** Ancien total des primes (compatibilite) : ajoute au brut. */
  bonuses?: number;
  /** Anciennete en % du salaire de base (bulletin : "Anciennete 65 700 x 6 %"). */
  seniorityRate?: number;
  /** Primes et elements soumis aux cotisations et a l'impot. */
  earnings?: PayItem[];
  /** Indemnites non soumises, ajoutees apres impot (allocations familiales, prime de transport, rations). */
  allowances?: PayItem[];
  deductions?: PayDeduction[];
  taxParts: number;
  zone: 'centre' | 'peripherie';
}

export function computePayslip(input: PayslipInput, p: PayrollParameters = DEFAULT_PAYROLL_PARAMETERS) {
  const seniority = Math.round((input.baseSalary * (input.seniorityRate ?? 0)) / 100);
  const earnings = (input.earnings ?? []).filter((e) => e.amount > 0).map((e) => ({ label: e.label, amount: Math.round(e.amount) }));
  const gross = input.baseSalary + seniority + (input.bonuses ?? 0) + earnings.reduce((s, e) => s + e.amount, 0);
  const pensionBase = Math.min(gross, p.cnss.pensionCeiling), otherBase = Math.min(gross, p.cnss.otherCeiling);
  const cnssEmployee = pct(pensionBase, p.cnss.employeePension);
  const cnssEmployer = pct(pensionBase, p.cnss.employerPension) + pct(otherBase, p.cnss.family) + pct(otherBase, p.cnss.workAccident);
  // CAMU et TOL : desactivables dans les parametres de l'etablissement (taux 0)
  const camuEmployee = pct(gross, p.camu.employee), camuEmployer = pct(gross, p.camu.employer);
  const tusTax = pct(gross, p.tus.tax), tusSocial = pct(gross, p.tus.social);
  const tol = input.zone === 'peripherie' ? p.tol.peripherie : p.tol.centre;

  // ITS : (brut - cotisations sociales salariales) - abattement, annualise, divise par le nombre de parts
  const parts = Math.min(Math.max(input.taxParts || 1, 1), p.its.maxParts);
  const taxableMonthly = Math.max(0, gross - cnssEmployee);
  const annualNet = Math.round(taxableMonthly * 12 * (1 - p.its.abatementRate / 100));
  const its = Math.round((progressiveTax(annualNet / parts, p.its.brackets) * parts) / 12);

  const employeeDeductions = cnssEmployee + camuEmployee + its + tol;
  const net = gross - employeeDeductions;
  const allowances = (input.allowances ?? []).filter((a) => a.amount > 0).map((a) => ({ label: a.label, amount: Math.round(a.amount) }));
  const allowancesTotal = allowances.reduce((s, a) => s + a.amount, 0);
  const deductions = (input.deductions ?? []).filter((d) => d.amount > 0).map((d) => ({ label: d.label, amount: Math.round(d.amount), kind: d.kind ?? 'autre' }));
  const deductionsTotal = deductions.reduce((s, d) => s + d.amount, 0);
  const employerCharges = cnssEmployer + camuEmployer + tusTax + tusSocial;
  return {
    gross, net, employerCost: gross + allowancesTotal + employerCharges,
    /** Lignes du bulletin, dans l'ordre du modele papier. */
    lines: { baseSalary: input.baseSalary, seniorityRate: input.seniorityRate ?? 0, seniority, earnings, afterSocial: gross - cnssEmployee - camuEmployee, taxBaseMonthly: Math.round(taxableMonthly * (1 - p.its.abatementRate / 100)) },
    allowances, allowancesTotal, dueTotal: net + allowancesTotal,
    deductions, deductionsTotal,
    netToPay: net + allowancesTotal - deductionsTotal,
    employee: { cnss: cnssEmployee, camu: camuEmployee, its, tol, total: employeeDeductions },
    employer: { cnss: cnssEmployer, camu: camuEmployer, tusTax, tusSocial, total: employerCharges },
    bases: { pensionBase, otherBase, taxableAnnualPerPart: Math.round(annualNet / parts), parts },
  };
}
export type PayslipResult = ReturnType<typeof computePayslip>;
