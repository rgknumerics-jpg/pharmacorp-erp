import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';

/**
 * Lecture d'une base « WinPharma / MySQL MyISAM » (fichiers .MYD / .frm / .MYI) sans serveur MySQL.
 * Les fichiers .frm de ce logiciel sont chiffrés (noms de colonnes illisibles) : on s'appuie sur la longueur
 * d'enregistrement (en clair dans l'en-tête .frm) et sur la disposition fixe des colonnes, établie à partir de la base.
 * Chaque enregistrement est de longueur fixe ; l'octet 0 vaut 0 pour un enregistrement supprimé.
 */
export interface WpTable { name: string; columns: string[]; rows: Record<string, string>[] }
export interface WpResult { tables: WpTable[]; notes: string[] }

const REC: Record<string, number> = { produit: 319, prodean: 35, fournis: 407, clients: 962, orders: 776, orditem: 162 };
const txt = (b: Buffer, s: number, e: number) => b.toString('latin1', s, e).replace(/\0/g, ' ').replace(/\s+/g, ' ').trim();
const money = (n: number) => String(Math.round(n));

/** Fichiers d'une table, copies « nom (1).MYD » comprises. */
function files(dir: string, table: string): string[] {
  const re = new RegExp(`^${table}( \\(\\d+\\))?\\.myd$`, 'i');
  return readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f)).sort((a, b) => statSync(b).size - statSync(a).size);
}
function recLen(file: string, table: string): number {
  const frm = file.replace(/\.myd$/i, '.frm');
  const fromFrm = existsSync(frm) ? readFileSync(frm).readUInt16LE(16) : 0;
  const len = fromFrm || REC[table];
  const size = statSync(file).size;
  if (size % len !== 0) { if (REC[table] && size % REC[table] === 0) return REC[table]; throw new Error(`${path.basename(file)} : taille inattendue (${size} octets, enregistrement de ${len}).`); }
  return len;
}
function* records(file: string, table: string): Generator<Buffer> {
  const len = recLen(file, table);
  const buf = readFileSync(file);
  for (let o = 0; o + len <= buf.length; o += len) if (buf[o] !== 0) yield buf.subarray(o, o + len);
}

export function isWinPharmaDir(dir: string): boolean {
  try { return statSync(dir).isDirectory() && files(dir, 'produit').length > 0; } catch { return false; }
}

// ------------------------------------------------------------------ tables
export function productsOf(dir: string) {
  const ean = new Map<number, string[]>();
  for (const f of files(dir, 'prodean').slice(0, 1)) for (const r of records(f, 'prodean')) {
    const code = txt(r, 1, 15).replace(/\s/g, ''), id = r.readUInt32LE(15);
    if (!code || /^0+$/.test(code)) continue;
    ean.set(id, [...(ean.get(id) ?? []), code]);
  }
  const best = (id: number, embedded: string) => { const l = ean.get(id) ?? (embedded ? [embedded] : []); return l.find((c) => /^340\d{10}$/.test(c)) ?? l.find((c) => c.length === 13) ?? l[0] ?? ''; };
  const out: { id: number; code: string; name: string; sale: number; buy: number; stock: number; barcode: string }[] = [];
  const seen = new Set<number>();
  for (const f of files(dir, 'produit')) for (const r of records(f, 'produit')) {
    const id = r.readUInt32LE(1); if (seen.has(id)) continue; seen.add(id);
    const name = txt(r, 5, 47); if (!name) continue;
    const embedded = txt(r, 47, 63).replace(/\s/g, '');
    out.push({ id, code: String(id), name, sale: r.readDoubleLE(63), buy: r.readDoubleLE(71), stock: r.readInt16LE(101), barcode: best(id, /^\d{13}$/.test(embedded) ? embedded : '') });
  }
  return out;
}

function suppliersOf(dir: string) {
  const out: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const f of files(dir, 'fournis').slice(0, 1)) for (const r of records(f, 'fournis')) {
    const name = txt(r, 9, 41); if (name.length < 2) continue;
    if (!/laborex|\bubi|\bcep\b|\bsep\b/i.test(name)) continue; // seuls les trois grossistes principaux sont repris
    const code = txt(r, 1, 9); const k = `${code}|${name}`; if (seen.has(k)) continue; seen.add(k);
    out.push({ 'Code': code, 'Fournisseur': name, 'Adresse': txt(r, 41, 140) });
  }
  return out;
}

function customersOf(dir: string) {
  const out: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const f of files(dir, 'clients').slice(0, 1)) for (const r of records(f, 'clients')) {
    const name = txt(r, 7, 67); if (name.length < 3) continue;
    const k = name.toUpperCase(); if (seen.has(k) || /^(CONTRACEPTIF|DELIVRANCE|D.LIVRANCE)/.test(k)) continue; seen.add(k);
    out.push({ 'Nom': name });
  }
  return out;
}

const ymd = (n: number) => { const s = String(n); return /^20\d{6}$|^19\d{6}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : ''; };

/** Ventes : commandes (en-tête) + lignes, toutes copies confondues, dédoublonnées ; uniquement depuis `since` (AAAA-MM-JJ). */
function salesOf(dir: string, products: Map<number, string>, since: string) {
  const heads = new Map<number, { date: string; customer: string }>();
  for (const f of files(dir, 'orders')) for (const r of records(f, 'orders')) {
    const id = r.readUInt32LE(1); const date = ymd(r.readUInt32LE(9));
    if (!date || date < since || heads.has(id)) continue;
    heads.set(id, { date, customer: txt(r, 63, 123) });
  }
  const rows: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const f of files(dir, 'orditem')) for (const r of records(f, 'orditem')) {
    const oid = r.readUInt32LE(1); const h = heads.get(oid); if (!h) continue;
    const key = `${oid}:${r.readUInt16LE(5)}:${r.readUInt32LE(7)}`; if (seen.has(key)) continue; seen.add(key);
    const name = products.get(r.readUInt32LE(7)); if (!name) continue;
    const unit = r.readDoubleLE(29), total = r.readDoubleLE(75);
    if (!(total > 0) || !(unit > 0)) continue;
    const qty = Math.max(1, Math.round(total / unit));
    rows.push({ 'Date': h.date, 'Ticket': String(oid), 'Produit': name, 'Quantité': String(qty), 'Prix unitaire': money(unit), 'Montant': money(total), 'Client': h.customer });
  }
  rows.sort((a, b) => a.Date.localeCompare(b.Date) || Number(a.Ticket) - Number(b.Ticket));
  return { rows, orders: heads.size };
}

/** Lit la base et renvoie des tableaux prêts pour la Reprise des données (colonnes reconnues automatiquement). */
export function readWinPharmaFolder(dir: string, opt: { since?: string } = {}): WpResult {
  if (!isWinPharmaDir(dir)) throw new Error('Dossier non reconnu : il doit contenir les fichiers de la base (PRODUIT.MYD, FOURNIS.MYD…).');
  const notes: string[] = [];
  const prods = productsOf(dir);
  const tables: WpTable[] = [];
  const pc = ['Code produit', 'Code-barres', 'Désignation', 'Prix de vente', 'Prix d\'achat'];
  tables.push({ name: 'Produits', columns: pc, rows: prods.map((p) => ({ 'Code produit': p.code, 'Code-barres': p.barcode, 'Désignation': p.name, 'Prix de vente': money(p.sale), 'Prix d\'achat': money(p.buy) })) });
  const inStock = prods.filter((p) => p.stock > 0);
  tables.push({ name: 'Stock', columns: ['Code produit', 'Désignation', 'Quantité en stock', 'Prix d\'achat'], rows: inStock.map((p) => ({ 'Code produit': p.code, 'Désignation': p.name, 'Quantité en stock': String(p.stock), 'Prix d\'achat': money(p.buy) })) });
  const sup = suppliersOf(dir); if (sup.length) tables.push({ name: 'Fournisseurs', columns: ['Code', 'Fournisseur', 'Adresse'], rows: sup });
  notes.push('Fournisseurs : seuls Laborex, Ubipharm et CEP/SEP sont repris (les autres fiches de l’ancienne base sont ignorées).');
  const cus = customersOf(dir); if (cus.length) tables.push({ name: 'Clients', columns: ['Nom'], rows: cus });
  const since = opt.since && /^\d{4}-\d{2}-\d{2}$/.test(opt.since) ? opt.since : '2024-10-01';
  if (files(dir, 'orders').length && files(dir, 'orditem').length) {
    const nameById = new Map(prods.map((p) => [p.id, p.name]));
    const s = salesOf(dir, nameById, since);
    if (s.rows.length) tables.push({ name: 'Ventes', columns: ['Date', 'Ticket', 'Produit', 'Quantité', 'Prix unitaire', 'Montant', 'Client'], rows: s.rows });
    notes.push(`Ventes depuis le ${since} : ${s.orders} tickets, ${s.rows.length} lignes.`);
  }
  notes.push(`${prods.length} produits (${prods.filter((p) => p.barcode).length} avec code-barres / CIP), ${inStock.length} en stock.`);
  return { tables, notes };
}
