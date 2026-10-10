import { useCallback, useEffect, useMemo, useState } from 'react';
import { alertUser, fcfa, papi, store } from './portalApi';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Item { id: string; name: string; dci?: string | null; form?: string | null; dosage?: string | null; salePrice: number; categoryId?: string | null; available: boolean; promoPrice?: number | null; promoLabel?: string | null }
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
  // La marque de la boutique (ex. « Rive Gauche ») est distincte de l'ERP qui la fait fonctionner :
  // le client ne doit voir ni le nom ni le logo de l'ERP dans l'onglet du navigateur.
  useEffect(() => {
    if (!info) return;
    document.title = info.name || 'Boutique en ligne';
    if (info.logoUrl) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = info.logoUrl;
    }
  }, [info]);
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

  const accent = info.primaryColor || undefined; // undefined => la classe Tailwind "brand" (vert PharmaCorp) sert de repli
  const accentStyle = accent ? { backgroundColor: accent } : undefined;
  const accentTextStyle = accent ? { color: accent } : undefined;

  return (
    <div className="mx-auto min-h-screen max-w-3xl bg-slate-100 pb-24">
      <header className={`sticky top-0 z-10 flex items-center justify-between px-4 py-3 text-white shadow ${accent ? '' : 'bg-brand'}`} style={accentStyle}>
        <div className="flex items-center gap-3">
          {info.logoUrl && <img src={info.logoUrl} alt={info.name} className="h-10 w-10 rounded-full bg-white object-contain p-0.5" />}
          <div><div className="text-lg font-extrabold leading-tight">{info.name}</div><div className="text-xs opacity-80">{info.tagline || [info.city, info.phone].filter(Boolean).join(' · ')}</div></div>
        </div>
        <div className="flex items-center gap-2">
          {token ? <button className="rounded-full bg-white/20 px-3 py-1 text-sm font-bold" onClick={logout}>Déconnexion</button> : <button className={`rounded-full bg-white px-3 py-1 text-sm font-bold ${accent ? '' : 'text-brand'}`} style={accentTextStyle} onClick={() => setAuth(true)}>Connexion</button>}
        </div>
      </header>
      <main className="p-3">
        {view === 'catalog' && <Catalog slug={slug} cart={cart} setCart={setCart} accent={accent} banners={info.banners} onCart={() => setView('cart')} count={count} />}
        {view === 'cart' && <Cart slug={slug} info={info} cart={cart} setCart={setCart} token={token} needLogin={() => setAuth(true)} done={() => { setCart({}); setView('orders'); }} />}
        {view === 'orders' && token && <Orders slug={slug} token={token} info={info} />}
      </main>
      {auth && <Auth slug={slug} registration={info.registration} accent={accent} onClose={() => setAuth(false)} onToken={(t) => { setToken(t); store.set(KEY + '.token', t); setAuth(false); }} />}
      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-3xl border-t bg-white shadow-[0_-2px_10px_rgba(0,0,0,.06)]">
        {([['catalog', '🏠', 'Accueil'], ['cart', '🛒', `Panier${count ? ` (${count})` : ''}`], ['orders', '📦', `Commandes${unread ? ` •${unread}` : ''}`]] as const).map(([k, icon, l]) => (
          <button key={k} onClick={() => (k === 'orders' && !token ? setAuth(true) : setView(k))} className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold" style={view === k ? accentTextStyle ?? { color: '#047234' } : { color: '#64748b' }}>
            <span className="text-lg leading-none">{icon}</span>{l}
          </button>
        ))}
      </nav>
    </div>
  );
}

const CAT_ICON = ['💊', '🧴', '🧼', '🩹', '🍼', '🌿', '💉', '🦷', '👶', '🧽'];

function Catalog({ slug, cart, setCart, accent, banners, onCart, count }: { slug: string; cart: Record<string, { item: Item; qty: number }>; setCart: (c: Record<string, { item: Item; qty: number }>) => void; accent?: string; banners?: { imageUrl: string; title: string; link: string }[]; onCart: () => void; count: number }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [bi, setBi] = useState(0);
  useEffect(() => {
    if (!banners || banners.length < 2) return;
    const id = setInterval(() => setBi((x) => (x + 1) % banners.length), 5000);
    return () => clearInterval(id);
  }, [banners]);
  const [data, setData] = useState<{ total: number; categories: { id: string; name: string }[]; items: Item[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => papi(`/online/${slug}/catalog?q=${encodeURIComponent(q)}&category=${category}&take=60`).then(setData).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
  }, [slug, q, category]);
  const add = (item: Item) => setCart({ ...cart, [item.id]: { item, qty: Math.min(20, (cart[item.id]?.qty ?? 0) + 1) } });
  return (
    <div className="relative space-y-3">
      <input className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base shadow-sm" placeholder="🔎 Rechercher un produit…" value={q} onChange={(e) => setQ(e.target.value)} />

      {data && data.categories.length > 0 && (
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
          <button onClick={() => setCategory('')} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${category === '' ? 'text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`} style={category === '' ? { backgroundColor: accent ?? '#047234' } : undefined}>Tout</button>
          {data.categories.map((c, i) => (
            <button key={c.id} onClick={() => setCategory(c.id)} className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold ${category === c.id ? 'text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`} style={category === c.id ? { backgroundColor: accent ?? '#047234' } : undefined}>{CAT_ICON[i % CAT_ICON.length]} {c.name}</button>
          ))}
        </div>
      )}

      {!q && !category && banners && banners.length > 0 && (
        <a href={banners[bi]?.link || undefined} target={banners[bi]?.link ? '_blank' : undefined} rel="noreferrer" className="block overflow-hidden rounded-2xl shadow-sm">
          <div className="relative">
            <img src={banners[bi].imageUrl} alt={banners[bi].title} className="h-32 w-full object-cover" />
            {banners[bi].title && <div className="absolute inset-x-0 bottom-0 bg-black/40 p-2 text-sm font-extrabold text-white">{banners[bi].title}</div>}
          </div>
          {banners.length > 1 && <div className="flex justify-center gap-1 bg-white py-1.5">{banners.map((_, i) => <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: i === bi ? (accent ?? '#047234') : '#cbd5e1' }} />)}</div>}
        </a>
      )}

      {!q && !category && (!banners || !banners.length) && (
        <div className="overflow-hidden rounded-2xl text-white shadow-sm" style={{ backgroundColor: accent ?? '#047234' }}>
          <div className="p-4">
            <div className="text-xs font-bold uppercase tracking-wide opacity-80">Commande en ligne</div>
            <div className="mt-0.5 text-xl font-extrabold leading-tight">Vos produits livrés<br />ou prêts au comptoir</div>
            <div className="mt-2 text-sm opacity-90">Parcourez le catalogue, ajoutez au panier, payez en Mobile Money ou à la remise.</div>
          </div>
        </div>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="grid grid-cols-2 gap-3">
        {data?.items.map((i, k) => (
          <div key={i.id} className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="flex h-24 items-center justify-center text-4xl" style={{ backgroundColor: `${accent ?? '#047234'}14` }}>{CAT_ICON[k % CAT_ICON.length]}</div>
            <div className="flex flex-1 flex-col gap-1 p-2.5">
              {i.promoLabel && <span className="w-fit rounded-full bg-red-600 px-2 py-0.5 text-[9px] font-extrabold text-white">{i.promoLabel}</span>}
              <div className="line-clamp-2 min-h-[2.4em] text-sm font-bold leading-tight">{i.name}</div>
              {(i.dci || i.dosage) && <div className="text-[11px] text-slate-500">{[i.dci, i.dosage, i.form].filter(Boolean).join(' · ')}</div>}
              <div className="mt-auto flex items-center justify-between pt-1">
                {i.promoPrice != null ? (
                  <span className="flex flex-col"><span className="text-[11px] text-slate-400 line-through">{fcfa(i.salePrice)}</span><span className="font-extrabold text-red-600">{fcfa(i.promoPrice)}</span></span>
                ) : (
                  <span className="font-extrabold" style={accent ? { color: accent } : undefined}>{fcfa(i.salePrice)}</span>
                )}
                {!i.available && <span className="text-[10px] font-bold text-red-600">Indispo.</span>}
              </div>
              <button disabled={!i.available} onClick={() => add(i)} className="w-full rounded-full py-1.5 text-xs font-extrabold text-white disabled:bg-slate-300 disabled:opacity-60" style={i.available ? { backgroundColor: accent ?? '#047234' } : undefined}>{cart[i.id] ? `Ajouté ×${cart[i.id].qty}` : '+ Ajouter'}</button>
            </div>
          </div>
        ))}
        {data && !data.items.length && <p className="col-span-2 p-6 text-center text-slate-500">Aucun produit trouvé. Pour un médicament sur ordonnance, présentez-vous à la pharmacie.</p>}
      </div>

      {count > 0 && (
        <button onClick={onCart} className="fixed bottom-20 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full px-5 py-3 text-sm font-extrabold text-white shadow-lg" style={{ backgroundColor: accent ?? '#047234' }}>
          🛒 Voir le panier ({count})
        </button>
      )}
    </div>
  );
}

function Cart({ slug, info, cart, setCart, token, needLogin, done }: { slug: string; info: any; cart: Record<string, { item: Item; qty: number }>; setCart: (c: Record<string, { item: Item; qty: number }>) => void; token: string | null; needLogin: () => void; done: () => void }) {
  const lines = Object.values(cart);
  const zones = (info.deliveryZones ?? []) as { name: string; fee: number }[];
  const accent = info.primaryColor as string | undefined;
  const [f, setF] = useState({ fulfilment: info.delivery ? 'delivery' : 'pickup', address: '', addressNote: '', zone: '', paymentMethod: 'mtn_momo', paymentRef: '', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const deliveryFee = f.fulfilment === 'delivery' && zones.length ? (zones.find((z) => z.name === f.zone)?.fee ?? 0) : 0;
  const total = lines.reduce((s, l) => s + (l.item.promoPrice ?? l.item.salePrice) * l.qty, 0) + deliveryFee;
  if (!lines.length) return <p className="p-8 text-center text-slate-500">Votre panier est vide.</p>;
  const setQty = (id: string, d: number) => { const l = cart[id]; const q = l.qty + d; const n = { ...cart }; if (q <= 0) delete n[id]; else n[id] = { ...l, qty: Math.min(20, q) }; setCart(n); };
  async function send() {
    if (!token) { needLogin(); return; }
    if (f.fulfilment === 'delivery' && zones.length && !f.zone) { setErr('Choisissez votre zone de livraison.'); return; }
    setBusy(true); setErr(null);
    try { await papi(`/online/${slug}/orders`, { token, json: { items: lines.map((l) => ({ productId: l.item.id, quantity: l.qty })), ...f } }); done(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <div className="space-y-2">{lines.map((l) => (
        <div key={l.item.id} className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm"><div className="min-w-0"><div className="font-bold leading-tight">{l.item.name}</div><div className="text-sm text-slate-500">{l.item.promoPrice != null ? <><span className="line-through">{fcfa(l.item.salePrice)}</span> <span className="font-bold text-red-600">{fcfa(l.item.promoPrice)}</span></> : fcfa(l.item.salePrice)} × {l.qty}</div></div>
          <div className="flex items-center gap-2"><button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => setQty(l.item.id, -1)}>−</button><b>{l.qty}</b><button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => setQty(l.item.id, 1)}>+</button></div></div>
      ))}</div>
      {deliveryFee > 0 && <div className="flex justify-between rounded-xl bg-white px-3 py-2 text-sm text-slate-600 shadow-sm"><span>Frais de livraison ({f.zone})</span><span>{fcfa(deliveryFee)}</span></div>}
      <div className="flex justify-between rounded-xl bg-white p-3 text-lg font-extrabold shadow-sm"><span>Total</span><span className={accent ? '' : 'text-brand'} style={accent ? { color: accent } : undefined}>{fcfa(total)}</span></div>
      <div className="space-y-2 rounded-xl bg-white p-3 shadow-sm">
        <div className="font-extrabold">Réception</div>
        <div className="flex gap-2">{info.delivery && <button className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold ${f.fulfilment === 'delivery' ? (accent ? 'text-white' : 'bg-brand text-white') : 'bg-slate-100'}`} style={f.fulfilment === 'delivery' ? { backgroundColor: accent } : undefined} onClick={() => setF({ ...f, fulfilment: 'delivery' })}>🛵 Livraison</button>}<button className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold ${f.fulfilment === 'pickup' ? (accent ? 'text-white' : 'bg-brand text-white') : 'bg-slate-100'}`} style={f.fulfilment === 'pickup' ? { backgroundColor: accent } : undefined} onClick={() => setF({ ...f, fulfilment: 'pickup' })}>🏪 Retrait en pharmacie</button></div>
        {f.fulfilment === 'delivery' && <>
          {zones.length > 0 && <select className="w-full rounded-lg border border-slate-300 px-3 py-2" value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })}>
            <option value="">— Choisir votre zone —</option>
            {zones.map((z) => <option key={z.name} value={z.name}>{z.name} ({fcfa(z.fee)})</option>)}
          </select>}
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Adresse de livraison (quartier, rue, repère)" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Précision (étage, portail, point de repère)" value={f.addressNote} onChange={(e) => setF({ ...f, addressNote: e.target.value })} />
        </>}
        <div className="pt-1 font-extrabold">Paiement</div>
        <select className="w-full rounded-lg border border-slate-300 px-3 py-2" value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })}>{PAY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {f.paymentMethod !== 'cash' && <div className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Envoyez <b>{fcfa(total)}</b> {info.phone ? <>au <b>{info.phone}</b> </> : null}par {f.paymentMethod === 'mtn_momo' ? 'MTN Mobile Money' : 'Airtel Money'}, puis indiquez la référence reçue (vous pouvez aussi la saisir plus tard dans « Mes commandes »).<input className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-3 py-2" placeholder="Référence de la transaction" value={f.paymentRef} onChange={(e) => setF({ ...f, paymentRef: e.target.value })} /></div>}
        <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Remarque pour la pharmacie (facultatif)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
      {err && <p className="rounded-lg bg-red-50 p-2 text-sm font-bold text-red-700">{err}</p>}
      <button disabled={busy} onClick={send} className={`w-full rounded-xl py-4 text-lg font-extrabold text-white shadow disabled:opacity-50 ${accent ? '' : 'bg-brand'}`} style={accent ? { backgroundColor: accent } : undefined}>{token ? (busy ? 'Envoi…' : 'Commander') : 'Me connecter pour commander'}</button>
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

/** Indicatifs proposés par défaut : pays voisins les plus probables pour une pharmacie en Afrique centrale, puis quelques autres courants. Le client peut toujours choisir « Autre » et saisir son numéro complet. */
const COUNTRIES: { dial: string; flag: string; name: string; tz: string[] }[] = [
  { dial: '242', flag: '🇨🇬', name: 'Congo-Brazzaville', tz: ['Africa/Brazzaville'] },
  { dial: '243', flag: '🇨🇩', name: 'RD Congo', tz: ['Africa/Kinshasa', 'Africa/Lubumbashi'] },
  { dial: '237', flag: '🇨🇲', name: 'Cameroun', tz: ['Africa/Douala'] },
  { dial: '241', flag: '🇬🇦', name: 'Gabon', tz: ['Africa/Libreville'] },
  { dial: '236', flag: '🇨🇫', name: 'Centrafrique', tz: ['Africa/Bangui'] },
  { dial: '240', flag: '🇬🇶', name: 'Guinée équatoriale', tz: ['Africa/Malabo'] },
  { dial: '244', flag: '🇦🇴', name: 'Angola', tz: ['Africa/Luanda'] },
  { dial: '33', flag: '🇫🇷', name: 'France', tz: ['Europe/Paris'] },
];
/** Devine l'indicatif par le fuseau horaire de l'appareil (aucune permission requise, contrairement à la géolocalisation) ; toujours modifiable à la main. */
function guessDial(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return COUNTRIES.find((c) => c.tz.includes(tz))?.dial ?? '242';
  } catch { return '242'; }
}

function Auth({ slug, registration, accent, onClose, onToken }: { slug: string; registration: boolean; accent?: string; onClose: () => void; onToken: (t: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [dial, setDial] = useState(guessDial);
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email);
  const ok = useMemo(() => f.phone.replace(/\D/g, '').length >= 6 && f.password.length >= 6 && (mode === 'login' || (f.name.trim().length >= 2 && emailOk)), [f, mode, emailOk]);
  async function go() {
    setBusy(true); setErr(null);
    try { const r = await papi(`/online/${slug}/${mode}`, { json: { ...f, phone: `${dial}${f.phone.replace(/\D/g, '')}` } }); onToken(r.token); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-2">{(['login', 'register'] as const).filter((m) => m === 'login' || registration).map((m) => <button key={m} className={`flex-1 rounded-lg py-2 text-sm font-bold ${mode === m ? (accent ? 'text-white' : 'bg-brand text-white') : 'bg-slate-100'}`} style={mode === m ? { backgroundColor: accent } : undefined} onClick={() => setMode(m)}>{m === 'login' ? 'Connexion' : 'Créer mon compte'}</button>)}</div>
        {mode === 'register' && <input className="w-full rounded-lg border border-slate-300 px-3 py-3" placeholder="Votre nom et prénom" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
        <div className="flex gap-1.5">
          <select className="w-28 shrink-0 rounded-lg border border-slate-300 px-1 py-3 text-sm" value={dial} onChange={(e) => setDial(e.target.value)}>
            {COUNTRIES.map((c) => <option key={c.dial} value={c.dial}>{c.flag} +{c.dial}</option>)}
          </select>
          <input className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-3" inputMode="tel" placeholder={dial === '242' ? '06 123 45 67' : 'Numéro WhatsApp'} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </div>
        {mode === 'register' && <input className="w-full rounded-lg border border-slate-300 px-3 py-3" type="email" placeholder="Adresse e-mail" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
        <input className="w-full rounded-lg border border-slate-300 px-3 py-3" type="password" placeholder="Mot de passe (6 caractères minimum)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && ok) go(); }} />
        {err && <p className="text-sm font-bold text-red-700">{err}</p>}
        <button disabled={!ok || busy} onClick={go} className={`w-full rounded-xl py-3 text-base font-extrabold text-white disabled:opacity-40 ${accent ? '' : 'bg-brand'}`} style={accent ? { backgroundColor: accent } : undefined}>{busy ? '…' : mode === 'login' ? 'Me connecter' : 'Créer mon compte'}</button>
      </div>
    </div>
  );
}
