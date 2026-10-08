import { useEffect, useState } from 'react';
import { api, apiBlob, can } from '../lib/api';
import { dateFr } from '../lib/format';
import { Badge, ErrorBox, Field } from '../components/ui';
import { Branding, BrandingData, loadBranding, setBrandingCache } from '../lib/branding';
import { printLabels, printVoucher } from '../lib/print';
import { LabelDesigner } from './LabelDesigner';
import { ReceiptDesigner } from './ReceiptDesigner';

const SAMPLE_SALE = {
  number: 'V-2026-00001', createdAt: new Date().toISOString(), total: 8500, paidAmount: 8500,
  items: [{ quantity: 2, unitPrice: 1500, lineTotal: 3000, product: { name: 'PARACETAMOL 500 MG BTE 16' } }, { quantity: 1, unitPrice: 5500, lineTotal: 5500, product: { name: 'VITAMINE C 1000 MG EFFERVESCENT' } }],
  payments: [{ method: 'credit', amount: 8500 }], customer: { name: 'Mme EXEMPLE Marie', phone: '+242 06 000 00 00' },
};

/** Réduit une image à 400 px de large maximum (ticket thermique) et la renvoie en data URL. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Image illisible')); i.src = url; });
    const k = Math.min(1, 400 / img.width);
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d'); if (!ctx) throw new Error('Image illisible');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

const PRESETS: [string, number, number][] = [['50 × 30 mm', 50, 30], ['40 × 25 mm', 40, 25], ['58 × 40 mm', 58, 40], ['70 × 35 mm', 70, 35]];

/** Habillage de la structure : logo, slogan, messages du ticket, modèles de bon de pharmacie et d'étiquette. */
export function BrandingSection() {
  const write = can('company.manage');
  const [d, setD] = useState<BrandingData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadBranding(true).then(setD).catch((e: Error) => setErr(e.message)); }, []);
  if (!d) return <ErrorBox error={err} />;
  const b = d.branding;
  const set = (patch: Partial<Branding>) => setD({ ...d, branding: { ...b, ...patch } });
  const rc = (p: Partial<Branding['receipt']>) => set({ receipt: { ...b.receipt, ...p } });
  const lb = (p: Partial<Branding['label']>) => set({ label: { ...b.label, ...p } });
  const vc = (p: Partial<Branding['voucher']>) => set({ voucher: { ...b.voucher, ...p } });
  async function save() {
    setErr(null); setMsg(null);
    try {
      const r = await api<BrandingData>('/company/branding', { method: 'PUT', json: { logo: b.logo ?? '', slogan: b.slogan ?? '', receipt: b.receipt, label: b.label, voucher: b.voucher } });
      setD(r); setBrandingCache(r); setMsg('Enregistré ✓');
    } catch (e) { setErr((e as Error).message); }
  }
  const tog = (v: boolean, on: (x: boolean) => void, label: string) => <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" disabled={!write} checked={v} onChange={(e) => on(e.target.checked)} /> {label}</label>;
  return (
    <div className="card mt-4 space-y-4">
      <div><h3 className="text-lg font-extrabold">Image de la pharmacie, tickets, bons et étiquettes</h3><p className="text-xs text-ink-muted">Le logo, le slogan et les messages ci-dessous sont imprimés sur les tickets de caisse, les bons de pharmacie et les étiquettes.</p></div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h4 className="font-extrabold">Logo et slogan</h4>
          <div className="flex items-center gap-3">
            <div className="flex h-24 w-40 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-ink-line">{b.logo ? <img src={b.logo} alt="Logo" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-ink-muted">Aucun logo</span>}</div>
            {write && <div className="space-y-1">
              <label className="btn-alt cursor-pointer">Choisir un logo<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { set({ logo: await shrink(f) }); } catch (x) { setErr((x as Error).message); } }} /></label>
              {b.logo && <button className="block text-xs font-bold text-red-700" onClick={() => set({ logo: undefined })}>Retirer le logo</button>}
            </div>}
          </div>
          <Field label="Slogan (sous le nom, sur les tickets et bons)"><input className="w-full" maxLength={120} disabled={!write} value={b.slogan ?? ''} onChange={(e) => set({ slogan: e.target.value })} placeholder="Votre santé, notre priorité" /></Field>

        </div>

        <div className="space-y-3">
          <h4 className="font-extrabold">Bon de pharmacie (vente à crédit)</h4>
          <p className="text-xs text-ink-muted">Quand un médicament est délivré « en bon », le bon s’imprime automatiquement en plusieurs exemplaires : un reste à la pharmacie, l’autre est remis au client qui le signe.</p>
          <Field label="Titre du bon"><input className="w-full" maxLength={60} disabled={!write} value={b.voucher.title} onChange={(e) => vc({ title: e.target.value })} /></Field>
          <Field label="Texte d’engagement du client"><textarea rows={4} className="w-full" maxLength={400} disabled={!write} value={b.voucher.legalText} onChange={(e) => vc({ legalText: e.target.value })} /></Field>
          <div className="flex flex-wrap items-center gap-4">
            <Field label="Nombre d’exemplaires"><select disabled={!write} value={b.voucher.copies} onChange={(e) => vc({ copies: Number(e.target.value) })}><option value={1}>1</option><option value={2}>2 (pharmacie + client)</option><option value={3}>3 (+ comptabilité)</option></select></Field>
            <div className="space-y-1">{tog(b.voucher.autoPrint, (x) => vc({ autoPrint: x }), 'Imprimer automatiquement après la vente')}{tog(b.voucher.showLogo, (x) => vc({ showLogo: x }), 'Afficher le logo')}</div>
          </div>
          <button className="btn-alt" onClick={() => printVoucher(SAMPLE_SALE, d, 'Caissier exemple')}>🖨 Imprimer un bon d’essai</button>

          <h4 className="pt-2 font-extrabold">Étiquettes produit</h4>
          <div className="flex flex-wrap items-center gap-2">{PRESETS.map(([l, w, h]) => <button key={l} type="button" disabled={!write} onClick={() => lb({ widthMm: w, heightMm: h })} className={`rounded-full px-3 py-1 text-xs font-bold ${b.label.widthMm === w && b.label.heightMm === h ? 'bg-brand text-white' : 'bg-slate-100'}`}>{l}</button>)}</div>
          <div className="flex gap-3"><Field label="Largeur (mm)"><input type="number" min={20} max={120} className="w-24" disabled={!write} value={b.label.widthMm} onChange={(e) => lb({ widthMm: Number(e.target.value) || 50 })} /></Field><Field label="Hauteur (mm)"><input type="number" min={15} max={100} className="w-24" disabled={!write} value={b.label.heightMm} onChange={(e) => lb({ heightMm: Number(e.target.value) || 30 })} /></Field></div>
          <div className="grid grid-cols-2 gap-1">{tog(b.label.showPharmacy, (x) => lb({ showPharmacy: x }), 'Nom de la pharmacie')}{tog(b.label.showName, (x) => lb({ showName: x }), 'Nom du produit')}{tog(b.label.showDci, (x) => lb({ showDci: x }), 'DCI')}{tog(b.label.showPrice, (x) => lb({ showPrice: x }), 'Prix')}{tog(b.label.showBarcode, (x) => lb({ showBarcode: x }), 'Code-barres')}{tog(b.label.showExpiry, (x) => lb({ showExpiry: x }), 'Date de péremption')}{tog(b.label.showSupplier, (x) => lb({ showSupplier: x }), 'Fournisseur (abréviation)')}{tog(b.label.showLot, (x) => lb({ showLot: x }), 'N° de lot')}</div>
          <LabelDesigner d={d} disabled={!write} onChange={(layout) => lb({ layout })} onReset={async () => { setErr(null); try { const r = await api<BrandingData>('/company/branding', { method: 'PUT', json: { label: { ...b.label, layout: 'reset' } } }); setD(r); setBrandingCache(r); } catch (e) { setErr((e as Error).message); } }} />
          <button className="btn-alt" onClick={() => printLabels([{ name: 'PARACETAMOL 500 MG BTE 16', dci: 'paracétamol', price: 1500, barcode: '6001234567890', expiry: '2028-06-30', supplier: 'LBX', lot: 'A2401', qty: 2 }], d)}>🖨 Imprimer des étiquettes d’essai</button>
        </div>
      </div>
      <ReceiptDesigner d={d} write={write} onReceipt={rc} />
      <ErrorBox error={err} />{msg && <Badge>{msg}</Badge>}
      {write && <button className="btn" onClick={save}>💾 Enregistrer l’image et les modèles</button>}
    </div>
  );
}

interface Doc { key: string; label?: string | null; fileName: string; createdAt: string }

/** Documents libres : on peut en déposer d'autres au fil du temps (contrats, autorisations, attestations…). */
export function CustomDocs({ docs, onChange }: { docs: Doc[]; onChange: (p: unknown) => void }) {
  const write = can('company.manage');
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const custom = docs.filter((x) => x.key.startsWith('custom_'));
  async function add() {
    if (!file) return;
    setErr(null);
    const form = new FormData(); form.append('label', label); form.append('file', file);
    try { onChange(await api('/company/documents-custom', { method: 'POST', form })); setLabel(''); setFile(null); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="card mt-4 space-y-3">
      <div><h3 className="font-extrabold">Autres documents</h3><p className="text-xs text-ink-muted">Ajoutez ici, au fur et à mesure, tout autre document de la structure (contrat de travail type, convention, assurance, attestation…).</p></div>
      {custom.length > 0 && (
        <table className="w-full text-sm"><tbody>{custom.map((d) => (
          <tr key={d.key}><td><b>{d.label}</b><div className="text-xs text-ink-muted">{d.fileName} · {dateFr(d.createdAt)}</div></td>
            <td className="text-right"><button className="btn-alt !py-1" onClick={async () => window.open(URL.createObjectURL(await apiBlob(`/company/documents/${d.key}`)))}>Voir</button>{write && <button className="ml-2 text-xs font-bold text-red-700" onClick={async () => { if (confirm(`Supprimer « ${d.label} » ?`)) onChange(await api(`/company/documents/${d.key}`, { method: 'DELETE' })); }}>Supprimer</button>}</td></tr>
        ))}</tbody></table>
      )}
      {write && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Nom du document" className="flex-1"><input className="w-full" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Attestation d’assurance 2026" /></Field>
          <label className="btn-alt cursor-pointer">{file ? file.name.slice(0, 24) : 'Choisir le fichier'}<input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <button className="btn" disabled={label.trim().length < 2 || !file} onClick={add}>Ajouter</button>
        </div>
      )}
      <ErrorBox error={err} />
    </div>
  );
}
