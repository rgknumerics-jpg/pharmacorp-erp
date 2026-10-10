import { useEffect, useState } from 'react';
import { api, can, getSession } from '../lib/api';
import { fcfa } from '../lib/format';
import { Badge, ErrorBox, Field, Modal, PageTitle, useLoad } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'muted'> = { new: 'bad', accepted: 'warn', ready: 'info', out: 'info', delivered: 'ok', cancelled: 'muted' };
const PAYLBL: Record<string, string> = { pending: 'à payer', declared: 'paiement déclaré — à vérifier', paid: 'payé', cod: 'espèces à la remise' };
const METH: Record<string, string> = { mtn_momo: 'MTN MoMo', airtel_money: 'Airtel Money', cash: 'Espèces' };

/** Commandes passées depuis l'application client / le site : acceptation (devient une vente), livreur, paiement, statut. */
export default function OnlineOrders() {
  const [tab, setTab] = useState<'orders' | 'customers' | 'couriers' | 'links'>('orders');
  const [status, setStatus] = useState('open');
  const { data, error, reload } = useLoad(() => api<any[]>(`/online-orders?status=${status}`), [status]) as any;
  const { data: sum, reload: reSum } = useLoad(() => api<any>('/online-orders/summary'), []) as any;
  const { data: couriers, reload: reCouriers } = useLoad(() => api<any[]>('/online-orders/couriers'), []) as any;
  const [err, setErr] = useState<string | null>(null);
  const [courierModal, setCourierModal] = useState<any | null>(null);
  const w = can('online.manage');
  useEffect(() => { const id = setInterval(() => { reload(); reSum(); }, 20000); return () => clearInterval(id); }, [reload, reSum]);
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); reload(); reSum(); } catch (e) { setErr((e as Error).message); } };
  const slug = getSession()?.tenant.slug ?? '';
  const base = `${location.origin}`;

  return (
    <>
      <PageTitle title="Commandes en ligne" sub="Commandes de l’application client et du site web : acceptation, paiement, livreur" />
      <div className="mb-3 flex flex-wrap gap-2">
        {([['orders', 'Commandes'], ['customers', 'Clients en ligne'], ['couriers', 'Livreurs'], ['links', 'Liens à partager']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'btn' : 'btn-alt'} onClick={() => setTab(k)}>{l}{k === 'orders' && sum?.new ? <span className="ml-2 rounded-full bg-red-600 px-2 text-xs text-white">{sum.new}</span> : null}</button>)}
      </div>
      <ErrorBox error={err ?? error} />

      {tab === 'orders' && (
        <>
          {sum && <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">{[['Nouvelles', sum.new], ['En préparation', sum.accepted], ['Prêtes', sum.ready], ['En livraison', sum.out], ['Paiements à vérifier', sum.toValidate]].map(([l, v]) => <div key={String(l)} className="card !p-3 text-center"><div className="text-xs text-ink-muted">{l}</div><div className="text-xl font-extrabold">{v}</div></div>)}</div>}
          <div className="mb-3 flex flex-wrap gap-2">{[['open', 'En cours'], ['delivered', 'Livrées'], ['cancelled', 'Annulées'], ['', 'Toutes']].map(([k, l]) => <button key={k} className={`rounded-full px-3 py-1 text-sm font-bold ${status === k ? 'bg-brand text-white' : 'bg-slate-100'}`} onClick={() => setStatus(k)}>{l}</button>)}</div>
          <div className="space-y-2">
            {data?.map((o: any) => (
              <div key={o.id} className="card !p-3">
                <div className="flex flex-wrap items-center gap-2"><b>{o.number}</b><Badge tone={TONE[o.status]}>{o.statusLabel}</Badge><span className="text-sm">{o.customer}</span><span className="ml-auto font-extrabold">{fcfa(o.total)}</span></div>
                <ul className="mt-1 text-sm">{(o.items as any[]).map((i) => <li key={i.productId}>{i.quantity} × {i.name}</li>)}</ul>
                <div className="mt-1 text-xs text-ink-muted">{o.fulfilment === 'delivery' ? `🛵 ${o.address}${o.addressNote ? ` (${o.addressNote})` : ''}` : '🏪 Retrait en pharmacie'} · tél. {o.phone} · {METH[o.paymentMethod]}{o.paymentRef ? ` réf. ${o.paymentRef}` : ''} · <b className={o.paymentStatus === 'declared' ? 'text-amber-700' : ''}>{PAYLBL[o.paymentStatus]}</b>{o.courier ? ` · livreur : ${o.courier.name}` : ''}</div>
                {o.note && <div className="text-xs italic">« {o.note} »</div>}
                {w && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {o.status === 'new' && <button className="btn !py-1 text-xs" onClick={() => run(() => api(`/online-orders/${o.id}/accept`, { method: 'POST' }))}>✓ Accepter (crée la vente)</button>}
                    {o.fulfilment === 'delivery' && !['delivered', 'cancelled'].includes(o.status) && o.status !== 'new' && (
                      <select className="text-xs" value={o.courierId ?? ''} onChange={(e) => run(() => api(`/online-orders/${o.id}/assign`, { method: 'POST', json: { courierId: e.target.value || null } }))}><option value="">— Livreur —</option>{couriers?.filter((c: any) => c.isActive).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                    )}
                    {o.saleId && o.paymentStatus !== 'paid' && o.status !== 'cancelled' && <button className="btn-alt !py-1 text-xs" onClick={() => run(() => api(`/online-orders/${o.id}/confirm-payment`, { method: 'POST' }))}>💰 Valider le paiement{o.paymentMethod === 'cash' ? ' (espèces encaissées)' : ''}</button>}
                    {o.next.filter((n: string) => n !== 'cancelled').map((n: string) => n !== 'accepted' && <button key={n} className="btn-alt !py-1 text-xs" onClick={() => run(() => api(`/online-orders/${o.id}/status`, { method: 'POST', json: { status: n } }))}>→ {({ ready: 'Prête', out: 'En livraison', delivered: 'Livrée' } as any)[n]}</button>)}
                    {o.courier?.phone && !['delivered', 'cancelled'].includes(o.status) && <a className="btn-alt !py-1 text-xs" target="_blank" rel="noreferrer" href={`https://wa.me/${String(o.courier.phone).replace(/\D/g, '')}?text=${encodeURIComponent(`Course ${o.number} : ${o.address ?? ''} — ${o.phone} — ${o.paymentStatus === 'paid' ? 'déjà payée' : `à encaisser ${fcfa(o.total)}`}`)}`}>Prévenir par WhatsApp</a>}
                    {o.next.includes('cancelled') && <button className="text-xs font-bold text-red-700 underline" onClick={() => { const reason = prompt('Motif de l’annulation (communiqué au client) :'); if (reason) run(() => api(`/online-orders/${o.id}/status`, { method: 'POST', json: { status: 'cancelled', reason } })); }}>Annuler</button>}
                  </div>
                )}
              </div>
            ))}
            {data && !data.length && <div className="card text-center text-ink-muted">Aucune commande.</div>}
          </div>
        </>
      )}

      {tab === 'customers' && <OnlineCustomers />}

      {tab === 'couriers' && (
        <div className="card">
          <table className="w-full text-sm"><thead><tr><th>Livreur</th><th>Téléphone</th><th>État</th><th /></tr></thead>
            <tbody>{couriers?.map((c: any) => <tr key={c.id}><td><b>{c.name}</b></td><td>{c.phone}</td><td>{c.isActive ? <Badge>actif</Badge> : <Badge tone="muted">inactif</Badge>}</td><td className="text-right">{w && <button className="btn-alt !py-0.5 text-xs" onClick={() => setCourierModal(c)}>Modifier</button>}</td></tr>)}</tbody></table>
          {!couriers?.length && <p className="p-3 text-sm text-ink-muted">Aucun livreur. Ajoutez-en un : il se connecte à l’application livreur avec son téléphone et son code.</p>}
          {w && <button className="btn mt-3" onClick={() => setCourierModal({})}>+ Livreur</button>}
        </div>
      )}

      {tab === 'links' && (
        <div className="card space-y-3 text-sm">
          <div><b>Application client / site web</b><div className="mt-1 break-all rounded-lg bg-slate-50 p-2 font-mono">{base}/boutique/{slug}</div></div>
          <div><b>Application livreur</b><div className="mt-1 break-all rounded-lg bg-slate-50 p-2 font-mono">{base}/livreur/{slug}</div></div>
          <p className="text-ink-muted">Ces adresses s’ouvrent sur n’importe quel téléphone : « Ajouter à l’écran d’accueil » les installe comme une application. Activez le catalogue en ligne, l’inscription et la livraison dans <b>Ma structure → Réglages de l’établissement</b>, puis cochez « Visible dans l’application client » sur les produits à proposer. Pour un site installé à l’extérieur, l’ERP doit être joignable par Internet.</p>
        </div>
      )}
      {courierModal && <CourierForm c={courierModal} onClose={() => setCourierModal(null)} onSaved={() => { setCourierModal(null); reCouriers(); }} />}
    </>
  );
}

/** Clients venus de la boutique en ligne : population distincte des clients « pos » (pharmacie), jamais
 * eligible au credit — suivis ici plutot que melanges dans Clients. */
function OnlineCustomers() {
  const { data, error } = useLoad(() => api<any[]>('/customers?source=online&take=200'), []) as any;
  return (
    <div className="card overflow-auto">
      <p className="mb-2 text-xs text-ink-muted">Clients inscrits depuis la boutique en ligne — jamais de vente à crédit pour cette population.</p>
      <ErrorBox error={error} />
      <table className="w-full text-sm"><thead><tr><th className="text-left">Client</th><th>Téléphone</th><th>Inscrit le</th></tr></thead>
        <tbody>{data?.map((c: any) => (
          <tr key={c.id}><td><b>{c.name}</b><div className="text-xs text-ink-muted">{c.email}</div></td>
            <td>{c.phone ? <a className="text-brand underline" href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer">{c.phone}</a> : '—'}</td>
            <td className="text-xs text-ink-muted">{new Date(c.createdAt).toLocaleDateString('fr-FR')}</td></tr>
        ))}</tbody>
      </table>
      {data && !data.length && <p className="p-3 text-sm text-ink-muted">Aucun client inscrit depuis la boutique pour l’instant.</p>}
    </div>
  );
}

function CourierForm({ c, onClose, onSaved }: { c: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: c.name ?? '', phone: c.phone ?? '', pin: '', isActive: c.isActive !== false });
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setErr(null);
    try { await api(c.id ? `/online-orders/couriers/${c.id}` : '/online-orders/couriers', { method: c.id ? 'PATCH' : 'POST', json: { name: f.name, phone: f.phone, pin: f.pin || undefined, isActive: f.isActive } }); onSaved(); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title={c.id ? c.name : 'Nouveau livreur'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nom *"><input className="w-full" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Téléphone *"><input className="w-full" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label={c.id ? 'Nouveau code (laisser vide pour ne pas changer)' : 'Code de connexion (4 à 6 chiffres) *'}><input className="w-full" inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} /></Field>
        {c.id && <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Livreur actif</label>}
        <ErrorBox error={err} />
        <button className="btn" onClick={save}>Enregistrer</button>
      </div>
    </Modal>
  );
}
