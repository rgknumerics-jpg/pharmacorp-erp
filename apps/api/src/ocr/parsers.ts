/**
 * Analyse de texte OCR : bons de livraison, factures fournisseurs, etiquettes de peremption.
 * Fonctions pures (aucun acces base) : testables sans infrastructure. Le resultat est TOUJOURS une proposition
 * a verifier par un humain avant toute entree en stock (ARCHITECTURE.md section 17).
 */

export interface ParsedDate {
  /** Date ISO (YYYY-MM-DD). Pour un mois seul (MM/AAAA), dernier jour du mois (convention pharmaceutique). */
  iso: string;
  precision: 'day' | 'month';
  raw: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, janv: 1, janvier: 1, january: 1,
  fev: 2, fevr: 2, fevrier: 2, feb: 2, february: 2,
  mar: 3, mars: 3, march: 3,
  avr: 4, avril: 4, apr: 4, april: 4,
  mai: 5, may: 5,
  juin: 6, jun: 6, june: 6,
  juil: 7, juillet: 7, jul: 7, july: 7,
  aout: 8, aug: 8, august: 8,
  sep: 9, sept: 9, septembre: 9, september: 9,
  oct: 10, octobre: 10, october: 10,
  nov: 11, novembre: 11, november: 11,
  dec: 12, decembre: 12, december: 12,
};

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const year4 = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
const validYear = (y: number) => y >= 2000 && y <= 2100;

/** Premiere date trouvee dans `text` (formats JJ/MM/AAAA, MM/AAAA, MM/AA, AAAA-MM(-JJ), "oct 2027", "OCT.27"). */
export function findDate(text: string): ParsedDate | null {
  const t = strip(text);
  let m: RegExpExecArray | null;

  // AAAA-MM-JJ ou AAAA/MM
  m = /\b(20\d{2})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?\b/.exec(t);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    const y = Number(m[1]), mo = Number(m[2]);
    if (m[3]) {
      const d = Number(m[3]);
      if (d >= 1 && d <= lastDay(y, mo)) return { iso: `${y}-${pad(mo)}-${pad(d)}`, precision: 'day', raw: m[0] };
    } else return { iso: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}`, precision: 'month', raw: m[0] };
  }

  // JJ/MM/AAAA ou JJ/MM/AA
  m = /\b(\d{1,2})[ ./-](\d{1,2})[ ./-](\d{4}|\d{2})\b/.exec(t);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]), y = year4(m[3]);
    if (mo >= 1 && mo <= 12 && validYear(y) && d >= 1 && d <= lastDay(y, mo)) return { iso: `${y}-${pad(mo)}-${pad(d)}`, precision: 'day', raw: m[0] };
  }

  // Mois en toutes lettres
  m = /\b([a-z]{3,9})\.?[ ./-]*(\d{4}|\d{2})\b/.exec(t.toLowerCase());
  if (m && MONTHS[m[1]]) {
    const mo = MONTHS[m[1]], y = year4(m[2]);
    if (validYear(y)) return { iso: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}`, precision: 'month', raw: m[0] };
  }

  // MM/AAAA ou MM/AA
  m = /\b(\d{1,2})[-/.](\d{4}|\d{2})\b/.exec(t);
  if (m) {
    const mo = Number(m[1]), y = year4(m[2]);
    if (mo >= 1 && mo <= 12 && validYear(y)) return { iso: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}`, precision: 'month', raw: m[0] };
  }
  return null;
}

const EXPIRY_KEYS = /(?:EXP(?:IRY|IRATION)?\.?(?:\s*DATE)?|PEREMPTION|PER\.?|DLC|DLUO|USE\s*BY|BEST\s*BEFORE|BB|DATE\s*LIMITE)\s*[:.-]?\s*/i;
const MFG_KEYS = /(?:FAB(?:R(?:ICATION)?)?\.?|MFG|MFD|MANUFACTURED?|DATE\s*DE\s*FAB\w*)\s*[:.-]?\s*$/i;
const LOT_KEYS = /\b(?:N[°o]?\s*DE\s*LOT|LOT|BATCH|B\.?\s?N\.?|L)(?![A-Za-z])\s*(?:N[°o])?\s*[:.#-]?\s*([A-Z0-9][A-Z0-9/-]{2,19})/i;

export interface ExpiryReading {
  lotNumber: string | null;
  expiry: ParsedDate | null;
  /** 0..1 : plus haut quand la date suit un mot-cle explicite (EXP, PER, DLC...) et que le lot est present. */
  confidence: number;
}

/** Etiquette de boite ou de flacon : numero de lot et date de peremption. */
export function parseExpiryLabel(text: string): ExpiryReading {
  const flat = strip(text).replace(/\r/g, '').replace(/\s+/g, ' ');
  let expiry: ParsedDate | null = null;
  let keyword = false;

  const re = new RegExp(EXPIRY_KEYS.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    const after = flat.slice(m.index + m[0].length, m.index + m[0].length + 24);
    const d = findDate(after);
    if (d && after.indexOf(d.raw) <= 3) { expiry = d; keyword = true; break; }
  }
  if (!expiry) {
    // aucune mention explicite : on prend la date la plus tardive qui n'est pas precedee d'un mot de fabrication
    const found: ParsedDate[] = [];
    const rx = /(?<!\d)(\d{1,2}[ ./-]\d{1,2}[ ./-]\d{2,4}|\d{1,2}[-/.]\d{2,4}|20\d{2}[-/.]\d{1,2}(?:[-/.]\d{1,2})?|[A-Za-z]{3,9}\.?[ ./-]*\d{2,4})/g;
    let r: RegExpExecArray | null;
    while ((r = rx.exec(flat))) {
      const before = flat.slice(Math.max(0, r.index - 18), r.index);
      if (MFG_KEYS.test(before)) continue;
      const d = findDate(r[0]);
      if (d) found.push(d);
    }
    expiry = found.sort((a, b) => (a.iso < b.iso ? 1 : -1))[0] ?? null;
  }

  let lot: string | null = null;
  const lm = LOT_KEYS.exec(strip(text).replace(/\s+/g, ' '));
  if (lm) {
    const cand = lm[1].toUpperCase();
    if (/\d/.test(cand) && !/^(20\d{2}|EXP|PER)/.test(cand)) lot = cand;
  }
  const confidence = (expiry ? (keyword ? 0.55 : 0.3) : 0) + (lot ? 0.3 : 0) + (expiry && expiry.precision === 'day' ? 0.05 : 0) + (keyword && lot ? 0.1 : 0);
  return { lotNumber: lot, expiry, confidence: Math.min(1, confidence) };
}

/** "1 250,50" -> 1250.5 ; "12.500" -> 12500 ; "3,5" -> 3.5 */
export function parseNumber(token: string): number | null {
  const t = token.replace(/[\s\u00a0]/g, '').replace(/[^\d.,-]/g, '');
  if (!/\d/.test(t)) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export interface ParsedLine {
  designation: string;
  quantity: number | null;
  unitCost: number | null;
  lineTotal: number | null;
  lotNumber: string | null;
  expiry: ParsedDate | null;
  barcode: string | null;
  /** Code article du grossiste (CIP LABOREX, code UBIPHARM...) lu en debut de ligne. */
  supplierCode?: string | null;
  /** Prix public conseille imprime sur le BL. */
  publicPrice?: number | null;
  raw: string;
  confidence: number;
}

/**
 * Qte x PU = montant parmi tous les nombres de la ligne (quel que soit l'ordre des colonnes : LABOREX met les
 * quantites avant la designation, UBIPHARM apres le prix public). Renvoie aussi le prix public (nombre juste avant le PU).
 */
export function solveLine(nums: number[]): { quantity: number; unitCost: number; lineTotal: number; publicPrice: number | null } | null {
  for (let c = nums.length - 1; c >= 2; c--) {
    for (let b = c - 1; b >= 1; b--) {
      for (let a = b - 1; a >= 0; a--) {
        const q = nums[a], pu = nums[b], tot = nums[c];
        if (!Number.isInteger(q) || q <= 0 || q > 10000 || pu <= 0 || tot <= 0) continue;
        if (Math.abs(q * pu - tot) <= Math.max(1, tot * 0.005)) {
          // prix public : entre la quantite et le PU (LABOREX) ou avant les quantites (UBIPHARM)
          const pp = [...nums.slice(a + 1, b), ...nums.slice(0, a)].reverse().find((n) => n > pu) ?? null;
          return { quantity: q, unitCost: pu, lineTotal: tot, publicPrice: pp };
        }
      }
    }
  }
  return null;
}

export interface ParsedDocument {
  kind: 'delivery_note' | 'invoice';
  supplierName: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  totalAmount: number | null;
  lines: ParsedLine[];
  /** Confiance moyenne des lignes (0..1). */
  confidence: number;
}

const SKIP_LINE = /^(?:\s*(?:total|sous[- ]?total|net\s*a\s*payer|tva|taxe|montant|remise|acompte|reste|page|tel|telephone|fax|adresse|bp|rccm|nif|niu|date|client|livre|facture|bon\s*de|designation|libelle|produit|article|ref|quantite|qte|signature|cachet|arrete)\b)/i;
const TOTAL_LINE = /(?:TOTAL\s*(?:TTC|GENERAL|A\s*PAYER)?|NET\s*A\s*PAYER|MONTANT\s*TTC)\s*[:.-]?\s*([\d\s.,\u00a0]+)/i;

const isNum = (n: number | null): n is number => n !== null;
const consistentTriple = (n: number[]) => n.length >= 3 && Math.abs(n[0] * n[1] - n[2]) <= Math.max(1, n[2] * 0.01);
/** Nombres d'une fin de ligne ; en cas de doute entre "20 850" (deux colonnes) et 20850, la coherence qte x PU = total tranche. */
function numbersOf(tail: string): number[] {
  const grouped = (tail.match(/\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d+)?(?!\d)|\d+(?:[.,]\d+)?/g) ?? []).map(parseNumber).filter(isNum);
  if (consistentTriple(grouped)) return grouped;
  const plain = (tail.match(/\d+(?:[.,]\d+)?/g) ?? []).map(parseNumber).filter(isNum);
  return consistentTriple(plain) ? plain : grouped;
}

/** Analyse d'un bon de livraison ou d'une facture fournisseur (texte brut issu de l'OCR). */
export function parseDocument(text: string, kind: 'delivery_note' | 'invoice'): ParsedDocument {
  const rawLines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const flat = strip(text);

  let documentNumber: string | null = null;
  const nm = /(?:BON\s*DE\s*LIVRAISON|FACTURE|\bBL\b|\bB\.L\.)[^\n]{0,20}?(?:N[°o]|NUM(?:ERO)?|#)\s*[:.-]?\s*([A-Z0-9][A-Z0-9/-]{2,24})/i.exec(flat)
    ?? /\b(?:N[°o]|NUM(?:ERO)?)\s*[:.-]?\s*([A-Z0-9][A-Z0-9/-]{3,24})/i.exec(flat);
  if (nm) documentNumber = nm[1].toUpperCase();

  let documentDate: string | null = null;
  for (const l of rawLines.slice(0, 15)) {
    if (/exp|per|dlc|lot/i.test(strip(l))) continue;
    const d = findDate(l);
    if (d && d.precision === 'day') { documentDate = d.iso; break; }
  }

  const supplierName = rawLines.slice(0, 6).find((l) => /[A-Za-z]{3,}/.test(l) && !/^(?:bon|facture|livraison|date|n[°o]|page|tel)/i.test(strip(l))) ?? null;

  let totalAmount: number | null = null;
  for (const l of [...rawLines].reverse()) {
    const m = TOTAL_LINE.exec(strip(l));
    if (m) { totalAmount = parseNumber(m[1]); if (totalAmount) break; }
  }

  const lines: ParsedLine[] = [];
  for (const raw of rawLines) {
    const line = strip(raw);
    // ligne "LOT xxx PER. 31/10/28" sous l'article (BL UBIPHARM) : rattachee a l'article precedent
    const cont = /^\s*(?:\d{8,14}\s+)?LOT\s*[:.]?\s*([A-Z0-9][A-Z0-9/-]{1,19})(?:\s+(?:PER|EXP)\.?\s*(\S+))?/i.exec(line);
    const prev = lines[lines.length - 1];
    if (cont && prev && !prev.lotNumber) {
      prev.lotNumber = cont[1].toUpperCase();
      if (cont[2]) prev.expiry = findDate(cont[2]) ?? prev.expiry;
      const ean = /\b(\d{12,14})\b/.exec(line); if (ean && !prev.barcode) prev.barcode = ean[1];
      prev.confidence = Math.min(1, Math.round((prev.confidence + 0.2) * 1000) / 1000);
      continue;
    }
    if (prev && /^\s*\d{12,14}\s*$/.test(line) && !prev.barcode) { prev.barcode = line.trim(); continue; }
    if (line.length < 6 || SKIP_LINE.test(line) || !/[A-Za-z]{3,}/.test(line)) continue;

    // colonnes en tete de ligne : n° de ligne, code grossiste, quantites (LABOREX : CIP QTCDE QTLIV DESIGNATION ...)
    const head = /^((?:\s*(?:\d{1,3}|(?=[A-Z]*\d)[A-Z0-9]{5,14})\b)+)\s+(?=[A-Za-z])/.exec(line);
    const headTokens = head ? head[1].trim().split(/\s+/) : [];
    const codeIdx = headTokens.findIndex((t) => t.length >= 5);
    const supplierCode = codeIdx >= 0 ? headTokens[codeIdx] : null;
    const headNums = headTokens.slice(codeIdx + 1).map(parseNumber).filter(isNum);
    const lineBody = head ? line.slice(head[0].length) : line;

    const barcodeM = /\b(\d{8,14})\b/.exec(lineBody);
    const barcode = barcodeM ? barcodeM[1] : null;
    let work = barcode ? lineBody.replace(barcode, ' ') : lineBody;

    const expiry = (() => {
      const kw = new RegExp(EXPIRY_KEYS.source + '(.{0,20})', 'i').exec(work);
      if (kw) { const d = findDate(kw[1]); if (d) return d; }
      return findDate(work);
    })();
    if (expiry) work = work.replace(expiry.raw, ' ');

    let lotNumber: string | null = null;
    const lm = /(?:LOT|BATCH|B\.?N\.?)\s*[:.#-]?\s*([A-Z0-9][A-Z0-9/-]{2,19})/i.exec(work);
    if (lm) { lotNumber = lm[1].toUpperCase(); work = work.replace(lm[0], ' '); }

    // designation = texte jusqu'au premier nombre isole ; les nombres qui suivent sont qte / prix / total
    const tokens = work.split(/\s+/).filter(Boolean);
    const firstNum = tokens.findIndex((t, i) => i > 0 && /^\d[\d.,]*$/.test(t) && !/^(?:mg|g|ml|ui|mcg)$/i.test(tokens[i + 1] ?? ''));
    const designation = (firstNum === -1 ? tokens : tokens.slice(0, firstNum)).join(' ').replace(/[|_;]+/g, ' ').trim();
    // nombres de la fin de ligne, en conservant l'espacement d'origine : "17 000" (un seul espace) = 17000, alors que
    // des colonnes separees par plusieurs espaces restent distinctes.
    let tailRaw = '';
    if (firstNum !== -1) {
      const re = /\S+/g; let i = 0, mm: RegExpExecArray | null;
      while ((mm = re.exec(work))) { if (i === firstNum) { tailRaw = work.slice(mm.index); break; } i += 1; }
    }
    const nums = numbersOf(tailRaw);
    if (!designation || designation.length < 3) continue;

    let quantity: number | null = null, unitCost: number | null = null, lineTotal: number | null = null, publicPrice: number | null = null;
    const solved = solveLine([...headNums, ...(tailRaw.match(/\d+(?:[.,]\d+)?/g) ?? []).map(parseNumber).filter(isNum)]) ?? (headNums.length ? null : solveLine(nums));
    if (solved) ({ quantity, unitCost, lineTotal, publicPrice } = solved);
    else if (nums.length) {
      quantity = Number.isInteger(nums[0]) && nums[0] > 0 && nums[0] < 100000 ? nums[0] : null;
      if (nums.length >= 3) { unitCost = nums[1]; lineTotal = nums[2]; }
      else if (nums.length === 2) { unitCost = nums[1]; }
    }
    // coherence arithmetique qte x PU = total : forte indication que la ligne est bien lue
    const consistent = quantity !== null && unitCost !== null && lineTotal !== null && Math.abs(quantity * unitCost - lineTotal) <= Math.max(1, lineTotal * 0.01);
    if (quantity === null && !expiry && !lotNumber) continue; // ligne de texte sans donnee de stock

    const confidence = Math.round(Math.min(1, 0.25 + (quantity !== null ? 0.25 : 0) + (expiry ? 0.2 : 0) + (lotNumber ? 0.1 : 0) + (consistent ? 0.2 : 0) + (barcode ? 0.1 : 0)) * 1000) / 1000;
    lines.push({ designation, quantity, unitCost, lineTotal, lotNumber, expiry, barcode, supplierCode, publicPrice, raw, confidence });
  }

  const confidence = lines.length ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length : 0;
  return { kind, supplierName, documentNumber, documentDate, totalAmount, lines, confidence };
}

// ----- Rapprochement avec le catalogue -----

const STOP = new Set(['de', 'du', 'la', 'le', 'les', 'et', 'en', 'pour', 'a', 'au', 'b', 'bte', 'boite', 'bt', 'cp', 'cpr', 'comprime', 'comprimes', 'gelule', 'gelules', 'sol', 'inj', 'sirop', 'fl']);
const tok = (s: string) => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t && !STOP.has(t) && (t.length > 1 || /\d/.test(t)));

export interface CatalogEntry { id: string; name: string; dci?: string | null; barcode?: string | null; sku?: string | null }

/** Meilleur produit du catalogue pour une designation lue par OCR (code-barres exact, sinon similarite de mots). */
export function matchProduct(designation: string, barcode: string | null, catalog: CatalogEntry[]): { id: string; score: number } | null {
  if (barcode) {
    const hit = catalog.find((p) => p.barcode === barcode || p.sku === barcode);
    if (hit) return { id: hit.id, score: 1 };
  }
  const a = new Set(tok(designation));
  if (!a.size) return null;
  let best: { id: string; score: number } | null = null;
  for (const p of catalog) {
    const b = new Set(tok(`${p.name} ${p.dci ?? ''}`));
    if (!b.size) continue;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter += 1;
    const nameTokens = new Set(tok(p.name));
    let nameInter = 0;
    for (const t of a) if (nameTokens.has(t)) nameInter += 1;
    // part des mots de la designation retrouves dans le produit (tolere un nom de catalogue plus long)
    const score = inter / a.size * 0.6 + (nameTokens.size ? nameInter / Math.max(a.size, nameTokens.size) : 0) * 0.4;
    if (!best || score > best.score) best = { id: p.id, score };
  }
  return best && best.score >= 0.5 ? best : null;
}
