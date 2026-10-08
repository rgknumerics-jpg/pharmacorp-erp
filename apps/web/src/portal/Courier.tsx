import { useCallback, useEffect, useRef, useState } from 'react';
import { alertUser, fcfa, papi, store } from './portalApi';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Application livreur : course affectée, adresse, appel, statut, espèces à encaisser, et alerte à chaque paiement validé. */
export default function Courier({ slug }: { slug: string }) {
  const KEY = `courier.${slug}`;
  const [token, setToken] = useState<string | null>(() => store.get(KEY + '.token', null));
  const [name, setName] = useState<string>(() => store.get(KEY + '.name', ''));
  const [f, setF] = useState({ phone: '', pin: '' });
  const [err, setErr] = useState<string | null>(null);
  const [orders, setOrders] = useState<any[] | null>(null);
  const [notifs, setNotifs] = useState<{ unread: number; items: any[] }>({ unread: 0, items: [] });
  const [perm, setPerm] = useState<string>(() => ('Notification' in window ? Notification.permission : 'denied'));
  const seen = useRef<Set<string>>(new Set());
  const first = useRef(true);

  const logout = useCallback(() => { setToken(null); store.set(KEY + '.token', null); }, [KEY]);
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [o, n] = await Promise.all([papi(`/online/${slug}/courier/orders`, { token }), papi(`/online/${slug}/courier/notifications`, { token })]);
      setOrders(o); setNotifs(n);
      // alerte sur chaque nouvelle notification (jamais au premier chargement)
      const fresh = (n.items as any[]).filter((i) => !i.readAt && !seen.current.has(i.id));
      if (!first.current && fresh.length) alertUser(fresh[0].title, fresh[0].body);
      for (const i of n.items as any[]) seen.current.add(i.id);
      first.current = false;
    } catch (e) { if ((e as any).status === 401 || (e as any).status === 404) logout(); }
  }, [token, slug, logout]);

  useEffect(() => { if (!token) return; refresh(); const id = setInterval(refresh, 8000); return () => clearInterval(id); }, [token, refresh]);

  async function login() {
    setErr(null);
    try { const r = await papi(`/online/${slug}/courier/login`, { json: f }); setToken(r.token); setName(r.name); store.set(KEY + '.token', r.token); store.set(KEY + '.name', r.name); } catch (e) { setErr((e as Error).message); }
  }
  async function status(id: string, s: 'out' | 'delivered') {
    setErr(null);
    try { await papi(`/online/${slug}/courier/orders/${id}/status`, { token, json: { status: s } }); await refresh(); } catch (e) { setErr((e as Error).message); }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6">
        <div className="text-center text-5xl">🛵</div>
        <h1 className="text-center text-xl font-extrabold">Application livreur</h1>
        <input className="w-full rounded-lg border border-slate-300 px-3 py-3" inputMode="tel" placeholder="Votre téléphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input className="w-full rounded-lg border border-slate-300 px-3 py-3 text-center text-xl tracking-[.4em]" type="password" inputMode="numeric" maxLength={6} placeholder="Code" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} onKeyDown={(e) => { if (e.key === 'Enter') login(); }} />
        {err && <p className="text-sm font-bold text-red-700">{err}</p>}
        <button className="w-full rounded-xl bg-brand py-3 text-lg font-extrabold text-white" onClick={login}>Me connecter</button>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-xl bg-slate-50 pb-10">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-brand px-4 py-3 text-white shadow">
        <div><div className="font-extrabold">🛵 {name}</div><div className="text-xs opacity-80">{orders ? `${orders.filter((o) => o.status !== 'delivered').length} course(s) en cours` : '…'}</div></div>
        <button className="rounded-full bg-white/20 px-3 py-1 text-sm font-bold" onClick={logout}>Quitter</button>
      </header>
      <main className="space-y-3 p-3">
        {perm !== 'granted' && 'Notification' in window && <button className="w-full rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-900" onClick={async () => setPerm(await Notification.requestPermission())}>🔔 Activer les notifications sur ce téléphone</button>}
        {notifs.unread > 0 && (
          <div className="space-y-1 rounded-xl border-2 border-amber-400 bg-amber-50 p-3">
            <div className="flex items-center justify-between"><b>🔔 {notifs.unread} nouvelle(s) notification(s)</b><button className="text-sm font-bold text-amber-900 underline" onClick={async () => { await papi(`/online/${slug}/courier/notifications/read`, { token, json: {} }); refresh(); }}>Marquer comme lues</button></div>
            {notifs.items.filter((i) => !i.readAt).slice(0, 4).map((i) => <div key={i.id} className="text-sm"><b>{i.title}</b><div className="text-slate-700">{i.body}</div></div>)}
          </div>
        )}
        {err && <p className="rounded-lg bg-red-50 p-2 text-sm font-bold text-red-700">{err}</p>}
        {orders && !orders.length && <p className="p-8 text-center text-slate-500">Aucune course pour le moment. Vous serez alerté dès qu’une commande vous est confiée ou qu’un paiement est validé.</p>}
        {orders?.map((o) => {
          const wa = `https://wa.me/${String(o.phone).replace(/\D/g, '')}`;
          return (
            <div key={o.id} className={`space-y-2 rounded-xl bg-white p-3 shadow-sm ${o.status === 'delivered' ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between"><b>{o.number}</b><span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{o.statusLabel}</span></div>
              <div className="font-bold">{o.address}</div>
              {o.addressNote && <div className="text-sm text-slate-600">{o.addressNote}</div>}
              <ul className="text-sm text-slate-700">{(o.items as any[]).map((i) => <li key={i.productId}>{i.quantity} × {i.name}</li>)}</ul>
              <div className={`rounded-lg p-2 text-center font-extrabold ${o.toCollect ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>{o.toCollect ? `💵 À encaisser : ${fcfa(o.toCollect)}` : '✅ Déjà payée'}</div>
              <div className="grid grid-cols-3 gap-2 text-center text-sm font-bold">
                <a className="rounded-lg bg-slate-100 py-2" href={`tel:${o.phone}`}>📞 Appeler</a>
                <a className="rounded-lg bg-slate-100 py-2" href={wa} target="_blank" rel="noreferrer">💬 WhatsApp</a>
                <a className="rounded-lg bg-slate-100 py-2" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address ?? '')}`} target="_blank" rel="noreferrer">🗺 Itinéraire</a>
              </div>
              {o.status === 'ready' && <button className="w-full rounded-xl bg-brand py-3 text-lg font-extrabold text-white" onClick={() => status(o.id, 'out')}>Je pars en livraison</button>}
              {o.status === 'accepted' && <p className="text-center text-sm text-slate-500">En préparation à la pharmacie…</p>}
              {o.status === 'out' && <button className="w-full rounded-xl bg-emerald-700 py-3 text-lg font-extrabold text-white" onClick={() => { if (confirm(o.toCollect ? `Confirmer la livraison et l’encaissement de ${fcfa(o.toCollect)} ?` : 'Confirmer la livraison ?')) status(o.id, 'delivered'); }}>✅ Livrée{o.toCollect ? ' et encaissée' : ''}</button>}
            </div>
          );
        })}
      </main>
    </div>
  );
}
