import type { BrandingData, LabelKey } from './branding';
import { code128Svg } from './barcode';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ')} FCFA`;
const dt = (d: string | Date) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Imprime un document HTML dans un cadre invisible (pas de fenêtre pop-up bloquée). `page` = règle @page (taille du papier). */
export function printHtml(html: string, css: string, page = ''): void {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(f);
  const d = f.contentDocument;
  const w = f.contentWindow;
  if (!d || !w) return;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>Impression</title><style>${page}*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000}${css}</style></head><body>${html}</body></html>`);
  d.close();
  setTimeout(() => { w.focus(); w.print(); setTimeout(() => f.remove(), 3000); }, 350);
}

export interface SaleLike {
  number: string; createdAt: string; total: number; paidAmount?: number;
  items: { quantity: number; unitPrice: number; lineTotal: number; product: { name: string }; lot?: { lotNumber: string } | null }[];
  payments?: { method: string; amount: number; status?: string }[];
  customer?: { name: string; phone?: string | null } | null;
}
const PAY: Record<string, string> = { cash: 'Espèces', mtn_momo: 'MTN MoMo', airtel_money: 'Airtel Money', card: 'Carte', cheque: 'Chèque', transfer: 'Virement', credit: 'Crédit (bon)', insurer: 'Assurance', loyalty: 'Points fidélité' };

/** Mentions légales cochées dans « Ma structure » (RCCM, NIU, autorisation, patente, compte bancaire…). */
function legal(b: BrandingData) {
  const f = b.ticket?.fields, id = b.identity;
  if (!f) return '';
  const parts = [f.rccm && id.rccm ? `RCCM : ${id.rccm}` : '', f.niu && id.niu ? `NIU : ${id.niu}` : '', f.authorization && id.authorization ? `Autorisation : ${id.authorization}` : '', f.patente && id.patente ? `Patente : ${id.patente}` : '', f.bank && b.ticket?.bankAccount ? `${b.ticket.bankName ? b.ticket.bankName + ' · ' : ''}Compte : ${b.ticket.bankAccount}` : ''].filter(Boolean);
  return parts.length ? `<div style="font-size:.72em;margin-top:1mm">${parts.map(esc).join(' · ')}</div>` : '';
}

function head(b: BrandingData, showLogo: boolean, center = true) {
  const { branding: br, identity: id } = b;
  const show = (k: 'address' | 'phone' | 'email') => b.ticket?.fields[k] ?? k !== 'email';
  return `<div style="text-align:${center ? 'center' : 'left'}">${showLogo && br.logo ? `<img src="${br.logo}" style="max-width:60%;max-height:22mm;object-fit:contain;margin-bottom:2mm">` : ''}
    <div style="font-weight:800;font-size:1.15em">${esc(id.name)}</div>
    ${br.slogan ? `<div style="font-style:italic;font-size:.85em">${esc(br.slogan)}</div>` : ''}
    <div style="font-size:.8em">${[show('address') ? id.address : null, show('address') ? id.city : null].filter(Boolean).map(esc).join(', ')}${show('phone') && id.phone ? ` · Tél. ${esc(id.phone)}` : ''}${show('email') && id.email ? `<br>${esc(id.email)}` : ''}</div>
    ${legal(b)}</div>`;
}

/** Ticket de caisse : éléments, ordre, alignement et taille réglés dans « Ma structure » (aperçu = impression). */
export function receiptDoc(sale: SaleLike, b: BrandingData, cashier?: string): { html: string; css: string; page: string; width: string } {
  const r = b.branding.receipt;
  const wide = r.widthMm === 210;
  const w = wide ? '148mm' : `${r.widthMm}mm`;
  const id = b.identity, tk = b.ticket?.fields;
  const items = sale.items.map((i) => `<tr><td colspan="3" style="padding-top:1.5mm">${esc(i.product.name)}${i.lot ? ` <small>(lot ${esc(i.lot.lotNumber)})</small>` : ''}</td></tr><tr><td>${i.quantity} × ${Math.round(i.unitPrice).toLocaleString('fr-FR')}</td><td></td><td style="text-align:right">${Math.round(i.lineTotal).toLocaleString('fr-FR')}</td></tr>`).join('');
  const pays = (sale.payments ?? []).filter((p) => p.status !== 'failed').map((p) => `<div style="display:flex;justify-content:space-between"><span>${esc(PAY[p.method] ?? p.method)}</span><span>${fcfa(p.amount)}</span></div>`).join('');
  const legalParts = tk ? [tk.rccm && id.rccm ? `RCCM : ${id.rccm}` : '', tk.niu && id.niu ? `NIU : ${id.niu}` : '', tk.authorization && id.authorization ? `Autorisation : ${id.authorization}` : '', tk.patente && id.patente ? `Patente : ${id.patente}` : '', tk.bank && b.ticket?.bankAccount ? `${b.ticket.bankName ? b.ticket.bankName + ' · ' : ''}Compte : ${b.ticket.bankAccount}` : ''].filter(Boolean) : [];
  const content: Record<string, string> = {
    logo: b.branding.logo ? `<img src="${b.branding.logo}" style="max-width:100%;object-fit:contain;margin-bottom:2mm;width:__LOGO__%">` : '',
    name: esc(id.name),
    slogan: b.branding.slogan ? `<i>${esc(b.branding.slogan)}</i>` : '',
    address: tk && !tk.address ? '' : [id.address, id.city].filter(Boolean).map(esc).join(', '),
    phone: id.phone && (!tk || tk.phone) ? `Tél. ${esc(id.phone)}` : '',
    email: id.email && tk?.email ? esc(id.email) : '',
    legal: legalParts.map(esc).join('<br>'),
    header: r.header ? esc(r.header) : '',
    line1: '<hr>',
    ticket: `Ticket <b>${esc(sale.number)}</b> — ${dt(sale.createdAt)}`,
    cashier: cashier ? `Caissier(ère) : ${esc(cashier)}` : '',
    customer: sale.customer ? `Client : ${esc(sale.customer.name)}` : '',
    items: `<table style="width:100%;border-collapse:collapse">${items}</table><hr>`,
    total: `<div style="display:flex;justify-content:space-between"><span>TOTAL</span><span>${fcfa(sale.total)}</span></div>`,
    payments: pays,
    footer: r.footer ? esc(r.footer).replace(/\n/g, '<br>') : '',
    thanks: 'Merci de votre confiance',
  };
  const blocks = r.blocks ?? [];
  const body = blocks.filter((k) => k.show).map((k) => {
    let c = k.key.startsWith('custom') ? (k.text ? esc(k.text).replace(/\n/g, '<br>') : '') : content[k.key] ?? '';
    if (!c) return '';
    if (k.key === 'logo') c = c.replace('__LOGO__', String(k.size));
    const size = k.key === 'logo' ? '' : `font-size:${k.size}px;`;
    return `<div style="text-align:${k.align};${size}font-weight:${k.bold ? 800 : 400};margin:.6mm 0">${c}</div>`;
  }).join('');
  return { html: `<div class="t">${body}</div>`, css: `.t{width:${w};padding:2mm;font-size:${wide ? 13 : 11}px}hr{border:0;border-top:1px dashed #000;margin:2mm 0}small{font-size:.8em}`, page: `@page{size:${w} auto;margin:0}`, width: w };
}

/** Ticket de caisse (58 mm, 80 mm ou A5). */
export function printReceipt(sale: SaleLike, b: BrandingData, cashier?: string): void {
  const d = receiptDoc(sale, b, cashier);
  printHtml(d.html, d.css, d.page);
}

/** Bon de pharmacie (vente à crédit) : N exemplaires, dont un à faire signer par le client. */
export function printVoucher(sale: SaleLike, b: BrandingData, cashier?: string, copies?: number): void {
  const v = b.branding.voucher;
  const n = copies ?? v.copies;
  const names = ['EXEMPLAIRE PHARMACIE (à conserver)', 'EXEMPLAIRE CLIENT', 'EXEMPLAIRE COMPTABILITÉ'];
  const credit = (sale.payments ?? []).filter((p) => p.method === 'credit').reduce((s, p) => s + p.amount, 0) || sale.total;
  const rows = sale.items.map((i) => `<tr><td>${esc(i.product.name)}</td><td style="text-align:center">${i.quantity}</td><td style="text-align:right">${Math.round(i.unitPrice).toLocaleString('fr-FR')}</td><td style="text-align:right">${Math.round(i.lineTotal).toLocaleString('fr-FR')}</td></tr>`).join('');
  const one = (k: number) => `<section class="p">
    <div class="tag">${names[k]}</div>${head(b, v.showLogo, false)}
    <h2>${esc(v.title)} N° ${esc(sale.number)}</h2>
    <div class="meta"><div>Date : <b>${dt(sale.createdAt)}</b></div><div>Client : <b>${esc(sale.customer?.name ?? '—')}</b>${sale.customer?.phone ? ` · ${esc(sale.customer.phone)}` : ''}</div>${cashier ? `<div>Délivré par : ${esc(cashier)}</div>` : ''}</div>
    <table><thead><tr><th style="text-align:left">Produit</th><th>Qté</th><th style="text-align:right">Prix unitaire</th><th style="text-align:right">Montant</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="3" style="text-align:right"><b>TOTAL</b></td><td style="text-align:right"><b>${fcfa(sale.total)}</b></td></tr><tr><td colspan="3" style="text-align:right">Dont à crédit (porté au compte du client)</td><td style="text-align:right"><b>${fcfa(credit)}</b></td></tr></tfoot></table>
    <p class="legal">${esc(v.legalText)}</p>
    <div class="sig"><div><div class="box"></div>Signature du client<br><small>précédée de « Lu et approuvé »</small></div><div><div class="box"></div>Cachet et signature de la pharmacie</div></div></section>`;
  const html = Array.from({ length: n }, (_, k) => one(k)).join('');
  printHtml(html, `.p{page-break-after:always;padding:12mm;font-size:12px;position:relative}.p:last-child{page-break-after:auto}.tag{position:absolute;top:6mm;right:10mm;border:1px solid #000;padding:1mm 3mm;font-weight:800;font-size:10px}h2{text-align:center;margin:6mm 0 3mm;font-size:16px;border-top:2px solid #000;border-bottom:2px solid #000;padding:2mm 0}.meta{display:grid;grid-template-columns:1fr 1fr;gap:1mm 6mm;margin-bottom:4mm}table{width:100%;border-collapse:collapse}th,td{border:1px solid #444;padding:1.5mm 2mm}.legal{margin:5mm 0;font-size:11px}.sig{display:flex;justify-content:space-between;gap:10mm;margin-top:6mm}.sig>div{flex:1;text-align:center;font-size:11px}.box{height:28mm;border:1px solid #000;margin-bottom:1.5mm}`, '@page{size:A5 portrait;margin:0}');
}

export interface LabelItem { name: string; dci?: string | null; price: number; barcode?: string | null; expiry?: string | null; qty: number; supplier?: string | null; lot?: string | null }

/** Une étiquette en HTML : chaque élément est placé à la position réglée dans « Ma structure » (mm depuis le coin haut-gauche). */
export function labelHtml(it: LabelItem, bd: BrandingData, preview = false): string {
  const l = bd.branding.label;
  const box = (k: LabelKey, inner: string) => { const g = l.layout[k]; if (!g) return ''; return `<div class="e" data-k="${k}" style="left:${g.x}mm;top:${g.y}mm;width:${g.w}mm;font-size:${g.fs}pt;text-align:${g.align ?? 'center'};font-weight:${g.bold ? 800 : 400}${k === 'barcode' ? `;height:${g.h ?? 7}mm` : ''}">${inner}</div>`; };
  return `<div class="l${preview ? ' pv' : ''}">${[
    l.showPharmacy ? box('pharmacy', esc(bd.identity.name)) : '',
    l.showName ? box('name', esc(it.name)) : '',
    l.showDci && it.dci ? box('dci', esc(it.dci)) : '',
    l.showExpiry && it.expiry ? box('expiry', `Exp. ${esc(new Date(it.expiry).toLocaleDateString('fr-FR', { month: '2-digit', year: 'numeric' }))}`) : '',
    l.showSupplier && it.supplier ? box('supplier', esc(it.supplier)) : '',
    l.showLot && it.lot ? box('lot', `Lot ${esc(it.lot)}`) : '',
    l.showPrice ? box('price', fcfa(it.price)) : '',
    l.showBarcode && it.barcode ? box('barcode', `<div class="bsv">${code128Svg(it.barcode, 28)}</div><div class="bt">${esc(it.barcode)}</div>`) : '',
  ].join('')}</div>`;
}
export const labelCss = (l: BrandingData['branding']['label']) => `.l{position:relative;width:${l.widthMm}mm;height:${l.heightMm}mm;overflow:hidden;page-break-after:always;background:#fff}.e{position:absolute;line-height:1.1;overflow:hidden}.bsv{height:calc(100% - 2.4mm);width:100%}.bsv svg{width:100%;height:100%}.bt{font-size:5.5pt;letter-spacing:.4px;line-height:1}`;

/** Étiquettes à coller sur les produits : format, éléments et position réglés dans « Ma structure ». */
export function printLabels(items: LabelItem[], bd: BrandingData): void {
  const l = bd.branding.label;
  const html = items.flatMap((it) => Array.from({ length: Math.max(1, Math.min(500, it.qty)) }, () => labelHtml(it, bd))).join('');
  printHtml(html, labelCss(l), `@page{size:${l.widthMm}mm ${l.heightMm}mm;margin:0}`);
}
