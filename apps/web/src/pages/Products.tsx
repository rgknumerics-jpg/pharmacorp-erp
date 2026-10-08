import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { api, apiBlob, can } from '../lib/api';
import { fcfa } from '../lib/format';
import { Badge, ErrorBox, Field, Modal, PageTitle, useDebounced, useLoad } from '../components/ui';
import { ProductPlantPanel } from '../components/PlantAdvice';
import { loadBranding } from '../lib/branding';
import { printLabels } from '../lib/print';

export interface Product {
  id: string; sku: string; barcode?: string | null; name: string; dci?: string | null; form?: string | null; dosage?: string | null; laboratory?: string | null; categoryId?: string | null;
  salePrice: number; purchasePrice?: number; vatRate: number; priceFree: boolean; trackLots: boolean; minStock: number; oversellTolerance: number; prescriptionRequired: boolean; isActive: boolean;
  supplierCodes?: Record<string, string>; onlineVisible?: boolean; priceCategory?: string | null; packSize?: number; unitsPerBox?: number | null; unitSalePrice?: number | null; storage?: string; location?: string | null; safetyStock?: number; reorderQty?: number;
}

const EMPTY: Partial<Product> = { sku: '', barcode: '', name: '', dci: '', form: '', dosage: '', laboratory: '', salePrice: 0, purchasePrice: 0, vatRate: 0, priceFree: false, trackLots: true, minStock: 0, oversellTolerance: 0, prescriptionRequired: false, supplierCodes: {}, packSize: 1, storage: 'normal', safetyStock: 0, reorderQty: 0 };
const STORAGE: [string, string, string][] = [['normal', '🌡️ Ambiante (< 25 °C)', 'bg-slate-100 text-slate-800'], ['froid', '❄️ Chaîne du froid (2-8 °C)', 'bg-sky-100 text-sky-800'], ['stupefiant', '🔒 Stupéfiant', 'bg-red-100 text-red-800'], ['psychotrope', '⚠️ Psychotrope', 'bg-orange-100 text-orange-800'], ['photosensible', '🌑 Photosensible', 'bg-violet-100 text-violet-800'], ['inflammable', '🔥 Inflammable', 'bg-amber-100 text-amber-800']];
const storageOf = (k?: string) => STORAGE.find((s) => s[0] === k);

export default function Products() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, error, reload } = useLoad(() => api<Product[]>(`/products?q=${encodeURIComponent(dq)}&take=100&includeInactive=true`), [dq]);
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  const write = can('products.write');
  const showCost = data?.some((p) => p.purchasePrice !== undefined);
  const [sort, setSort] = useState<{ k: 'name' | 'sku' | 'salePrice' | 'purchasePrice' | 'minStock'; dir: 1 | -1 }>({ k: 'name', dir: 1 });
  const sorted = data && [...data].sort((a, b) => {
    const x = a[sort.k] ?? '', y = b[sort.k] ?? '';
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { sensitivity: 'base', numeric: true })) * sort.dir;
  });
  const Th = (k: typeof sort.k, label: string) => <th className="cursor-pointer select-none whitespace-nowrap hover:text-brand" title="Cliquer pour trier" onClick={() => setSort({ k, dir: sort.k === k ? (sort.dir === 1 ? -1 : 1) : 1 })}>{label} <span className={sort.k === k ? 'text-brand' : 'text-slate-300'}>{sort.k === k ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span></th>;

  return (
    <>
      <PageTitle title="Produits" sub="Catalogue, prix, TVA, codes grossistes et seuils de stock" actions={write && <button className="btn" onClick={() => setEdit({ ...EMPTY })}>+ Nouveau produit</button>} />
      <div className="card mb-3"><input className="w-full" placeholder="🔎 Nom, DCI, code…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ErrorBox error={error} />
      <div className="card overflow-auto !p-0">
        <table className="w-full">
          <thead><tr>{Th('name', 'Produit')}{Th('sku', 'Code')}{Th('salePrice', 'Prix de vente')}{showCost && Th('purchasePrice', 'Prix d’achat')}<th>TVA</th>{Th('minStock', 'Seuil')}<th>Indicateurs</th><th /></tr></thead>
          <tbody>
            {sorted?.map((p, i) => (
              <tr key={p.id} className={`${i % 2 ? 'bg-slate-100/70' : 'bg-white'} hover:bg-brand-soft ${p.isActive ? '' : 'opacity-50'}`}>
                <td><b className={p.unitsPerBox && p.unitsPerBox > 1 ? 'text-teal-700' : ''}>{p.name}</b>{p.unitsPerBox && p.unitsPerBox > 1 ? <span className="ml-1 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-extrabold text-teal-800" title={`Détaillable : ${p.unitsPerBox} unités par boîte`}>✂ détail</span> : null}<div className="text-xs text-ink-muted">{[p.dci, p.dosage, p.form, p.laboratory].filter(Boolean).join(' · ')}</div></td>
                <td className="text-xs">{p.sku}<br />{p.barcode}</td>
                <td>{p.priceFree ? <Badge tone="info">prix libre</Badge> : fcfa(p.salePrice)}{p.unitSalePrice ? <div className="text-xs text-ink-muted">unité {fcfa(p.unitSalePrice)}</div> : null}</td>
                {showCost && <td>{fcfa(p.purchasePrice)}</td>}
                <td>{p.vatRate ? `${p.vatRate} %` : <span className="text-xs text-ink-muted">exonéré</span>}</td>
                <td>{p.minStock}</td>
                <td className="space-x-1">{p.prescriptionRequired && <Badge tone="warn">ordonnance</Badge>}{p.storage && p.storage !== 'normal' && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${storageOf(p.storage)?.[2]}`}>{storageOf(p.storage)?.[1]}</span>}{(p.packSize ?? 1) > 1 && <Badge tone="muted">colis ×{p.packSize}</Badge>}{!p.trackLots && <Badge tone="muted">sans lot</Badge>}{!p.isActive && <Badge tone="bad">retiré</Badge>}</td>
                <td>{write && <button className="btn-alt" onClick={() => setEdit(p)}>Modifier</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && <p className="p-3 text-sm text-ink-muted">Aucun produit.</p>}
      </div>
      {edit && <ProductForm initial={edit} showCost={showCost !== false} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

/** Champ avec propositions dès les premières lettres (DCI, laboratoire, famille). */
function Autocomplete({ value, onChange, fetcher, placeholder }: { value: string; onChange: (v: string) => void; fetcher: (q: string) => Promise<{ value: string; hint?: string | null }[]>; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ value: string; hint?: string | null }[]>([]);
  const [sel, setSel] = useState(0);
  const dq = useDebounced(value, 200);
  useEffect(() => { if (!open || dq.trim().length < 3) { setItems([]); return; } fetcher(dq).then((l) => { setItems(l); setSel(0); }).catch(() => setItems([])); }, [dq, open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative">
      <input className="w-full" placeholder={placeholder} value={value} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (!items.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          else if (e.key === 'Enter' && open) { e.preventDefault(); onChange(items[sel].value); setOpen(false); }
        }} />
      {open && items.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-ink-line bg-white shadow-lg">
          {items.map((it, i) => <button type="button" key={it.value} onMouseDown={() => { onChange(it.value); setOpen(false); }} className={`block w-full px-3 py-1.5 text-left text-sm ${i === sel ? 'bg-brand text-white' : i % 2 ? 'bg-slate-50' : ''}`}>{it.value}{it.hint && <span className={`ml-2 text-xs ${i === sel ? 'text-white/80' : 'text-ink-muted'}`}>{it.hint}</span>}</button>)}
        </div>
      )}
    </div>
  );
}

/** Lecture camera (navigateurs compatibles BarcodeDetector) ; sinon la douchette suffit (elle tape le code). */
function CameraScan({ onCode, onClose }: { onCode: (c: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null, stop = false;
    const BD = (window as unknown as { BarcodeDetector?: new (o: unknown) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) { setErr('Ce navigateur ne lit pas les codes-barres par caméra : utilisez la douchette ou saisissez le code.'); return; }
    const det = new BD({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'qr_code', 'data_matrix'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(async (s) => {
      stream = s; if (!video.current) return; video.current.srcObject = s; await video.current.play();
      while (!stop) { try { const r = await det.detect(video.current); if (r[0]?.rawValue) { onCode(r[0].rawValue); break; } } catch { /* image suivante */ } await new Promise((x) => setTimeout(x, 250)); }
    }).catch(() => setErr('Caméra inaccessible.'));
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);
  return <Modal title="Scanner le code-barres" onClose={onClose}>{err ? <p className="text-sm">{err}</p> : <video ref={video} className="w-full rounded-lg" muted playsInline />}</Modal>;
}

const Section = ({ title, color, children }: { title: string; color: string; children: ReactNode }) => (
  <section className={`rounded-xl border-l-4 p-3 ${color}`}><h4 className="mb-2 text-sm font-extrabold uppercase tracking-wide">{title}</h4>{children}</section>
);

function ProductForm({ initial, showCost, onClose, onSaved }: { initial: Partial<Product>; showCost: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<Product>>({ ...EMPTY, ...initial, supplierCodes: { ...(initial.supplierCodes ?? {}) } });
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  const [labelQty, setLabelQty] = useState(1);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => { if (initial.id) apiBlob(`/products/${initial.id}/photo`).then((b) => setPhotoUrl(URL.createObjectURL(b))).catch(() => undefined); }, [initial.id]);
  const { data: lists, reload: reloadLists } = useLoad(() => api<{ lists: { forms: string[]; locations: string[] } }>('/company/settings'));
  const wholesalersRef = useRef<{ supplierId: string }[] | null>(null);
  const [delegates, setDelegates] = useState(false);
  const [hints, setHints] = useState<{ supplierId: string; supplier: string; abbreviation: string | null; cip: string; designation: string; available: boolean; score: number }[]>([]);
  const { data: pricing, reload: reloadPricing } = useLoad(() => api<{ vatRates: { label: string; rate: number }[]; coefficients: { exempt: number; taxed: number }; priceCategories: { key: string; label: string; coefficient: number }[]; rounding: number }>('/settings/pricing'));
  const { data: suppliers } = useLoad(() => api<{ id: string; name: string; abbreviation?: string | null }[]>('/suppliers'));
  const { data: wholesalers } = useLoad(() => api<{ key: string; label: string; supplierId: string }[]>('/supplier-hub/wholesalers'));
  wholesalersRef.current = wholesalers;
  const { data: forms } = useLoad(() => api<string[]>('/referentials/forms'));
  const { data: categories, reload: reloadCategories } = useLoad(() => api<{ id: string; name: string }[]>('/categories'));
  const id = initial.id;
  // référentiel CIP : à la saisie du libellé, retrouve les codes de chaque grossiste (catalogues importés) et pré-remplit les cases vides quand la correspondance est sûre
  useEffect(() => {
    const q = (f.name ?? '').trim();
    if (q.length < 4) { setHints([]); return; }
    const t = setTimeout(() => {
      api<typeof hints>(`/supplier-hub/lookup?q=${encodeURIComponent(q)}`).then((h0) => {
        const allowed = new Set((wholesalersRef.current ?? []).map((w) => w.supplierId));
        const h = allowed.size ? h0.filter((x) => allowed.has(x.supplierId)) : h0;
        setHints(h);
        const sure = new Map<string, string>();
        for (const x of h) if (x.score >= 90 && x.available !== false && !sure.has(x.supplierId)) sure.set(x.supplierId, x.cip);
        if (sure.size) setF((cur) => { const codes = { ...(cur.supplierCodes ?? {}) }; let changed = false; for (const [sid, cip] of sure) if (!codes[sid]) { codes[sid] = cip; changed = true; } return changed ? { ...cur, supplierCodes: codes } : cur; });
      }).catch(() => undefined);
    }, 600);
    return () => clearTimeout(t);
  }, [f.name]);
  const createInList = async (kind: 'forms' | 'locations', label: string, field: 'form' | 'location') => {
    const v = prompt(`Nouveau(elle) ${label} :`)?.trim();
    if (!v) return;
    try { await api(`/company/lists/${kind}`, { method: 'POST', json: { value: v } }); reloadLists(); set(field, v as never); } catch (e) { setError((e as Error).message); }
  };
  const createCategory = async () => {
    const v = prompt('Nouvelle famille / catégorie :')?.trim();
    if (!v) return;
    try { const c = await api<{ id: string }>('/categories', { method: 'POST', json: { name: v } }); reloadCategories(); set('categoryId', c.id); } catch (e) { setError((e as Error).message); }
  };
  const createVat = async () => {
    const label = prompt('Nom du taux de TVA (ex. TVA 5 %) :')?.trim();
    if (!label) return;
    const rate = Number(prompt('Taux en % (ex. 5) :')?.replace(',', '.'));
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) { setError('Taux invalide'); return; }
    try { await api('/settings/pricing', { method: 'PUT', json: { vatRates: [...(pricing?.vatRates ?? []), { label, rate }] } }); reloadPricing(); set('vatRate', rate); } catch (e) { setError((e as Error).message); }
  };
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setF((x) => ({ ...x, [k]: v }));
  const taxable = (f.vatRate ?? 0) > 0;
  // coefficient de la categorie de prix choisie (sinon coefficient general exonere / avec TVA), arrondi au multiple superieur de 5 F
  const cat = pricing?.priceCategories.find((x) => x.key === f.priceCategory);
  const coef = cat?.coefficient ?? (pricing ? (taxable ? pricing.coefficients.taxed : pricing.coefficients.exempt) : null);
  const step = pricing?.rounding ?? 5;
  const suggested = coef && f.purchasePrice ? Math.ceil(Math.round(f.purchasePrice * coef * 1000) / 1000 / step) * step : null;
  const barcodeRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!id) barcodeRef.current?.focus(); }, [id]);

  async function save(e: FormEvent) {
    e.preventDefault(); setError(null);
    const body: Record<string, unknown> = {};
    for (const k of ['sku', 'barcode', 'name', 'dci', 'form', 'dosage', 'laboratory', 'location'] as const) if (f[k] !== undefined && f[k] !== null && f[k] !== '') body[k] = String(f[k]).trim();
    if (f.categoryId) body.categoryId = f.categoryId;
    for (const k of ['salePrice', 'vatRate', 'minStock', 'oversellTolerance', 'safetyStock', 'reorderQty'] as const) body[k] = Number(f[k]) || 0;
    body.packSize = Math.max(1, Number(f.packSize) || 1);
    if (f.unitsPerBox) { body.unitsPerBox = Number(f.unitsPerBox); body.unitSalePrice = Number(f.unitSalePrice) || Math.ceil((Number(f.salePrice) || 0) / Number(f.unitsPerBox)); }
    body.storage = f.storage ?? 'normal';
    if (f.priceCategory) body.priceCategory = f.priceCategory;
    body.supplierCodes = Object.fromEntries(Object.entries(f.supplierCodes ?? {}).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v.trim()]));
    if (showCost) body.purchasePrice = Number(f.purchasePrice) || 0;
    for (const k of ['priceFree', 'trackLots', 'prescriptionRequired', 'onlineVisible'] as const) body[k] = !!f[k];
    if (!body.sku) body.sku = (f.barcode || `P-${Date.now().toString(36).toUpperCase()}`).slice(0, 40);
    if (id) body.isActive = f.isActive !== false;
    try {
      const p = await api<{ id: string }>(id ? `/products/${id}` : '/products', { method: id ? 'PATCH' : 'POST', json: body });
      if (photo) { const form = new FormData(); form.append('file', photo); await api(`/products/${p.id}/photo`, { method: 'POST', form }); }
      onSaved();
    } catch (er) { setError((er as Error).message); }
  }

  const num = (k: keyof Product, label: string, extra: Record<string, unknown> = {}) => <Field label={label}><input type="number" min={0} className="w-full" value={(f[k] as number) || ''} placeholder="0" onChange={(e) => set(k, (e.target.value === '' ? null : Number(e.target.value)) as never)} {...extra} /></Field>;
  const chk = (k: keyof Product, label: string) => <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked as never)} /> {label}</label>;

  return (
    <Modal title={id ? 'Modifier le produit' : 'Nouveau produit'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-3" onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'submit') e.preventDefault(); }}>
        <Section title="① Identification" color="border-brand bg-emerald-50/60">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Code-barres (EAN) — scannez ou saisissez" className="md:col-span-1">
              <div className="flex gap-1"><input ref={barcodeRef} className="w-full font-mono" placeholder="Scannez ici…" value={f.barcode ?? ''} onChange={(e) => set('barcode', e.target.value.trim())} /><button type="button" className="btn-alt !px-2" title="Scanner avec la caméra" onClick={() => setScan(true)}>📷</button></div>
            </Field>
            <Field label="Nom commercial *" className="md:col-span-2"><input className="w-full text-base font-bold" required value={f.name ?? ''} onChange={(e) => set('name', e.target.value.toUpperCase())} /></Field>
            <Field label="DCI (nom générique) — dès 3 lettres" className="md:col-span-2"><Autocomplete value={f.dci ?? ''} onChange={(v) => set('dci', v)} placeholder="ex. parac…" fetcher={async (q) => (await api<string[]>(`/referentials/dci?q=${encodeURIComponent(q)}`)).map((v) => ({ value: v }))} /></Field>
            <Field label="Dosage"><input className="w-full" placeholder="500 mg" value={f.dosage ?? ''} onChange={(e) => set('dosage', e.target.value)} /></Field>
            <Field label="Forme"><div className="flex gap-1"><input className="w-full" list="forms" value={f.form ?? ''} onChange={(e) => set('form', e.target.value)} /><button type="button" className="btn-alt !px-2" title="Créer une forme" onClick={() => createInList('forms', 'forme', 'form')}>+</button></div><datalist id="forms">{[...new Set([...(forms ?? []), ...(lists?.lists.forms ?? [])])].map((x) => <option key={x} value={x} />)}</datalist></Field>
            <Field label="Laboratoire — dès 3 lettres" className="md:col-span-2"><Autocomplete value={f.laboratory ?? ''} onChange={(v) => set('laboratory', v)} placeholder="ex. sano…" fetcher={async (q) => (await api<{ name: string; agency: string | null }[]>(`/referentials/laboratories?q=${encodeURIComponent(q)}`)).map((l) => ({ value: l.name, hint: l.agency && l.agency !== 'Sans Agence' ? l.agency : null }))} />{f.laboratory ? <button type="button" className="mt-1 text-xs font-bold text-brand underline" onClick={() => setDelegates(true)}>📞 Délégué médical de ce laboratoire</button> : null}</Field>
            <Field label="Famille thérapeutique"><div className="flex gap-1"><select className="w-full" value={f.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}><option value="">—</option>{categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button type="button" className="btn-alt !px-2" title="Créer une famille" onClick={createCategory}>+</button></div>{(categories?.length ?? 0) < 20 && <button type="button" className="mt-1 text-xs font-bold text-brand underline" onClick={async () => { await api('/referentials/families/import', { method: 'POST' }); reloadCategories(); }}>Reprendre les familles du référentiel PHARMACORP</button>}</Field>
            <Field label="Code interne"><input className="w-full font-mono" placeholder="auto (code-barres)" value={f.sku ?? ''} onChange={(e) => set('sku', e.target.value)} /></Field>
          </div>
        </Section>

        <Section title="📸 Photo du produit" color="border-pink-500 bg-pink-50/60">
          <div className="flex items-center gap-3">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-ink-line">{photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-contain" /> : <span className="text-3xl">💊</span>}</div>
            <label className="btn-alt cursor-pointer">📷 Prendre / choisir une photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) { setPhoto(file); setPhotoUrl(URL.createObjectURL(file)); } }} /></label>
            <span className="text-xs text-ink-muted">JPEG, PNG ou WebP, 2 Mo maximum.</span>
          </div>
        </Section>

        <Section title="② Codes grossistes (CIP) — utilisés pour les commandes" color="border-sky-500 bg-sky-50/60">
          {wholesalers?.length ? <div className="grid gap-3 md:grid-cols-3">{wholesalers.map((s) => <Field key={s.supplierId} label={`CIP ${s.label}`}><input className="w-full font-mono" value={f.supplierCodes?.[s.supplierId] ?? ''} onChange={(e) => set('supplierCodes', { ...(f.supplierCodes ?? {}), [s.supplierId]: e.target.value })} /></Field>)}</div> : <p className="text-sm text-ink-muted">Chargement des grossistes…</p>}
          <p className="mt-1 text-xs text-ink-muted">Les trois grossistes principaux (Laborex, Ubipharm, CEP / SEP). Les codes sont retrouvés automatiquement d’après le nom du produit ; saisissez-les à la main uniquement pour corriger.</p>
          {hints.length > 0 && <div className="mt-2 rounded-lg bg-white p-2 text-xs ring-1 ring-sky-200"><b>Codes trouvés dans les catalogues des grossistes</b>{hints.map((h) => { const cur = f.supplierCodes?.[h.supplierId]; return <div key={h.supplierId + h.cip} className="flex items-center gap-2 py-0.5"><span className="w-24 shrink-0 font-bold">{h.abbreviation || h.supplier}</span><span className="font-mono">{h.cip}</span><span className="truncate text-ink-muted">{h.designation}{h.available ? '' : ' · indisponible'} · {h.score} %</span>{cur === h.cip ? <span className="ml-auto font-bold text-brand">✓</span> : <button type="button" className="ml-auto font-bold text-brand underline" onClick={() => set('supplierCodes', { ...(f.supplierCodes ?? {}), [h.supplierId]: h.cip })}>Utiliser</button>}</div>; })}</div>}
        </Section>

        <Section title="③ Prix et TVA" color="border-amber-500 bg-amber-50/60">
          <div className="mb-2 flex flex-wrap gap-2">{pricing?.priceCategories.map((pc) => <button type="button" key={pc.key} onClick={() => { set('priceCategory', pc.key); if (f.purchasePrice) set('salePrice', Math.ceil(Math.round(f.purchasePrice * pc.coefficient * 1000) / 1000 / step) * step); }} className={`rounded-xl px-3 py-1.5 text-sm font-bold transition ${f.priceCategory === pc.key ? 'scale-105 bg-orange-500 text-white shadow' : 'bg-white ring-1 ring-orange-300 hover:bg-orange-50'}`}>{pc.label} <span className="opacity-75">×{pc.coefficient}</span></button>)}</div>
          <div className="mb-2 flex flex-wrap gap-2">
            {(pricing?.vatRates ?? [{ label: 'Exonéré', rate: 0 }, { label: 'TVA 18 %', rate: 18 }]).map((r) => <button type="button" key={r.label} onClick={() => set('vatRate', r.rate)} className={`rounded-full px-3 py-1 text-sm font-bold ${f.vatRate === r.rate ? 'bg-amber-500 text-white' : 'bg-white ring-1 ring-amber-300'}`}>{r.rate ? '🧾' : '🚫'} {r.label}</button>)}
            <button type="button" className="rounded-full bg-white px-3 py-1 text-sm font-bold text-amber-700 ring-1 ring-dashed ring-amber-400" onClick={createVat}>+ Nouveau taux</button>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {showCost && num('purchasePrice', 'Prix d’achat (FCFA)')}
            <Field label="Prix de vente public (FCFA)"><input type="number" min={0} className="w-full font-bold" value={f.salePrice || ''} placeholder="0" onChange={(e) => set('salePrice', Number(e.target.value) || 0)} />{suggested && suggested !== f.salePrice && <button type="button" className="mt-1 text-xs font-bold text-amber-700 underline" onClick={() => set('salePrice', suggested)}>Proposé : {fcfa(suggested)} (achat × {coef}, arrondi {step} F)</button>}</Field>
            {num('packSize', 'Colisage (boîtes par carton)', { min: 1 })}
            {num('unitsPerBox', 'Unités par boîte (déconditionnement)')}
            {f.unitsPerBox ? num('unitSalePrice', `Prix à l’unité (défaut ${fcfa(Math.ceil((f.salePrice ?? 0) / (f.unitsPerBox || 1)))})`) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-4">{chk('priceFree', 'Prix libre (saisi à la caisse)')}</div>
        </Section>

        <Section title="④ Conservation et réglementation" color="border-violet-500 bg-violet-50/60">
          <div className="mb-2 flex flex-wrap gap-2">{STORAGE.map(([k, l, c]) => <button type="button" key={k} onClick={() => set('storage', k)} className={`rounded-full px-3 py-1 text-sm font-bold ${f.storage === k ? `${c} ring-2 ring-offset-1 ring-current` : 'bg-white ring-1 ring-ink-line'}`}>{l}</button>)}</div>
          <div className="grid gap-3 md:grid-cols-3"><Field label="Emplacement (rayon)"><div className="flex gap-1"><input className="w-full" list="locations" placeholder="Rayon 1" value={f.location ?? ''} onChange={(e) => set('location', e.target.value)} /><button type="button" className="btn-alt !px-2" title="Créer un emplacement" onClick={() => createInList('locations', 'emplacement', 'location')}>+</button></div><datalist id="locations">{lists?.lists.locations.map((x) => <option key={x} value={x} />)}</datalist></Field></div>
          <div className="mt-2 flex flex-wrap gap-4">{chk('prescriptionRequired', 'Ordonnance requise')}{chk('onlineVisible', '📱 Visible dans l’application client')}{chk('trackLots', 'Suivi par lot et péremption')}{id && chk('isActive', 'Produit actif')}</div>
        </Section>

        <Section title="⑤ Stock" color="border-rose-500 bg-rose-50/60">
          <div className="grid gap-3 md:grid-cols-4">{num('minStock', 'Stock minimum (alerte)')}{num('safetyStock', 'Stock de sécurité')}{num('reorderQty', 'Quantité économique de commande')}{num('oversellTolerance', 'Survente tolérée')}</div>
        </Section>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-line bg-slate-50 p-3">
          <b className="text-sm">🏷 Étiquettes</b>
          <input type="number" min={1} max={500} className="w-20" value={labelQty} onChange={(e) => setLabelQty(Math.max(1, Number(e.target.value) || 1))} aria-label="Nombre d’étiquettes" />
          <button type="button" className="btn-alt" disabled={!f.name} onClick={async () => { try { printLabels([{ name: f.name ?? '', dci: f.dci, price: f.salePrice ?? 0, barcode: f.barcode || f.sku || '', supplier: (() => { const sid = Object.keys(f.supplierCodes ?? {}).find((k) => f.supplierCodes?.[k]); const s = suppliers?.find((x) => x.id === sid); return s ? s.abbreviation || s.name : null; })(), qty: labelQty }], await loadBranding()); } catch (e) { setError((e as Error).message); } }}>Imprimer</button>
          <span className="text-xs text-ink-muted">Format, mentions et code-barres : réglés dans « Ma structure ».</span>
        </div>
        {id && <ProductPlantPanel productId={id} />}

        <ErrorBox error={error} />
        <div className="flex gap-2"><button className="btn !px-6 !py-2.5">💾 Enregistrer</button><button type="button" className="btn-alt" onClick={onClose}>Annuler</button></div>
      </form>
      {delegates && f.laboratory && <DelegateLookup lab={f.laboratory} product={f.name ?? ''} onClose={() => setDelegates(false)} />}
      {scan && <CameraScan onCode={(c) => { set('barcode', c); setScan(false); }} onClose={() => setScan(false)} />}
    </Modal>
  );
}

/** Délégué médical responsable d'un produit : trouvé par le laboratoire (ou son agence de promotion) dans l'annuaire santé, à appeler ou contacter sur WhatsApp. */
function DelegateLookup({ lab, product, onClose }: { lab: string; product: string; onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [agency, setAgency] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const labs = await api<{ name: string; agency: string | null }[]>(`/referentials/laboratories?q=${encodeURIComponent(lab)}`).catch(() => []);
        const ag = labs.find((l) => l.name.toLowerCase() === lab.toLowerCase())?.agency ?? labs[0]?.agency ?? null;
        setAgency(ag && ag !== 'Sans Agence' ? ag : null);
        const qs = [lab, ...(ag && ag !== 'Sans Agence' ? [ag] : [])];
        const res = await Promise.all(qs.map((q) => api<{ items: any[] }>(`/directory?q=${encodeURIComponent(q)}&type=delegue&take=30`).catch(() => ({ items: [] }))));
        const seen = new Set<string>(); const out: any[] = [];
        for (const r of res) for (const x of r.items) { const k = x.id ?? x.name; if (!seen.has(k)) { seen.add(k); out.push(x); } }
        setRows(out);
      } catch { setRows([]); }
    })();
  }, [lab]);
  return (
    <Modal title={`Délégué médical — ${lab}`} onClose={onClose}>
      <div className="space-y-2">
        <p className="text-sm text-ink-muted">Pour un souci sur <b>{product || 'ce produit'}</b> : contactez le délégué du laboratoire{agency ? <> ou de son agence <b>{agency}</b></> : ''}.</p>
        {rows === null && <p className="text-sm">Recherche dans l’annuaire…</p>}
        {rows?.length === 0 && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Aucun délégué enregistré pour ce laboratoire. Ajoutez-le dans <b>Annuaires santé → Proposer une nouvelle fiche</b> (type « Délégués médicaux », avec son laboratoire).</p>}
        <div className="max-h-80 space-y-2 overflow-auto">
          {rows?.map((x) => (
            <div key={x.id ?? x.name} className="rounded-xl bg-slate-50 p-2 text-sm">
              <b>{x.name}</b>{x.title && <span className="text-ink-muted"> · {x.title}</span>}
              <div className="text-xs text-ink-muted">{[x.agency && x.agency !== 'Sans Agence' ? `Agence : ${x.agency}` : null, x.laboratories?.length ? `Laboratoires : ${x.laboratories.join(', ')}` : null, x.products].filter(Boolean).join(' · ')}</div>
              <div className="mt-1 flex flex-wrap gap-1">{(x.phones ?? []).map((p: string) => <span key={p} className="inline-flex gap-1"><a className="rounded bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand" href={`tel:${p.replace(/\s/g, '')}`}>📞 {p}</a><a className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800" target="_blank" rel="noreferrer" href={`https://wa.me/${p.replace(/\D/g, '')}?text=${encodeURIComponent(`Bonjour, nous avons un souci avec ${product || 'un produit'} (${lab}).`)}`}>💬 WhatsApp</a></span>)}{x.email && <a className="rounded bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800" href={`mailto:${x.email}?subject=${encodeURIComponent(`Souci produit ${product}`)}`}>✉ {x.email}</a>}</div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
