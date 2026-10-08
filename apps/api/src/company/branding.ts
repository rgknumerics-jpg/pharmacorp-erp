import { BadRequestException } from '@nestjs/common';

/** Habillage de la structure : logo, slogan, messages et modèles imprimés (ticket, bon de pharmacie, étiquette). */
export interface Branding {
  logo?: string;
  slogan?: string;
  receipt: { header?: string; footer?: string; widthMm: 58 | 80 | 210; showLogo: boolean; showNiu: boolean; showCashier: boolean; showCustomer: boolean; blocks: ReceiptBlock[] };
  label: { widthMm: number; heightMm: number; showPharmacy: boolean; showName: boolean; showDci: boolean; showPrice: boolean; showBarcode: boolean; showExpiry: boolean; showSupplier: boolean; showLot: boolean; layout: LabelLayout };
  voucher: { title: string; legalText: string; copies: number; autoPrint: boolean; showLogo: boolean };
}

/** Éléments du ticket de caisse, dans l'ordre d'impression : affichage, alignement, taille et graisse réglables. */
export type ReceiptKey = 'logo' | 'name' | 'slogan' | 'address' | 'phone' | 'email' | 'legal' | 'header' | 'line1' | 'ticket' | 'cashier' | 'customer' | 'items' | 'total' | 'payments' | 'footer' | 'custom1' | 'custom2' | 'custom3' | 'thanks';
export interface ReceiptBlock { key: ReceiptKey; show: boolean; align: 'left' | 'center' | 'right'; size: number; bold: boolean; text?: string }
export const RECEIPT_KEYS: ReceiptKey[] = ['logo', 'name', 'slogan', 'address', 'phone', 'email', 'legal', 'header', 'line1', 'ticket', 'cashier', 'customer', 'items', 'total', 'payments', 'footer', 'custom1', 'custom2', 'custom3', 'thanks'];
export const DEFAULT_RECEIPT_BLOCKS: ReceiptBlock[] = [
  { key: 'logo', show: true, align: 'center', size: 100, bold: false },
  { key: 'name', show: true, align: 'center', size: 15, bold: true },
  { key: 'slogan', show: true, align: 'center', size: 10, bold: false },
  { key: 'address', show: true, align: 'center', size: 10, bold: false },
  { key: 'phone', show: true, align: 'center', size: 10, bold: false },
  { key: 'email', show: false, align: 'center', size: 10, bold: false },
  { key: 'legal', show: true, align: 'center', size: 9, bold: false },
  { key: 'header', show: true, align: 'center', size: 10, bold: false },
  { key: 'line1', show: true, align: 'center', size: 10, bold: false },
  { key: 'ticket', show: true, align: 'left', size: 10, bold: false },
  { key: 'cashier', show: true, align: 'left', size: 10, bold: false },
  { key: 'customer', show: true, align: 'left', size: 10, bold: false },
  { key: 'items', show: true, align: 'left', size: 11, bold: false },
  { key: 'total', show: true, align: 'left', size: 15, bold: true },
  { key: 'payments', show: true, align: 'left', size: 10, bold: false },
  { key: 'footer', show: true, align: 'center', size: 10, bold: false },
  { key: 'custom1', show: false, align: 'center', size: 10, bold: false, text: '' },
  { key: 'custom2', show: false, align: 'center', size: 10, bold: false, text: '' },
  { key: 'custom3', show: false, align: 'center', size: 10, bold: false, text: '' },
  { key: 'thanks', show: true, align: 'center', size: 9, bold: false },
];

/** Position de chaque élément de l'étiquette (en mm depuis le coin haut-gauche), largeur de son cadre, taille du texte (pt) et hauteur (code-barres). */
export type LabelKey = 'pharmacy' | 'name' | 'dci' | 'expiry' | 'supplier' | 'lot' | 'price' | 'barcode';
export interface LabelBox { x: number; y: number; w: number; fs: number; h?: number; align?: 'left' | 'center' | 'right'; bold?: boolean }
export type LabelLayout = Record<LabelKey, LabelBox>;
export const LABEL_KEYS: LabelKey[] = ['pharmacy', 'name', 'dci', 'expiry', 'supplier', 'lot', 'price', 'barcode'];

/** Disposition par défaut, proportionnée au format de l'étiquette. */
export function defaultLabelLayout(w: number, h: number): LabelLayout {
  const m = 1.5, iw = Math.max(10, w - 2 * m), k = Math.max(0.6, Math.min(1.6, h / 30));
  const row = (i: number) => Math.round((m + i * 4.2 * k) * 10) / 10;
  return {
    pharmacy: { x: m, y: row(0), w: iw, fs: 6, align: 'center', bold: true },
    name: { x: m, y: row(0.9), w: iw, fs: 8, align: 'center', bold: true },
    dci: { x: m, y: row(2.5), w: iw, fs: 6, align: 'center' },
    expiry: { x: m, y: row(3.3), w: iw / 2, fs: 6, align: 'left' },
    supplier: { x: m + iw / 2, y: row(3.3), w: iw / 2, fs: 6, align: 'right' },
    lot: { x: m, y: row(4.1), w: iw, fs: 6, align: 'center' },
    price: { x: m, y: row(4.9), w: iw, fs: 11, align: 'center', bold: true },
    barcode: { x: m, y: Math.round(Math.max(row(6.2), h - 9.5 * k) * 10) / 10, w: iw, fs: 6, h: Math.round(7 * k * 10) / 10, align: 'center' },
  };
}

export const DEFAULT_BRANDING: Branding = {
  receipt: { widthMm: 80, showLogo: true, showNiu: true, showCashier: true, showCustomer: true, blocks: DEFAULT_RECEIPT_BLOCKS },
  label: { widthMm: 50, heightMm: 30, showPharmacy: true, showName: true, showDci: false, showPrice: true, showBarcode: true, showExpiry: false, showSupplier: true, showLot: false, layout: defaultLabelLayout(50, 30) },
  voucher: {
    title: 'BON DE PHARMACIE',
    legalText: 'Je reconnais avoir reçu les produits ci-dessus à crédit et m’engage à régler le montant dû dans les délais convenus avec la pharmacie.',
    copies: 2,
    autoPrint: true,
    showLogo: true,
  },
};

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const num = (v: unknown, min: number, max: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d; };

/** Fusionne une saisie partielle avec l'existant, en ne gardant que les champs connus et bornés. */
export function mergeBranding(current: Partial<Branding> | null | undefined, input: Record<string, any>): Branding {
  const cur = { ...DEFAULT_BRANDING, ...(current ?? {}), receipt: { ...DEFAULT_BRANDING.receipt, ...(current?.receipt ?? {}), blocks: completeBlocks(current?.receipt?.blocks) }, label: { ...DEFAULT_BRANDING.label, ...(current?.label ?? {}), layout: { ...defaultLabelLayout((current?.label as Branding['label'] | undefined)?.widthMm ?? 50, (current?.label as Branding['label'] | undefined)?.heightMm ?? 30), ...((current?.label as Branding['label'] | undefined)?.layout ?? {}) } }, voucher: { ...DEFAULT_BRANDING.voucher, ...(current?.voucher ?? {}) } } as Branding;
  const out: Branding = { ...cur };
  if (input.logo !== undefined) {
    if (input.logo === '' || input.logo === null) delete out.logo;
    else if (typeof input.logo === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.logo) && input.logo.length <= 450_000) out.logo = input.logo;
    else throw new BadRequestException('Logo invalide (PNG, JPEG ou WebP, 300 Ko maximum)');
  }
  if (input.slogan !== undefined) out.slogan = text(input.slogan, 120) || undefined;
  const r = input.receipt;
  if (r && typeof r === 'object') {
    out.receipt = {
      header: r.header !== undefined ? text(r.header, 200) || undefined : cur.receipt.header,
      footer: r.footer !== undefined ? text(r.footer, 300) || undefined : cur.receipt.footer,
      widthMm: ([58, 80, 210].includes(Number(r.widthMm)) ? Number(r.widthMm) : cur.receipt.widthMm) as 58 | 80 | 210,
      showLogo: bool(r.showLogo, cur.receipt.showLogo), showNiu: bool(r.showNiu, cur.receipt.showNiu), showCashier: bool(r.showCashier, cur.receipt.showCashier), showCustomer: bool(r.showCustomer, cur.receipt.showCustomer),
      blocks: r.blocks === 'reset' ? DEFAULT_RECEIPT_BLOCKS : Array.isArray(r.blocks) ? completeBlocks(r.blocks) : cur.receipt.blocks,
    };
  }
  const l = input.label;
  if (l && typeof l === 'object') {
    out.label = {
      widthMm: num(l.widthMm, 20, 120, cur.label.widthMm), heightMm: num(l.heightMm, 15, 100, cur.label.heightMm),
      showPharmacy: bool(l.showPharmacy, cur.label.showPharmacy), showName: bool(l.showName, cur.label.showName), showDci: bool(l.showDci, cur.label.showDci),
      showPrice: bool(l.showPrice, cur.label.showPrice), showBarcode: bool(l.showBarcode, cur.label.showBarcode), showExpiry: bool(l.showExpiry, cur.label.showExpiry),
      showSupplier: bool(l.showSupplier, cur.label.showSupplier), showLot: bool(l.showLot, cur.label.showLot),
      layout: mergeLayout(cur.label.layout, l.layout, num(l.widthMm, 20, 120, cur.label.widthMm), num(l.heightMm, 15, 100, cur.label.heightMm)),
    };
  }
  const v = input.voucher;
  if (v && typeof v === 'object') {
    out.voucher = {
      title: text(v.title, 60) || cur.voucher.title, legalText: v.legalText !== undefined ? text(v.legalText, 400) ?? '' : cur.voucher.legalText,
      copies: num(v.copies, 1, 3, cur.voucher.copies), autoPrint: bool(v.autoPrint, cur.voucher.autoPrint), showLogo: bool(v.showLogo, cur.voucher.showLogo),
    };
  }
  return out;
}

/** Valide la liste des éléments du ticket : clés connues uniquement, valeurs bornées, éléments manquants ajoutés à la fin. */
function completeBlocks(input: unknown): ReceiptBlock[] {
  const out: ReceiptBlock[] = [];
  const seen = new Set<string>();
  for (const b of Array.isArray(input) ? input : []) {
    if (!b || typeof b !== 'object' || !RECEIPT_KEYS.includes(b.key) || seen.has(b.key)) continue;
    const d = DEFAULT_RECEIPT_BLOCKS.find((x) => x.key === b.key) as ReceiptBlock;
    seen.add(b.key);
    const size = Math.round(Number(b.size));
    out.push({ key: b.key, show: typeof b.show === 'boolean' ? b.show : d.show, align: ['left', 'center', 'right'].includes(b.align) ? b.align : d.align, size: Number.isFinite(size) ? Math.min(b.key === 'logo' ? 200 : 30, Math.max(b.key === 'logo' ? 30 : 6, size)) : d.size, bold: typeof b.bold === 'boolean' ? b.bold : d.bold, ...(b.key.startsWith('custom') ? { text: typeof b.text === 'string' ? b.text.slice(0, 120) : '' } : {}) });
  }
  for (const d of DEFAULT_RECEIPT_BLOCKS) if (!seen.has(d.key)) out.push({ ...d });
  return out;
}

function mergeLayout(cur: LabelLayout, input: unknown, w: number, h: number): LabelLayout {
  const out = { ...cur } as LabelLayout;
  if (input === 'reset') return defaultLabelLayout(w, h);
  if (!input || typeof input !== 'object') return out;
  const f = (v: unknown, min: number, max: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n)) * 10) / 10 : d; };
  for (const k of LABEL_KEYS) {
    const b = (input as Record<string, any>)[k];
    if (!b || typeof b !== 'object') continue;
    const c = cur[k];
    out[k] = {
      x: f(b.x, 0, w - 3, c.x), y: f(b.y, 0, h - 2, c.y), w: f(b.w, 5, w, c.w), fs: f(b.fs, 4, 30, c.fs),
      ...(k === 'barcode' ? { h: f(b.h, 3, h, c.h ?? 7) } : {}),
      align: ['left', 'center', 'right'].includes(b.align) ? b.align : c.align,
      bold: typeof b.bold === 'boolean' ? b.bold : c.bold,
    };
  }
  return out;
}

export function withDefaults(stored: unknown): Branding {
  return mergeBranding(stored as Partial<Branding>, {});
}
