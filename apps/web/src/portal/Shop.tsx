import { useCallback, useEffect, useMemo, useState } from 'react';
import { alertUser, fcfa, papi, store } from './portalApi';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Item { id: string; name: string; dci?: string | null; form?: string | null; dosage?: string | null; salePrice: number; categoryId?: string | null; available: boolean }
const PAY: [string, string][] = [['mtn_momo', 'MTN Mobile Money'], ['airtel_money', 'Airtel Money'], ['cash', 'Espèces (à la livraison / au comptoir)']];
const STEPS = ['new', 'accepted', 'ready', 'out', 'delivered'];
const STEP_LABEL: Record<string, string> = { new: 'Reçue', accepted: 'En préparation', ready: 'Prête', out: 'En route', delivered: 'Livrée', cancelled: 'Annulée' };

/** Application client / site web de la pharmacie : catalogue, disponibilité, compte, commande, suivi. */
export default function Shop({ slug }: { slug: string }) {
  const KEY = `shop.${slug}`;
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(() => store.get(KEY + '.token', null));
  const [view, setView] = useState<'catalog' | 'cart' | 'orders'>('catalog');
  const [cart, setCart] = useState<Record<string, { item: Item; qty: number }>>(() => store.get(KEY + '.cart', {}));
  const [unread, setUnread] = useState(0);
  const [auth, setAuth] = useState(false);

  useEffect(() => { papi(`/online/${slug}/info`).then(setInfo).catch((e) => setErr(e.message)); }, [slug]);
  useEffect(() => { store.set(KEY + '.cart', cart); }, [cart, KEY]);
  const logout = useCallback(() => { setToken(null); store.set(KEY + '.token', null); setView('catalog'); }, [KEY]);

  // notifications du client (commande acceptée, prête, en route, livrée, paiement reçu)
  useEffect(() => {
    if (!token) return;
    let last = 0;
    const tick = () => papi(`/online/${slug}/notifications`, { token }).then((n) => { if (n.unread > last) alertUser(n.items[0]?.title ?? 'Pharmacie', n.items[0]?.body ?? ''); last = n.unread; setUnread(n.unread); }).catch((e) => { if (e.status === 401) logout(); });
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [token, slug, logout]);

  const count = Object.values(cart).reduce((s, l) => s + l.qty, 0);
  if (err) return <div className="p-6 text-center"><div className="text-4xl">💊</div><p className="mt-2 font-bold">Cette pharmacie n’est pas disponible en ligne pour le moment.</p><p className="text-sm text-slate-500">{err}</p></div>;
  if (!info) return <div className="p-6 text-center text-slate-500">Chargement…</div>;

  return (
    <div className="mx-auto min-h-screen max-w-3xl bg-slate-50 pb-20">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-brand px-4 py-3 text-white shadow">
        <div><div className="text-lg font-extrabold leading-tight">{info.name}</div><div className="text-xs opacity-80">{[info.city, info.phone].filter(Boolean).join(' · ')}</div></div>
        <div className="flex items-center gap-2">
          {token ? <button className="rounded-full bg-white/20 px-3 py-1 text-sm font-bold" onClick={logout}>Déconnexion</button> : <button className="rounded-full bg-white px-3 py-1 text-sm font-bold text-brand" onClick={() => setAuth(true)}>Connexion</button>}
        </div>
      </header>
      <nav className="sticky top-[58px] z-10 flex border-b bg-white text-sm font-bold">
        {([['catalog', '💊 Produits'], ['cart', `🛒 Panier${count ? ` (${count})` : ''}`], ['orders', `📦 Mes commandes${unread ? ` •${unread}` : ''}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => (k === 'orders' && !token ? setAuth(true) : setView(k))} className={`flex-1 px-2 py-3 ${view === k ? 'border-b-4 border-brand text-brand' : 'text-slate-500'}`}>{l}</button>
        ))}
      </nav>
      <main className="p-3">
        {view === 'catalog' && <Catalog slug={slug} cart={cart} setCart={setCart} />}
        {view === 'cart' && <Cart slug={slug} info={info} cart={cart} setCart={setCart} token={token} needLogin={() => setAuth(true)} done={() => { setCart({}); setView('orders'); }} />}
        {view === 'orders' && token && <Orders slug={slug} token={token} info={info} />}
      </main>
      {auth && <Auth slug={slug} registration={info.registration} onClose={() => setAuth(false)} onToken={(t) => { setToken(t); store.set(KEY + '.token', t); setAuth(false); }} />}
    </div>
  );
}

function Catalog({ slug, cart, setCart }: { slug: string; cart: Record<string, { item: Item; qty: number }>; setCart: (c: Record<string, { item: Item; qty: number }>) => void }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [data, setData] = useState<{ total: number; categories: { id: string; name: string }[]; items: Item[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => papi(`/online/${slug}/catalog?q=${encodeURIComponent(q)}&category=${category}&take=60`).then(setData).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
  }, [slug, q, category]);
  const add = (item: Item) => setCart({ ...cart, [item.id]: { item, qty: Math.min(20, (cart[item.id]?.qty ?? 0) + 1) } });
  return (
    <div className="space-y-3">
      <input className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base" placeholder="🔎 Rechercher un produit…" value={q} onChange={(e) => setQ(e.target.value)} />
      {data && data.categories.length > 0 && <select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Toutes les catégories</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="space-y-2">
        {data?.items.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 shadow-sm">
            <div className="min-w-0"><div className="font-bold leading-tight">{i.name}</div><div className="text-xs text-slate-500">{[i.dci, i.dosage, i.form].filter(Boolean).join(' · ')}</div><div className="mt-1 font-extrabold text-brand">{fcfa(i.salePrice)}</div></div>
            <div className="shrink-0 text-right">
              <div className={`mb-1 text-xs font-bold ${i.available ? 'text-emerald-700' : 'text-red-600'}`}>{i.available ? '● Disponible' : '○ Indisponible'}</div>
              <button disabled={!i.available} onClick={() => add(i)} className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white disabled:opacity-30">{cart[i.id] ? `+1 (${cart[i.id].qty})` : 'Ajouter'}</button>
            </div>
          </div>
        ))}
        {data && !data.items.length && <p className="p-6 text-center text-slate-500">Aucun produit trouvé. Pour un médicament sur ordonnance, présentez-vous à la pharmacie.</p>}
      </div>
    </div>
  );
}

function Cart({ slug, info, cart, setCart, token, needLogin, done }: { slug: string; info: any; cart: Record<string, { item: Item; qty: number }>; setCart: (c: Record<string, { item: Item; qty: number }>) => void; token: string | null; needLogin: () => void; done: () => void }) {
  const lines = Object.values(cart);
  const total = lines.reduce((s, l) => s + l.item.salePrice * l.qty, 0);
  const [f, setF] = useState({ fulfilment: info.delivery ? 'delivery' : 'pickup', address: '', addressNote: '', paymentMethod: 'mtn_momo', paymentRef: '', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!lines.length) return <p className="p-8 text-center text-slate-500">Votre panier est vide.</p>;
  const setQty = (id: string, d: number) => { const l = cart[id]; const q = l.qty + d; const n = { ...cart }; if (q <= 0) delete n[id]; else n[id] = { ...l, qty: Math.min(20, q) }; setCart(n); };
  async function send() {
    if (!token) { needLogin(); return; }
    setBusy(true); setErr(null);
    try { await papi(`/online/${slug}/orders`, { token, json: { items: lines.map((l) => ({ productId: l.item.id, quantity: l.qty })), ...f } }); done(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <div className="space-y-2">{lines.map((l) => (
        <div key={l.item.id} className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm"><div className="min-w-0"><div className="font-bold leading-tight">{l.item.name}</div><div className="text-sm text-slate-500">{fcfa(l.item.salePrice)} × {l.qty}</div></div>
          <div className="flex items-center gap-2"><button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => setQty(l.item.id, -1)}>−</button><b>{l.qty}</b><button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => setQty(l.item.id, 1)}>+</button></div></div>
      ))}</div>
      <div className="flex justify-between rounded-xl bg-white p-3 text-lg font-extrabold shadow-sm"><span>Total</span><span className="text-brand">{fcfa(total)}</span></div>
      <div className="space-y-2 rounded-xl bg-white p-3 shadow-sm">
        <div className="font-extrabold">Réception</div>
        <div className="flex gap-2">{info.delivery && <button className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold ${f.fulfilment === 'delivery' ? 'bg-brand text-white' : 'bg-slate-100'}`} onClick={() => setF({ ...f, fulfilment: 'delivery' })}>🛵 Livraison</button>}<button className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold ${f.fulfilment === 'pickup' ? 'bg-brand text-white' : 'bg-slate-100'}`} onClick={() => setF({ ...f, fulfilment: 'pickup' })}>🏪 Retrait en pharmacie</button></div>
        {f.fulfilment === 'delivery' && <><input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Adresse de livraison (quartier, rue, repère)" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /><input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Précision (étage, portail, point de repère)" value={f.addressNote} onChange={(e) => setF({ ...f, addressNote: e.target.value })} /></>}
        <div className="pt-1 font-extrabold">Paiement</div>
        <select className="w-full rounded-lg border border-slate-300 px-3 py-2" value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })}>{PAY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {f.paymentMethod !== 'cash' && <div className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Envoyez <b>{fcfa(total)}</b> {info.phone ? <>au <b>{info.phone}</b> </> : null}par {f.paymentMethod === 'mtn_momo' ? 'MTN Mobile Money' : 'Airtel Money'}, puis indiquez la référence reçue (vous pouvez aussi la saisir plus tard dans « Mes commandes »).<input className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" placeholder="Référence de la transaction" value={f.paymentRef} onChange={(e) => setF({ ...f, paymentRef: e.target.value })} /></div>}
        <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Remarque pour la pharmacie (facultatif)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
      {err && <p className="rounded-lg bg-red-50 p-2 text-sm font-bold text-red-700">{err}</p>}
      <button disabled={busy} onClick={send} className="w-full rounded-xl bg-brand py-4 text-lg font-extrabold text-white shadow disabled:opacity-50">{token ? (busy ? 'Envoi…' : 'Commander') : 'Me connecter pour commander'}</button>
      <p className="text-center text-xs text-slate-500">Les médicaments sur ordonnance ne sont pas vendus en ligne. Le pharmacien peut vous contacter avant de préparer votre commande.</p>
    </div>
  );
}

function Orders({ slug, token, info }: { slug: string; token: string; info: any }) {
  const [orders, setOrders] = useState<any[] | null>(null);
  const [ref, setRef] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => papi(`/online/${slug}/orders`, { token }).then(setOrders).catch((e) => setErr(e.message)), [slug, token]);
  useEffect(() => { load(); papi(`/online/${slug}/notifications/read`, { token, json: {} }).catch(() => undefined); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load, slug, token]);
  const act = async (fn: () => Promise<any>) => { setErr(null); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className="space-y-3">
      {err && <p className="rounded-lg bg-red-50 p-2 text-sm font-bold text-red-700">{err}</p>}
      {orders && !orders.length && <p className="p-8 text-center text-slate-500">Vous n’avez pas encore de commande.</p>}
      {orders?.map((o) => {
        const idx = STEPS.indexOf(o.status);
        return (
          <div key={o.id} className="space-y-2 rounded-xl bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between"><b>{o.number}</b><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${o.status === 'cancelled' ? 'bg-red-100 text-red-700' : o.status === 'delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{STEP_LABEL[o.status]}</span></div>
            {o.status !== 'cancelled' && <div className="flex gap-1">{STEPS.map((s, i) => <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= idx ? 'bg-brand' : 'bg-slate-200'}`} />)}</div>}
            <ul className="text-sm text-slate-700">{(o.items as any[]).map((i) => <li key={i.productId}>{i.quantity} × {i.name}</li>)}</ul>
            <div className="flex justify-between text-sm"><span>{o.fulfilment === 'delivery' ? `🛵 ${o.address}` : '🏪 Retrait en pharmacie'}</span><b>{fcfa(o.total)}</b></div>
            <div className="text-xs text-slate-600">Paiement : {o.paymentStatus === 'paid' ? '✅ validé' : o.paymentStatus === 'declared' ? '⏳ en cours de vérification' : o.paymentStatus === 'cod' ? 'espèces à la remise' : '❗ à effectuer'}</div>
            {o.paymentStatus === 'pending' && o.status !== 'cancelled' && (
              <div className="flex gap-2"><input className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Référence du paiement" value={ref[o.id] ?? ''} onChange={(e) => setRef({ ...ref, [o.id]: e.target.value })} /><button className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white" onClick={() => act(() => papi(`/online/${slug}/orders/${o.id}/pay`, { token, json: { reference: ref[o.id] ?? '' } }))}>J’ai payé</button></div>
            )}
            {o.status === 'new' && <button className="text-sm font-bold text-red-700 underline" onClick={() => act(() => papi(`/online/${slug}/orders/${o.id}/cancel`, { token, json: {} }))}>Annuler la commande</button>}
            {info.phone && o.status !== 'delivered' && o.status !== 'cancelled' && <a className="block text-sm font-bold text-brand underline" href={`tel:${String(info.phone).replace(/\s/g, '')}`}>📞 Appeler la pharmacie</a>}
          </div>
        );
      })}
    </div>
  );
}

function Auth({ slug, registration, onClose, onToken }: { slug: string; registration: boolean; onClose: () => void; onToken: (t: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email);
  const ok = useMemo(() => f.phone.length >= 8 && f.password.length >= 6 && (mode === 'login' || (f.name.trim().length >= 2 && emailOk)), [f, mode, emailOk]);
  async function go() {
    setBusy(true); setErr(null);
    try { const r = await papi(`/online/${slug}/${mode}`, { json: f }); onToken(r.token); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-2">{(['login', 'register'] as const).filter((m) => m === 'login' || registration).map((m) => <button key={m} className={`flex-1 rounded-lg py-2 text-sm font-bold ${mode === m ? 'bg-brand text-white' : 'bg-slate-100'}`} onClick={() => setMode(m)}>{m === 'login' ? 'Connexion' : 'Créer mon compte'}</button>)}</div>
        {mode === 'register' && <input className="w-full rounded-lg border border-slate-300 px-3 py-3" placeholder="Votre nom et prénom" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
        <input className="w-full rounded-lg border border-slate-300 px-3 py-3" inputMode="tel" placeholder="Numéro WhatsApp (ex. 06 123 45 67)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        {mode === 'register' && <input className="w-full rounded-lg border border-slate-300 px-3 py-3" type="email" placeholder="Adresse e-mail" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
        <input className="w-full rounded-lg border border-slate-300 px-3 py-3" type="password" placeholder="Mot de passe (6 caractères minimum)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && ok) go(); }} />
        {err && <p className="text-sm font-bold text-red-700">{err}</p>}
        <button disabled={!ok || busy} onClick={go} className="w-full rounded-xl bg-brand py-3 text-base font-extrabold text-white disabled:opacity-40">{busy ? '…' : mode === 'login' ? 'Me connecter' : 'Créer mon compte'}</button>
      </div>
    </div>
  );
}
