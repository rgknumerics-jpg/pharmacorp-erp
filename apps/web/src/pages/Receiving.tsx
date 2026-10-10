import { useEffect, useRef, useState } from 'react';
import { api, apiBlob, can, getSession } from '../lib/api';
import { dateFr, dateTimeFr, fcfa } from '../lib/format';
import { Badge, ErrorBox, Field, PageTitle, useDebounced, useLoad } from '../components/ui';
import { loadBranding } from '../lib/branding';
import { printLabels } from '../lib/print';

interface Supplier { id: string; name: string }
interface PickProduct { id: string; name: string; sku: string }
interface Line { productId: string; productName: string; quantity: number; unitCost: number; lotNumber: string; expiryDate: string; confidence?: number; designation?: string }
interface OcrDoc {
  id: string; kind: 'delivery_note' | 'invoice' | 'expiry_label'; status: string; confidence: number; createdById: string | null; needsSecondReviewer: boolean; createdAt: string; fileName?: string | null; rawText: string;
  parsed: {
    header?: { supplierName: string | null; documentNumber: string | null; documentDate: string | null; totalAmount: number | null };
    lines?: { designation: string; quantity: number | null; unitCost: number | null; lotNumber: string | null; expiryDate: string | null; productId: string | null; productName: string | null; confidence: number }[];
    label?: { lotNumber: string | null; expiryDate: string | null; expiryPrecision: string | null };
  };
}

const KIND_LABEL = { delivery_note: 'Bon de livraison', invoice: 'Facture fournisseur', expiry_label: 'Étiquette de péremption' } as const;
const confTone = (c: number) => (c >= 0.8 ? 'ok' : c >= 0.55 ? 'warn' : 'bad') as 'ok' | 'warn' | 'bad';

declare global { interface Window { Tesseract?: { recognize: (img: File | Blob, lang: string, opts?: unknown) => Promise<{ data: { text: string; confidence: number } }> } } }

/** OCR dans le navigateur (gratuit, aucune image envoyee a un tiers, utilisable hors ligne une fois le moteur en cache). */
async function browserOcr(file: File): Promise<{ text: string; confidence: number }> {
  if (!window.Tesseract) {
    await new Promise<void>((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = () => res(); s.onerror = () => rej(new Error('Moteur OCR du navigateur indisponible (connexion requise la première fois).'));
      document.head.appendChild(s);
    });
  }
  const r = await window.Tesseract!.recognize(file, 'fra+eng');
  return { text: r.data.text, confidence: Math.max(0, Math.min(1, r.data.confidence / 100)) };
}

function ProductPicker({ value, name, onPick }: { value: string; name: string; onPick: (p: PickProduct) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [res, setRes] = useState<PickProduct[]>([]);
  useEffect(() => {
    if (dq.trim().length < 2) { setRes([]); return; }
    api<PickProduct[]>(`/products?q=${encodeURIComponent(dq.trim())}&take=8`).then(setRes).catch(() => setRes([]));
  }, [dq]);
  return (
    <div className="relative">
      <input className={`w-full ${value ? '' : 'border-orange-400'}`} placeholder="Choisir le produit…" value={q || name} onChange={(e) => setQ(e.target.value)} />
      {res.length > 0 && q && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-ink-line bg-white shadow">
          {res.map((p) => <button key={p.id} className="block w-full px-2 py-1 text-left text-sm hover:bg-brand-soft" onClick={() => { onPick(p); setQ(''); setRes([]); }}>{p.name} <span className="text-xs text-ink-muted">{p.sku}</span></button>)}
        </div>
      )}
    </div>
  );
}

function LinesEditor({ lines, setLines }: { lines: Line[]; setLines: (l: Line[]) => void }) {
  const upd = (i: number, patch: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[760px]">
        <thead><tr><th>Produit</th><th>Qté</th><th>Coût unit.</th><th>N° de lot</th><th>Péremption</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="min-w-[230px]">
                {l.designation && <div className="mb-1 text-xs text-ink-muted">Lu : « {l.designation} » {l.confidence !== undefined && <Badge tone={confTone(l.confidence)}>{Math.round(l.confidence * 100)} %</Badge>}</div>}
                <ProductPicker value={l.productId} name={l.productName} onPick={(p) => upd(i, { productId: p.id, productName: p.name })} />
              </td>
              <td><input type="number" min={1} className="w-20" value={l.quantity} onChange={(e) => upd(i, { quantity: Number(e.target.value) || 0 })} /></td>
              <td><input type="number" min={0} className="w-24" value={l.unitCost} onChange={(e) => upd(i, { unitCost: Number(e.target.value) || 0 })} /></td>
              <td><input className="w-28" value={l.lotNumber} onChange={(e) => upd(i, { lotNumber: e.target.value.toUpperCase() })} /></td>
              <td><input type="date" value={l.expiryDate} onChange={(e) => upd(i, { expiryDate: e.target.value })} /></td>
              <td><button className="btn-alt" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn-alt mt-2" onClick={() => setLines([...lines, { productId: '', productName: '', quantity: 1, unitCost: 0, lotNumber: '', expiryDate: '' }])}>+ Ligne</button>
    </div>
  );
}

const toPayload = (lines: Line[]) => lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: l.unitCost || undefined, lotNumber: l.lotNumber || undefined, expiryDate: l.expiryDate || undefined }));

export default function Receiving() {
  const [tab, setTab] = useState<'scan' | 'manual' | 'review' | 'history'>('scan');
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageTitle title="Réception et OCR" sub="Bons de livraison, factures et dates de péremption — rien n’entre en stock sans vérification humaine" />
      <div className="mb-3 flex flex-wrap gap-2">
        {([['scan', '📷 Numériser'], ['manual', '⌨️ Saisie rapide'], ['review', 'Documents à vérifier'], ['history', 'Historique']] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? 'btn' : 'btn-alt'} onClick={() => { setTab(k); setOpen(null); }}>{l}</button>
        ))}
      </div>
      {open ? <Review id={open} onClose={() => { setOpen(null); setTab('review'); }} /> : (
        <>
          {tab === 'scan' && <Scan onCreated={(id) => setOpen(id)} />}
          {tab === 'manual' && <QuickReceive />}
          {tab === 'review' && <ReviewList onOpen={setOpen} />}
          {tab === 'history' && <History />}
        </>
      )}
    </>
  );
}

function Scan({ onCreated }: { onCreated: (id: string) => void }) {
  const [kind, setKind] = useState<'delivery_note' | 'invoice' | 'expiry_label'>('delivery_note');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [inBrowser, setInBrowser] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<string | null>(null);
  if (file && !preview.current) preview.current = URL.createObjectURL(file);

  async function run() {
    setError(null);
    try {
      const form = new FormData();
      form.append('kind', kind);
      if (file) form.append('image', file);
      if (text.trim()) form.append('rawText', text.trim());
      else if (file && inBrowser) {
        setBusy('Lecture du document dans le navigateur…');
        const r = await browserOcr(file);
        form.append('rawText', r.text);
        form.append('engineConfidence', String(r.confidence));
      } else setBusy('Lecture du document par le serveur…');
      const doc = await api<{ id: string }>('/ocr/documents', { method: 'POST', form });
      onCreated(doc.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div className="card max-w-3xl space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Type de document"><select className="w-full" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Photo ou scan"><input type="file" accept="image/*" capture="environment" className="w-full" onChange={(e) => { setFile(e.target.files?.[0] ?? null); preview.current = null; }} /></Field>
      </div>
      {file && preview.current && <img src={preview.current} alt="Aperçu" className="max-h-64 rounded-lg border border-ink-line" />}
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={inBrowser} onChange={(e) => setInBrowser(e.target.checked)} /> Lire dans le navigateur (gratuit, l’image ne quitte pas l’appareil pour être analysée)</label>
      <Field label="… ou collez directement le texte du document"><textarea className="w-full" rows={4} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <ErrorBox error={error} />
      <button className="btn" disabled={!!busy || (!file && !text.trim())} onClick={run}>{busy ?? 'Analyser le document'}</button>
      <p className="text-xs text-ink-muted">Conseil : photo bien à plat, bonne lumière, document entier. Le résultat est une proposition : vous corrigez puis validez à l’étape suivante.</p>
    </div>
  );
}

function Review({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: doc, error: loadErr } = useLoad(() => api<OcrDoc>(`/ocr/documents/${id}`), [id]);
  const { data: suppliers } = useLoad(() => api<Supplier[]>('/suppliers'));
  const [lines, setLines] = useState<Line[] | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [ref, setRef] = useState('');
  const [label, setLabel] = useState({ productId: '', productName: '', lotNumber: '', expiryDate: '' });
  const [img, setImg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const me = getSession()?.user.id;

  useEffect(() => {
    if (!doc) return;
    if (doc.kind === 'expiry_label') setLabel((l) => ({ ...l, lotNumber: doc.parsed.label?.lotNumber ?? '', expiryDate: doc.parsed.label?.expiryDate ?? '' }));
    else {
      setLines((doc.parsed.lines ?? []).map((l) => ({ productId: l.productId ?? '', productName: l.productName ?? '', quantity: l.quantity ?? 1, unitCost: l.unitCost ?? 0, lotNumber: l.lotNumber ?? '', expiryDate: l.expiryDate ?? '', confidence: l.confidence, designation: l.designation })));
      setRef(doc.parsed.header?.documentNumber ?? '');
    }
    apiBlob(`/ocr/documents/${doc.id}/image`).then((b) => setImg(URL.createObjectURL(b))).catch(() => undefined);
  }, [doc]);

  if (loadErr) return <ErrorBox error={loadErr} />;
  if (!doc) return <p>Chargement…</p>;
  const blocked = doc.needsSecondReviewer && doc.createdById === me;
  const pending = doc.status === 'pending_review';

  async function validate() {
    setError(null);
    try {
      const body = doc!.kind === 'expiry_label' ? { productId: label.productId, lotNumber: label.lotNumber, expiryDate: label.expiryDate } : { supplierId: supplierId || undefined, supplierRef: ref || undefined, lines: toPayload(lines ?? []), updateCosts: true, depotId: receiveDepot() };
      await api(`/ocr/documents/${doc!.id}/validate`, { method: 'POST', json: body });
      setDone(true);
    } catch (e) { setError((e as Error).message); }
  }
  async function reject() {
    const reason = prompt('Motif du rejet'); if (!reason) return;
    try { await api(`/ocr/documents/${doc!.id}/reject`, { method: 'POST', json: { reason } }); onClose(); } catch (e) { setError((e as Error).message); }
  }

  if (done) return <div className="card"><p className="font-bold text-brand">✓ Document validé{doc.kind === 'expiry_label' ? '' : ' : la réception est enregistrée et le stock mis à jour.'}</p><button className="btn mt-2" onClick={onClose}>Terminer</button></div>;

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <div className="card space-y-2">
        <div className="flex items-center gap-2"><b>{KIND_LABEL[doc.kind]}</b><Badge tone={confTone(doc.confidence)}>fiabilité {Math.round(doc.confidence * 100)} %</Badge></div>
        <div className="text-xs text-ink-muted">Numérisé le {dateTimeFr(doc.createdAt)}</div>
        {img ? <img src={img} alt="Document" className="max-h-[420px] w-full rounded-lg border border-ink-line object-contain" /> : <details><summary className="cursor-pointer text-sm font-bold">Texte lu</summary><pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{doc.rawText}</pre></details>}
        {doc.needsSecondReviewer && <div className="rounded-lg bg-orange-50 p-2 text-sm font-semibold text-orange-800">Lecture peu fiable : un autre professionnel que celui qui a numérisé doit valider.</div>}
      </div>
      <div className="card space-y-3">
        {doc.kind === 'expiry_label' ? (
          <>
            <Field label="Produit"><ProductPicker value={label.productId} name={label.productName} onPick={(p) => setLabel((l) => ({ ...l, productId: p.id, productName: p.name }))} /></Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="N° de lot"><input className="w-full" value={label.lotNumber} onChange={(e) => setLabel((l) => ({ ...l, lotNumber: e.target.value.toUpperCase() }))} /></Field>
              <Field label="Date de péremption"><input type="date" className="w-full" value={label.expiryDate} onChange={(e) => setLabel((l) => ({ ...l, expiryDate: e.target.value }))} /></Field>
            </div>
            <p className="text-xs text-ink-muted">Le lot doit déjà exister (réceptionné). La date saisie est comparée à celle du lot enregistré.</p>
          </>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <DepotPicker /><Field label={`Fournisseur${doc.parsed.header?.supplierName ? ` (lu : ${doc.parsed.header.supplierName})` : ''}`}><select className="w-full" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">— choisir —</option>{suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="N° du bon / de la facture"><input className="w-full" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
            </div>
            {doc.parsed.header?.documentDate && <div className="text-xs text-ink-muted">Date du document : {dateFr(doc.parsed.header.documentDate)}{doc.parsed.header.totalAmount ? ` · total lu ${doc.parsed.header.totalAmount.toLocaleString('fr-FR')}` : ''}</div>}
            {lines && <LinesEditor lines={lines} setLines={setLines} />}
          </>
        )}
        <ErrorBox error={error} />
        {pending && (
          <div className="flex gap-2">
            {can('ocr.validate') ? <button className="btn" disabled={blocked} onClick={validate}>{doc.kind === 'expiry_label' ? 'Confirmer lot et date' : 'Valider et réceptionner'}</button> : <Badge tone="warn">Validation réservée au pharmacien</Badge>}
            {can('ocr.validate') && <button className="btn-alt" onClick={reject}>Rejeter</button>}
            {blocked && <span className="self-center text-sm font-semibold text-orange-700">En attente d’un second valideur</span>}
          </div>
        )}
        {!pending && <Badge tone={doc.status === 'validated' ? 'ok' : 'bad'}>{doc.status === 'validated' ? 'Validé' : 'Rejeté'}</Badge>}
      </div>
    </div>
  );
}

function ReviewList({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, error } = useLoad(() => api<OcrDoc[]>('/ocr/documents?status=pending_review'));
  const me = getSession()?.user.id;
  return (
    <>
      <ErrorBox error={error} />
      <div className="card overflow-auto"><table className="w-full">
        <thead><tr><th>Document</th><th>Numérisé</th><th>Fiabilité</th><th /></tr></thead>
        <tbody>{data?.map((d) => (
          <tr key={d.id}><td><b>{KIND_LABEL[d.kind]}</b><div className="text-xs text-ink-muted">{d.fileName}</div></td><td>{dateTimeFr(d.createdAt)}</td>
            <td><Badge tone={confTone(d.confidence)}>{Math.round(d.confidence * 100)} %</Badge> {d.needsSecondReviewer && d.createdById === me && <Badge tone="warn">2ᵉ valideur requis</Badge>}</td>
            <td><button className="btn" onClick={() => onOpen(d.id)}>Vérifier</button></td></tr>
        ))}</tbody>
      </table>{data?.length === 0 && <p className="p-3 text-sm text-ink-muted">Aucun document en attente.</p>}</div>
    </>
  );
}

interface FullProduct { id: string; name: string; sku: string; barcode?: string | null; dci?: string | null; salePrice: number; purchasePrice?: number; vatRate: number; trackLots: boolean }
interface QrLine { product: FullProduct; quantity: number; unitCost: number; salePrice: number; taxable: boolean; lotNumber: string; expiryDate: string }

const Key = ({ k }: { k: string }) => <kbd className="rounded border border-ink-line bg-white px-1 text-[10px] font-bold text-ink-muted">{k}</kbd>;

/**
 * Réception clavier-first (feuille de route PharmaCorp — Achats) : fournisseur/N° BL/date puis une boucle
 * recherche → Entrée → quantité → Entrée pour chaque ligne (coût déjà connu, pas ressaisi), un écran de
 * contrôle prix/marge avec rapprochement du total du bon, puis impression des étiquettes en un geste.
 */
function QuickReceive() {
  const { data: suppliers, reload } = useLoad(() => api<Supplier[]>('/suppliers'));
  const [step, setStep] = useState<'header' | 'lines' | 'control'>('header');
  const [supplierId, setSupplierId] = useState('');
  const [ref, setRef] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<QrLine[]>([]);
  const [blTotal, setBlTotal] = useState('');
  const [ignoreGap, setIgnoreGap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- étape produits : recherche clavier, puis quantité, puis (si suivi par lot) lot + péremption
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [results, setResults] = useState<FullProduct[]>([]);
  const [sel, setSel] = useState(0);
  const [draft, setDraft] = useState<FullProduct | null>(null);
  const [dQty, setDQty] = useState('1');
  const [dLot, setDLot] = useState('');
  const [dExp, setDExp] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const lotRef = useRef<HTMLInputElement>(null);
  const supplierRef = useRef<HTMLSelectElement>(null);
  const refRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSel(0);
    if (dq.trim().length < 2) { setResults([]); return; }
    api<FullProduct[]>(`/products?q=${encodeURIComponent(dq.trim())}&take=10`).then(setResults).catch(() => setResults([]));
  }, [dq]);

  function pick(p: FullProduct) {
    setDraft(p); setDQty('1'); setDLot(''); setDExp(''); setQ(''); setResults([]);
    setTimeout(() => { qtyRef.current?.focus(); qtyRef.current?.select(); }, 0);
  }
  function commitLine() {
    if (!draft) return;
    const quantity = Math.max(1, Number(dQty) || 1);
    if (draft.trackLots && !dLot.trim()) { lotRef.current?.focus(); return; }
    setLines((ls) => [...ls, { product: draft, quantity, unitCost: draft.purchasePrice ?? 0, salePrice: draft.salePrice, taxable: draft.vatRate > 0, lotNumber: dLot.trim().toUpperCase(), expiryDate: dExp }]);
    setDraft(null); setDQty('1'); setDLot(''); setDExp('');
    setTimeout(() => searchRef.current?.focus(), 0);
  }
  function removeLine(i: number) { setLines((ls) => ls.filter((_, k) => k !== i)); }
  const updLine = (i: number, patch: Partial<QrLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const total = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  const blNum = Number(blTotal.replace(/[^\d.-]/g, '')) || 0;
  const gap = blTotal.trim() ? total - blNum : 0;
  const reconciled = !blTotal.trim() || gap === 0 || ignoreGap;

  async function addSupplier() {
    const name = prompt('Nom du fournisseur'); if (!name) return;
    try { const s = await api<Supplier>('/suppliers', { method: 'POST', json: { name } }); reload(); setSupplierId(s.id); } catch (e) { setError((e as Error).message); }
  }

  async function validate() {
    if (!reconciled || !lines.length || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ number: string }>('/goods-receipts', {
        method: 'POST',
        json: { supplierId: supplierId || undefined, supplierRef: ref || undefined, updateCosts: true, depotId: receiveDepot(), lines: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitCost: l.unitCost, lotNumber: l.lotNumber || undefined, expiryDate: l.expiryDate || undefined })) },
      });
      // Prix de vente / taux de TVA ajustés au contrôle : mis à jour sur la fiche produit uniquement si changés.
      await Promise.all(lines.filter((l) => l.salePrice !== l.product.salePrice || (l.taxable ? l.product.vatRate <= 0 : l.product.vatRate > 0)).map((l) =>
        api(`/products/${l.product.id}`, { method: 'PUT', json: { salePrice: l.salePrice, vatRate: l.taxable ? Math.max(l.product.vatRate, 1) : 0 } }).catch(() => undefined),
      ));
      try { const b = await loadBranding(); printLabels(lines.map((l) => ({ name: l.product.name, dci: l.product.dci, price: l.salePrice, barcode: l.product.barcode || l.product.sku, expiry: l.expiryDate || undefined, qty: l.quantity, lot: l.lotNumber || undefined })), b); } catch { /* impression facultative */ }
      setOk(`Réception ${r.number} enregistrée, étiquettes envoyées à l’impression.`);
      setLines([]); setRef(''); setBlTotal(''); setIgnoreGap(false); setStep('header');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-ink-muted">
        <span><Key k="Entrée" /> valider / champ suivant</span><span><Key k="↑↓" /> choisir dans la liste</span><span><Key k="Échap" /> annuler la recherche</span>
      </div>

      {step === 'header' && (
        <div className="card space-y-3">
          <h3 className="font-extrabold">1. Fournisseur et bon de livraison</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <DepotPicker />
            <Field label="Fournisseur">
              <div className="flex gap-1">
                <select ref={supplierRef} autoFocus className="w-full" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); refRef.current?.focus(); } }}>
                  <option value="">— choisir —</option>{suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button className="btn-alt" onClick={addSupplier} title="Nouveau fournisseur">+</button>
              </div>
            </Field>
            <Field label="N° bon de livraison / facture"><input ref={refRef} className="w-full" value={ref} onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); dateRef.current?.focus(); } }} /></Field>
            <Field label="Date de réception"><input ref={dateRef} type="date" className="w-full" value={date} onChange={(e) => setDate(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setStep('lines'); setTimeout(() => searchRef.current?.focus(), 0); } }} /></Field>
          </div>
          <button className="btn" onClick={() => { setStep('lines'); setTimeout(() => searchRef.current?.focus(), 0); }}>Saisir les produits →</button>
        </div>
      )}

      {step === 'lines' && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold">2. Produits reçus</h3>
            <button className="btn-alt text-xs" onClick={() => setStep('header')}>← Fournisseur / bon</button>
          </div>
          <div className="relative">
            <input ref={searchRef} className="w-full text-lg" placeholder="🔎 Rechercher un produit…" value={draft ? draft.name : q}
              onChange={(e) => { if (!draft) setQ(e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); setQ(''); setResults([]); setDraft(null); }
                else if (results.length && e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
                else if (results.length && e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                else if (e.key === 'Enter' && results[sel] && !draft) { e.preventDefault(); pick(results[sel]); }
              }} />
            {results.length > 0 && !draft && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-ink-line bg-white shadow">
                {results.map((p, i) => <button key={p.id} className={`block w-full px-3 py-2 text-left text-sm ${i === sel ? 'bg-brand text-white' : i % 2 ? 'bg-slate-50' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => pick(p)}>{p.name} <span className="text-xs opacity-70">{p.sku}</span></button>)}
              </div>
            )}
          </div>
          {draft && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-brand-soft p-3">
              <Field label="Quantité"><input ref={qtyRef} type="number" min={1} className="w-24" value={dQty} onChange={(e) => setDQty(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (draft.trackLots) lotRef.current?.focus(); else commitLine(); } }} /></Field>
              {draft.trackLots && <>
                <Field label="N° de lot"><input ref={lotRef} className="w-32" value={dLot} onChange={(e) => setDLot(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('qr-exp')?.focus(); } }} /></Field>
                <Field label="Péremption"><input id="qr-exp" type="date" className="w-36" value={dExp} onChange={(e) => setDExp(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitLine(); } }} /></Field>
              </>}
              <button className="btn !py-2" onClick={commitLine}>Ajouter (Entrée)</button>
              <span className="text-xs text-ink-muted">Coût d’achat connu : {fcfa(draft.purchasePrice ?? 0)}/unité</span>
            </div>
          )}
          {lines.length > 0 && (
            <table className="w-full text-sm"><thead><tr><th className="text-left">Produit</th><th>Qté</th><th>Coût unit.</th><th>Lot</th><th /></tr></thead><tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-1">{l.product.name}</td>
                  <td className="py-1 text-center">{l.quantity}</td>
                  <td className="py-1 text-center">{fcfa(l.unitCost)}</td>
                  <td className="py-1 text-center text-xs text-ink-muted">{l.lotNumber || '—'}</td>
                  <td className="py-1 text-right"><button className="text-xs font-bold text-red-700" onClick={() => removeLine(i)}>✕</button></td>
                </tr>
              ))}
            </tbody></table>
          )}
          <button className="btn" disabled={!lines.length} onClick={() => setStep('control')}>Contrôle prix et marges →</button>
        </div>
      )}

      {step === 'control' && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold">3. Contrôle et rapprochement</h3>
            <button className="btn-alt text-xs" onClick={() => setStep('lines')}>← Produits</button>
          </div>
          <table className="w-full text-sm"><thead><tr><th className="text-left">Produit</th><th>Qté</th><th>Achat</th><th>Vente</th><th>Marge</th><th>Taxable</th></tr></thead><tbody>
            {lines.map((l, i) => {
              const margin = l.salePrice > 0 ? Math.round(((l.salePrice - l.unitCost) / l.salePrice) * 100) : 0;
              return (
                <tr key={i}>
                  <td className="py-1">{l.product.name}</td>
                  <td className="py-1 text-center">{l.quantity}</td>
                  <td className="py-1 text-center"><input type="number" min={0} className="w-24" value={l.unitCost} onChange={(e) => updLine(i, { unitCost: Number(e.target.value) || 0 })} /></td>
                  <td className="py-1 text-center"><input type="number" min={0} className="w-24" value={l.salePrice} onChange={(e) => updLine(i, { salePrice: Number(e.target.value) || 0 })} /></td>
                  <td className="py-1 text-center"><Badge tone={margin < 10 ? 'bad' : margin < 25 ? 'warn' : 'ok'}>{margin} %</Badge></td>
                  <td className="py-1 text-center"><input type="checkbox" checked={l.taxable} onChange={(e) => updLine(i, { taxable: e.target.checked })} /></td>
                </tr>
              );
            })}
          </tbody></table>
          <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
            <Field label="Total du bon de livraison (papier)"><input className="w-40" placeholder={fcfa(total)} value={blTotal} onChange={(e) => { setBlTotal(e.target.value); setIgnoreGap(false); }} /></Field>
            <div className="text-sm"><b>Total saisi :</b> {fcfa(total)}</div>
            {blTotal.trim() && gap !== 0 && (
              <div className="flex items-center gap-2 text-sm font-bold text-red-700">
                Écart : {fcfa(Math.abs(gap))} {gap > 0 ? '(saisi en trop)' : '(manque)'}
                <label className="flex items-center gap-1 text-xs font-normal text-ink-muted"><input type="checkbox" checked={ignoreGap} onChange={(e) => setIgnoreGap(e.target.checked)} /> Ignorer l’écart</label>
              </div>
            )}
            {blTotal.trim() && gap === 0 && <Badge tone="ok">Totaux alignés</Badge>}
          </div>
          <ErrorBox error={error} />
          {ok && <div className="rounded-lg bg-brand-soft px-3 py-2 text-sm font-bold text-brand">{ok}</div>}
          <button className="btn" disabled={!reconciled || busy} onClick={validate}>{busy ? 'Validation…' : 'Valider la réception et imprimer les étiquettes'}</button>
        </div>
      )}
    </div>
  );
}

function History() {
  const { data, error } = useLoad(() => api<{ id: string; number: string; supplierRef?: string; createdAt: string; supplier?: { name: string }; ocrDocumentId?: string | null; _count: { items: number } }[]>('/goods-receipts'));
  return (
    <>
      <ErrorBox error={error} />
      <div className="card overflow-auto"><table className="w-full">
        <thead><tr><th>N°</th><th>Date</th><th>Fournisseur</th><th>Bon</th><th>Lignes</th><th>Origine</th></tr></thead>
        <tbody>{data?.map((r) => <tr key={r.id}><td><b>{r.number}</b></td><td>{dateTimeFr(r.createdAt)}</td><td>{r.supplier?.name ?? '—'}</td><td>{r.supplierRef ?? '—'}</td><td>{r._count.items}</td><td>{r.ocrDocumentId ? <Badge tone="info">OCR</Badge> : <Badge tone="muted">saisie</Badge>}</td></tr>)}</tbody>
      </table></div>
    </>
  );
}
/** Depot de reception, memorise sur ce poste (comptoir par defaut, ou une reserve). */
const receiveDepot = () => { try { return localStorage.getItem('erp.receiveDepot') || 'main'; } catch { return 'main'; } };
function DepotPicker() {
  const { data } = useLoad(() => api<{ id: string; name: string; isActive: boolean }[]>('/stock/depots'));
  const [v, setV] = useState(receiveDepot());
  if (!data || data.length < 2) return null;
  return <Field label="Réceptionner dans"><select className="w-full font-semibold" value={v} onChange={(e) => { setV(e.target.value); try { localStorage.setItem('erp.receiveDepot', e.target.value); } catch { /* stockage indisponible */ } }}>{data.filter((d) => d.isActive).map((d) => <option key={d.id} value={d.id}>{d.id === 'main' ? '🛒' : '📦'} {d.name}</option>)}</select></Field>;
}
