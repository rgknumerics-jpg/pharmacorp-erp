/**
 * Fichiers de commande des grossistes : lecture de leur catalogue (CSV) et écriture du fichier de commande à coller dans leur extranet.
 * Les modèles réels (Laborex, SEP/CEP) ont les colonnes « CIP/EAN/ACL 13 ; Quantite ; Description ; DCI » ; la colonne Quantite porte
 * la disponibilité (« Indisponible ») dans leur catalogue et la quantité commandée dans le fichier de commande.
 */
export type ExportColumn = 'cip' | 'quantite' | 'designation' | 'dci';
export interface ExportFormat {
  preset: 'laborex' | 'sep' | 'custom';
  separator: ';' | ',' | '\t';
  quoteAll: boolean;
  header: string[];
  bom: boolean;
  eol: 'lf' | 'crlf';
  columns: ExportColumn[];
}

export const PRESETS: Record<'laborex' | 'sep', ExportFormat> = {
  laborex: { preset: 'laborex', separator: ';', quoteAll: false, header: ['CIP/EAN/ACL 13', 'Quantite', 'Description', 'DCI'], bom: false, eol: 'lf', columns: ['cip', 'quantite', 'designation', 'dci'] },
  sep: { preset: 'sep', separator: ';', quoteAll: true, header: ['CIP', 'Quantite', 'Description', 'DCI'], bom: true, eol: 'lf', columns: ['cip', 'quantite', 'designation', 'dci'] },
};

/** Format d'un fournisseur : celui appris de son fichier, sinon un modèle, sinon le modèle Laborex (le plus simple). */
export function resolveFormat(stored: unknown): ExportFormat {
  const s = (stored ?? {}) as Partial<ExportFormat>;
  const base = s.preset === 'sep' ? PRESETS.sep : PRESETS.laborex;
  const cols = Array.isArray(s.columns) && s.columns.length === 4 && s.columns.every((c) => ['cip', 'quantite', 'designation', 'dci'].includes(c)) ? s.columns : base.columns;
  return {
    preset: s.preset ?? 'laborex',
    separator: s.separator === ',' || s.separator === '\t' ? s.separator : ';',
    quoteAll: typeof s.quoteAll === 'boolean' ? s.quoteAll : base.quoteAll,
    header: Array.isArray(s.header) && s.header.length === 4 ? s.header.map(String) : base.header,
    bom: typeof s.bom === 'boolean' ? s.bom : base.bom,
    eol: s.eol === 'crlf' ? 'crlf' : 'lf',
    columns: cols as ExportColumn[],
  };
}

export interface OrderLine { cip: string; quantite: number; designation: string; dci: string }

const cell = (v: string, f: ExportFormat) => {
  const s = String(v ?? '').replace(/\r?\n/g, ' ');
  if (f.quoteAll) return `"${s.replace(/"/g, '""')}"`;
  return s.includes(f.separator) || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Texte du fichier de commande (sans BOM) + octets prêts à télécharger (avec BOM si le modèle l'exige). */
export function buildOrderFile(format: ExportFormat, lines: OrderLine[]): { text: string; bytes: Buffer } {
  const eol = format.eol === 'crlf' ? '\r\n' : '\n';
  const row = (vals: string[]) => vals.map((v) => cell(v, format)).join(format.separator);
  const body = lines.map((l) => row(format.columns.map((c) => (c === 'cip' ? l.cip : c === 'quantite' ? String(l.quantite) : c === 'designation' ? l.designation : l.dci))));
  const text = [row(format.header), ...body].join(eol) + eol;
  const bytes = Buffer.concat([format.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(text, 'utf8')]);
  return { text, bytes };
}

export interface CatalogRow { cip: string; designation: string; dci: string; available: boolean }
export interface ParsedCatalog { rows: CatalogRow[]; format: ExportFormat; skipped: number }

/** Découpe un CSV en respectant les guillemets. */
export function splitCsv(text: string, sep: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); out.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur.replace(/\r$/, '')); out.push(row); }
  return out;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Lit un fichier catalogue de grossiste (UTF-8 avec ou sans BOM, ANSI en repli) et apprend son format. */
export function parseCatalogCsv(buf: Buffer): ParsedCatalog {
  const bom = buf.length > 2 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  let text = buf.subarray(bom ? 3 : 0).toString('utf8');
  if (text.includes('�')) text = buf.subarray(bom ? 3 : 0).toString('latin1'); // fichier ANSI
  const firstLine = text.split('\n', 1)[0] ?? '';
  const sep = ([';', '\t', ','] as const).reduce((best, s) => (firstLine.split(s).length > firstLine.split(best).length ? s : best), ';');
  const eol: 'lf' | 'crlf' = text.includes('\r\n') ? 'crlf' : 'lf';
  const rows = splitCsv(text, sep).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length < 2) throw new Error('Fichier vide ou illisible.');
  const head = rows[0].map((h) => h.trim());
  const idx = (re: RegExp) => head.findIndex((h) => re.test(fold(h)));
  const iCip = idx(/cip|ean|acl|code/), iQty = idx(/quantit|qte/), iDes = idx(/descr|design|libell|produit|nom/), iDci = idx(/dci|molecule|substance/);
  if (iCip < 0) throw new Error('Colonne CIP / EAN introuvable (attendue : « CIP/EAN/ACL 13 ; Quantite ; Description ; DCI »).');
  const quoteAll = firstLine.replace(/\r$/, '').split(sep).every((c) => c.startsWith('"') && c.endsWith('"'));
  const out: CatalogRow[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const cip = (r[iCip] ?? '').trim().replace(/\s+/g, '');
    if (!/^\d{4,14}$/.test(cip)) { skipped++; continue; }
    const q = fold(r[iQty] ?? '');
    out.push({ cip, designation: (r[iDes] ?? '').trim(), dci: (r[iDci] ?? '').trim(), available: !/indispo|rupture|epuise/.test(q) });
  }
  const order = [iCip, iQty, iDes, iDci];
  const names: ExportColumn[] = ['cip', 'quantite', 'designation', 'dci'];
  const columns = order.every((i) => i >= 0) ? names.map((n, k) => ({ n, i: order[k] })).sort((a, b) => a.i - b.i).map((x) => x.n) : PRESETS.laborex.columns;
  const header = order.every((i) => i >= 0) ? columns.map((c) => head[order[names.indexOf(c)]]) : PRESETS.laborex.header;
  const learned: ExportFormat = { preset: quoteAll ? 'sep' : 'laborex', separator: sep, quoteAll, header, bom, eol, columns };
  return { rows: out, format: learned, skipped };
}

/* ---------- Rapprochement des désignations (même produit, libellés légèrement différents) ---------- */
const STOP = new Set(['de', 'du', 'la', 'le', 'les', 'et', 'en', 'pour', 'sol', 'inj', 'ext', 'adulte', 'enfant', 'boite', 'unite']);
export function nameKey(s: string): string {
  return fold(s).replace(/[^a-z0-9%/.,+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export function nameTokens(s: string): string[] {
  return nameKey(s).split(/[ /+,]+/).map((t) => t.replace(/^\.+|\.+$/g, '')).filter((t) => t.length >= 2 && !STOP.has(t));
}
/** Score 0..100 : proportion de mots communs ; dosage et conditionnement doivent concorder (sinon ce n'est pas le même produit). */
export function similarity(a: string, b: string): number {
  const ta = new Set(nameTokens(a)), tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return 0;
  const unit = (t: string) => /^\d+([.,]\d+)?(mg|g|ml|mcg|ug|ui|%|cl|l)$/.test(t);
  const num = (t: string) => /^\d+([.,]\d+)?$/.test(t);
  const disjoint = (pred: (t: string) => boolean) => {
    const x = [...ta].filter(pred), y = [...tb].filter(pred);
    return x.length > 0 && y.length > 0 && !x.some((t) => tb.has(t));
  };
  if (disjoint(unit) || disjoint(num)) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return Math.round((2 * common) / (ta.size + tb.size) * 100);
}