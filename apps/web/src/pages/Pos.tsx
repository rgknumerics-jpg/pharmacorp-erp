import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, can, getSession, restoreBaseSession, Session, switchOperator } from '../lib/api';
import { dateTimeFr, fcfa, PAY_LABEL } from '../lib/format';
import { Badge, ErrorBox, Modal, PageTitle, useDebounced } from '../components/ui';
import { CashSession, CloseCash, ExpenseForm, OpenCash, ShiftReminder, useShift } from '../components/CashDesk';
import { Advice, BasketAdvice, OfferGate } from '../components/PlantAdvice';
import { BrandingData, loadBranding } from '../lib/branding';
import { printReceipt, printVoucher } from '../lib/print';
import { byCodeLocal, catalogDate, enqueue, flush, isNetworkError, queue, refreshCatalog, searchLocal } from '../lib/offline';

interface Product { stock?: number; detail?: boolean; unitsPerBox?: number | null; id: string; sku: string; barcode?: string | null; name: string; salePrice: number; priceFree: boolean; vatRate: number; prescriptionRequired: boolean; trackLots: boolean }
interface CartLine { product: Product; quantity: number; unitPrice: number; discount: number }
interface Customer { id: string; name: string; phone?: string | null; creditLimit: number; creditBalance: number }
interface PayLine { method: string; amount: number; reference: string }
interface SaleResult {
  needsPrescription?: boolean;
  id: string; number: string; status: string; total: number; paidAmount: number; warnings: string[]; createdAt: string;
  items: { quantity: number; unitPrice: number; lineTotal: number; product: { name: string }; lot?: { lotNumber: string } | null }[];
  payments: { id: string; method: string; amount: number; status: string; reference?: string | null }[];
  customer?: { name: string } | null;
}

type Mode = 'cash' | 'single' | 'multi';
interface Equivalent { id: string; name: string; dosage?: string | null; salePrice: number; stock: number; nearestExpiry: string | null; lotNumber: string | null; expiresSoon: boolean }
const METHODS = ['cash', 'mtn_momo', 'airtel_money', 'card', 'cheque', 'transfer', 'credit'];
const SINGLE = ['mtn_momo', 'airtel_money', 'card', 'cheque', 'transfer', 'credit', 'insurer'];
const BILLS = [500, 1000, 2000, 5000, 10000];
const MODE_LABEL: Record<Mode, string> = { cash: 'Espèces', single: 'Règlement groupé', multi: 'Règlement multiple' };

type WorkMode = 'seller' | 'cashier' | 'direct';
interface TicketLine { productId: string; name: string; quantity: number; unitPrice: number; discount: number; product: Product | null }
interface QueueTicket { id: string; number: string; note?: string | null; createdAt: string; sellerName: string | null; total: number; lines: TicketLine[]; customer: Customer | null }

const MODE_NAME: Record<WorkMode, string> = { seller: 'Poste vendeur', cashier: 'Poste caisse', direct: 'Vente directe' };
const sget = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const sset = (k: string, v: string | null) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* ignore */ } };

/** Point d'entrée : vendeur (saisit et envoie à la caisse), caissier (encaisse les tickets) ou vente directe (pharmacien). Chaque poste peut être protégé par un code personnel qui identifie la personne. */
export default function Pos() {
  const canSell = can('sales.ticket'), canCash = can('sales.create');
  const [lock, setLock] = useState<{ seller: boolean; cashier: boolean; direct: boolean } | null>(null);
  useEffect(() => { api<{ posLock: { seller: boolean; cashier: boolean; direct: boolean } }>('/company/settings').then((s) => setLock(s.posLock)).catch(() => setLock({ seller: false, cashier: false, direct: false })); }, []);
  const saved = sget('erp.posmode') as WorkMode | null;
  const [wm, setWm] = useState<WorkMode | null>(() => (canSell && canCash ? (saved && ['seller', 'cashier', 'direct'].includes(saved) ? saved : null) : canSell ? 'seller' : 'cashier'));
  const [pinFor, setPinFor] = useState<WorkMode | null>(null);
  const unlocked = sget('erp.posunlocked');
  const choose = (m: WorkMode | null) => { setWm(m); sset('erp.posmode', m); if (!m) sset('erp.posunlocked', null); };
  const pick = (m: WorkMode) => { if (lock?.[m] && unlocked !== m) setPinFor(m); else choose(m); };
  /** Verrouille le poste : on rend la main au compte de départ. */
  const lockPos = () => { sset('erp.posunlocked', null); sset('erp.posmode', null); if (restoreBaseSession()) window.location.reload(); else setWm(null); };
  if (!lock) return null;
  const gate = pinFor ?? (wm && lock[wm] && unlocked !== wm ? wm : null);
  if (gate) return <PinGate mode={gate} onCancel={pinFor ? () => setPinFor(null) : undefined} />;
  if (!wm) {
    const Card = ({ m, icon, title, text }: { m: WorkMode; icon: string; title: string; text: string }) => (
      <button onClick={() => pick(m)} className="card flex flex-col items-start gap-1 border-2 border-transparent text-left transition hover:border-brand hover:shadow-lg"><span className="text-4xl">{icon}</span><b className="text-lg">{title}{lock[m] ? ' 🔒' : ''}</b><span className="text-sm text-ink-muted">{text}</span></button>
    );
    return (
      <>
        <PageTitle title="Ouvrir le POS" sub="Choisissez votre poste de travail" />
        <div className="grid gap-4 md:grid-cols-3">
          <Card m="seller" icon="🧑‍⚕️" title="Poste vendeur" text="Saisir la vente d’après l’ordonnance (produits, client) puis l’envoyer à la caisse. Aucun encaissement." />
          <Card m="cashier" icon="💰" title="Poste caisse" text="Voir arriver les tickets des vendeurs, vérifier leur contenu et encaisser. Ouverture de caisse et billetage." />
          <Card m="direct" icon="🧾" title="Vente directe" text="Saisir et encaisser soi-même (pharmacien, petite équipe)." />
        </div>
      </>
    );
  }
  return (
    <>
      {unlocked === wm && <div className="mb-2 flex items-center justify-between rounded-xl bg-slate-100 px-3 py-1.5 text-sm"><span>🔓 {MODE_NAME[wm]} · <b>{getSession()?.user.fullName}</b></span><button className="btn-alt !py-0.5 text-xs" onClick={lockPos}>🔒 Verrouiller le poste</button></div>}
      <PosCore workMode={wm} onSwitch={canSell && canCash ? () => choose(null) : undefined} onDirect={wm === 'cashier' && canSell && (!lock.direct || unlocked === 'direct') ? () => choose('direct') : undefined} />
    </>
  );
}

/** Saisie du code personnel : il identifie la personne, qui travaille ensuite sous son propre compte. */
function PinGate({ mode, onCancel }: { mode: WorkMode; onCancel?: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go(p = pin) {
    if (p.length < 4 || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<Session>('/auth/pos-unlock', { method: 'POST', json: { mode, pin: p } });
      sset('erp.posmode', mode); sset('erp.posunlocked', mode); switchOperator(r); window.location.reload();
    } catch (e) { setErr((e as Error).message); setPin(''); setBusy(false); }
  }
  const press = (d: string) => setPin((x) => (x.length < 8 ? x + d : x));
  return (
    <div className="mx-auto mt-6 max-w-xs space-y-3 text-center">
      <div className="text-4xl">🔒</div>
      <h1 className="text-xl font-extrabold">{MODE_NAME[mode]}</h1>
      <p className="text-sm text-ink-muted">{mode === 'direct' ? 'Vente directe : code du pharmacien.' : 'Saisissez votre code personnel.'}</p>
      <div className="rounded-xl bg-slate-100 py-3 text-3xl tracking-[.5em]">{pin ? '•'.repeat(pin.length) : <span className="text-slate-300">••••</span>}</div>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} className="rounded-xl bg-white py-3 text-xl font-bold shadow ring-1 ring-ink-line active:scale-95" onClick={() => press(d)}>{d}</button>)}
        <button className="rounded-xl bg-slate-100 py-3 font-bold" onClick={() => setPin('')}>C</button>
        <button className="rounded-xl bg-white py-3 text-xl font-bold shadow ring-1 ring-ink-line active:scale-95" onClick={() => press('0')}>0</button>
        <button className="rounded-xl bg-slate-100 py-3 font-bold" onClick={() => setPin((x) => x.slice(0, -1))}>⌫</button>
      </div>
      <input className="sr-only" autoFocus aria-label="Code" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
      <ErrorBox error={err} />
      <button className="btn w-full !py-3" disabled={pin.length < 4 || busy} onClick={() => go()}>{busy ? 'Vérification…' : 'Déverrouiller'}</button>
      {onCancel && <button className="btn-alt w-full" onClick={onCancel}>Retour</button>}
    </div>
  );
}
/** Produit à rupture (stock nul ou négatif) : affiché en rouge à la recherche. Un produit détaillable n'est
 * jamais un vrai manque (la boîte parente se délote automatiquement à la vente) : il garde sa propre couleur. */
const out = (p: { stock?: number; detail?: boolean }) => p.stock !== undefined && p.stock <= 0 && !p.detail;
const lowDetail = (p: { stock?: number; detail?: boolean }) => !!p.detail && p.stock !== undefined && p.stock <= 0;

function PosCore({ workMode, onSwitch, onDirect }: { workMode: WorkMode; onSwitch?: () => void; onDirect?: () => void }) {
  const isSeller = workMode === 'seller', isCashier = workMode === 'cashier';
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [ticketNo, setTicketNo] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [offer, setOffer] = useState<Advice | null>(null);
  const [declinedSig, setDeclinedSig] = useState('');
  const offerNext = useRef<(() => void | Promise<void>) | null>(null);
  const [addMore, setAddMore] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [results, setResults] = useState<Product[]>([]);
  const [sel, setSel] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [line, setLine] = useState(-1);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [custQ, setCustQ] = useState('');
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [mode, setMode] = useState<Mode>('cash');
  const [single, setSingle] = useState('mtn_momo');
  const [reference, setReference] = useState('');
  const [pays, setPays] = useState<PayLine[]>([]);
  const [tendered, setTendered] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SaleResult | null>(null);
  const [offlineDone, setOfflineDone] = useState<{ total: number; change: number } | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [insurers, setInsurers] = useState<{ id: string; name: string; coverageRate: number }[]>([]);
  const [insurerId, setInsurerId] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(queue().length);
  const [cash, setCash] = useState<CashSession | null | undefined>(undefined);
  const [showExpense, setShowExpense] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const loadCash = useCallback(() => api<CashSession | null>('/cash/sessions/current').then(setCash).catch(() => setCash((c) => (c === undefined ? null : c))), []);
  useEffect(() => { loadCash(); }, [loadCash, done]);
  const shift = useShift();
  const [equiv, setEquiv] = useState<{ for: Product; alt: Equivalent } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const cust = useRef<HTMLInputElement>(null);
  const cashIn = useRef<HTMLInputElement>(null);
  const canDiscount = can('sales.discount');
  // la touche Entree qui valide la vente ne doit pas refermer aussitot le ticket
  const shownAt = useRef(0);
  useEffect(() => { if (done || offlineDone) shownAt.current = Date.now(); }, [done, offlineDone]);

  // --- hors ligne : catalogue local + renvoi automatique des ventes en attente
  const sync = useCallback(async () => {
    try { const r = await flush(); setPending(r.left); setOnline(true); if (Date.now() - new Date(catalogDate() ?? 0).getTime() > 3_600_000) await refreshCatalog(); }
    catch { setOnline(false); }
  }, []);
  useEffect(() => {
    sync();
    const t = setInterval(sync, 20_000);
    const on = () => { setOnline(true); sync(); }, off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { clearInterval(t); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [sync]);

  useEffect(() => { api<{ id: string; name: string; coverageRate: number; isActive: boolean }[]>('/insurers').then((l) => setInsurers(l.filter((i) => i.isActive))).catch(() => undefined); }, []);
  useEffect(() => { if (!done && !offlineDone) search.current?.focus(); }, [done, offlineDone]);
  useEffect(() => {
    setSel(0);
    if (dq.trim().length < 2) { setResults([]); return; }
    api<Product[]>(`/products?q=${encodeURIComponent(dq.trim())}&take=12&stock=1`).then(setResults).catch(() => setResults(searchLocal(dq)));
  }, [dq]);
  useEffect(() => {
    if (custQ.trim().length < 2) { setCustResults([]); return; }
    api<Customer[]>(`/customers?q=${encodeURIComponent(custQ.trim())}&take=6`).then(setCustResults).catch(() => setCustResults([]));
  }, [custQ]);

  const total = useMemo(() => cart.reduce((s, l) => s + l.unitPrice * l.quantity - l.discount, 0), [cart]);
  const cashGiven = Number(tendered) || 0;
  const insurerShare = insurerId ? Math.round((total * (insurers.find((i) => i.id === insurerId)?.coverageRate ?? 0)) / 100) : 0;

  /** Paiements effectifs selon le mode choisi : la caissiere ne saisit que ce que donne le client. */
  const effective: PayLine[] = useMemo(() => {
    if (mode === 'cash') return total > 0 ? [{ method: 'cash', amount: total, reference: '' }] : [];
    if (mode === 'single') {
      if (single === 'insurer') return [{ method: 'insurer', amount: insurerShare, reference }, ...(total - insurerShare > 0 ? [{ method: 'cash', amount: total - insurerShare, reference: '' }] : [])];
      return total > 0 ? [{ method: single, amount: total, reference }] : [];
    }
    return pays.filter((p) => p.amount > 0);
  }, [mode, single, total, reference, pays, insurerShare]);
  const paid = effective.reduce((s, p) => s + p.amount, 0);
  const remaining = total - paid;
  const cashDue = effective.find((p) => p.method === 'cash')?.amount ?? 0;
  const change = cashDue > 0 && cashGiven > cashDue ? cashGiven - cashDue : 0;
  const short = cashDue > 0 && cashGiven > 0 && cashGiven < cashDue;

  function add(p: Product) {
    // equivalent de meme DCI dont un lot perime bientot : simple proposition, le pharmacien decide
    api<{ items: Equivalent[] }>(`/products/${p.id}/equivalents`).then((r) => { const e = r.items.find((x) => x.expiresSoon); setEquiv(e ? { for: p, alt: e } : null); }).catch(() => setEquiv(null));
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id && !p.priceFree);
      if (i >= 0) { setLine(i); return c.map((l, k) => (k === i ? { ...l, quantity: l.quantity + 1 } : l)); }
      setLine(c.length);
      return [...c, { product: p, quantity: 1, unitPrice: p.priceFree ? 0 : p.salePrice, discount: 0 }];
    });
    setQ(''); setResults([]); search.current?.focus();
  }
  const qty = (i: number, d: number) => setCart((c) => c.map((x, k) => (k === i ? { ...x, quantity: Math.max(1, x.quantity + d) } : x)));

  async function onEnter() {
    if (results[sel] && q.trim() && !/^\d{6,}$/.test(q.trim())) return add(results[sel]);
    const code = q.trim();
    if (!code) { if (cart.length) cashIn.current?.focus(); return; }
    try { add(await api<Product>(`/products/by-code/${encodeURIComponent(code)}`)); }
    catch (e) {
      const local = isNetworkError(e) ? byCodeLocal(code) : null;
      if (local) add(local); else if (results.length) add(results[sel] ?? results[0]); else setError(`Code « ${code} » introuvable.`);
    }
  }

  function setPay(method: string, amount: number) {
    setPays((ps) => [...ps.filter((p) => p.method !== method), ...(amount > 0 ? [{ method, amount, reference: ps.find((p) => p.method === method)?.reference ?? '' }] : [])]);
  }
  const payOf = (m: string) => pays.find((p) => p.method === m);

  function reset() { setCart([]); setPays([]); setCustomer(null); setTendered(''); setInsurerId(''); setReference(''); setMode('cash'); setLine(-1); setEquiv(null); setKey(crypto.randomUUID()); setError(null); setTicketId(null); setTicketNo(null); setNote(''); setDeclinedSig(''); setOffer(null); }

  /** Poste caisse : charge un ticket envoyé par un vendeur dans le panier, prêt à encaisser. */
  function loadTicket(t: QueueTicket) {
    reset();
    setCart(t.lines.filter((l) => l.product).map((l) => ({ product: l.product as Product, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount })));
    setCustomer(t.customer); setTicketId(t.id); setTicketNo(t.number); setNote(t.note ?? '');
    setTimeout(() => cashIn.current?.focus(), 50);
  }

  /** Poste vendeur : envoie le ticket à la caisse (aucun stock touché avant l'encaissement). */
  async function sendTicket() {
    if (!cart.length || busy) return;
    setBusy(true); setError(null);
    try {
      const t = await api<{ number: string }>('/tickets', { method: 'POST', json: { customerId: customer?.id, note: note.trim() || undefined, items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, ...(l.product.priceFree ? { unitPrice: l.unitPrice } : {}), ...(l.discount ? { discount: l.discount } : {}) })) } });
      setSent(t.number); reset();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  /** Avant de valider (vendeur ou vente directe) : on propose d'abord un complément ; si le client décline, la vente part à la caisse / à l'encaissement. */
  const sig = cart.map((l) => l.product.id).sort().join(',');
  async function offerThen(next: () => void | Promise<void>) {
    if (isCashier || !cart.length || declinedSig === sig || !online) { void next(); return; }
    try {
      const a = await api<Advice>('/plants/basket', { method: 'POST', json: { productIds: cart.map((l) => l.product.id) } });
      if (a.suggestions?.length) { offerNext.current = next; setOffer(a); return; }
    } catch { /* conseil indisponible : on ne bloque jamais la vente */ }
    void next();
  }
  function submit() { return isSeller ? offerThen(sendTicket) : offerThen(doSubmit); }

  async function doSubmit() {
    if (!cart.length || busy || remaining < 0) return;
    if (short) { setError(`Montant reçu insuffisant : il manque ${fcfa(cashDue - cashGiven)}.`); return; }
    if (mode === 'single' && single === 'credit' && !customer) { setError('Choisissez le client (F4) pour une vente à crédit.'); return; }
    setBusy(true); setError(null);
    const payload = {
      idempotencyKey: key,
      customerId: customer?.id,
      ...(ticketId ? { ticketId } : {}),
      items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, ...(l.product.priceFree ? { unitPrice: l.unitPrice } : {}), ...(l.discount ? { discount: l.discount } : {}) })),
      payments: effective.map((p) => ({ method: p.method, amount: Number(p.amount), ...(p.reference ? { reference: p.reference } : {}), ...(p.method === 'insurer' ? { insurerId } : {}) })),
    };
    try {
      const sale = await api<SaleResult>('/sales', { method: 'POST', json: payload });
      setDone({ ...sale, needsPrescription: cart.some((l) => l.product.prescriptionRequired) });
      reset();
    } catch (e) {
      if (isNetworkError(e)) {
        enqueue({ key, payload, total, at: new Date().toISOString() });
        setPending(queue().length); setOnline(false);
        setOfflineDone({ total, change }); reset();
      } else setError((e as Error).message);
    } finally { setBusy(false); }
  }

  // --- raccourcis clavier
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (done || offlineDone) { if ((e.key === 'Escape' || e.key === 'Enter') && Date.now() - shownAt.current > 600) { e.preventDefault(); setDone(null); setOfflineDone(null); } return; }
      const k = e.key;
      if (k === 'F2') { e.preventDefault(); search.current?.focus(); search.current?.select(); }
      else if (k === 'F4') { e.preventDefault(); cust.current?.focus(); }
      else if (k === 'F5') { e.preventDefault(); setMode('cash'); setTimeout(() => cashIn.current?.focus(), 0); }
      else if (k === 'F6') { e.preventDefault(); setMode('single'); }
      else if (k === 'F7') { e.preventDefault(); setMode('multi'); }
      else if (k === 'F8' || k === 'F9') { e.preventDefault(); submit(); }
      else if (k === 'Escape') { e.preventDefault(); if (q) { setQ(''); setResults([]); } else search.current?.focus(); }
      else if (e.target === search.current && !q) {
        if ((k === '+' || k === '-') && line >= 0) { e.preventDefault(); qty(line, k === '+' ? 1 : -1); }
        else if (k === 'Delete' && line >= 0) { e.preventDefault(); setCart((c) => c.filter((_, i) => i !== line)); setLine((l) => Math.min(l, cart.length - 2)); }
        else if (k === 'ArrowUp' && cart.length) { e.preventDefault(); setLine((l) => Math.max(0, (l < 0 ? cart.length : l) - 1)); }
        else if (k === 'ArrowDown' && cart.length) { e.preventDefault(); setLine((l) => Math.min(cart.length - 1, l + 1)); }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const Key = ({ k }: { k: string }) => <kbd className="rounded border border-ink-line bg-white px-1 text-[10px] font-bold text-ink-muted">{k}</kbd>;

  // caisse non ouverte (et serveur joignable) : la caissiere declare d'abord son fond de caisse
  if (!isSeller && cash === null && online) return <OpenCash onOpened={(s) => setCash(s)} />;

  return (
    <>
      <PageTitle title={isSeller ? 'Poste vendeur' : isCashier ? 'Poste caisse' : 'Caisse'} sub={isSeller ? 'Saisissez la vente d’après l’ordonnance, puis envoyez-la à la caisse (F8)' : isCashier ? 'Les tickets des vendeurs arrivent ici : vérifiez, encaissez (F8)' : 'Tout se fait au clavier : scannez, Entrée, puis F8 pour encaisser'}
        actions={<div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${online ? 'bg-brand-soft text-brand' : 'animate-pulse bg-orange-100 text-orange-800'}`}>{online ? '● En ligne' : '● Hors ligne — les ventes sont gardées'}{pending > 0 && ` · ${pending} à envoyer`}</span>
          {pending > 0 && online && <button className="btn-alt !py-1" onClick={sync}>Envoyer</button>}
          {onDirect && <button className="btn-alt" onClick={onDirect}>Vente directe</button>}
          {onSwitch && <button className="btn-alt" onClick={onSwitch}>⇄ Changer de poste</button>}
          {!isSeller && cash && <><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{cash.register}{cash.expected !== undefined ? ` · en caisse ${fcfa(cash.expected)}` : ''}</span><button className="btn-alt" onClick={() => setShowExpense(true)}>💸 Dépense</button><button className="btn-alt" onClick={() => setShowClose(true)}>🌙 Clôturer</button></>}
        </div>} />
      {!isSeller && cash && <ShiftReminder shift={shift} />}
      <div className="mb-3 flex flex-wrap gap-3 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-ink-muted">
        <span><Key k="F2" /> recherche</span><span><Key k="↑↓" /> choisir</span><span><Key k="Entrée" /> ajouter</span><span><Key k="+" /><Key k="-" /> quantité</span><span><Key k="Suppr" /> retirer</span>
        <span><Key k="F4" /> client</span><span><Key k="F5" /> espèces</span><span><Key k="F6" /> groupé</span><span><Key k="F7" /> multiple</span><span><Key k="F8" /> encaisser</span><span><Key k="Échap" /> annuler</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <div className="space-y-3">
          {isCashier && <TicketQueue activeId={ticketId} onPick={loadTicket} />}
          {isCashier && ticketNo && <div className="rounded-lg bg-brand-soft px-3 py-2 text-sm font-bold text-brand">Ticket {ticketNo} chargé{note ? ` — ${note}` : ''}. Vérifiez le contenu puis encaissez.</div>}
          {isCashier && !addMore && <button className="btn-alt text-sm" onClick={() => setAddMore(true)}>+ Ajouter un produit à ce ticket</button>}
          <div className={`card ${isCashier && !addMore ? 'hidden' : ''}`}>
            <input ref={search} className="w-full text-lg" placeholder="🔎 Code-barres, nom ou DCI…" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
                else if (results.length && e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSel((s) => Math.min(results.length - 1, s + 1)); }
                else if (results.length && e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSel((s) => Math.max(0, s - 1)); }
              }} />
            {results.length > 0 && (
              <div className="mt-2 overflow-hidden rounded-lg border border-ink-line">
                {results.map((p, i) => (
                  <button key={p.id} onMouseEnter={() => setSel(i)} onClick={() => add(p)} className={`flex w-full items-center justify-between px-3 py-2 text-left ${i === sel ? (out(p) ? 'bg-red-700 text-white' : lowDetail(p) ? 'bg-amber-600 text-white' : 'bg-brand text-white') : out(p) ? 'bg-red-50 text-red-700' : lowDetail(p) ? 'bg-amber-50 text-amber-800' : i % 2 ? 'bg-slate-50' : 'bg-white'}`}>
                    <span><b>{p.name}</b> {p.detail && <span title="Produit détaillable (vendu à l’unité)" className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${i === sel ? 'bg-white/25' : 'bg-teal-100 text-teal-800'}`}>✂ détail</span>} {p.prescriptionRequired && <Badge tone="warn">ordonnance</Badge>} {p.priceFree && <Badge tone="info">prix libre</Badge>}</span>
                    <span className="whitespace-nowrap font-bold">{p.priceFree ? '—' : fcfa(p.salePrice)} <span className={out(p) ? 'font-extrabold' : 'font-normal opacity-80'}>({p.stock ?? '?'})</span></span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {equiv && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-sm">
              <span className="text-xl">💡</span>
              <span className="flex-1">Même DCI à écouler : <b>{equiv.alt.name}</b> — {fcfa(equiv.alt.salePrice)}, lot {equiv.alt.lotNumber} périme le <b>{equiv.alt.nearestExpiry ? new Date(equiv.alt.nearestExpiry).toLocaleDateString('fr-FR') : '—'}</b> ({equiv.alt.stock} en stock). <span className="text-xs text-ink-muted">Substitution soumise à l’accord du pharmacien.</span></span>
              <button className="btn !py-1" onClick={() => { const a = equiv.alt, from = equiv.for; setCart((c) => { const i = c.findIndex((l) => l.product.id === from.id); if (i < 0) return c; const l = c[i]; const np: Product = { ...from, id: a.id, name: a.name, salePrice: a.salePrice, priceFree: false }; return [...c.slice(0, i), ...(l.quantity > 1 ? [{ ...l, quantity: l.quantity - 1 }] : []), { product: np, quantity: 1, unitPrice: a.salePrice, discount: 0 }, ...c.slice(i + 1)]; }); setEquiv(null); search.current?.focus(); }}>Remplacer</button>
              <button className="btn-alt !py-1" onClick={() => { setEquiv(null); search.current?.focus(); }}>Ignorer</button>
            </div>
          )}
          <div className="card">
            {cart.length === 0 ? <p className="text-sm text-ink-muted">Le panier est vide. Scannez un produit.</p> : (
              <table className="w-full">
                <thead><tr><th>Produit</th><th>Qté</th><th>Prix</th>{canDiscount && <th>Remise</th>}<th className="text-right">Total</th><th /></tr></thead>
                <tbody>
                  {cart.map((l, i) => (
                    <tr key={i} onClick={() => setLine(i)} className={i === line ? 'bg-brand-soft outline outline-2 outline-brand' : i % 2 ? 'bg-slate-50' : ''}>
                      <td><b>{l.product.name}</b>{l.product.prescriptionRequired && <div><Badge tone="warn">ordonnance requise</Badge></div>}</td>
                      <td><div className="flex items-center gap-1"><button className="btn-alt !px-2 !py-0" tabIndex={-1} onClick={() => qty(i, -1)}>−</button><input type="number" min={1} className="w-16 text-center" value={l.quantity} onChange={(e) => setCart((c) => c.map((x, k) => (k === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))} /><button className="btn-alt !px-2 !py-0" tabIndex={-1} onClick={() => qty(i, 1)}>+</button></div></td>
                      <td>{l.product.priceFree ? <input type="number" min={0} className="w-28" value={l.unitPrice} onChange={(e) => setCart((c) => c.map((x, k) => (k === i ? { ...x, unitPrice: Number(e.target.value) || 0 } : x)))} /> : fcfa(l.unitPrice)}</td>
                      {canDiscount && <td><input type="number" min={0} className="w-24" value={l.discount} onChange={(e) => setCart((c) => c.map((x, k) => (k === i ? { ...x, discount: Number(e.target.value) || 0 } : x)))} /></td>}
                      <td className="text-right font-bold">{fcfa(l.unitPrice * l.quantity - l.discount)}</td>
                      <td><button className="btn-alt" tabIndex={-1} onClick={() => setCart((c) => c.filter((_, k) => k !== i))}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {!isCashier && (
            <BasketAdvice
              productIds={cart.map((l) => l.product.id)}
              onAdd={(pid) => { api<Product>(`/products/${pid}`).then((p) => add(p)).catch(() => undefined); }}
            />
          )}
        </div>

        <div className="space-y-3">
          <div className="card bg-gradient-to-br from-brand to-emerald-700 text-white">
            <div className="text-xs font-bold uppercase opacity-80">Total à payer · {cart.reduce((s, l) => s + l.quantity, 0)} article(s)</div>
            <div className="text-5xl font-extrabold">{fcfa(total)}</div>
          </div>

          {!isSeller && <div className="card space-y-2">
            <div className="grid grid-cols-3 gap-1">
              {(['cash', 'single', 'multi'] as Mode[]).map((m, i) => (
                <button key={m} onClick={() => setMode(m)} className={`rounded-lg px-2 py-2 text-sm font-bold ${mode === m ? 'bg-brand text-white' : 'bg-slate-100 hover:bg-slate-200'}`}>{MODE_LABEL[m]}<div className="text-[10px] opacity-70">F{5 + i}</div></button>
              ))}
            </div>

            {mode === 'single' && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-1">
                  {SINGLE.filter((m) => (m !== 'insurer' || insurers.length) && (m !== 'credit' || can('sales.credit'))).map((m) => <button key={m} onClick={() => setSingle(m)} className={`rounded-lg border px-2 py-1.5 text-xs font-bold ${single === m ? 'border-brand bg-brand-soft text-brand' : 'border-ink-line'}`}>{m === 'insurer' ? 'Tiers payant' : PAY_LABEL[m]}</button>)}
                </div>
                {single === 'insurer' && <select className="w-full" value={insurerId} onChange={(e) => setInsurerId(e.target.value)}><option value="">— organisme —</option>{insurers.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.coverageRate} %)</option>)}</select>}
                {single === 'insurer' && insurerId && <p className="text-sm">Part organisme <b>{fcfa(insurerShare)}</b> · reste patient en espèces <b>{fcfa(total - insurerShare)}</b></p>}
                {['mtn_momo', 'airtel_money', 'card', 'cheque', 'transfer'].includes(single) && <input className="w-full" placeholder="Référence de transaction" value={reference} onChange={(e) => setReference(e.target.value)} />}
                {single === 'credit' && !customer && <p className="text-sm font-bold text-orange-700">Choisissez le client (F4).</p>}
              </div>
            )}

            {mode === 'multi' && (
              <div className="space-y-1">
                {METHODS.filter((m) => m !== 'credit' || (customer && can('sales.credit'))).map((m) => {
                  const p = payOf(m);
                  return (
                    <div key={m} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-28 text-sm font-bold">{PAY_LABEL[m]}</span>
                        <input type="number" min={0} className="w-full" placeholder="0" value={p?.amount ?? ''} onChange={(e) => setPay(m, Number(e.target.value) || 0)} />
                        <button className="btn-alt" title="Tout le reste" onClick={() => setPay(m, Math.max(0, remaining + (p?.amount ?? 0)))}>=</button>
                      </div>
                      {p && (m === 'mtn_momo' || m === 'airtel_money' || m === 'card' || m === 'cheque' || m === 'transfer') && <input className="w-full" placeholder="Référence de transaction" value={p.reference} onChange={(e) => setPays((ps) => ps.map((x) => (x.method === m ? { ...x, reference: e.target.value } : x)))} />}
                    </div>
                  );
                })}
                <div className={`text-sm font-bold ${remaining === 0 ? 'text-brand' : remaining < 0 ? 'text-red-700' : 'text-orange-700'}`}>{remaining === 0 ? 'Montant réparti ✓' : remaining > 0 ? `Reste à répartir ${fcfa(remaining)}` : `Dépassement ${fcfa(-remaining)}`}</div>
              </div>
            )}

            {cashDue > 0 && (
              <div className="space-y-2 rounded-lg bg-brand-soft p-2">
                <label className="block text-xs font-bold uppercase text-ink-muted">Montant donné par le client{mode !== 'cash' && ` (espèces : ${fcfa(cashDue)})`}</label>
                <input ref={cashIn} type="number" min={0} className="w-full text-2xl font-extrabold" placeholder={String(cashDue)} value={tendered} onChange={(e) => setTendered(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
                <div className="flex flex-wrap gap-1">
                  <button className="btn-alt !py-1 text-xs" onClick={() => setTendered(String(cashDue))}>Compte exact</button>
                  {BILLS.filter((b) => b >= cashDue / 5).slice(0, 5).map((b) => <button key={b} className="btn-alt !py-1 text-xs" onClick={() => setTendered(String((Number(tendered) || 0) + b))}>+{fcfa(b)}</button>)}
                  {tendered && <button className="btn-alt !py-1 text-xs" onClick={() => setTendered('')}>↺</button>}
                </div>
                {change > 0 && <div className="rounded-lg bg-white p-2 text-center"><div className="text-xs font-bold uppercase text-ink-muted">À rendre</div><div className="text-4xl font-extrabold text-brand-orange">{fcfa(change)}</div></div>}
                {short && <div className="text-sm font-bold text-red-700">Il manque {fcfa(cashDue - cashGiven)}</div>}
              </div>
            )}
          </div>}

          <div className="card space-y-2">
            <div className="text-xs font-bold uppercase text-ink-muted">Client <Key k="F4" />{isSeller ? '' : ' (requis pour le crédit)'}</div>
            {customer ? (
              <div className="flex items-center justify-between"><span><b>{customer.name}</b><br /><span className="text-xs text-ink-muted">Dû {fcfa(customer.creditBalance)} / plafond {fcfa(customer.creditLimit)}</span></span><button className="btn-alt" onClick={() => setCustomer(null)}>✕</button></div>
            ) : (
              <>
                <input ref={cust} className="w-full" placeholder="Nom ou téléphone…" value={custQ} onChange={(e) => setCustQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && custResults[0]) { setCustomer(custResults[0]); setCustQ(''); setCustResults([]); search.current?.focus(); } }} />
                {custResults.map((c) => <button key={c.id} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-brand-soft" onClick={() => { setCustomer(c); setCustQ(''); setCustResults([]); }}>{c.name} <span className="text-ink-muted">{c.phone}</span></button>)}
              </>
            )}
          </div>

          {isSeller && <input className="w-full" placeholder="Note pour la caisse (ex. ordonnance Dr X, patient pressé)…" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
          <ErrorBox error={error} />
          <div className="flex gap-2">
            {isSeller
              ? <button className="btn flex-1 !py-3 text-base" disabled={busy || cart.length === 0} onClick={submit}>{busy ? 'Envoi…' : '📤 Envoyer à la caisse (F8)'}</button>
              : <button className="btn flex-1 !py-3 text-base" disabled={busy || cart.length === 0 || remaining < 0} onClick={submit}>{busy ? 'Enregistrement…' : `Encaisser (F8)${remaining > 0 ? ' — reste dû' : ''}`}</button>}
            <button className="btn-alt" onClick={reset}>{ticketId ? 'Décharger' : 'Vider'}</button>
            {isCashier && ticketId && <button className="btn-alt text-red-700" onClick={async () => { const r = prompt('Motif de l’annulation du ticket (ex. client parti)'); if (r === null) return; try { await api(`/tickets/${ticketId}/cancel`, { method: 'POST', json: { reason: r } }); reset(); } catch (e) { setError((e as Error).message); } }}>Annuler le ticket</button>}
          </div>
          {!isSeller && mode !== 'cash' && <p className="text-xs text-ink-muted">Mobile Money : la vente reste « en attente » tant que le paiement n’est pas confirmé.</p>}
        </div>
      </div>
      {showExpense && cash && <ExpenseForm available={cash.expected ?? null} onClose={() => setShowExpense(false)} onDone={() => { setShowExpense(false); loadCash(); }} />}
      {showClose && cash && <CloseCash session={cash} onClose={() => setShowClose(false)} onClosed={() => { setShowClose(false); setCash(null); }} />}
      {done && <Receipt sale={done} onClose={() => setDone(null)} onChange={setDone} />}
      {offer && (
        <OfferGate
          advice={offer}
          declineLabel={isSeller ? 'envoyer à la caisse' : 'poursuivre l’encaissement'}
          onAdd={(pid) => { setOffer(null); api<Product>(`/products/${pid}`).then((p) => add(p)).catch(() => undefined); }}
          onDecline={() => { setDeclinedSig(sig); const n = offerNext.current; offerNext.current = null; setOffer(null); void n?.(); }}
          onBack={() => setOffer(null)}
        />
      )}
      {sent && (
        <Modal title="Ticket envoyé à la caisse" onClose={() => setSent(null)}>
          <div className="space-y-2 text-center">
            <div className="text-5xl">📤</div>
            <div className="text-3xl font-extrabold text-brand">{sent}</div>
            <p className="text-sm text-ink-muted">La caissière voit ce ticket arriver : elle vérifie le contenu et encaisse. Donnez le numéro au client.</p>
            <button className="btn" autoFocus onClick={() => { setSent(null); search.current?.focus(); }}>Nouvelle vente</button>
          </div>
        </Modal>
      )}
      {offlineDone && (
        <Modal title="Vente enregistrée hors ligne" onClose={() => setOfflineDone(null)}>
          <div className="space-y-2 text-sm">
            <p>Total <b>{fcfa(offlineDone.total)}</b>{offlineDone.change > 0 && <> · à rendre <b className="text-brand-orange">{fcfa(offlineDone.change)}</b></>}</p>
            <p className="rounded-lg bg-orange-50 p-2 text-orange-800">Le serveur est injoignable : la vente est gardée sur ce poste et sera envoyée automatiquement dès le retour de la connexion (sans doublon). Le ticket définitif sera disponible dans « Ventes ».</p>
            <button className="btn" onClick={() => setOfflineDone(null)}>Nouvelle vente (Entrée)</button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** File des tickets envoyés par les vendeurs (rafraîchie toutes les 4 secondes). */
function TicketQueue({ activeId, onPick }: { activeId: string | null; onPick: (t: QueueTicket) => void }) {
  const [list, setList] = useState<QueueTicket[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<QueueTicket[]>('/tickets?status=open').then((l) => { setList(l); setErr(null); }).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);
  const age = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? 'à l’instant' : `il y a ${m} min`; };
  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between"><b>🎫 Tickets à encaisser <span className="ml-1 rounded-full bg-brand px-2 py-0.5 text-xs text-white">{list.length}</span></b><span className="text-xs text-ink-muted">mise à jour automatique</span></div>
      <ErrorBox error={err} />
      {list.length === 0 && <p className="text-sm text-ink-muted">Aucun ticket en attente. Les ventes saisies par les vendeurs apparaîtront ici.</p>}
      <div className="grid gap-2 md:grid-cols-2">
        {list.map((t) => (
          <button key={t.id} onClick={() => onPick(t)} className={`rounded-xl border-2 p-3 text-left transition hover:shadow ${t.id === activeId ? 'border-brand bg-brand-soft' : 'border-ink-line bg-white'}`}>
            <div className="flex items-center justify-between"><b>{t.number}</b><span className="text-xs text-ink-muted">{age(t.createdAt)}</span></div>
            <div className="text-xs text-ink-muted">Vendeur : {t.sellerName ?? '—'}{t.customer ? ` · Client : ${t.customer.name}` : ''}</div>
            <div className="mt-1 line-clamp-2 text-sm">{t.lines.map((l) => `${l.quantity} × ${l.name}`).join(' · ')}</div>
            {t.note && <div className="text-xs italic text-ink-muted">« {t.note} »</div>}
            <div className="mt-1 text-right text-lg font-extrabold text-brand">{fcfa(t.total)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PrescriptionForm({ saleId }: { saleId: string }) {
  const [f, setF] = useState({ patientName: '', prescriber: '', facility: '', prescribedAt: new Date().toISOString().slice(0, 10) });
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (saved) return <div className="no-print rounded-lg bg-brand-soft px-2 py-1 text-sm font-bold text-brand">Ordonnance enregistrée : {saved}</div>;
  return (
    <div className="no-print space-y-1 rounded-lg border border-orange-300 p-2">
      <div className="text-sm font-bold">📋 Ordonnancier (produit sur prescription)</div>
      <div className="grid grid-cols-2 gap-1">
        <input placeholder="Patient" value={f.patientName} onChange={(e) => setF({ ...f, patientName: e.target.value })} />
        <input placeholder="Prescripteur (Dr …)" value={f.prescriber} onChange={(e) => setF({ ...f, prescriber: e.target.value })} />
        <input placeholder="Établissement" value={f.facility} onChange={(e) => setF({ ...f, facility: e.target.value })} />
        <input type="date" value={f.prescribedAt} onChange={(e) => setF({ ...f, prescribedAt: e.target.value })} />
      </div>
      <ErrorBox error={err} />
      <button className="btn !py-1" disabled={!f.patientName || !f.prescriber} onClick={async () => { try { const p = await api<{ number: string }>('/prescriptions', { method: 'POST', json: { saleId, ...f, ...(f.facility ? {} : { facility: undefined }) } }); setSaved(p.number); } catch (e) { setErr((e as Error).message); } }}>Enregistrer l’ordonnance</button>
    </div>
  );
}

function Receipt({ sale, onClose, onChange }: { sale: SaleResult; onClose: () => void; onChange: (s: SaleResult) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [brand, setBrand] = useState<BrandingData | null>(null);
  useEffect(() => { loadBranding().then(setBrand).catch(() => undefined); }, []);
  const creditPay = sale.payments.some((p) => p.method === 'credit' && p.status !== 'failed');
  const cashier = getSession()?.user.fullName;
  // Bon de pharmacie : imprimé automatiquement (N exemplaires) dès qu'une vente à crédit est enregistrée.
  const autoDone = useRef(false);
  useEffect(() => { if (brand && creditPay && brand.branding.voucher.autoPrint && sale.status !== 'void' && !autoDone.current) { autoDone.current = true; printVoucher(sale, brand, cashier); } }, [brand, creditPay]); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(path: string) {
    try { onChange({ ...(await api<SaleResult>(path, { method: 'POST', json: {} })), warnings: sale.warnings }); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title={`Vente ${sale.number}`} onClose={onClose}>
      <div id="ticket" className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          {sale.status === 'completed' ? <Badge>Payée</Badge> : sale.status === 'void' ? <Badge tone="bad">Annulée</Badge> : <Badge tone="warn">En attente de paiement — ne rien remettre</Badge>}
          <span className="text-ink-muted">{dateTimeFr(sale.createdAt)}</span>
        </div>
        <table className="w-full"><tbody>
          {sale.items.map((it, i) => <tr key={i}><td>{it.quantity} × {it.product.name}{it.lot && <span className="text-xs text-ink-muted"> (lot {it.lot.lotNumber})</span>}</td><td className="text-right">{fcfa(it.lineTotal)}</td></tr>)}
          <tr><td className="font-extrabold">Total</td><td className="text-right font-extrabold">{fcfa(sale.total)}</td></tr>
        </tbody></table>
        {sale.payments.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1">
            <span>{PAY_LABEL[p.method]} {fcfa(p.amount)} {p.reference && <span className="text-xs text-ink-muted">· {p.reference}</span>}</span>
            {p.status === 'pending_confirmation' ? (
              <span className="no-print flex gap-1"><button className="btn !py-1" onClick={() => act(`/payments/${p.id}/confirm`)}>Confirmer reçu</button><button className="btn-alt !py-1" onClick={() => act(`/payments/${p.id}/fail`)}>Échec</button></span>
            ) : <Badge tone={p.status === 'confirmed' ? 'ok' : 'bad'}>{p.status === 'confirmed' ? 'confirmé' : p.status}</Badge>}
          </div>
        ))}
        {sale.warnings.map((w, i) => <div key={i} className="rounded-lg bg-orange-50 px-2 py-1 font-semibold text-orange-800">⚠ {w}</div>)}
        {sale.needsPrescription && <PrescriptionForm saleId={sale.id} />}
      </div>
      <ErrorBox error={err} />
      <div className="no-print mt-3 flex flex-wrap gap-2">
        <button className="btn" onClick={() => (brand ? printReceipt(sale, brand, cashier) : window.print())}>🖨 Imprimer le ticket</button>
        {creditPay && brand && <button className="btn-alt" onClick={() => printVoucher(sale, brand, cashier)}>🖨 Bon de pharmacie ({brand.branding.voucher.copies} ex.)</button>}
        <button className="btn-alt" onClick={onClose}>Nouvelle vente</button>
      </div>
    </Modal>
  );
}
