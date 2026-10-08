import { useState } from 'react';
import { api, can, getSession } from '../lib/api';
import { printDestructionPV } from '../lib/printDocs';
import { dateFr } from '../lib/format';
import { Badge, ErrorBox, Field, Modal, PageTitle, useDebounced, useLoad } from '../components/ui';

interface Level { productId: string; sku: string; name: string; minStock: number; onHand: number; sellable: number; expired: number; held: number; belowMin: boolean }
interface Lot { id: string; lotNumber: string; expiryDate: string | null; status: string; quantity: number; daysToExpiry: number | null; byDepot?: Record<string, number> }
interface Depot { id: string; name: string; kind: string; note?: string | null; isActive: boolean; units: number; value: number }
interface Expiring { lotId: string; productId: string; name: string; lotNumber: string; expiryDate: string; quantity: number; status: string; expired: boolean }
interface Pending { id: string; lotNumber: string; expiryDate: string | null; product: { name: string; sku: string }; createdAt: string }

export default function Stock() {
  const [tab, setTab] = useState<'levels' | 'value' | 'depots' | 'expiry' | 'pending'>('levels');
  return (
    <>
      <PageTitle title="Stock" sub="Niveaux, lots, péremptions — sorties en FEFO (le lot qui expire en premier)" />
      <div className="mb-3 flex gap-2">
        {([['levels', 'Niveaux'], ['value', 'Valeur du stock'], ['depots', 'Dépôts et réserves'], ['expiry', 'Périmé et avarié'], ['pending', 'Lots à valider']] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? 'btn' : 'btn-alt'} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'levels' && <Levels />}
      {tab === 'value' && <Valuation />}
      {tab === 'depots' && <Depots />}
      {tab === 'expiry' && <Expiry />}
      {tab === 'pending' && <PendingLots />}
    </>
  );
}

interface VRow { name: string; units: number; purchaseValue: number | null; saleValue: number }
interface Val { canSeeCost: boolean; scopeNote: string | null; total: { units: number; products: number; purchaseValue: number | null; saleValue: number; potentialMargin: number | null }; byCategory: VRow[]; byDepot: VRow[]; byLocation: VRow[]; byVat: VRow[]; byLaboratory: VRow[]; byStorage: VRow[]; expiry: { expiredUnits: number; expiredValue: number | null; soonUnits: number; soonValue: number | null } }
const F = (n: number | null) => (n === null ? '—' : `${Math.round(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} FCFA`);

/** Valeur du stock et ventilations ; chacun ne voit que ce que l'administrateur l'autorise à voir. */
function Valuation() {
  const { data, error, reload } = useLoad(() => api<Val>('/stock/valuation'));
  const [mode, setMode] = useState<'purchase' | 'sale'>('purchase');
  if (!data) return <ErrorBox error={error} />;
  const useSale = mode === 'sale' || !data.canSeeCost;
  const val = (r: VRow) => (useSale ? r.saleValue : r.purchaseValue ?? 0);
  const Block = ({ title, rows, hint }: { title: string; rows: VRow[]; hint?: string }) => {
    const max = Math.max(1, ...rows.map(val)), tot = rows.reduce((s, r) => s + val(r), 0) || 1;
    return (
      <div className="card"><h3 className="mb-1 font-extrabold">{title}</h3>{hint && <p className="mb-2 text-xs text-ink-muted">{hint}</p>}
        <div className="max-h-96 space-y-1 overflow-auto pr-1">
          {rows.map((r) => (
            <div key={r.name} className="text-sm"><div className="flex justify-between gap-2"><span className="truncate">{r.name}</span><span className="whitespace-nowrap font-bold">{F(val(r))} <span className="text-xs font-normal text-ink-muted">· {Math.round((val(r) / tot) * 100)} % · {r.units.toLocaleString('fr-FR')} u.</span></span></div>
              <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand" style={{ width: `${(val(r) / max) * 100}%` }} /></div></div>
          ))}
          {!rows.length && <p className="text-sm text-ink-muted">Aucune donnée.</p>}
        </div>
      </div>
    );
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {data.canSeeCost && <>{([['purchase', 'Valeur d’achat'], ['sale', 'Valeur de vente']] as const).map(([k, l]) => <button key={k} className={mode === k ? 'btn' : 'btn-alt'} onClick={() => setMode(k)}>{l}</button>)}</>}
        <button className="btn-alt" onClick={reload}>↻ Actualiser</button>
        {data.scopeNote && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">{data.scopeNote}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {([['Valeur d’achat', F(data.total.purchaseValue)], ['Valeur de vente', F(data.total.saleValue)], ['Marge potentielle', F(data.total.potentialMargin)], ['Unités en stock', data.total.units.toLocaleString('fr-FR')], ['Périmé (valeur d’achat)', F(data.expiry.expiredValue)]] as const).map(([l, v]) => <div key={l} className="card !p-3"><div className="text-xs text-ink-muted">{l}</div><div className="text-lg font-extrabold">{v}</div></div>)}
      </div>
      {(data.expiry.soonUnits > 0 || data.expiry.expiredUnits > 0) && <div className="rounded-lg bg-orange-50 p-2 text-sm text-orange-900">⏳ {data.expiry.expiredUnits} unité(s) périmée(s){data.expiry.expiredValue !== null ? ` (${F(data.expiry.expiredValue)})` : ''} · {data.expiry.soonUnits} unité(s) à péremption sous 90 jours{data.expiry.soonValue !== null ? ` (${F(data.expiry.soonValue)})` : ''}.</div>}
      <div className="grid gap-3 lg:grid-cols-2">
        <Block title="Par endroit : comptoir et réserves" rows={data.byDepot} hint="Comptoir / rayons = dépôt de vente ; les autres lignes sont vos réserves." />
        <Block title="Par rayon (emplacement)" rows={data.byLocation} hint="Emplacement saisi sur la fiche produit." />
        <Block title="Par famille / catégorie" rows={data.byCategory} />
        <Block title="Par taux de TVA" rows={data.byVat} />
        <Block title="Par laboratoire (15 premiers)" rows={data.byLaboratory} />
        <Block title="Par mode de conservation" rows={data.byStorage} />
      </div>
    </div>
  );
}

function Levels() {
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [depot, setDepot] = useState('all');
  const dq = useDebounced(q);
  const { data: depots } = useLoad(() => api<Depot[]>('/stock/depots'));
  const [sort, setSort] = useState('name_asc');
  const { data, error, reload } = useLoad(() => api<Level[]>(`/stock/levels?q=${encodeURIComponent(dq)}&lowOnly=${low}&take=100&depot=${depot}&sort=${sort}`), [dq, low, depot, sort]);
  /** Clic sur un titre : tri par ce critère ; second clic = sens inverse (stock et périmé : le plus grand d'abord). */
  const Th = ({ k, label, first }: { k: string; label: string; first: 'asc' | 'desc' }) => {
    const on = sort.startsWith(`${k}_`), dir = on ? sort.slice(k.length + 1) : null;
    return <th className="cursor-pointer select-none whitespace-nowrap hover:text-brand" title="Cliquer pour trier" onClick={() => setSort(`${k}_${on ? (dir === 'asc' ? 'desc' : 'asc') : first}`)}>{label} <span className={on ? 'text-brand' : 'text-slate-300'}>{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}</span></th>;
  };
  const [open, setOpen] = useState<Level | null>(null);
  return (
    <>
      <div className="card mb-3 flex flex-wrap items-center gap-3">
        <input className="min-w-[220px] flex-1" placeholder="🔎 Produit…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={depot} onChange={(e) => setDepot(e.target.value)} className="font-semibold"><option value="all">🏬 Tous les dépôts</option>{depots?.map((d) => <option key={d.id} value={d.id}>{d.id === 'main' ? '🛒' : '📦'} {d.name}</option>)}</select>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Sous le seuil seulement</label>
      </div>
      <ErrorBox error={error} />
      <div className="card overflow-auto">
        <table className="w-full">
          <thead><tr>{Th({ k: 'name', label: 'Produit', first: 'asc' })}{Th({ k: 'stock', label: 'En stock', first: 'desc' })}<th>Vendable</th>{Th({ k: 'expired', label: 'Périmé', first: 'desc' })}<th>En attente</th><th>Seuil</th><th /></tr></thead>
          <tbody>
            {data?.map((r) => (
              <tr key={r.productId}>
                <td><b>{r.name}</b><div className="text-xs text-ink-muted">{r.sku}</div></td>
                <td>{r.onHand}</td>
                <td className={r.belowMin ? 'font-extrabold text-brand-orange' : ''}>{r.sellable} {r.belowMin && <Badge tone="warn">sous le seuil</Badge>}</td>
                <td>{r.expired > 0 ? <Badge tone="bad">{r.expired}</Badge> : 0}</td>
                <td>{r.held > 0 ? <Badge tone="warn">{r.held}</Badge> : 0}</td>
                <td>{r.minStock}</td>
                <td><button className="btn-alt" onClick={() => setOpen(r)}>Lots</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <LotsModal level={open} onClose={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function LotsModal({ level, onClose }: { level: Level; onClose: () => void }) {
  const { data, error, reload } = useLoad(() => api<Lot[]>(`/stock/products/${level.productId}/lots`));
  const [adj, setAdj] = useState<{ lot: Lot } | null>(null);
  const { data: product } = useLoad(() => api<{ unitsPerBox?: number | null; unitSalePrice?: number | null; unitProductId?: string | null }>(`/products/${level.productId}`));
  const [unpack, setUnpack] = useState<Lot | null>(null);
  const [move, setMove] = useState<Lot | null>(null);
  const { data: depots } = useLoad(() => api<Depot[]>('/stock/depots'));
  const dname = (id: string) => depots?.find((d) => d.id === id)?.name ?? (id === 'main' ? 'Comptoir' : 'dépôt');
  return (
    <Modal title={level.name} onClose={onClose} wide>
      <ErrorBox error={error} />
      {(product?.unitsPerBox ?? 0) > 1 && <p className="mb-2 text-xs text-ink-muted">Déconditionnement possible : {product?.unitsPerBox} unités par boîte. Les unités sont vendues sous « {level.name} (à l’unité) », même lot et même péremption.</p>}
      <table className="w-full">
        <thead><tr><th>Lot</th><th>Péremption</th><th>Quantité</th><th>Statut</th><th /></tr></thead>
        <tbody>
          {data?.map((l) => (
            <tr key={l.id}>
              <td><b>{l.lotNumber}</b></td>
              <td>{dateFr(l.expiryDate)} {l.daysToExpiry !== null && <Badge tone={l.daysToExpiry < 0 ? 'bad' : l.daysToExpiry < 90 ? 'warn' : 'muted'}>{l.daysToExpiry < 0 ? 'périmé' : `${l.daysToExpiry} j`}</Badge>}</td>
              <td><b>{l.quantity}</b>{l.byDepot && Object.keys(l.byDepot).length > 0 && <div className="text-xs text-ink-muted">{Object.entries(l.byDepot).map(([d, q]) => `${dname(d)} ${q}`).join(' · ')}</div>}</td>
              <td>{l.status === 'available' ? <Badge>disponible</Badge> : <Badge tone="warn">{l.status === 'pending_review' ? 'à valider' : 'bloqué'}</Badge>}</td>
              <td className="space-x-1 whitespace-nowrap">{can('stock.write') && l.quantity > 0 && <button className="btn-alt" onClick={() => setAdj({ lot: l })}>Perte / ajustement</button>}
                {can('stock.write') && l.quantity > 0 && (depots?.length ?? 0) > 1 && <button className="btn-alt" onClick={() => setMove(l)}>⇄ Transférer</button>}
                {can('stock.write') && l.quantity > 0 && (product?.unitsPerBox ?? 0) > 1 && <button className="btn-alt" onClick={() => setUnpack(l)}>✂️ Déconditionner</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.length === 0 && <p className="text-sm text-ink-muted">Aucun lot en stock.</p>}
      {adj && <Adjust productId={level.productId} lot={adj.lot} onClose={() => setAdj(null)} onSaved={() => { setAdj(null); reload(); }} />}
      {move && depots && <Transfer productId={level.productId} lot={move} depots={depots} onClose={() => setMove(null)} onSaved={() => { setMove(null); reload(); }} />}
      {unpack && <Unpack productId={level.productId} lot={unpack} unitsPerBox={product?.unitsPerBox ?? 1} onClose={() => setUnpack(null)} onSaved={() => { setUnpack(null); reload(); }} />}
    </Modal>
  );
}

function Adjust({ productId, lot, onClose, onSaved }: { productId: string; lot: Lot; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState('loss');
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try { await api('/stock/adjustments', { method: 'POST', json: { productId, lotId: lot.id, type, quantity: type === 'adjustment' ? qty : -Math.abs(qty), reason } }); onSaved(); } catch (e) { setError((e as Error).message); }
  }
  return (
    <Modal title={`Ajustement du lot ${lot.lotNumber}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Type"><select className="w-full" value={type} onChange={(e) => setType(e.target.value)}><option value="loss">Perte / casse</option><option value="expiry_writeoff">Mise au rebut (péremption)</option><option value="adjustment">Correction d’inventaire (+ ou −)</option></select></Field>
        <Field label={type === 'adjustment' ? 'Quantité (négative pour retirer)' : 'Quantité retirée'}><input type="number" className="w-full" value={qty} onChange={(e) => setQty(Number(e.target.value) || 0)} /></Field>
        <Field label="Motif (obligatoire, journalisé)"><input className="w-full" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <ErrorBox error={error} />
        <button className="btn" disabled={!reason.trim() || !qty} onClick={save}>Enregistrer</button>
      </div>
    </Modal>
  );
}

/** Transfert d'un lot entre depots (reserve -> comptoir, etc.). */
function Transfer({ productId, lot, depots, onClose, onSaved }: { productId: string; lot: Lot; depots: Depot[]; onClose: () => void; onSaved: () => void }) {
  const first = Object.entries(lot.byDepot ?? {}).find(([, q]) => q > 0)?.[0] ?? 'main';
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(depots.find((d) => d.id !== first)?.id ?? 'main');
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const avail = lot.byDepot?.[from] ?? 0;
  return (
    <Modal title={`Transférer le lot ${lot.lotNumber}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <Field label="De"><select className="w-full" value={from} onChange={(e) => setFrom(e.target.value)}>{depots.map((d) => <option key={d.id} value={d.id}>{d.name} ({lot.byDepot?.[d.id] ?? 0})</option>)}</select></Field>
          <span className="pb-2 text-2xl">➜</span>
          <Field label="Vers"><select className="w-full" value={to} onChange={(e) => setTo(e.target.value)}>{depots.filter((d) => d.id !== from).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        </div>
        <Field label={`Quantité (disponible : ${avail})`}><input type="number" min={1} max={avail} className="w-full text-xl font-bold" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} /></Field>
        <ErrorBox error={error} />
        <button className="btn w-full" disabled={qty > avail || from === to} onClick={async () => { try { await api('/stock/transfers', { method: 'POST', json: { productId, lotId: lot.id, from, to, quantity: qty } }); onSaved(); } catch (e) { setError((e as Error).message); } }}>⇄ Transférer</button>
      </div>
    </Modal>
  );
}

/** Depots et reserves : creation, renommage, valeur en stock. */
function Depots() {
  const { data, error, reload } = useLoad(() => api<Depot[]>('/stock/depots'));
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const COLORS = ['from-emerald-500 to-emerald-700', 'from-sky-500 to-sky-700', 'from-violet-500 to-violet-700', 'from-amber-500 to-amber-700', 'from-rose-500 to-rose-700', 'from-teal-500 to-teal-700'];
  return (
    <>
      <ErrorBox error={error ?? err} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((d, i) => (
          <div key={d.id} className={`rounded-2xl bg-gradient-to-br p-4 text-white shadow ${COLORS[i % COLORS.length]} ${d.isActive ? '' : 'opacity-50'}`}>
            <div className="text-xs uppercase opacity-80">{d.id === 'main' ? 'Dépôt de vente' : 'Réserve'}</div>
            <div className="text-xl font-extrabold">{d.id === 'main' ? '🛒' : '📦'} {d.name}</div>
            <div className="mt-2 text-sm">{d.units} unité(s)</div>
            {d.value !== undefined && <div className="text-lg font-bold">{d.value.toLocaleString('fr-FR')} FCFA</div>}
            {d.id !== 'main' && can('stock.write') && <div className="mt-2 flex gap-2 text-xs"><button className="rounded bg-white/25 px-2 py-1" onClick={async () => { const n = prompt('Nouveau nom', d.name); if (n) { try { await api(`/stock/depots/${d.id}`, { method: 'PUT', json: { name: n } }); reload(); } catch (e) { setErr((e as Error).message); } } }}>Renommer</button><button className="rounded bg-white/25 px-2 py-1" onClick={async () => { try { await api(`/stock/depots/${d.id}`, { method: 'PUT', json: { name: d.name, isActive: !d.isActive } }); reload(); } catch (e) { setErr((e as Error).message); } }}>{d.isActive ? 'Désactiver' : 'Réactiver'}</button></div>}
          </div>
        ))}
      </div>
      {can('stock.write') && <div className="card mt-3 flex flex-wrap gap-2"><input className="flex-1" placeholder="Nouvelle réserve (ex. Réserve parapharmacie, Réserve 2…)" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn" disabled={name.trim().length < 2} onClick={async () => { try { await api('/stock/depots', { method: 'POST', json: { name } }); setName(''); reload(); } catch (e) { setErr((e as Error).message); } }}>+ Créer la réserve</button></div>}
      <p className="mt-2 text-xs text-ink-muted">La caisse vend uniquement depuis « Comptoir / rayons ». Réceptionnez dans une réserve puis transférez vers le comptoir (bouton ⇄ dans les lots d’un produit).</p>
    </>
  );
}

/** Lotage / delotage : boites -> unites (ou reconstitution de boites completes). */
function Unpack({ productId, lot, unitsPerBox, onClose, onSaved }: { productId: string; lot: Lot; unitsPerBox: number; onClose: () => void; onSaved: () => void }) {
  const [boxes, setBoxes] = useState(1);
  const [reverse, setReverse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try { await api(`/products/${productId}/unpack`, { method: 'POST', json: { lotId: lot.id, boxes: reverse ? -boxes : boxes } }); onSaved(); } catch (e) { setError((e as Error).message); }
  }
  return (
    <Modal title={`Lot ${lot.lotNumber} — lotage / délotage`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2"><button className={reverse ? 'btn-alt' : 'btn'} onClick={() => setReverse(false)}>✂️ Ouvrir des boîtes</button><button className={reverse ? 'btn' : 'btn-alt'} onClick={() => setReverse(true)}>📦 Reconstituer des boîtes</button></div>
        <Field label="Nombre de boîtes"><input type="number" min={1} className="w-full" value={boxes} onChange={(e) => setBoxes(Math.max(1, Number(e.target.value) || 1))} /></Field>
        <p className="rounded-lg bg-brand-soft p-2 text-sm">{reverse ? `${boxes * unitsPerBox} unités redeviennent ${boxes} boîte(s).` : `${boxes} boîte(s) → ${boxes * unitsPerBox} unités vendables au détail.`}</p>
        <ErrorBox error={error} />
        <button className="btn" onClick={save}>Valider</button>
      </div>
    </Modal>
  );
}

/** Un lot mis de côté pour sortir du stock, avec son motif propre (périmé déduit de la liste, avarié/cassé ajouté à la main). */
interface OutItem { lotId: string; productId: string; name: string; lotNumber: string; expiryDate: string | null; quantity: number; maxQuantity: number; cause: 'perime' | 'avarie' | 'casse' | 'autre' }
const CAUSES: [OutItem['cause'], string][] = [['perime', 'Périmé'], ['avarie', 'Avarié'], ['casse', 'Cassé'], ['autre', 'Autre']];

function Expiry() {
  const [days, setDays] = useState(90);
  const { data, error, reload } = useLoad(() => api<Expiring[]>(`/stock/expiring?days=${days}`), [days]);
  const { data: pvs, reload: reloadPv } = useLoad(() => api<any[]>('/stock/destructions'), []);
  const [sel, setSel] = useState<Map<string, OutItem>>(new Map());
  const [modal, setModal] = useState(false);
  const [pick, setPick] = useState(false);
  const [sort, setSort] = useState<{ k: 'name' | 'expiryDate' | 'quantity'; dir: 1 | -1 }>({ k: 'expiryDate', dir: 1 });
  const expired = (data ?? []).filter((l) => l.expired);
  const sorted = [...(data ?? [])].sort((a, b) => {
    const x = a[sort.k] ?? '', y = b[sort.k] ?? '';
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true })) * sort.dir;
  });
  const Th = (k: typeof sort.k, label: string) => <th className="cursor-pointer select-none whitespace-nowrap hover:text-brand" title="Cliquer pour trier" onClick={() => setSort({ k, dir: sort.k === k ? (sort.dir === 1 ? -1 : 1) : 1 })}>{label} <span className={sort.k === k ? 'text-brand' : 'text-slate-300'}>{sort.k === k ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span></th>;
  const toggle = (l: Expiring) => setSel((s) => {
    const n = new Map(s);
    if (n.has(l.lotId)) n.delete(l.lotId);
    else n.set(l.lotId, { lotId: l.lotId, productId: l.productId, name: l.name, lotNumber: l.lotNumber, expiryDate: l.expiryDate, quantity: l.quantity, maxQuantity: l.quantity, cause: 'perime' });
    return n;
  });
  const addPicked = (it: OutItem) => setSel((s) => { const n = new Map(s); n.set(it.lotId, it); return n; });
  const removeSel = (lotId: string) => setSel((s) => { const n = new Map(s); n.delete(lotId); return n; });
  return (
    <>
      <div className="card mb-3 flex flex-wrap items-center gap-2"><span className="text-sm font-bold">Horizon :</span>{[30, 60, 90, 180].map((d) => <button key={d} className={days === d ? 'btn' : 'btn-alt'} onClick={() => setDays(d)}>{d} jours</button>)}
        {can('stock.write') && expired.length > 0 && <button className="btn-alt" onClick={() => setSel((s) => { const n = new Map(s); for (const l of expired) if (!n.has(l.lotId)) n.set(l.lotId, { lotId: l.lotId, productId: l.productId, name: l.name, lotNumber: l.lotNumber, expiryDate: l.expiryDate, quantity: l.quantity, maxQuantity: l.quantity, cause: 'perime' }); return n; })}>Tout sélectionner (périmés)</button>}
        {can('stock.write') && <button className="btn-alt ml-auto" onClick={() => setPick(true)}>➕ Signaler un produit avarié / cassé</button>}
        {can('stock.write') && <button className="btn bg-red-700 hover:bg-red-800" disabled={!sel.size} onClick={() => setModal(true)}>🗑 Sortir du stock et établir le procès-verbal ({sel.size})</button>}
      </div>
      {sel.size > 0 && (
        <div className="card mb-3">
          <h3 className="mb-1 text-sm font-extrabold">Sélection à sortir du stock ({sel.size})</h3>
          <div className="max-h-32 space-y-1 overflow-auto text-xs">{[...sel.values()].map((it) => <div key={it.lotId} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1"><span>{it.quantity} × {it.name} — lot {it.lotNumber} <Badge tone={it.cause === 'perime' ? 'bad' : 'warn'}>{CAUSES.find((c) => c[0] === it.cause)?.[1]}</Badge></span><button className="text-red-700" onClick={() => removeSel(it.lotId)}>✕</button></div>)}</div>
        </div>
      )}
      <ErrorBox error={error} />
      <div className="card overflow-auto">
        <table className="w-full">
          <thead><tr><th />{Th('name', 'Produit')}<th>Lot</th>{Th('expiryDate', 'Péremption')}{Th('quantity', 'Quantité')}<th>État</th></tr></thead>
          <tbody>
            {sorted.map((l) => (
              <tr key={l.lotId} className={l.expired ? 'bg-red-50' : ''}>
                <td>{can('stock.write') && <input type="checkbox" checked={sel.has(l.lotId)} onChange={() => toggle(l)} />}</td>
                <td><b>{l.name}</b></td><td>{l.lotNumber}</td><td>{dateFr(l.expiryDate)}</td><td>{l.quantity}</td>
                <td>{l.expired ? <Badge tone="bad">PÉRIMÉ — à retirer et à détruire</Badge> : <Badge tone="warn">à écouler</Badge>} {l.status !== 'available' && <Badge tone="muted">{l.status === 'pending_review' ? 'à valider' : 'bloqué'}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && <p className="p-3 text-sm text-ink-muted">Aucun lot concerné. 🎉</p>}
      </div>
      <div className="card mt-4 overflow-auto"><h3 className="mb-2 font-extrabold">Procès-verbaux de destruction</h3>
        <table className="w-full text-sm"><thead><tr><th>N°</th><th>Date</th><th>Pharmacien</th><th>Lots</th><th className="text-right">Valeur</th><th /></tr></thead>
          <tbody>{(pvs ?? []).map((p) => <tr key={p.id}><td><b>{p.number}</b></td><td>{dateFr(p.createdAt)}</td><td>{p.pharmacistName ?? '—'}</td><td>{(p.items as unknown[]).length}</td><td className="text-right">{Math.round(p.totalValue).toLocaleString('fr-FR')} FCFA</td><td className="text-right"><button className="btn-alt !py-0.5 text-xs" onClick={() => printDestructionPV(p)}>🖨 Réimprimer (3 ex.)</button></td></tr>)}</tbody></table>
        {pvs?.length === 0 && <p className="p-2 text-sm text-ink-muted">Aucune destruction enregistrée. Les produits sortis du stock (péremption, avarie, casse) apparaissent ici avec leur procès-verbal.</p>}
      </div>
      {modal && <DestroyModal items={[...sel.values()]} onClose={() => setModal(false)} onDone={() => { setModal(false); setSel(new Map()); reload(); reloadPv(); }} />}
      {pick && <PickDamaged onClose={() => setPick(false)} onPicked={(it) => { addPicked(it); setPick(false); }} />}
    </>
  );
}

/** Choix libre d'un produit + lot à sortir du stock pour avarie, casse ou autre motif (hors péremption). */
function PickDamaged({ onClose, onPicked }: { onClose: () => void; onPicked: (it: OutItem) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data: results } = useLoad(() => (dq.trim().length < 2 ? Promise.resolve([]) : api<{ id: string; name: string; sku: string }[]>(`/products?q=${encodeURIComponent(dq)}&take=15`)), [dq]);
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const { data: lots } = useLoad(() => (product ? api<Lot[]>(`/stock/products/${product.id}/lots`) : Promise.resolve(null)), [product?.id]);
  const [lot, setLot] = useState<Lot | null>(null);
  const [qty, setQty] = useState(1);
  const [cause, setCause] = useState<OutItem['cause']>('avarie');
  return (
    <Modal title="Signaler un produit avarié ou cassé" onClose={onClose}>
      <div className="space-y-3">
        {!product ? (
          <>
            <input className="w-full" autoFocus placeholder="🔎 Chercher un produit…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-56 space-y-1 overflow-auto">{results?.map((p) => <button key={p.id} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-soft" onClick={() => setProduct(p)}><b>{p.name}</b> <span className="text-xs text-ink-muted">{p.sku}</span></button>)}</div>
          </>
        ) : !lot ? (
          <>
            <p className="text-sm"><b>{product.name}</b> — choisissez le lot concerné : <button className="text-xs text-brand underline" onClick={() => setProduct(null)}>changer de produit</button></p>
            <div className="max-h-56 space-y-1 overflow-auto">{lots?.filter((l) => l.quantity > 0).map((l) => <button key={l.id} className="block w-full rounded-lg bg-slate-50 px-3 py-2 text-left text-sm hover:bg-brand-soft" onClick={() => { setLot(l); setQty(l.quantity); }}>Lot {l.lotNumber} — {l.quantity} en stock{l.expiryDate ? ` (péremption ${dateFr(l.expiryDate)})` : ''}</button>)}</div>
            {lots?.filter((l) => l.quantity > 0).length === 0 && <p className="text-sm text-ink-muted">Aucun lot avec du stock pour ce produit.</p>}
          </>
        ) : (
          <>
            <p className="text-sm"><b>{product.name}</b> — lot {lot.lotNumber} ({lot.quantity} en stock)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantité à sortir"><input type="number" min={1} max={lot.quantity} className="w-full" value={qty} onChange={(e) => setQty(Math.max(1, Math.min(lot.quantity, Number(e.target.value) || 1)))} /></Field>
              <Field label="Motif"><select className="w-full" value={cause} onChange={(e) => setCause(e.target.value as OutItem['cause'])}>{CAUSES.filter((c) => c[0] !== 'perime').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            </div>
            <button className="btn" onClick={() => onPicked({ lotId: lot.id, productId: product.id, name: product.name, lotNumber: lot.lotNumber, expiryDate: lot.expiryDate, quantity: qty, maxQuantity: lot.quantity, cause })}>Ajouter à la sélection</button>
          </>
        )}
      </div>
    </Modal>
  );
}

function DestroyModal({ items, onClose, onDone }: { items: OutItem[]; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('Incinération / enfouissement');
  const [witness, setWitness] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sig = getSession()?.user;
  async function go() {
    setBusy(true); setErr(null);
    try { const pv = await api<any>('/stock/destructions', { method: 'POST', json: { lots: items.map((l) => ({ lotId: l.lotId, quantity: l.quantity, cause: l.cause })), method, witness, note } }); await printDestructionPV(pv); onDone(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <Modal title="Sortie de stock — procès-verbal" onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-sm">{items.length} lot(s) seront sortis du stock et un <b>procès-verbal</b> numéroté sera établi, signé de <b>{sig?.fullName}</b>, à imprimer en <b>3 exemplaires</b> : ministère de la Santé, comptabilité, archive interne (pharmacie).</p>
        <div className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{items.map((l) => <div key={l.lotId}>{l.quantity} × {l.name} — lot {l.lotNumber} · {CAUSES.find((c) => c[0] === l.cause)?.[1]}{l.expiryDate ? ` (${dateFr(l.expiryDate)})` : ''}</div>)}</div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Mode de destruction"><input className="w-full" value={method} onChange={(e) => setMethod(e.target.value)} /></Field>
          <Field label="Témoin / autorité présente (facultatif)"><input className="w-full" value={witness} onChange={(e) => setWitness(e.target.value)} /></Field>
        </div>
        <Field label="Observations (facultatif)"><input className="w-full" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <p className="text-xs text-ink-muted">Pour que la signature apparaisse sur le procès-verbal, le pharmacien l’enregistre une fois : Équipe et accès → « Ma signature ».</p>
        <ErrorBox error={err} />
        <button className="btn bg-red-700 hover:bg-red-800" disabled={busy} onClick={go}>{busy ? 'Enregistrement…' : 'Sortir du stock et imprimer le procès-verbal'}</button>
      </div>
    </Modal>
  );
}

function PendingLots() {
  const { data, error, reload } = useLoad(() => api<Pending[]>('/stock/pending-lots'));
  const [msg, setMsg] = useState<string | null>(null);
  async function review(id: string, action: 'validate' | 'block') {
    setMsg(null);
    try { await api(`/stock/lots/${id}/review`, { method: 'POST', json: { action } }); reload(); } catch (e) { setMsg((e as Error).message); }
  }
  return (
    <>
      <p className="mb-2 text-sm text-ink-muted">Ces lots (lecture OCR peu fiable) ne sont pas vendables tant qu’un second professionnel — jamais celui qui les a saisis — ne les a pas validés.</p>
      <ErrorBox error={error ?? msg} />
      <div className="card overflow-auto">
        <table className="w-full">
          <thead><tr><th>Produit</th><th>Lot</th><th>Péremption lue</th><th /></tr></thead>
          <tbody>
            {data?.map((l) => (
              <tr key={l.id}><td><b>{l.product.name}</b></td><td>{l.lotNumber}</td><td>{dateFr(l.expiryDate)}</td>
                <td className="space-x-1"><button className="btn" onClick={() => review(l.id, 'validate')}>Valider</button><button className="btn-alt" onClick={() => review(l.id, 'block')}>Bloquer</button></td></tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && <p className="p-3 text-sm text-ink-muted">Aucun lot en attente.</p>}
      </div>
    </>
  );
}