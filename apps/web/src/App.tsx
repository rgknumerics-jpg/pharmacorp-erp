import { FormEvent, WheelEvent, useEffect, useRef, useState, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Compass, CreditCard, Pill, ShoppingCart, TrendingUp, BookOpen, ShieldCheck,
  Gauge, Lightbulb, Leaf, Receipt, Clock, Package, Truck, Smartphone, MessageCircle,
  Camera, Users, Calculator, CalendarDays, Wallet, GraduationCap, Lock, Download,
  HardDrive, UsersRound, BookUser, Building2, Library as LibraryIcon, CalendarClock,
} from 'lucide-react';
import { can, getSession, login, logout, Session, setOnExpire, api, switchOperator, restoreBaseSession } from './lib/api';
import { alertStaff } from './lib/alert';
import Accounting from './pages/Accounting';
import Advisor from './pages/Advisor';
import Audit from './pages/Audit';
import Backups from './pages/Backups';
import Migration from './pages/Migration';
import Team from './pages/Team';
import Directory from './pages/Directory';
import Suppliers from './pages/Suppliers';
import OnlineOrders from './pages/OnlineOrders';
import Chat from './pages/Chat';
import AdminPanel from './pages/AdminPanel';
import Timeclock from './pages/Timeclock';
import { PinPad } from './components/PinPad';
import Cockpit from './pages/Cockpit';
import Finance from './pages/Finance';
import Purchasing from './pages/Purchasing';
import Training from './pages/Training';
import Company from './pages/Company';
import Library from './pages/Library';
import Payroll from './pages/Payroll';
import Tax from './pages/Tax';
import TaxBanner from './components/TaxBanner';
import Customers from './pages/Customers';
import Pos from './pages/Pos';
import Plants from './pages/Plants';
import Products from './pages/Products';
import Receiving from './pages/Receiving';
import Sales from './pages/Sales';
import Stock from './pages/Stock';
import CashSettings from './pages/CashSettings';

/** Onglets principaux et sous-onglets du menu ; un écran absent d'ici reste accessible sous « Autres ». */
const GROUPS: { key: string; label: string; icon: LucideIcon; items: string[] }[] = [
  { key: 'g-pilot', label: 'Pilotage', icon: Compass, items: ['cockpit', 'advisor', 'chat'] },
  { key: 'g-sales', label: 'Ventes et clients', icon: CreditCard, items: ['sales', 'cashdesk', 'online', 'customers', 'plants'] },
  { key: 'g-stock', label: 'Produits et stock', icon: Pill, items: ['products', 'stock', 'receiving'] },
  { key: 'g-buy', label: 'Achats et fournisseurs', icon: ShoppingCart, items: ['purchasing', 'suppliers'] },
  { key: 'g-money', label: 'Finances et gestion', icon: TrendingUp, items: ['finance', 'accounting', 'tax', 'payroll'] },
  { key: 'g-know', label: 'Savoir et annuaires', icon: BookOpen, items: ['training', 'library', 'directory'] },
  { key: 'g-admin', label: 'Administration', icon: ShieldCheck, items: ['admin', 'company', 'team', 'timeclock', 'audit', 'backups', 'migration'] },
];

const NAV: { key: string; label: string; icon: LucideIcon; perm: string }[] = [
  { key: 'cockpit', label: 'Cockpit', icon: Gauge, perm: 'analytics.read' },
  { key: 'advisor', label: 'Recommandations', icon: Lightbulb, perm: 'advisor.read' },
  { key: 'plants', label: 'Conseil plantes', icon: Leaf, perm: 'plants.read' },
  { key: 'pos', label: 'Caisse', icon: Receipt, perm: 'sales.create' },
  { key: 'sales', label: 'Ventes', icon: CreditCard, perm: 'sales.read' },
  { key: 'cashdesk', label: 'Caisses', icon: Clock, perm: 'sales.create' },
  { key: 'products', label: 'Produits', icon: Pill, perm: 'products.read' },
  { key: 'stock', label: 'Stock', icon: Package, perm: 'stock.read' },
  { key: 'purchasing', label: 'Achats', icon: ShoppingCart, perm: 'purchases.read' },
  { key: 'suppliers', label: 'Fournisseurs', icon: Truck, perm: 'purchases.read' },
  { key: 'online', label: 'Commandes en ligne', icon: Smartphone, perm: 'online.manage' },
  { key: 'chat', label: 'Messagerie', icon: MessageCircle, perm: '' },
  { key: 'timeclock', label: 'Horaires et pointage', icon: CalendarClock, perm: 'users.write' },
  { key: 'admin', label: 'Panneau d’administration', icon: ShieldCheck, perm: 'tenant.manage' },
  { key: 'receiving', label: 'Réception / OCR', icon: Camera, perm: 'ocr.use' },
  { key: 'customers', label: 'Clients', icon: Users, perm: 'customers.read' },
  { key: 'finance', label: 'Finances', icon: TrendingUp, perm: 'finance.read' },
  { key: 'accounting', label: 'Comptabilité', icon: Calculator, perm: 'accounting.read' },
  { key: 'tax', label: 'Calendrier fiscal', icon: CalendarDays, perm: 'tax.read' },
  { key: 'payroll', label: 'Paie', icon: Wallet, perm: 'payroll.read' },
  { key: 'training', label: 'Formation', icon: GraduationCap, perm: 'training.use' },
  { key: 'audit', label: 'Journal d’audit', icon: Lock, perm: 'audit.read' },
  { key: 'migration', label: 'Reprise des données', icon: Download, perm: 'migration.run' },
  { key: 'backups', label: 'Sauvegardes', icon: HardDrive, perm: 'backup.manage' },
  { key: 'team', label: 'Équipe et accès', icon: UsersRound, perm: 'users.read' },
  { key: 'directory', label: 'Annuaires santé', icon: BookUser, perm: 'directory.read' },
  { key: 'company', label: 'Ma structure', icon: Building2, perm: 'company.view' },
  { key: 'library', label: 'Bibliothèque', icon: LibraryIcon, perm: 'library.read' },
];

/** Écran d'arrivée : la caisse pour un vendeur, sinon le premier onglet autorisé. */
function landing(perms: string[]): string {
  if ((perms.includes('sales.create') || perms.includes('sales.ticket')) && !perms.includes('analytics.read') && !perms.includes('reports.read')) return 'pos';
  return NAV.find((n) => n.perm && perms.includes(n.perm))?.key ?? (perms.includes('sales.ticket') ? 'pos' : 'cockpit');
}

export default function App() {
  const mainRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<Session | null>(getSession());
  // Un vendeur (qui peut encaisser sans piloter) arrive directement sur la caisse.
  const first = landing(session?.permissions ?? []);
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [accessLock, setAccessLock] = useState(false);
  const [gate, setGate] = useState<{ page: string; at: number } | null>(() => { try { return JSON.parse(sessionStorage.getItem('erp.tabgate') ?? 'null'); } catch { return null; } });
  const [chatInfo, setChatInfo] = useState<{ total: number; alert: { id: string; kind: string; body: string } | null }>({ total: 0, alert: null });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState<string>(() => location.hash.slice(1).split('?')[0] || first);

  useEffect(() => { setOnExpire(() => setSession(null)); }, []);
  // fonctions visibles (réglées dans le panneau d'administration) et messagerie : pastille de messages non lus
  useEffect(() => {
    if (!session) return;
    const load = () => api<{ modules: Record<string, boolean>; accessLock?: { enabled: boolean } }>('/company/settings').then((s) => { setModules(s.modules ?? {}); setAccessLock(!!s.accessLock?.enabled); }).catch(() => undefined);
    load();
    const h = (e: Event) => { setModules((e as CustomEvent).detail?.modules ?? {}); setAccessLock(!!(e as CustomEvent).detail?.accessLock?.enabled); };
    window.addEventListener('erp:settings', h);
    return () => window.removeEventListener('erp:settings', h);
  }, [session]);
  const pollChat = useCallback(() => { api<typeof chatInfo>('/chat/unread').then(setChatInfo).catch(() => undefined); }, []);
  useEffect(() => { if (!session) return; pollChat(); const id = setInterval(pollChat, 12000); return () => clearInterval(id); }, [session, pollChat]);

  // Nouvelle inscription sur la boutique en ligne : alerte sonore + bannière clignotante côté caisse/équipe.
  const [signupAlert, setSignupAlert] = useState<string[] | null>(null);
  useEffect(() => {
    if (!session || !can('customers.read')) return;
    let since = (() => { try { return sessionStorage.getItem('erp.lastSignupCheck') ?? new Date().toISOString(); } catch { return new Date().toISOString(); } })();
    const poll = () => {
      api<{ name: string; createdAt: string }[]>(`/customers/online-signups?since=${encodeURIComponent(since)}`).then((rows) => {
        if (rows.length) {
          alertStaff('Nouveau client inscrit', rows.map((r) => r.name).join(', '));
          setSignupAlert(rows.map((r) => r.name));
          setTimeout(() => setSignupAlert(null), 20000);
        }
        since = new Date().toISOString();
        try { sessionStorage.setItem('erp.lastSignupCheck', since); } catch { /* ignore */ }
      }).catch(() => undefined);
    };
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, [session]);
  useEffect(() => { const h = () => setPage(location.hash.slice(1).split('?')[0] || first); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, [first]);
  const go = (p: string) => { location.hash = p; setPage(p); };

  if (!session) return <Login onLogged={(s) => { setSession(s); go(landing(s.permissions)); }} />;
  const MODULE_OF: Record<string, string> = { online: 'online', chat: 'chat', plants: 'plants', training: 'training', library: 'library', directory: 'directory', payroll: 'payroll', suppliers: 'suppliers' };
  const items = NAV.filter((n) => (!n.perm || can(n.perm) || (n.key === 'pos' && can('sales.ticket'))) && modules[MODULE_OF[n.key] ?? ''] !== false);
  const current = items.find((n) => n.key === page) ? page : (items[0]?.key ?? 'cockpit');
  // verrouillage des onglets : sauf le titulaire, chacun saisit son code personnel pour ouvrir un onglet (qui fait quoi est journalisé)
  const gateOk = !!(gate && gate.page === current && Date.now() - gate.at < 10 * 60_000);
  // le panneau d'administration est toujours protégé par un code (même pour le titulaire) ; les autres onglets seulement si le verrouillage est activé
  const tabLocked = current === 'admin' ? !gateOk : accessLock && !can('tenant.manage') && current !== 'pos' && !gateOk;
  const openGate = () => { const g = { page: current, at: Date.now() }; setGate(g); try { sessionStorage.setItem('erp.tabgate', JSON.stringify(g)); } catch { /* ignore */ } };
  const byKey = new Map(items.map((n) => [n.key, n]));
  const grouped = GROUPS.map((g) => ({ ...g, list: g.items.map((k) => byKey.get(k)).filter(Boolean) as typeof items })).filter((g) => g.list.length);
  const used = new Set(GROUPS.flatMap((g) => g.items));
  const others = items.filter((n) => !used.has(n.key) && !(n.key === 'pos' && can('sales.create')));

  /** Défilement indépendant : le menu et le contenu ont chacun leur ascenseur ; quand le menu est au bout de sa course, la molette continue sur le contenu. */
  const chain = (e: WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget, main = mainRef.current;
    if (!main || window.innerWidth < 768) return;
    const atEnd = e.deltaY > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    const atStart = e.deltaY < 0 && el.scrollTop <= 0;
    if (atEnd || atStart) main.scrollBy({ top: e.deltaY });
  };

  return (
    <div className="min-h-screen md:grid md:h-screen md:grid-cols-[230px_1fr] md:overflow-hidden">
      <nav className="no-print flex flex-col border-b border-ink-line bg-white p-3 md:h-screen md:overflow-hidden md:border-b-0 md:border-r">
        <div className="mb-2 rounded-xl bg-white p-1"><img src="/logo-erp.png" alt="PHARMACORP ERP — logiciel de gestion" className="h-auto w-full" /></div>
        {can('sales.create') && (
          <button onClick={() => go('pos')} className={`mb-2 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-base font-extrabold text-white shadow ${current === 'pos' ? 'bg-emerald-800' : 'bg-brand hover:bg-emerald-700'}`}><Receipt className="h-5 w-5" /> Lancer la caisse (POS)</button>
        )}
        <div onWheel={chain} className="flex gap-1 overflow-x-auto md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto md:overflow-x-hidden md:overscroll-contain md:pr-1">
          {grouped.map((g) => {
            const hasCurrent = g.list.some((n) => n.key === current);
            const open = openGroups[g.key] ?? hasCurrent;
            return (
              <div key={g.key} className="flex gap-1 md:flex-col">
                <button onClick={() => setOpenGroups({ ...openGroups, [g.key]: !open })} className={`flex items-center justify-between whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-extrabold ${hasCurrent ? 'bg-brand-soft text-brand' : 'hover:bg-slate-50'}`}><span className="flex items-center gap-2"><g.icon className="h-4 w-4 shrink-0" /> {g.label}</span><span className="ml-2 hidden text-xs md:inline">{open ? '▾' : '▸'}</span></button>
                {open && g.list.map((n) => (
                  <button key={n.key} onClick={() => go(n.key)} className={`flex items-center gap-2 whitespace-nowrap rounded-lg py-1.5 pl-7 pr-3 text-left text-sm font-semibold ${current === n.key ? 'bg-emerald-100 text-brand' : 'text-ink-muted hover:bg-slate-50'}`}><n.icon className="h-4 w-4 shrink-0" /> {n.label}{n.key === 'chat' && chatInfo.total > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-xs text-white">{chatInfo.total}</span>}</button>
                ))}
              </div>
            );
          })}
          {others.map((n) => (
            <button key={n.key} onClick={() => go(n.key)} className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-bold ${current === n.key ? 'bg-brand-soft text-brand' : 'hover:bg-slate-50'}`}><n.icon className="h-4 w-4 shrink-0" /> {n.label}</button>
          ))}
        </div>
        <div className="mt-2 hidden border-t border-ink-line pt-3 text-xs text-ink-muted md:block">
          <b className="text-ink">{session.user.fullName}</b><br />{session.tenant.name}<br />
          {accessLock && !can('tenant.manage') && <button className="mr-3 mt-1 font-bold text-brand" onClick={() => { try { sessionStorage.removeItem('erp.tabgate'); } catch { /* ignore */ } setGate(null); if (restoreBaseSession()) { setSession(getSession()); go('cockpit'); } }}>🔒 Verrouiller</button>}<button className="mt-1 font-bold text-red-700" onClick={() => { logout(); setSession(null); }}>Déconnexion</button>
        </div>
      </nav>
      <div ref={mainRef} className="min-w-0 md:h-screen md:overflow-y-auto">
      {signupAlert && (
        <div className="no-print flex animate-pulse items-center gap-3 bg-amber-500 px-4 py-2 text-sm font-extrabold text-white">
          <span>🆕 Nouveau{signupAlert.length > 1 ? 'x' : ''} client{signupAlert.length > 1 ? 's' : ''} inscrit{signupAlert.length > 1 ? 's' : ''} sur la boutique : {signupAlert.join(', ')}</span>
          <button className="ml-auto whitespace-nowrap rounded-full bg-white/20 px-3 py-0.5" onClick={() => go('customers')}>Voir</button>
          <button className="rounded-full bg-white/20 px-3 py-0.5" onClick={() => setSignupAlert(null)}>✕</button>
        </div>
      )}
      {chatInfo.alert && dismissed !== chatInfo.alert.id && (
        <div className={`no-print flex items-start gap-3 px-4 py-2 text-sm font-bold text-white ${chatInfo.alert.kind === 'alerte' ? 'bg-red-600' : 'bg-sky-600'}`}>
          <span>{chatInfo.alert.kind === 'alerte' ? '🚨 Alerte' : 'ℹ️ Information'} : {chatInfo.alert.body.slice(0, 220)}</span>
          <button className="ml-auto whitespace-nowrap rounded-full bg-white/20 px-3 py-0.5" onClick={() => go('chat')}>Ouvrir</button>
          <button className="rounded-full bg-white/20 px-3 py-0.5" onClick={() => setDismissed(chatInfo.alert!.id)}>✕</button>
        </div>
      )}
      <TaxBanner go={go} />
      <main className="mx-auto w-full max-w-[1250px] p-4">
        {tabLocked ? (
          <>
          <PinPad icon="🔒" title={items.find((n) => n.key === current)?.label ?? 'Accès protégé'} subtitle="Saisissez votre code personnel : votre passage est enregistré dans le journal." okLabel="Ouvrir" onSubmit={async (pin) => {
            const s = await api<Session>('/auth/pos-unlock', { method: 'POST', json: { mode: `tab:${current}`, pin } });
            switchOperator(s); setSession(s);
            openGate();
          }} />
          {current === 'admin' && can('tenant.manage') && (
            <p className="mt-3 text-center text-sm text-ink-muted">Pas encore de code personnel ? <button className="font-bold text-brand underline" onClick={async () => {
              const pw = window.prompt('Mot de passe du titulaire (' + session.user.email + ')');
              if (!pw) return;
              try { const s = await login(session.user.email, pw, session.tenant.slug); setSession(s); openGate(); } catch (e) { window.alert((e as Error).message || 'Mot de passe incorrect'); }
            }}>Utiliser mon mot de passe</button></p>
          )}
          </>
        ) : <>
        {current === 'pos' && <Pos />}
        {current === 'plants' && <Plants />}
        {current === 'sales' && <Sales />}
        {current === 'cashdesk' && <CashSettings />}
        {current === 'products' && <Products />}
        {current === 'stock' && <Stock />}
        {current === 'receiving' && <Receiving />}
        {current === 'customers' && <Customers />}
        {current === 'accounting' && <Accounting />}
        {current === 'advisor' && <Advisor go={go} />}
        {current === 'cockpit' && <Cockpit go={go} />}
        {current === 'purchasing' && <Purchasing />}
        {current === 'suppliers' && <Suppliers />}
        {current === 'online' && <OnlineOrders />}
        {current === 'chat' && <Chat onRead={pollChat} />}
        {current === 'admin' && <AdminPanel go={go} />}
        {current === 'finance' && <Finance />}
        {current === 'audit' && <Audit />}
        {current === 'training' && <Training />}
        {current === 'backups' && <Backups />}
        {current === 'migration' && <Migration />}
        {current === 'team' && <Team />}
        {current === 'directory' && <Directory />}
        {current === 'tax' && <Tax />}
        {current === 'payroll' && <Payroll />}
        {current === 'company' && <Company />}
        {current === 'library' && <Library />}
        {current === 'timeclock' && <Timeclock />}
        </>}
        {items.length === 0 && <p className="card">Votre rôle ne donne accès à aucun écran. Contactez l’administrateur.</p>}
      </main>
      </div>
    </div>
  );
}

function Login({ onLogged }: { onLogged: (s: Session) => void }) {
  const [tenant, setTenant] = useState(() => localStorage.getItem('erp.tenant') ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const s = await login(email, password, tenant.trim()); localStorage.setItem('erp.tenant', tenant.trim()); onLogged(s); } catch (er) { setError((er as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3">
        <img src="/logo-erp.png" alt="PHARMACORP ERP" className="mx-auto w-full max-w-[280px]" />
        <div><label className="f">Pharmacie / entreprise (identifiant)</label><input className="w-full" value={tenant} onChange={(e) => setTenant(e.target.value)} required /></div>
        <div><label className="f">E-mail</label><input type="email" className="w-full" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></div>
        <div><label className="f">Mot de passe</label><input type="password" className="w-full" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></div>
        {error && <p className="text-sm font-bold text-red-700">{error}</p>}
        <button className="btn w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    </div>
  );
}