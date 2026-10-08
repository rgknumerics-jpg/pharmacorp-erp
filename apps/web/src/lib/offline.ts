/**
 * Caisse hors ligne : catalogue en cache local et file d'attente des ventes.
 * Chaque vente garde sa cle d'idempotence : la renvoyer plusieurs fois ne cree jamais de doublon cote serveur.
 */
import { api } from './api';

const CATALOG = 'erp.pos.catalog';
const QUEUE = 'erp.pos.queue';

/* eslint-disable @typescript-eslint/no-explicit-any */
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage plein ou bloque */ } };

export interface QueuedSale { key: string; payload: any; total: number; at: string; error?: string }

/** Erreur reseau (serveur injoignable) par opposition a un refus metier (stock, plafond...). */
export const isNetworkError = (e: unknown) => e instanceof TypeError || /fetch|network|réseau|Failed to/i.test((e as Error)?.message ?? '');

export async function refreshCatalog() {
  const list: any[] = [];
  for (let skip = 0; skip < 50_000; skip += 200) {
    const page = await api<any[]>(`/products?take=200&skip=${skip}`);
    list.push(...page);
    if (page.length < 200) break;
  }
  write(CATALOG, { at: new Date().toISOString(), list });
  return list.length;
}
export const catalog = (): any[] => read<{ list: any[] }>(CATALOG, { list: [] }).list;
export const catalogDate = () => read<{ at?: string }>(CATALOG, {}).at ?? null;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Recherche multi-mots : chaque mot (même non terminé) doit figurer dans le nom, la DCI ou le code ; les débuts de mots passent en premier. */
export function searchLocal(q: string, take = 12) {
  const words = norm(q.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = catalog().map((p) => {
    const hay = norm(`${p.name} ${p.dci ?? ''} ${p.sku} ${p.barcode ?? ''}`);
    if (!words.every((w) => hay.includes(w))) return null;
    const nameWords = norm(p.name).split(/[^a-z0-9]+/);
    return { p, s: words.reduce((s, w) => s + (nameWords.some((x) => x.startsWith(w)) ? 2 : 1), 0) };
  }).filter((x): x is { p: any; s: number } => !!x);
  return hits.sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name)).slice(0, take).map((x) => x.p);
}
export const byCodeLocal = (code: string) => catalog().find((p) => p.barcode === code || p.sku === code) ?? null;

export const queue = () => read<QueuedSale[]>(QUEUE, []);
export function enqueue(s: QueuedSale) { write(QUEUE, [...queue().filter((x) => x.key !== s.key), s]); }

/** Renvoie les ventes en attente ; garde celles qui echouent encore. */
export async function flush(): Promise<{ sent: number; left: number }> {
  let sent = 0;
  for (const s of queue()) {
    try {
      await api('/sales', { method: 'POST', json: s.payload });
      write(QUEUE, queue().filter((x) => x.key !== s.key)); sent += 1;
    } catch (e) {
      if (isNetworkError(e)) break; // toujours hors ligne
      write(QUEUE, queue().map((x) => (x.key === s.key ? { ...x, error: (e as Error).message } : x))); // refus metier : a traiter a la main
    }
  }
  return { sent, left: queue().length };
}
