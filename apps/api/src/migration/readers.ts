/**
 * Lecture de fichiers issus d'autres logiciels de gestion -> tableaux { nom, colonnes, lignes }.
 * Formats : CSV / TSV / TXT, Excel (xlsx, xls, ods), JSON, base dBase (.dbf, frequente dans les anciens logiciels
 * d'officine), SQLite (.db, .sqlite), Microsoft Access (.mdb, .accdb), export SQL (INSERT INTO ...), PDF (texte) et
 * image (OCR). Pour une base SQL Server / MySQL / Oracle : un export .sql, .csv ou Excel suffit.
 */
export interface RawTable { name: string; columns: string[]; rows: Record<string, string>[] }

const MAX_ROWS = 100_000;
const clean = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\u0000/g, '').trim());

function fromMatrix(name: string, matrix: unknown[][]): RawTable | null {
  // la ligne d'en-tete est la premiere ligne avec au moins 2 cellules texte non vides
  const headerIdx = matrix.findIndex((r) => r.filter((c) => clean(c) && Number.isNaN(Number(clean(c)))).length >= 2);
  if (headerIdx < 0) return null;
  const seen = new Map<string, number>();
  const columns = matrix[headerIdx].map((c, i) => {
    let h = clean(c) || `colonne_${i + 1}`;
    const n = seen.get(h) ?? 0; seen.set(h, n + 1); if (n) h = `${h}_${n + 1}`;
    return h;
  });
  const rows = matrix.slice(headerIdx + 1, headerIdx + 1 + MAX_ROWS)
    .filter((r) => r.some((c) => clean(c)))
    .map((r) => Object.fromEntries(columns.map((c, i) => [c, clean(r[i])])));
  return { name, columns, rows };
}

// ----- CSV / TSV -----
export function parseDelimited(text: string, name = 'fichier'): RawTable | null {
  const firstLines = text.split(/\r?\n/).slice(0, 10).join('\n');
  const delim = [';', '\t', ',', '|'].map((d) => [d, (firstLines.match(new RegExp(d === '|' ? '\\|' : d, 'g')) ?? []).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let cur: string[] = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') q = false; else field += ch; continue; }
    if (ch === '"' && field === '') { q = true; continue; }
    if (ch === delim) { cur.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; cur.push(field); rows.push(cur); cur = []; field = ''; if (rows.length > MAX_ROWS) break; continue; }
    field += ch;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return fromMatrix(name, rows);
}

/** Decode un fichier texte : UTF-8 si valide, sinon Windows-1252 (exports Excel francais). */
export function decodeText(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  return new TextDecoder('windows-1252').decode(buf);
}

// ----- dBase (.dbf) -----
export function parseDbf(buf: Buffer, name: string): RawTable {
  const nRecords = buf.readUInt32LE(4), headerLen = buf.readUInt16LE(8), recordLen = buf.readUInt16LE(10);
  const fields: { name: string; type: string; len: number }[] = [];
  for (let off = 32; off < headerLen - 1 && buf[off] !== 0x0d; off += 32) {
    fields.push({ name: buf.toString('latin1', off, off + 11).replace(/\0.*$/, '').trim(), type: String.fromCharCode(buf[off + 11]), len: buf[off + 16] });
  }
  const rows: Record<string, string>[] = [];
  for (let r = 0; r < Math.min(nRecords, MAX_ROWS); r++) {
    const base = headerLen + r * recordLen;
    if (base + recordLen > buf.length) break;
    if (buf[base] === 0x2a) continue; // enregistrement supprime
    let pos = base + 1; const row: Record<string, string> = {};
    for (const f of fields) {
      let v = buf.toString('latin1', pos, pos + f.len).trim(); pos += f.len;
      if (f.type === 'D' && /^\d{8}$/.test(v)) v = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
      if (f.type === 'L') v = /^[TtYy]/.test(v) ? 'oui' : /^[FfNn]/.test(v) ? 'non' : '';
      row[f.name] = v;
    }
    rows.push(row);
  }
  return { name, columns: fields.map((f) => f.name), rows };
}

// ----- export SQL : INSERT INTO table (cols) VALUES (...), (...); -----
export function parseSqlDump(text: string): RawTable[] {
  const tables = new Map<string, RawTable>();
  const createCols = new Map<string, string[]>();
  for (const m of text.matchAll(/CREATE TABLE\s+[`"[]?(\w+)[`"\]]?\s*\(([\s\S]*?)\)\s*[;E]/gi)) {
    createCols.set(m[1].toLowerCase(), m[2].split(/,\s*\n/).map((l) => /^\s*[`"[]?(\w+)/.exec(l)?.[1] ?? '').filter((c) => c && !/^(PRIMARY|KEY|UNIQUE|CONSTRAINT|INDEX|FOREIGN)$/i.test(c)));
  }
  const splitValues = (s: string) => {
    const out: string[][] = []; let row: string[] = [], f = '', q: string | null = null, depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '\\') { f += s[++i] ?? ''; continue; } if (c === q && s[i + 1] === q) { f += c; i++; continue; } if (c === q) { q = null; continue; } f += c; continue; }
      if (c === "'" || c === '"') { q = c; continue; }
      if (c === '(') { if (depth === 0) { row = []; f = ''; } else f += c; depth++; continue; }
      if (c === ')') { depth--; if (depth === 0) { row.push(f.trim()); out.push(row.map((v) => (v.toUpperCase() === 'NULL' ? '' : v))); f = ''; } else f += c; continue; }
      if (c === ',' && depth === 1) { row.push(f.trim()); f = ''; continue; }
      if (depth >= 1) f += c;
    }
    return out;
  };
  for (const m of text.matchAll(/INSERT\s+INTO\s+[`"[]?(\w+)[`"\]]?\s*(\(([^)]*)\))?\s*VALUES\s*([\s\S]*?\));/gi)) {
    const name = m[1];
    const cols = m[3] ? m[3].split(',').map((c) => c.trim().replace(/[`"[\]]/g, '')) : createCols.get(name.toLowerCase()) ?? [];
    const t = tables.get(name) ?? { name, columns: cols, rows: [] };
    for (const vals of splitValues(m[4])) {
      if (t.rows.length >= MAX_ROWS) break;
      const columns = t.columns.length ? t.columns : vals.map((_, i) => `colonne_${i + 1}`);
      if (!t.columns.length) t.columns = columns;
      t.rows.push(Object.fromEntries(columns.map((c, i) => [c, vals[i] ?? ''])));
    }
    tables.set(name, t);
  }
  return [...tables.values()];
}

/** Texte de PDF ou d'OCR -> tableau : colonnes separees par 2 espaces ou plus (ou tabulations). */
export function parseTextTable(text: string, name: string): RawTable | null {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  const matrix = lines.map((l) => l.trim().split(/\t+| {2,}/).map((c) => c.trim()));
  const width = Math.max(0, ...matrix.map((r) => r.length));
  if (width < 2) return null;
  return fromMatrix(name, matrix.filter((r) => r.length >= Math.max(2, Math.floor(width / 2))));
}

export async function readFile(buf: Buffer, fileName: string, ocr?: (img: Buffer) => Promise<string>): Promise<{ format: string; tables: RawTable[] }> {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  const base = fileName.replace(/\.[^.]+$/, '');
  if (['myd', 'myi', 'frm', 'mb', 'tmd'].includes(ext)) throw new Error('Fichiers d’une base MySQL (WinPharma) : ne téléversez pas les fichiers un par un. Utilisez « Lire la base installée sur cet ordinateur » en haut de cette page et indiquez le dossier qui contient PRODUIT.MYD, FOURNIS.MYD…');
  if (['rar', 'zip', '7z'].includes(ext)) throw new Error('Archive compressée : décompressez-la d’abord (clic droit → Extraire ici), puis, pour une base WinPharma / MySQL, utilisez « Lire la base installée sur cet ordinateur » avec le dossier extrait.');
  if (['csv', 'tsv', 'txt'].includes(ext)) { const t = parseDelimited(decodeText(buf), base); return { format: ext, tables: t ? [t] : [] }; }
  if (['xlsx', 'xlsm', 'xls', 'ods'].includes(ext)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    return { format: ext, tables: wb.SheetNames.map((n) => fromMatrix(n, XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: false, defval: '' }))).filter((t): t is RawTable => !!t && t.rows.length > 0) };
  }
  if (ext === 'json') {
    const j = JSON.parse(decodeText(buf));
    const arrays: [string, unknown[]][] = Array.isArray(j) ? [[base, j]] : Object.entries(j).filter((e): e is [string, unknown[]] => Array.isArray(e[1]));
    return { format: 'json', tables: arrays.map(([n, a]) => { const cols = [...new Set(a.flatMap((o) => (o && typeof o === 'object' ? Object.keys(o) : [])))]; return { name: n, columns: cols, rows: a.slice(0, MAX_ROWS).map((o) => Object.fromEntries(cols.map((c) => [c, clean((o as Record<string, unknown>)[c])]))) }; }) };
  }
  if (ext === 'dbf') return { format: 'dbf', tables: [parseDbf(buf, base)] };
  if (['db', 'sqlite', 'sqlite3'].includes(ext)) {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database(new Uint8Array(buf));
    const names = (db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0]?.values ?? []).map((v) => String(v[0]));
    const tables = names.map((n) => { const r = db.exec(`SELECT * FROM "${n.replace(/"/g, '""')}" LIMIT ${MAX_ROWS}`)[0]; return r ? { name: n, columns: r.columns, rows: r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, clean(v[i])]))) } : { name: n, columns: [], rows: [] }; }).filter((t) => t.rows.length);
    db.close();
    return { format: 'sqlite', tables };
  }
  if (['mdb', 'accdb'].includes(ext)) {
    const MDBReader = (await import('mdb-reader')).default;
    const r = new MDBReader(buf);
    return { format: 'access', tables: r.getTableNames().map((n) => { const t = r.getTable(n); const cols = t.getColumnNames(); return { name: n, columns: cols, rows: t.getData({ rowLimit: MAX_ROWS }).map((row) => Object.fromEntries(cols.map((c) => [c, clean(row[c])]))) }; }).filter((t) => t.rows.length) };
  }
  if (ext === 'sql') return { format: 'sql', tables: parseSqlDump(decodeText(buf)) };
  if (ext === 'pdf') {
    const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const { text } = await pdf(buf);
    if (text.replace(/\s/g, '').length < 20) throw new Error('PDF scanné (sans texte) : envoyez une photo ou un scan des pages en image pour l\'OCR, ou un export Excel/CSV.');
    const t = parseTextTable(text, base); return { format: 'pdf', tables: t ? [t] : [] };
  }
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'].includes(ext)) {
    if (!ocr) throw new Error('OCR indisponible');
    const t = parseTextTable(await ocr(buf), base); return { format: 'image', tables: t ? [t] : [] };
  }
  throw new Error(`Format .${ext} non reconnu. Formats acceptés : CSV, TXT, Excel (xlsx, xls, ods), JSON, DBF, SQLite, Access (mdb, accdb), SQL, PDF, image.`);
}
