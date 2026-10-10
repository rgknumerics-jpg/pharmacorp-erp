import { ToOrder } from './Sales';
import { useState } from 'react';
import { api, can } from '../lib/api';
import { dateFr, fcfa } from '../lib/format';
import { Badge, ErrorBox, Field, Modal, PageTitle, useLoad } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ST: Record<string, ['ok' | 'warn' | 'bad' | 'info' | 'muted', string]> = { rupture: ['bad', 'rupture'], critique: ['bad', 'critique'], a_commander: ['warn', 'à commander'], surstock: ['info', 'surstock'], ok: ['ok', 'ok'], sans_vente: ['muted', 'sans vente'] };

export default function Purchasing() {
  const [tab, setTab] = useState<'proposals' | 'reorder' | 'stockouts' | 'suppliers' | 'invoices' | 'garde'>('proposals');
  return (
    <>
      <PageTitle title="Achats" sub="Quoi commander, chez qui, quand payer — et les semaines de garde" />
      <div className="mb-3 flex flex-wrap gap-2">{([['proposals', 'Propositions de commande'], ['reorder', 'Réapprovisionnement'], ['stockouts', 'Ruptures recherchées'], ['suppliers', 'Fournisseurs'], ['invoices', 'Échéances fournisseurs'], ['garde', 'Semaines de garde']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'btn' : 'btn-alt'} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'reorder' && <Reorder />}
      {tab === 'proposals' && <Proposals />}
      {tab === 'stockouts' && <Stockouts />}
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'invoices' && <Invoices />}
      {tab === 'garde' && <Garde />}
    </>
  );
}

interface StockoutSummary { productId: string | null; productName: string; count: number }
interface StockoutRow { id: string; productName: string; userName: string; createdAt: string }

/** Journal des ruptures : produits recherches par un vendeur et trouves a 0 en stock (enregistre automatiquement a la vente). */
function Stockouts() {
  const [days, setDays] = useState(30);
  const { data: summary, error } = useLoad(() => api<StockoutSummary[]>(`/stockouts/summary?days=${days}`), [days]);
  const { data: recent } = useLoad(() => api<StockoutRow[]>('/stockouts?take=50'), []);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card">
        <h3 className="mb-1 font-extrabold">Produits les plus recherchés en rupture</h3>
        <p className="mb-3 text-xs text-ink-muted">Sur les <select className="inline-block w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>7</option><option value={30}>30</option><option value={90}>90</option></select> derniers jours — un produit en haut de liste mérite d'être recommandé ou référencé, même s'il n'est pas en rupture officielle.</p>
        <ErrorBox error={error} />
        <table className="w-full text-sm"><tbody>
          {summary?.map((s) => <tr key={s.productId ?? s.productName}><td className="py-1">{s.productName}</td><td className="py-1 text-right"><Badge tone={s.count >= 5 ? 'bad' : 'warn'}>{s.count}×</Badge></td></tr>)}
          {summary && !summary.length && <tr><td className="py-2 text-xs text-ink-muted">Aucune recherche en rupture sur la période.</td></tr>}
        </tbody></table>
      </div>
      <div className="card">
        <h3 className="mb-3 font-extrabold">Dernières recherches en rupture</h3>
        <table className="w-full text-sm"><tbody>
          {recent?.map((r) => <tr key={r.id}><td className="py-1">{r.productName}</td><td className="py-1 text-xs text-ink-muted">{r.userName}</td><td className="py-1 text-right text-xs text-ink-muted">{dateFr(r.createdAt)}</td></tr>)}
          {recent && !recent.length && <tr><td className="py-2 text-xs text-ink-muted">Aucune recherche enregistrée.</td></tr>}
        </tbody></table>
      </div>
    </div>
  );
}

const OBJECTIVES: [string, string, string][] = [
  ['day', '📅 Ventes sur une période', 'Réassortir ce qui est sorti entre deux dates (un jour, une semaine…)'],
  ['month', '🗓 Prochain mois', 'Demande attendue d’après les ventes des 30 et 90 derniers jours'],
  ['season', '🌦 Saisonnalité (N-1, N-2)', 'Même période l’an dernier et il y a deux ans, corrigée de la tendance du chiffre d’affaires'],
  ['garde', '🌙 Avant la garde', 'Renfort pour la prochaine garde programmée'],
];

/** Propositions de commande : ventes d'une période, mois, saisonnalité, garde. Quantités modifiables, un bon de commande par fournisseur en un clic, ou export vers un seul fournisseur. */
function Proposals() {
  const today = new Date().toISOString().slice(0, 10);
  const [mode, setMode] = useState('day');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [horizon, setHorizon] = useState(30);
  const { data, error } = useLoad(() => api<any>(`/analytics/proposals?mode=${mode}&date=${from}&to=${to}&horizon=${horizon}`), [mode, from, to, horizon]);
  const { data: sups } = useLoad(() => api<{ id: string; name: string }[]>('/suppliers'), []) as any;
  const [qty, setQty] = useState<Record<string, number>>({});
  const [off, setOff] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState(false);
  const [defSup, setDefSup] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lines: any[] = data?.lines ?? [];
  const q = (l: any) => qty[l.productId] ?? l.suggested;
  const chosen = lines.filter((l) => !off.has(l.productId) && q(l) > 0);
  const toggle = (id: string) => setOff((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function oneClick() {
    setBusy(true); setErr(null);
    try { setDone(await api<any>('/analytics/proposals/orders', { method: 'POST', json: { lines: chosen.map((l) => ({ productId: l.productId, quantity: q(l), supplierId: l.supplierId })), defaultSupplierId: defSup || null } })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  function file(o: any) { const bin = atob(o.file.base64); const u8 = Uint8Array.from(bin, (c) => c.charCodeAt(0)); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([u8], { type: o.file.mime })); a.download = o.file.name; a.click(); }
  const noSupplier = chosen.filter((l) => !l.supplierId).length;
  return (
    <>
      <div className="mb-3 grid gap-2 md:grid-cols-4">
        {OBJECTIVES.map(([k, l, h]) => <button key={k} onClick={() => { setMode(k); setQty({}); setOff(new Set()); setDone(null); }} className={`card !p-3 text-left transition ${mode === k ? 'ring-2 ring-brand' : 'hover:shadow-md'}`}><b>{l}</b><div className="text-xs text-ink-muted">{h}</div></button>)}
      </div>
      <div className="card mb-3 flex flex-wrap items-center gap-3 text-sm">
        {mode === 'day' && <><label>Du <input type="date" value={from} max={today} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></label><label>au <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label>
          {[['Aujourd’hui', 0], ['Hier', 1], ['7 jours', 6], ['30 jours', 29]].map(([l, n]) => <button key={l as string} className="btn-alt !py-1 text-xs" onClick={() => { const e = new Date(); const s = new Date(Date.now() - Number(n) * 86400000); setFrom(s.toISOString().slice(0, 10)); setTo(l === 'Hier' ? s.toISOString().slice(0, 10) : e.toISOString().slice(0, 10)); }}>{l}</button>)}</>}
        {(mode === 'month' || mode === 'season') && <label>Horizon <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>{[7, 15, 30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} jours</option>)}</select></label>}
        <span className="text-ink-muted">{data?.info?.label}</span>
        {mode === 'season' && data?.info && !data.info.hasHistory && <span className="font-bold text-amber-700">Pas d’historique N-1 / N-2 : importez vos anciennes ventes (Reprise des données).</span>}
      </div>
      <ErrorBox error={error ?? err} />
      <div className="card overflow-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr><th /><th>Produit</th><th>Fournisseur habituel</th><th>Stock</th><th>{mode === 'day' ? 'Sorti' : 'Ventes 30 j'}</th>{mode === 'season' && <><th>N-1</th><th>N-2</th></>}<th>Attendu</th><th className="text-right">À commander</th><th className="text-right">Valeur achat</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.productId} className={off.has(l.productId) ? 'opacity-40' : ''}>
                <td><input type="checkbox" checked={!off.has(l.productId)} onChange={() => toggle(l.productId)} /></td>
                <td><b className={l.detail ? 'text-teal-700' : ''}>{l.name}</b>{l.detail && <span className="ml-1 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-extrabold text-teal-800" title={`Détaillable : ${l.unitsPerBox} unités par boîte. Quantités en unités ; commande en boîtes entières seulement si le reste ne couvre plus le besoin.`}>✂ détail ×{l.unitsPerBox}</span>}</td>
                <td className="text-xs">{l.supplierName ?? <span className="text-ink-muted">—</span>}</td>
                <td>{l.detail ? <span title="boîtes">{l.stock} <small className="text-ink-muted">({l.stockUnits} u.)</small></span> : l.stock}</td><td>{l.sold}</td>{mode === 'season' && <><td>{l.n1}</td><td>{l.n2}</td></>}<td>{l.expected}</td>
                <td className="text-right"><input type="number" min={0} className="w-20 text-right font-bold" value={q(l)} onChange={(e) => setQty({ ...qty, [l.productId]: Math.max(0, Number(e.target.value) || 0) })} /><div className="text-[10px] text-ink-muted">{l.detail ? 'boîte(s)' : ''}</div></td>
                <td className="text-right">{fcfa(q(l) * (l.value / Math.max(1, l.suggested)))}</td>
              </tr>
            ))}
            {data && !lines.length && <tr><td colSpan={9} className="p-4 text-center text-ink-muted">Rien à commander pour cet objectif{mode === 'day' ? ' : aucune vente sur cette période (ou le stock restant suffit)' : ''}. Essayez une autre période ou « Prochain mois ».</td></tr>}
          </tbody>
        </table>
      </div>
      {can('purchases.write') && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn" disabled={!chosen.length || busy} onClick={oneClick}>{busy ? 'Création…' : `⚡ Créer les bons de commande en un clic (${chosen.length} ligne(s))`}</button>
          <label className="text-sm">Sans fournisseur habituel : <select value={defSup} onChange={(e) => setDefSup(e.target.value)}><option value="">— ignorer ces lignes ({noSupplier}) —</option>{sups?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <button className="btn-alt" disabled={!chosen.length} onClick={() => setOrder(true)}>Un seul fournisseur (aperçu et export)…</button>
        </div>
      )}
      <p className="mt-1 text-xs text-ink-muted">Un bon de commande est créé par fournisseur, avec les CIP de ce fournisseur et son fichier d’export. Les produits détaillables (✂) se commandent en boîtes entières seulement quand le reste en unités ne couvre plus le besoin.</p>
      {done && (
        <Modal title={`${done.orders.length} bon(s) de commande créé(s)`} onClose={() => setDone(null)} wide>
          <div className="space-y-2">
            {done.orders.map((o: any) => (
              <div key={o.number} className="rounded-xl bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><b>{o.number}</b><span>{o.supplier}</span><span className="text-ink-muted">{o.lines} ligne(s)</span>
                  {o.file && <button className="btn !py-1 text-xs" onClick={() => file(o)}>⬇ Fichier pour l’extranet ({o.file.name})</button>}
                  {o.waLink && <a className="btn-alt !py-1 text-xs" href={o.waLink} target="_blank" rel="noreferrer">WhatsApp</a>}</div>
                {o.missingCodes?.length > 0 && <div className="mt-1 text-xs text-amber-800">{o.missingCodes.length} produit(s) sans CIP chez ce fournisseur : {o.missingCodes.slice(0, 6).join(', ')}{o.missingCodes.length > 6 ? '…' : ''}</div>}
                {o.unavailable?.length > 0 && <div className="mt-1 text-xs text-red-700">Indisponibles chez lui : {o.unavailable.slice(0, 6).join(', ')}</div>}
              </div>
            ))}
            {done.unassigned > 0 && <p className="text-xs text-amber-800">{done.unassigned} ligne(s) ignorée(s) faute de fournisseur.</p>}
          </div>
        </Modal>
      )}
      {order && <ToOrder lines={chosen.map((l) => ({ productId: l.productId, quantity: q(l), name: l.name }))} onClose={() => setOrder(false)} />}
    </>
  );
}

function Reorder() {
  const { data, error } = useLoad(() => api<any>('/analytics/reorder'));
  const [only, setOnly] = useState(true);
  const rows = (data?.products ?? []).filter((p: any) => !only || p.orderQty > 0 || p.status === 'rupture');
  return (
    <>
      <ErrorBox error={error} />
      {data?.garde && <div className={`mb-3 rounded-xl border-l-4 p-3 text-sm ${data.garde.reinforceNow ? 'border-brand-orange bg-orange-50 font-bold' : 'border-blue-400 bg-blue-50'}`}>🌙 Prochaine garde du {dateFr(data.garde.start)} au {dateFr(data.garde.end)} (dans {data.garde.daysToGarde} j) — demande prévue +{data.garde.upliftPct} %. {data.garde.reinforceNow ? 'Renforcez le stock maintenant : les quantités ci-dessous incluent la garde.' : 'Le renfort sera proposé 4 jours avant.'}</div>}
      {data && <div className="mb-3 grid gap-2 md:grid-cols-3">{data.proposal.map((p: any) => <div key={p.supplier} className="card !p-3"><div className="text-xs font-bold uppercase text-ink-muted">Commande proposée</div><b>{p.supplier}</b><div className="text-sm">{p.lines} ligne(s) · {fcfa(p.value)}</div></div>)}</div>}
      {data?.proposal?.length > 0 && can('purchases.write') && <OneClickOrder />}
      <label className="mb-2 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Seulement ce qu'il faut commander</label>
      <div className="card overflow-auto"><table className="w-full min-w-[900px]">
        <thead><tr><th>Produit</th><th>Stock</th><th>Ventes / jour</th><th>Couverture</th><th>Rupture dans</th><th>Saisonnalité</th><th>Délai</th><th>À commander</th><th>Fournisseur</th><th>État</th></tr></thead>
        <tbody>{rows.map((p: any) => (
          <tr key={p.productId}><td><b>{p.name}</b>{p.gardeBoost && <Badge tone="warn">garde</Badge>}</td><td>{p.stock}</td><td>{p.dailyDemand}</td>
            <td>{p.monthsOfStock !== null ? `${p.monthsOfStock} mois` : '—'}</td><td>{p.ruptureInDays !== null ? `${p.ruptureInDays} j` : '—'}</td><td>×{p.seasonalFactor}</td><td>{p.leadTimeDays} j</td>
            <td className="font-extrabold">{p.orderQty || '—'}</td><td>{p.supplier ?? '—'}</td><td><Badge tone={ST[p.status][0]}>{ST[p.status][1]}</Badge></td></tr>
        ))}</tbody>
      </table></div>
      <p className="mt-2 text-xs text-ink-muted">Calcul : moyenne des ventes (30 j et 90 j) × saisonnalité (même période l’an dernier) × (délai fournisseur + 7 jours) + stock de sécurité − stock disponible.</p>
    </>
  );
}

function Suppliers() {
  const { data, error } = useLoad(() => api<any>('/analytics/suppliers'));
  return (
    <>
      <ErrorBox error={error} />
      {data?.alerts.length > 0 && <div className="mb-3 space-y-1">{data.alerts.map((a: any, i: number) => <div key={i} className={`rounded-xl border-l-4 px-3 py-2 text-sm font-semibold ${a.level === 'vert' ? 'border-brand bg-brand-soft' : 'border-brand-orange bg-orange-50'}`}>{a.text}</div>)}</div>}
      <div className="card overflow-auto"><table className="w-full min-w-[1000px]">
        <thead><tr><th>Fournisseur</th><th>Achats</th><th>Évolution prix</th><th>Délai moyen</th><th>Livraison complète</th><th>Retards</th><th>Manquants</th><th>Paiement</th><th>Marge obtenue</th><th>Reste dû</th></tr></thead>
        <tbody>{data?.suppliers.map((s: any) => (
          <tr key={s.id}><td><b>{s.name}</b><div className="text-xs text-ink-muted">{s.orders} commande(s) · {s.products} produit(s)</div></td>
            <td>{fcfa(s.purchasedAmount)}</td><td>{s.priceEvolutionPct !== null ? <Badge tone={s.priceEvolutionPct > 3 ? 'warn' : 'ok'}>{s.priceEvolutionPct > 0 ? '+' : ''}{s.priceEvolutionPct} %</Badge> : '—'}</td>
            <td>{s.avgLeadTimeDays ?? s.declaredLeadTime} j{s.recentLeadTimeDays && s.previousLeadTimeDays ? <div className="text-xs text-ink-muted">{s.previousLeadTimeDays} → {s.recentLeadTimeDays} j</div> : null}</td>
            <td>{s.completeRate !== null ? `${s.completeRate} %` : '—'}</td><td>{s.lateRate !== null ? `${s.lateRate} %` : '—'}</td><td>{s.missingProducts}</td>
            <td>{s.payment}</td><td>{fcfa(s.marginObtained)}{s.marginRate !== null && <div className="text-xs text-ink-muted">{s.marginRate} %</div>}</td><td>{fcfa(s.openDebt)}</td></tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

function Invoices() {
  const { data, error, reload } = useLoad(() => api<any[]>('/supplier-invoices'));
  const { data: sups } = useLoad(() => api<any[]>('/suppliers'));
  const [pay, setPay] = useState<any>(null);
  const [add, setAdd] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const write = can('purchases.write');
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      {write && <button className="btn mb-3" onClick={() => setAdd(true)}>+ Facture fournisseur</button>}
      <ErrorBox error={error ?? err} />
      <div className="card overflow-auto"><table className="w-full">
        <thead><tr><th>Fournisseur</th><th>Facture</th><th>Échéance</th><th className="text-right">Montant</th><th className="text-right">Reste</th><th /></tr></thead>
        <tbody>{data?.map((i) => {
          const due = i.amount - i.paidAmount, late = i.status === 'open' && i.dueDate.slice(0, 10) < today;
          return <tr key={i.id} className={i.status === 'paid' ? 'opacity-50' : ''}><td><b>{i.supplier.name}</b><div className="text-xs text-ink-muted">{i.supplier.paymentTermDays ? `${i.supplier.paymentTermDays} jours` : 'Comptant'}</div></td><td>{i.number}<div className="text-xs text-ink-muted">{dateFr(i.issueDate)}</div></td>
            <td>{write && i.status === 'open' ? <input type="date" defaultValue={i.dueDate.slice(0, 10)} className={late ? 'border-red-500' : ''} onBlur={async (e) => { if (e.target.value && e.target.value !== i.dueDate.slice(0, 10)) { try { await api(`/supplier-invoices/${i.id}`, { method: 'PATCH', json: { dueDate: e.target.value } }); reload(); } catch (x) { setErr((x as Error).message); } } }} /> : dateFr(i.dueDate)}{late && <Badge tone="bad">en retard</Badge>}</td>
            <td className="text-right">{fcfa(i.amount)}</td><td className="text-right font-bold">{i.status === 'paid' ? <Badge>réglée</Badge> : fcfa(due)}</td>
            <td>{write && i.status === 'open' && <button className="btn !py-1" onClick={() => setPay(i)}>Régler</button>}</td></tr>;
        })}</tbody>
      </table></div>
      {pay && <PayModal inv={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); reload(); }} />}
      {add && <AddInvoice sups={sups ?? []} onClose={() => setAdd(false)} onDone={() => { setAdd(false); reload(); }} />}
    </>
  );
}

function PayModal({ inv, onClose, onDone }: { inv: any; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(inv.amount - inv.paidAmount);
  const [method, setMethod] = useState('cash');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`Régler ${inv.supplier.name} — ${inv.number}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Montant"><input type="number" className="w-full" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        <Field label="Mode"><select className="w-full" value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Espèces</option><option value="card">Virement / chèque</option><option value="mtn_momo">MTN MoMo</option><option value="airtel_money">Airtel Money</option></select></Field>
        <ErrorBox error={error} /><button className="btn" onClick={async () => { try { await api(`/supplier-invoices/${inv.id}/payments`, { method: 'POST', json: { amount, method } }); onDone(); } catch (e) { setError((e as Error).message); } }}>Enregistrer le règlement</button>
      </div>
    </Modal>
  );
}

function AddInvoice({ sups, onClose, onDone }: { sups: any[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ supplierId: '', number: '', issueDate: new Date().toISOString().slice(0, 10), dueDate: '', amount: 0 });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Facture fournisseur" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Fournisseur"><select className="w-full" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">— choisir —</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.paymentTermDays ? `${s.paymentTermDays} j` : 'comptant'})</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="N° de facture"><input className="w-full" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field><Field label="Montant"><input type="number" className="w-full" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Date de facture"><input type="date" className="w-full" value={f.issueDate} onChange={(e) => setF({ ...f, issueDate: e.target.value })} /></Field><Field label="Échéance (vide = conditions du fournisseur)"><input type="date" className="w-full" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field></div>
        <ErrorBox error={error} /><button className="btn" onClick={async () => { try { await api('/supplier-invoices', { method: 'POST', json: { ...f, dueDate: f.dueDate || undefined } }); onDone(); } catch (e) { setError((e as Error).message); } }}>Enregistrer</button>
      </div>
    </Modal>
  );
}

function Garde() {
  const { data, reload } = useLoad(() => api<any[]>('/garde-periods'));
  const [f, setF] = useState({ startDate: '', endDate: '', upliftPct: 50 });
  const [error, setError] = useState<string | null>(null);
  const write = can('purchases.write');
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card">
        <h3 className="mb-2 font-extrabold">Gardes programmées</h3>
        {data?.map((g) => <div key={g.id} className="flex items-center justify-between border-b border-ink-line py-2 text-sm"><span>🌙 {dateFr(g.startDate)} → {dateFr(g.endDate)} · +{g.upliftPct} %</span>{write && <button className="btn-alt !py-1" onClick={async () => { await api(`/garde-periods/${g.id}`, { method: 'DELETE' }); reload(); }}>✕</button>}</div>)}
        {data?.length === 0 && <p className="text-sm text-ink-muted">Aucune garde programmée.</p>}
      </div>
      {write && <div className="card space-y-3">
        <h3 className="font-extrabold">Ajouter une semaine de garde</h3>
        <div className="grid grid-cols-2 gap-3"><Field label="Début"><input type="date" className="w-full" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field><Field label="Fin"><input type="date" className="w-full" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field></div>
        <Field label="Hausse de demande attendue (%)"><input type="number" className="w-full" value={f.upliftPct} onChange={(e) => setF({ ...f, upliftPct: Number(e.target.value) })} /></Field>
        <ErrorBox error={error} /><button className="btn" onClick={async () => { try { await api('/garde-periods', { method: 'POST', json: f }); reload(); } catch (e) { setError((e as Error).message); } }}>Enregistrer</button>
        <p className="text-xs text-ink-muted">4 jours avant la garde, le réapprovisionnement intègre la hausse prévue et un message apparaît dans le cockpit.</p>
      </div>}
    </div>
  );
}
/** Commande en un clic : un bon par fournisseur, aux CIP de sa base, envoi WhatsApp (lien direct) ou fichier pour l'extranet. */
function OneClickOrder() {
  const [orders, setOrders] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => { setBusy(true); setErr(null); try { setOrders(await api<any[]>('/analytics/reorder/orders', { method: 'POST', json: {} })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const download = (o: any) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + o.csv], { type: 'text/csv;charset=utf-8' })); a.download = `${o.number}-${o.supplier}.csv`; a.click(); };
  return (
    <div className="mb-3 rounded-xl bg-gradient-to-r from-brand to-emerald-700 p-3 text-white">
      {!orders ? <button className="rounded-lg bg-white px-4 py-2 font-extrabold text-brand shadow transition hover:scale-[1.02]" disabled={busy} onClick={go}>{busy ? 'Préparation…' : '⚡ Créer les bons de commande en un clic'}</button> : (
        <div className="space-y-2">
          <b>{orders.length} bon(s) de commande créé(s) en brouillon</b>
          {orders.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/15 p-2 text-sm">
              <span className="font-bold">{o.number} · {o.supplier} · {o.lines} ligne(s)</span>
              {o.waLink && <a className="rounded bg-white px-2 py-1 font-bold text-brand" href={o.waLink} target="_blank" rel="noreferrer">Envoyer par WhatsApp</a>}
              <button className="rounded bg-white px-2 py-1 font-bold text-brand" onClick={() => download(o)}>Fichier CIP (.csv)</button>
              {o.missingCodes?.length > 0 && <span className="text-xs text-amber-200">⚠ {o.missingCodes.length} article(s) sans CIP pour ce grossiste</span>}
            </div>
          ))}
        </div>
      )}
      {err && <p className="mt-1 text-sm text-red-100">{err}</p>}
    </div>
  );
}