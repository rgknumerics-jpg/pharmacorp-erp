import { useEffect, useMemo, useState } from 'react';
import StatsOverview from './StatsOverview';
import CashClosings from './CashClosings';
import { api, can } from '../lib/api';
import { dateFr, dateTimeFr, fcfa, PAY_LABEL, SALE_STATUS } from '../lib/format';
import { Badge, ErrorBox, Modal, PageTitle, useDebounced, useLoad } from '../components/ui';

interface SaleRow { id: string; number: string; kind: string; status: string; total: number; createdAt: string; content: string; itemCount: number; cashierName?: string | null; sellerName?: string | null; customer?: { name: string } | null; payments: { method: string; status: string; amount: number }[] }
interface SaleFull extends SaleRow { paidAmount: number; voidReason?: string | null; items: { id: string; quantity: number; unitPrice: number; lineTotal: number; product: { name: string }; lot?: { lotNumber: string } | null }[]; payments: { id: string; method: string; amount: number; status: string; reference?: string | null }[] }
interface Col { key: string; label: string; type: 'text' | 'int' | 'money' | 'pct' | 'date' }
interface Report { columns: Col[]; rows: Record<string, any>[]; totals?: Record<string, number>; note?: string }
interface StatDef { key: string; label: string; group: string; cost?: boolean; needs?: 'customer' | 'min'; help: string; orderable?: boolean; toOrder?: boolean }

const KIND: Record<string, [string, string, 'ok' | 'warn' | 'info']> = { V: ['V', 'Vente', 'ok'], A: ['A', 'Assurance', 'info'], B: ['B', 'Bon de pharmacie', 'warn'] };
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const fmt = (c: Col, v: unknown) => (v === null || v === undefined || v === '' ? '' : c.type === 'money' ? fcfa(Number(v)) : c.type === 'pct' ? `${v} %` : c.type === 'int' ? Number(v).toLocaleString('fr-FR') : c.type === 'date' ? (String(v).length > 10 ? dateTimeFr(String(v)) : dateFr(String(v))) : String(v));

function csv(cols: Col[], rows: Record<string, any>[]) {
  const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  return '﻿' + [cols.map((c) => q(c.label)).join(';'), ...rows.map((r) => cols.map((c) => (c.type === 'money' || c.type === 'int' || c.type === 'pct' ? String(r[c.key] ?? '').replace('.', ',') : q(r[c.key]))).join(';'))].join('\r\n');
}
function download(name: string, content: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click(); }

export default function Sales() {
  const [tab, setTab] = useState<'tickets' | 'stats' | 'holds' | 'closings'>('tickets');
  return (
    <>
      <PageTitle title="Ventes" sub="Tickets (V vente · A assurance · B bon de pharmacie), filtres et statistiques" />
      <div className="mb-3 flex gap-2">
        <button className={tab === 'tickets' ? 'btn' : 'btn-alt'} onClick={() => setTab('tickets')}>🧾 Tickets de vente</button>
        <button className={tab === 'stats' ? 'btn' : 'btn-alt'} onClick={() => setTab('stats')}>📊 Statistiques</button>
        <button className={tab === 'holds' ? 'btn' : 'btn-alt'} onClick={() => setTab('holds')}>📋 Avoirs</button>
        {can('reports.read') && <button className={tab === 'closings' ? 'btn' : 'btn-alt'} onClick={() => setTab('closings')}>🌙 Clôtures de caisse</button>}
      </div>
      {tab === 'tickets' ? <Tickets /> : tab === 'stats' ? <StatsHub /> : tab === 'holds' ? <Holds /> : <CashClosings />}
    </>
  );
}

interface HoldRow { id: string; number: string; customerName: string; customerPhone?: string | null; productName: string; quantity: number; unitPrice: number; status: string; dueAt: string; createdAt: string }
const HOLD_STATUS: Record<string, ['ok' | 'warn' | 'bad' | 'muted', string]> = { open: ['warn', 'en attente'], fulfilled: ['ok', 'soldé'], cancelled: ['muted', 'annulé'] };

/** Avoirs clients : produits indisponibles réservés chez un grossiste, en attente de retrait. */
function Holds() {
  const [status, setStatus] = useState('open');
  const { data, error, reload } = useLoad(() => api<HoldRow[]>(`/product-holds${status ? `?status=${status}` : ''}`), [status]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const write = can('sales.hold');
  async function act(id: string, action: 'fulfill' | 'cancel') {
    setBusyId(id);
    try { await api(`/product-holds/${id}/${action}`, { method: 'POST' }); reload(); } catch { /* affiché via ErrorBox au prochain chargement */ } finally { setBusyId(null); }
  }
  const now = Date.now();
  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-extrabold">Avoirs clients</h3>
        <div className="flex gap-2">{(['open', 'fulfilled', 'cancelled', ''] as const).map((s) => <button key={s || 'all'} className={status === s ? 'btn !py-1' : 'btn-alt !py-1'} onClick={() => setStatus(s)}>{s === 'open' ? 'En attente' : s === 'fulfilled' ? 'Soldés' : s === 'cancelled' ? 'Annulés' : 'Tous'}</button>)}</div>
      </div>
      <ErrorBox error={error} />
      <table className="w-full text-sm"><thead><tr><th className="text-left">N°</th><th className="text-left">Client</th><th className="text-left">Produit</th><th>Qté</th><th>Statut</th><th>À retirer avant</th>{write && <th /> }</tr></thead><tbody>
        {data?.map((h) => {
          const late = h.status === 'open' && new Date(h.dueAt).getTime() < now;
          const [tone, label] = HOLD_STATUS[h.status] ?? ['muted', h.status];
          return (
            <tr key={h.id}>
              <td className="py-1">{h.number}</td>
              <td className="py-1">{h.customerName}{h.customerPhone ? ` · ${h.customerPhone}` : ''}</td>
              <td className="py-1">{h.productName} <span className="text-xs text-ink-muted">×{h.quantity}</span></td>
              <td className="py-1 text-center">{h.quantity}</td>
              <td className="py-1 text-center"><Badge tone={late ? 'bad' : tone}>{late ? 'en retard' : label}</Badge></td>
              <td className="py-1 text-center text-xs">{dateFr(h.dueAt)}</td>
              {write && <td className="py-1 text-right">{h.status === 'open' && <><button className="btn-alt !py-1 text-xs" disabled={busyId === h.id} onClick={() => act(h.id, 'fulfill')}>Soldé (retiré)</button> <button className="ml-1 text-xs font-bold text-red-700" disabled={busyId === h.id} onClick={() => act(h.id, 'cancel')}>Annuler</button></>}</td>}
            </tr>
          );
        })}
        {data && !data.length && <tr><td colSpan={7} className="py-3 text-center text-xs text-ink-muted">Aucun avoir.</td></tr>}
      </tbody></table>
    </div>
  );
}

/* ---------------------------------------------------------------- Liste des tickets */
function Tickets() {
  const [f, setF] = useState({ q: '', from: addDays(0), to: addDays(0), customer: '', method: '', status: '', kind: '' });
  const dq = useDebounced(f, 350);
  const qs = useMemo(() => Object.entries(dq).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'), [dq]);
  const { data, error, reload } = useLoad(() => api<SaleRow[]>(`/sales?take=300&${qs}`), [qs]);
  const [open, setOpen] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));
  const live = (data ?? []).filter((s) => s.status !== 'void');
  const byKind = (k: string) => live.filter((s) => s.kind === k);
  const sum = (l: SaleRow[]) => l.reduce((t, s) => t + s.total, 0);
  const quick = (a: number, b: number) => setF((o) => ({ ...o, from: addDays(a), to: addDays(b) }));
  return (
    <>
      <div className="card mb-3 space-y-2">
        <div className="grid gap-2 md:grid-cols-6">
          <input placeholder="N° de ticket" value={f.q} onChange={(e) => set('q', e.target.value)} />
          <input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} aria-label="Du" />
          <input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} aria-label="Au" />
          <input placeholder="Client" value={f.customer} onChange={(e) => set('customer', e.target.value)} />
          <select value={f.method} onChange={(e) => set('method', e.target.value)}><option value="">Tous paiements</option>{Object.entries(PAY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Tous statuts</option>{Object.entries(SALE_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold text-ink-muted">Type :</span>
          {[['', 'Tous'], ['V', 'V · Ventes'], ['A', 'A · Assurances'], ['B', 'B · Bons de pharmacie']].map(([k, l]) => <button key={k} className={f.kind === k ? 'btn !py-1' : 'btn-alt !py-1'} onClick={() => set('kind', k)}>{l}</button>)}
          <span className="ml-3 font-bold text-ink-muted">Période :</span>
          <button className="btn-alt !py-1" onClick={() => quick(0, 0)}>Aujourd’hui</button><button className="btn-alt !py-1" onClick={() => quick(-1, -1)}>Hier</button><button className="btn-alt !py-1" onClick={() => quick(-6, 0)}>7 jours</button><button className="btn-alt !py-1" onClick={() => quick(-29, 0)}>30 jours</button>
          <button className="btn-alt !py-1" onClick={() => setF({ q: '', from: '', to: '', customer: '', method: '', status: '', kind: '' })}>Tout effacer</button>
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[['Tickets', String(live.length), 'Total ' + fcfa(sum(live))], ['V · Ventes', String(byKind('V').length), fcfa(sum(byKind('V')))], ['A · Assurances', String(byKind('A').length), fcfa(sum(byKind('A')))], ['B · Bons', String(byKind('B').length), fcfa(sum(byKind('B')))]].map(([l, n, s]) => (
          <div key={l} className="card"><div className="text-xs font-bold uppercase text-ink-muted">{l}</div><div className="text-2xl font-extrabold">{n}</div><div className="text-sm font-bold text-brand">{s}</div></div>
        ))}
      </div>
      <ErrorBox error={error} />
      <div className="card overflow-auto"><table className="w-full text-sm">
        <thead><tr><th>N°</th><th>Date</th><th>Client</th><th>Contenu</th><th>Total</th><th>Paiement</th><th>Statut</th><th>Vendeur / Caisse</th><th /></tr></thead>
        <tbody>{data?.map((s) => (
          <tr key={s.id}>
            <td className="whitespace-nowrap"><Badge tone={KIND[s.kind]?.[2] ?? 'muted'}>{s.kind}</Badge> <b>{s.number}</b></td>
            <td className="whitespace-nowrap">{dateTimeFr(s.createdAt)}</td>
            <td>{s.customer?.name ?? '—'}</td>
            <td className="max-w-[320px]"><div className="line-clamp-2 text-xs text-ink-muted" title={s.content}>{s.content}</div></td>
            <td className="whitespace-nowrap font-bold">{fcfa(s.total)}</td>
            <td className="space-x-1">{s.payments.map((p, i) => <Badge key={i} tone={p.status === 'confirmed' ? 'ok' : p.status === 'pending_confirmation' ? 'warn' : 'muted'}>{PAY_LABEL[p.method]}</Badge>)}</td>
            <td><Badge tone={s.status === 'completed' ? 'ok' : s.status === 'void' ? 'bad' : 'warn'}>{SALE_STATUS[s.status]}</Badge></td>
            <td className="text-xs">{s.sellerName ? `V : ${s.sellerName}` : ''}{s.sellerName && s.cashierName ? <br /> : null}{s.cashierName ? `C : ${s.cashierName}` : ''}</td>
            <td><button className="btn-alt" onClick={() => setOpen(s.id)}>Détail</button></td></tr>
        ))}
        {data && !data.length && <tr><td colSpan={9} className="py-6 text-center text-ink-muted">Aucun ticket pour ces critères.</td></tr>}</tbody>
      </table></div>
      {open && <Detail id={open} onClose={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: s, reload } = useLoad(() => api<SaleFull>(`/sales/${id}`));
  const [error, setError] = useState<string | null>(null);
  if (!s) return null;
  async function act(path: string, json: unknown = {}) { try { await api(path, { method: 'POST', json }); reload(); } catch (e) { setError((e as Error).message); } }
  return (
    <Modal title={`${KIND[s.kind]?.[1] ?? 'Vente'} ${s.number}`} onClose={onClose} wide>
      <div className="mb-2 flex items-center gap-2"><Badge tone={s.status === 'completed' ? 'ok' : s.status === 'void' ? 'bad' : 'warn'}>{SALE_STATUS[s.status]}</Badge><span className="text-sm text-ink-muted">{dateTimeFr(s.createdAt)} · {s.customer?.name ?? 'Client comptoir'}{s.sellerName ? ` · vendeur ${s.sellerName}` : ''}{s.cashierName ? ` · caisse ${s.cashierName}` : ''}</span></div>
      <table className="w-full"><thead><tr><th>Produit</th><th>Lot</th><th>Qté</th><th>PU</th><th className="text-right">Total</th></tr></thead>
        <tbody>{s.items.map((i) => <tr key={i.id}><td>{i.product.name}</td><td>{i.lot?.lotNumber ?? '—'}</td><td>{i.quantity}</td><td>{fcfa(i.unitPrice)}</td><td className="text-right">{fcfa(i.lineTotal)}</td></tr>)}
          <tr><td colSpan={4} className="text-right font-extrabold">Total</td><td className="text-right font-extrabold">{fcfa(s.total)}</td></tr></tbody></table>
      <div className="mt-3 space-y-1">{s.payments.map((p) => (
        <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1 text-sm"><span>{PAY_LABEL[p.method]} {fcfa(p.amount)} {p.reference && <span className="text-xs text-ink-muted">· {p.reference}</span>}</span>
          {p.status === 'pending_confirmation' ? <span className="flex gap-1"><button className="btn !py-1" onClick={() => act(`/payments/${p.id}/confirm`)}>Confirmer reçu</button><button className="btn-alt !py-1" onClick={() => act(`/payments/${p.id}/fail`)}>Échec</button></span> : <Badge tone={p.status === 'confirmed' ? 'ok' : 'muted'}>{p.status}</Badge>}</div>
      ))}</div>
      {s.voidReason && <p className="mt-2 text-sm text-red-700">Motif d’annulation : {s.voidReason}</p>}
      <ErrorBox error={error} />
      {can('sales.void') && s.status !== 'void' && <button className="btn-red mt-3" onClick={() => { const r = prompt('Motif de l’annulation (remet le stock et extourne le crédit)'); if (r) act(`/sales/${s.id}/void`, { reason: r }); }}>Annuler la vente</button>}
    </Modal>
  );
}

/* ---------------------------------------------------------------- Statistiques */
/** Statistiques : vue d'ensemble en images, puis les rapports détaillés (tableaux, export, commande). */
function StatsHub() {
  const [v, setV] = useState<'overview' | 'reports'>('overview');
  return (
    <>
      <div className="mb-3 flex gap-2"><button className={v === 'overview' ? 'btn' : 'btn-alt'} onClick={() => setV('overview')}>📊 Vue d’ensemble</button><button className={v === 'reports' ? 'btn' : 'btn-alt'} onClick={() => setV('reports')}>📋 Rapports détaillés</button></div>
      {v === 'overview' ? <StatsOverview /> : <Stats />}
    </>
  );
}

function Stats() {
  const { data: catalog, error: catErr } = useLoad(() => api<StatDef[]>('/sales/stats/catalog'));
  const [key, setKey] = useState('ventes_produits');
  const [p, setP] = useState({ from: addDays(0), to: addDays(0), kind: '', min: '', order: 'ca', customerId: '', customerName: '' });
  const [rep, setRep] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const def = catalog?.find((c) => c.key === key);
  const [custQ, setCustQ] = useState('');
  const dq = useDebounced(custQ, 300);
  const [custs, setCusts] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { if (dq.trim().length < 2) { setCusts([]); return; } api<{ id: string; name: string }[]>(`/customers?q=${encodeURIComponent(dq.trim())}&take=6`).then(setCusts).catch(() => setCusts([])); }, [dq]);
  const [sel, setSel] = useState<Record<string, number>>({});
  const [order, setOrder] = useState(false);

  async function run() {
    setBusy(true); setErr(null); setRep(null); setSel({});
    try {
      const qs = new URLSearchParams({ from: p.from, to: p.to || p.from });
      if (p.kind) qs.set('kind', p.kind);
      if (def?.needs === 'min' && p.min !== '') qs.set('min', p.min);
      if (def?.orderable) qs.set('order', p.order);
      if (def?.needs === 'customer') qs.set('customerId', p.customerId);
      setRep(await api<Report>(`/sales/stats/${key}?${qs}&limit=1000`));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const groups = [...new Set((catalog ?? []).map((c) => c.group))];
  const quick = (a: number, b: number) => setP((o) => ({ ...o, from: addDays(a), to: addDays(b) }));
  const chosen = Object.entries(sel).filter(([, q]) => q > 0);
  return (
    <>
      <ErrorBox error={catErr} />
      <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
        <div className="card space-y-3">
          <div><b>Choisir une statistique</b></div>
          {groups.map((g) => (
            <div key={g}><div className="mb-1 text-[11px] font-extrabold uppercase text-ink-muted">{g}</div>
              {catalog?.filter((c) => c.group === g).map((c) => <button key={c.key} onClick={() => { setKey(c.key); setRep(null); }} className={`mb-1 block w-full rounded-lg px-2 py-1.5 text-left text-sm font-semibold ${key === c.key ? 'bg-brand-soft text-brand' : 'hover:bg-slate-50'}`}>{c.label}</button>)}</div>
          ))}
        </div>
        <div className="space-y-3">
          <div className="card space-y-2">
            <div className="text-lg font-extrabold">{def?.label}</div>
            <p className="text-xs text-ink-muted">{def?.help}</p>
            {!['ca_mensuel', 'ventilation_mois_produits', 'stock_nul', 'prix_zero'].includes(key) && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs font-bold">Du<input type="date" className="block" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} /></label>
                <label className="text-xs font-bold">Au<input type="date" className="block" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} /></label>
                <div className="flex gap-1"><button className="btn-alt !py-1" onClick={() => quick(0, 0)}>Aujourd’hui</button><button className="btn-alt !py-1" onClick={() => quick(-1, -1)}>Hier</button><button className="btn-alt !py-1" onClick={() => quick(-6, 0)}>7 j</button><button className="btn-alt !py-1" onClick={() => quick(-29, 0)}>30 j</button></div>
                <label className="text-xs font-bold">Type<select className="block" value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value })}><option value="">V + A + B</option><option value="V">V · Ventes</option><option value="A">A · Assurances</option><option value="B">B · Bons</option></select></label>
              </div>
            )}
            {def?.orderable && <label className="text-xs font-bold">Classer par <select className="ml-1" value={p.order} onChange={(e) => setP({ ...p, order: e.target.value })}><option value="ca">Chiffre d’affaires</option><option value="qte">Quantité</option>{can('cost.read') && <option value="marge">Marge</option>}</select></label>}
            {def?.needs === 'min' && <label className="text-xs font-bold">Taux de marge supérieur à (%) <input type="number" className="ml-1 w-24" value={p.min} onChange={(e) => setP({ ...p, min: e.target.value })} placeholder="ex. 29" /></label>}
            {def?.needs === 'customer' && (
              <div className="relative max-w-sm"><input className="w-full" placeholder="Rechercher le client…" value={p.customerId ? p.customerName : custQ} onChange={(e) => { setP({ ...p, customerId: '', customerName: '' }); setCustQ(e.target.value); }} />
                {!p.customerId && custs.length > 0 && <div className="absolute z-10 mt-1 w-full rounded-lg border border-ink-line bg-white shadow">{custs.map((c) => <button key={c.id} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => { setP({ ...p, customerId: c.id, customerName: c.name }); setCustQ(''); setCusts([]); }}>{c.name}</button>)}</div>}</div>
            )}
            <button className="btn" onClick={run} disabled={busy || (def?.needs === 'customer' && !p.customerId)}>{busy ? 'Calcul…' : 'Afficher la statistique'}</button>
          </div>
          <ErrorBox error={err} />
          {rep && (
            <div className="card space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <b>{rep.rows.length} ligne(s)</b>
                <button className="btn-alt !py-1" onClick={() => download(`${key}-${p.from}.csv`, csv(rep.columns, rep.rows))}>⬇ Exporter en CSV</button>
                <button className="btn-alt !py-1" onClick={() => window.print()}>🖨 Imprimer</button>
                {def?.toOrder && can('purchases.write') && <button className="btn !py-1" disabled={!chosen.length} onClick={() => setOrder(true)}>🛒 Convertir en bon de commande ({chosen.length})</button>}
              </div>
              {rep.note && <p className="text-xs text-ink-muted">{rep.note}</p>}
              <div className="overflow-auto"><table className="w-full text-sm">
                <thead><tr>{def?.toOrder && can('purchases.write') && <th><input type="checkbox" aria-label="Tout sélectionner" checked={rep.rows.length > 0 && chosen.length === rep.rows.length} onChange={(e) => setSel(e.target.checked ? Object.fromEntries(rep.rows.map((r) => [r.productId, Math.max(1, Number(r.qte) || 1)])) : {})} /></th>}{rep.columns.map((c) => <th key={c.key} className={c.type === 'text' ? '' : 'text-right'}>{c.label}</th>)}{def?.toOrder && can('purchases.write') && <th>À commander</th>}</tr></thead>
                <tbody>{rep.rows.map((r, i) => (
                  <tr key={i}>{def?.toOrder && can('purchases.write') && <td><input type="checkbox" checked={!!sel[r.productId]} onChange={(e) => setSel((o) => { const n = { ...o }; if (e.target.checked) n[r.productId] = Math.max(1, Number(r.qte) || 1); else delete n[r.productId]; return n; })} /></td>}
                    {rep.columns.map((c) => <td key={c.key} className={c.type === 'text' ? '' : 'whitespace-nowrap text-right'}>{fmt(c, r[c.key])}</td>)}
                    {def?.toOrder && can('purchases.write') && <td><input type="number" min={0} className="w-20" value={sel[r.productId] ?? ''} placeholder="0" onChange={(e) => setSel((o) => ({ ...o, [r.productId]: Math.max(0, Number(e.target.value) || 0) }))} /></td>}</tr>
                ))}</tbody>
                {rep.totals && <tfoot><tr className="font-extrabold">{def?.toOrder && can('purchases.write') && <td />}{rep.columns.map((c, i) => <td key={c.key} className={c.type === 'text' ? '' : 'text-right'}>{i === 0 ? 'Total' : rep.totals![c.key] !== undefined ? fmt(c, rep.totals![c.key]) : ''}</td>)}{def?.toOrder && can('purchases.write') && <td />}</tr></tfoot>}
              </table></div>
            </div>
          )}
        </div>
      </div>
      {order && <ToOrder lines={chosen.map(([productId, quantity]) => ({ productId, quantity, name: rep?.rows.find((r) => r.productId === productId)?.name ?? '' }))} onClose={() => setOrder(false)} />}
    </>
  );
}

/** Convertit une sélection de produits en bon de commande : choix du fournisseur, CIP et disponibilité chez lui, quantités modifiables, puis fichier au format exact de son extranet. */
export function ToOrder({ lines, onClose }: { lines: { productId: string; quantity: number; name: string }[]; onClose: () => void }) {
  const { data: sups } = useLoad(() => api<{ id: string; name: string; abbreviation?: string | null; isWholesaler?: boolean }[]>('/suppliers'));
  const [sid, setSid] = useState('');
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.productId, l.quantity])));
  const [prev, setPrev] = useState<any[] | null>(null);
  const [res, setRes] = useState<{ number: string; supplier: string; lines: number; csv: string; missingCodes: string[]; unavailable?: string[]; waLink: string | null; text: string; file?: { name: string; mime: string; base64: string } } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cur = () => lines.map((l) => ({ productId: l.productId, quantity: Math.max(0, Math.round(Number(qty[l.productId])) || 0) })).filter((l) => l.quantity > 0);
  async function pick(id: string) {
    setSid(id); setPrev(null); setErr(null);
    if (!id) return;
    try { setPrev((await api<{ lines: any[] }>('/supplier-hub/order/preview', { method: 'POST', json: { supplierId: id, lines: cur() } })).lines); } catch (e) { setErr((e as Error).message); }
  }
  async function create() {
    setBusy(true); setErr(null);
    try { setRes(await api('/purchase-orders/from-lines', { method: 'POST', json: { supplierId: sid, lines: cur() } })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  function dlFile(r: NonNullable<typeof res>) {
    const a = document.createElement('a');
    if (r.file) { const bin = atob(r.file.base64); const u8 = Uint8Array.from(bin, (c) => c.charCodeAt(0)); a.href = URL.createObjectURL(new Blob([u8], { type: r.file.mime })); a.download = r.file.name; a.click(); } else download(`${r.number}-${r.supplier}.csv`, '﻿' + r.csv);
  }
  const pv = new Map((prev ?? []).map((p) => [p.productId, p]));
  return (
    <Modal title="Bon de commande à partir des ventes" onClose={onClose} wide>
      {!res ? (
        <div className="space-y-3">
          <p className="text-sm">{lines.length} produit(s) sélectionné(s). Choisissez le fournisseur : l’ERP attribue à chaque ligne le <b>CIP de ce fournisseur</b> et prépare le fichier au format de son extranet. Les quantités restent modifiables.</p>
          <select className="w-full max-w-md" value={sid} onChange={(e) => pick(e.target.value)}><option value="">— Choisir le fournisseur —</option>{sups?.map((s) => <option key={s.id} value={s.id}>{s.name}{s.abbreviation ? ` (${s.abbreviation})` : ''}{s.isWholesaler ? ' · grossiste' : ''}</option>)}</select>
          <div className="max-h-64 overflow-auto rounded-lg border border-ink-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs"><tr><th className="px-2 py-1">Produit</th><th>CIP fournisseur</th><th>Dispo</th><th className="text-right">Qté</th></tr></thead>
              <tbody>{lines.map((l) => { const p = pv.get(l.productId); return (
                <tr key={l.productId} className="border-t border-ink-line">
                  <td className="px-2">{l.name}</td>
                  <td className="font-mono text-xs">{p ? (p.hasCip ? p.cip : <span className="font-bold text-amber-700">CIP manquant</span>) : ''}</td>
                  <td className="text-xs">{p?.hasCip ? (p.available === false ? <span className="font-bold text-red-600">indisponible</span> : 'oui') : ''}</td>
                  <td className="px-2 text-right"><input type="number" min={0} className="w-20 text-right" value={qty[l.productId] ?? 0} onChange={(e) => setQty({ ...qty, [l.productId]: Number(e.target.value) })} /></td>
                </tr>); })}</tbody>
            </table>
          </div>
          <ErrorBox error={err} />
          <button className="btn" disabled={!sid || busy || !cur().length} onClick={create}>{busy ? 'Création…' : 'Créer le bon de commande'}</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg bg-brand-soft p-3"><b>Bon {res.number}</b> — {res.supplier} — {res.lines} ligne(s)</div>
          {res.missingCodes.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><b>{res.missingCodes.length} produit(s) sans CIP pour ce fournisseur</b> (ligne exportée sans CIP) : {res.missingCodes.slice(0, 8).join(', ')}{res.missingCodes.length > 8 ? '…' : ''}. Reliez-les dans Fournisseurs → Catalogue et CIP.</div>}
          {!!res.unavailable?.length && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800"><b>Indisponible chez ce fournisseur</b> : {res.unavailable.slice(0, 8).join(', ')}{res.unavailable.length > 8 ? '…' : ''}.</div>}
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => dlFile(res)}>⬇ Fichier pour l’extranet ({res.file?.name ?? 'CSV'})</button>
            {res.waLink && <a className="btn-alt" href={res.waLink} target="_blank" rel="noreferrer">Envoyer par WhatsApp</a>}
            <button className="btn-alt" onClick={() => navigator.clipboard?.writeText(res.text)}>Copier le texte</button>
          </div>
          <pre className="max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{res.csv}</pre>
        </div>
      )}
    </Modal>
  );
}