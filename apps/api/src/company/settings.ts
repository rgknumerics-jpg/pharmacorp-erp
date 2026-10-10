/** Réglages généraux de l'établissement (CompanyProfile.settings) : valeurs par défaut + nettoyage des entrées. */
export interface Settings {
  /** Politique de caisse : ce que la caissière voit. Par défaut, rien de la recette (comptage à l'aveugle). */
  cashPolicy: { showExpected: boolean; showTakings: boolean };
  /** Postes protégés par un code personnel : le code identifie la personne qui travaille. */
  posLock: { seller: boolean; cashier: boolean; direct: boolean };
  /** Listes créées par l'utilisateur, proposées dans la fiche produit. */
  lists: { forms: string[]; locations: string[] };
  /** Mentions affichées sur le ticket de caisse. */
  ticketFields: { rccm: boolean; niu: boolean; authorization: boolean; patente: boolean; bank: boolean; address: boolean; phone: boolean; email: boolean };
  legal: { bankName: string; bankAccount: string };
  /** Application client / boutique en ligne : catégories masquées par l'administrateur. */
  /** Fonctions de l'ERP que l'administrateur rend visibles ou non (menu masqué quand la fonction est désactivée). */
  modules: Record<string, boolean>;
  /** Horaires de travail (contrôle des arrivées) et verrouillage des onglets par code personnel (journalisation de qui fait quoi). */
  attendance: { start: string; end: string; tolerance: number };
  accessLock: { enabled: boolean };
  online: {
    enabled: boolean; hiddenCategoryIds: string[]; hiddenForms: string[]; registration: boolean; delivery: boolean;
    /** Identité propre de l'application/site client, distincte de la pharmacie (ex. « Rive Gauche », pas « PharmaCorp »).
     * Vide = on retombe sur le nom et le logo de la pharmacie (comportement d'avant). */
    brandName: string; tagline: string; logoUrl: string; primaryColor: string;
  };
  /**
   * Horaires des caisses : en semaine ordinaire (2 postes) et en semaine de garde (3 postes, dont un de nuit
   * qui traverse minuit). `guardActive` est basculé par le titulaire au début/à la fin d'une garde.
   */
  cashRegisters: { guardActive: boolean; ordinary: CashShift[]; guard: CashShift[] };
}

export interface CashShift { number: number; start: string; end: string }

export const MODULE_KEYS = ['online', 'chat', 'plants', 'training', 'library', 'directory', 'payroll', 'suppliers', 'ai'] as const;
export const DEFAULT_SETTINGS: Settings = {
  attendance: { start: '08:00', end: '18:00', tolerance: 10 },
  accessLock: { enabled: false },
  // IA desactivee par defaut (seul module ici qui a un cout reel) : le titulaire l'active sciemment, jamais par defaut.
  modules: { online: false, chat: true, plants: true, training: true, library: true, directory: true, payroll: true, suppliers: true, ai: false },
  cashPolicy: { showExpected: false, showTakings: false },
  posLock: { seller: false, cashier: false, direct: true },
  lists: { forms: [], locations: [] },
  ticketFields: { rccm: true, niu: true, authorization: false, patente: false, bank: false, address: true, phone: true, email: false },
  legal: { bankName: '', bankAccount: '' },
  online: { enabled: false, hiddenCategoryIds: [], hiddenForms: [], registration: true, delivery: false, brandName: '', tagline: '', logoUrl: '', primaryColor: '' },
  cashRegisters: {
    guardActive: false,
    ordinary: [{ number: 1, start: '08:00', end: '13:30' }, { number: 2, start: '13:30', end: '19:00' }],
    guard: [{ number: 1, start: '08:00', end: '15:00' }, { number: 2, start: '15:00', end: '19:00' }, { number: 3, start: '19:00', end: '08:00' }],
  },
};

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const strs = (v: unknown, max = 80, n = 200) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? '').trim().slice(0, max)).filter(Boolean))].slice(0, n) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Fusionne `input` dans `cur` (partiel accepté) ; toute valeur inconnue ou mal typée est ignorée. */
export function mergeSettings(cur: unknown, input: unknown): Settings {
  const c = withSettings(cur), i = obj(input);
  const out: Settings = JSON.parse(JSON.stringify(c));
  const pick = <K extends keyof Settings>(k: K, f: (src: Record<string, unknown>, base: Settings[K]) => Settings[K]) => { if (k in i) out[k] = f(obj(i[k]), c[k]); };
  pick('cashPolicy', (s, b) => ({ showExpected: bool(s.showExpected, b.showExpected), showTakings: bool(s.showTakings, b.showTakings) }));
  pick('posLock', (s, b) => ({ seller: bool(s.seller, b.seller), cashier: bool(s.cashier, b.cashier), direct: bool(s.direct, b.direct) }));
  pick('lists', (s, b) => ({ forms: 'forms' in s ? strs(s.forms, 60) : b.forms, locations: 'locations' in s ? strs(s.locations, 60) : b.locations }));
  pick('ticketFields', (s, b) => Object.fromEntries(Object.keys(b).map((k) => [k, bool(s[k], (b as Record<string, boolean>)[k])])) as Settings['ticketFields']);
  pick('attendance', (s, b) => ({ start: /^\d{2}:\d{2}$/.test(String(s.start)) ? String(s.start) : b.start, end: /^\d{2}:\d{2}$/.test(String(s.end)) ? String(s.end) : b.end, tolerance: Math.min(120, Math.max(0, Math.round(Number(s.tolerance ?? b.tolerance)) || 0)) }));
  pick('accessLock', (s, b) => ({ enabled: bool(s.enabled, b.enabled) }));
  if ('modules' in i) { const s = obj(i.modules); out.modules = { ...c.modules, ...Object.fromEntries((MODULE_KEYS as readonly string[]).filter((k) => typeof s[k] === 'boolean').map((k) => [k, s[k] as boolean])) }; }
  pick('legal', (s, b) => ({ bankName: 'bankName' in s ? String(s.bankName ?? '').slice(0, 80) : b.bankName, bankAccount: 'bankAccount' in s ? String(s.bankAccount ?? '').slice(0, 80) : b.bankAccount }));
  const str = (v: unknown, b: string, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : b);
  pick('online', (s, b) => ({
    enabled: bool(s.enabled, b.enabled), registration: bool(s.registration, b.registration), delivery: bool(s.delivery, b.delivery),
    hiddenCategoryIds: 'hiddenCategoryIds' in s ? strs(s.hiddenCategoryIds, 40, 500) : b.hiddenCategoryIds, hiddenForms: 'hiddenForms' in s ? strs(s.hiddenForms, 60, 200) : b.hiddenForms,
    brandName: 'brandName' in s ? str(s.brandName, b.brandName, 60) : b.brandName,
    tagline: 'tagline' in s ? str(s.tagline, b.tagline, 140) : b.tagline,
    logoUrl: 'logoUrl' in s ? str(s.logoUrl, b.logoUrl, 500_000) : b.logoUrl,
    primaryColor: 'primaryColor' in s && /^#[0-9a-fA-F]{6}$/.test(String(s.primaryColor)) ? String(s.primaryColor) : ('primaryColor' in s && s.primaryColor === '' ? '' : b.primaryColor),
  }));
  const shifts = (v: unknown, b: CashShift[]): CashShift[] => {
    if (!Array.isArray(v)) return b;
    const time = (x: unknown, d: string) => (/^\d{2}:\d{2}$/.test(String(x)) ? String(x) : d);
    const out = v.slice(0, 6).map((s, i) => { const o = obj(s); return { number: Math.min(9, Math.max(1, Math.round(Number(o.number ?? i + 1)) || i + 1)), start: time(o.start, '08:00'), end: time(o.end, '18:00') }; });
    return out.length ? out : b;
  };
  pick('cashRegisters', (s, b) => ({ guardActive: bool(s.guardActive, b.guardActive), ordinary: shifts(s.ordinary, b.ordinary), guard: shifts(s.guard, b.guard) }));
  return out;
}

export function withSettings(raw: unknown): Settings {
  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
  const r = obj(raw);
  if (!Object.keys(r).length) return base;
  const out: Settings = { ...base };
  for (const k of Object.keys(base) as (keyof Settings)[]) out[k] = { ...(base[k] as object), ...obj(r[k]) } as never;
  return out;
}
