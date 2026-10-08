/** Calcul des semaines de garde, identique a l'application Pharmacies de garde (src/services/guard.ts). */
export interface GardesCity { id: string; name: string; rotation: { type: 'cycle'; anchor: string; anchorGroup: number; groups: number; weekStart: number } | { type: 'schedule'; weeks: [string, number][]; weekStart: number; groups: number } }
export interface GardesPharmacy { id: string; cityId: string; name: string; arrondissement?: string; quartier?: string; kind: 'garde' | 'nuit'; group: number | null; address?: string; phones?: string[]; active?: boolean }

const DAY = 86_400_000;
const mod = (n: number, m: number) => ((n % m) + m) % m;
const atNoon = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
const parseIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function guardWeek(city: GardesCity, date: Date) {
  const r = city.rotation;
  const day = atNoon(date);
  const start = new Date(day.getTime() - mod(day.getUTCDay() - r.weekStart, 7) * DAY);
  const end = new Date(start.getTime() + 6 * DAY);
  const between = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / (7 * DAY));
  if (r.type === 'cycle') return { group: mod(r.anchorGroup - 1 + between(parseIso(r.anchor), start), r.groups) + 1, start, end };
  const exact = r.weeks.find(([s]) => s === iso(start));
  if (exact) return { group: exact[1], start, end };
  const ref = iso(start) < r.weeks[0][0] ? r.weeks[0] : r.weeks[r.weeks.length - 1];
  return { group: mod(ref[1] - 1 + between(parseIso(ref[0]), start), r.groups) + 1, start, end };
}

/** Semaines de garde de la pharmacie sur les `weeks` prochaines semaines. */
export function upcomingGardes(city: GardesCity, ph: GardesPharmacy, weeks = 12, from = new Date()) {
  if (ph.kind !== 'garde' || ph.group === null) return [];
  const out: { start: string; end: string }[] = [];
  for (let k = 0; k < weeks; k++) {
    const w = guardWeek(city, new Date(from.getTime() + k * 7 * DAY));
    if (w.group === ph.group) out.push({ start: iso(w.start), end: iso(w.end) });
  }
  return out;
}