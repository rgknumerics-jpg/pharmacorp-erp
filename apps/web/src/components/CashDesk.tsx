import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { dateTimeFr, fcfa, PAY_LABEL } from '../lib/format';
import { ErrorBox, Modal } from './ui';
import { printCashVoucher } from '../lib/printDocs';

/* eslint-disable @typescript-eslint/no-explicit-any */
// cashIn, refunds, expected, byMethod et diff sont absents quand l'administrateur masque la recette à la caissière (comptage à l'aveugle).
export interface CashSession { id: string; number: string; register: string; openedAt: string; openingFloat: number; cashIn?: number; refunds?: number; expensesTotal: number; expected?: number; byMethod?: Record<string, number>; expenses: any[]; status: string }
type Meta = { denominations: number[]; categories: Record<string, { label: string; account: string; group?: string }> };
const BILL_COLOR: Record<number, string> = { 10000: 'from-violet-500 to-violet-700', 5000: 'from-emerald-500 to-emerald-700', 2000: 'from-sky-500 to-sky-700', 1000: 'from-amber-500 to-amber-700', 500: 'from-rose-500 to-rose-700' };

let metaCache: Meta | null = null;
function useMeta() {
  const [m, setM] = useState<Meta | null>(metaCache);
  useEffect(() => { if (!metaCache) api<Meta>('/cash/meta').then((x) => { metaCache = x; setM(x); }).catch(() => undefined); }, []);
  return m;
}

export interface Shift { active: boolean; guardActive: boolean; register: string | null; number?: number; start?: string; end?: string; minutesToClose?: number; reminder: string | null }
/** Caisse en service d'après les horaires paramétrés (Équipe et accès → Caisses), vérifiée toutes les 30 secondes. */
export function useShift() {
  const [s, setS] = useState<Shift | null>(null);
  useEffect(() => {
    const load = () => api<Shift>('/cash/shift/current').then(setS).catch(() => undefined);
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);
  return s;
}

/** Rappel de passation de caisse : 30 minutes avant la clôture du poste, puis toutes les 10 minutes. Se réaffiche à chaque palier même si masqué. */
export function ShiftReminder({ shift }: { shift: Shift | null }) {
  const bucket = shift?.minutesToClose !== undefined ? Math.ceil(shift.minutesToClose / 10) : null;
  const [dismissed, setDismissed] = useState<number | null>(null);
  if (!shift?.reminder || bucket === null || dismissed === bucket) return null;
  return (
    <div key={bucket} className="no-print mb-2 flex items-center gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900 shadow animate-[pulse_1s_ease-in-out_2]">
      <span className="text-xl">⏰</span><span>{shift.reminder}</span>
      <button className="ml-auto rounded-full bg-amber-200 px-2 py-0.5 text-xs" onClick={() => setDismissed(bucket)}>✕ Masquer</button>
    </div>
  );
}

/** Comptage billet par billet avec gros boutons + / − (ouverture et cloture). */
function CountGrid({ detail, setDetail }: { detail: Record<string, number>; setDetail: (d: Record<string, number>) => void }) {
  const meta = useMeta();
  const total = Object.entries(detail).reduce((s, [k, n]) => s + Number(k) * n, 0);
  const add = (k: number, d: number) => setDetail({ ...detail, [k]: Math.max(0, (detail[k] ?? 0) + d) });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {meta?.denominations.map((k) => {
          const n = detail[k] ?? 0, bill = k >= 500;
          return (
            <div key={k} className={`rounded-xl p-2 text-center transition-all ${n ? 'scale-[1.03] shadow-lg' : ''} ${bill ? `bg-gradient-to-br text-white ${BILL_COLOR[k]}` : 'bg-gradient-to-br from-slate-200 to-slate-300'}`}>
              <div className="text-sm font-extrabold">{bill ? '💵' : '🪙'} {k.toLocaleString('fr-FR')}</div>
              <div className="my-1 flex items-center justify-center gap-1">
                <button type="button" className="h-8 w-8 rounded-full bg-black/20 text-lg font-bold active:scale-90" onClick={() => add(k, -1)}>−</button>
                <input type="number" min={0} className="w-14 rounded-lg border-0 bg-white/90 text-center font-bold text-ink" value={n || ''} placeholder="0" onChange={(e) => setDetail({ ...detail, [k]: Math.max(0, Number(e.target.value) || 0) })} />
                <button type="button" className="h-8 w-8 rounded-full bg-black/20 text-lg font-bold active:scale-90" onClick={() => add(k, 1)}>+</button>
              </div>
              <div className="text-xs opacity-90">{n ? fcfa(n * k) : '—'}</div>
            </div>
          );
        })}
      </div>
      <div className="rounded-xl bg-gradient-to-r from-brand to-emerald-700 p-3 text-center text-white"><div className="text-xs uppercase opacity-80">Total compté</div><div key={total} className="animate-[pulse_0.4s_ease-out_1] text-4xl font-extrabold">{fcfa(total)}</div></div>
    </div>
  );
}

/** Recettes par mode de paiement (espèces, mobile money, chèque, virement, carte…) : visibles seulement si l'administrateur l'autorise. */
function ByMethod({ m }: { m?: Record<string, number> }) {
  const rows = Object.entries(m ?? {});
  if (!rows.length) return null;
  return (
    <div className="rounded-xl bg-slate-50 p-2 text-sm">
      <div className="mb-1 text-xs font-extrabold uppercase text-ink-muted">Encaissé par mode de paiement</div>
      {rows.map(([k, v]) => <div key={k} className="flex justify-between"><span>{PAY_LABEL[k] ?? k}</span><b>{fcfa(v)}</b></div>)}
    </div>
  );
}

/** Ouverture : la caissiere declare le fond de caisse qu'elle trouve dans le tiroir. */
export function OpenCash({ onOpened }: { onOpened: (s: CashSession) => void }) {
  const [detail, setDetail] = useState<Record<string, number>>({});
  const shift = useShift();
  const [register, setRegister] = useState(() => localStorage.getItem('erp.register') ?? 'Caisse 1');
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched && shift?.register) setRegister(shift.register); }, [shift?.register, touched]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true); setErr(null);
    try { localStorage.setItem('erp.register', register); onOpened(await api<CashSession>('/cash/sessions/open', { method: 'POST', json: { register, detail } })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-4xl animate-[fadeIn_.3s_ease-out] space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-600 via-brand to-teal-700 p-6 text-white shadow-xl">
        <div className="text-3xl">☀️ Ouverture de caisse</div>
        <p className="mt-1 opacity-90">Comptez les billets et pièces que vous trouvez dans le tiroir : c’est votre fond de caisse de départ.</p>
        {shift?.register && !touched && <p className="mt-1 text-sm font-bold">D’après l’horaire en cours ({shift.start}–{shift.end}{shift.guardActive ? ', semaine de garde' : ''}) : <b>{shift.register}</b>.</p>}
        <div className="mt-3 flex flex-wrap gap-2">{['Caisse 1', 'Caisse 2', 'Caisse 3'].map((r) => <button key={r} onClick={() => { setRegister(r); setTouched(true); }} className={`rounded-full px-4 py-1.5 font-bold transition ${register === r ? 'bg-white text-brand' : 'bg-white/20 hover:bg-white/30'}`}>{r}</button>)}</div>
      </div>
      <div className="card"><CountGrid detail={detail} setDetail={setDetail} /></div>
      <ErrorBox error={err} />
      <button className="btn w-full !py-4 text-lg transition hover:scale-[1.01]" disabled={busy} onClick={open}>{busy ? 'Ouverture…' : '🔓 Ouvrir la caisse'}</button>
    </div>
  );
}

export function CloseCash({ session, onClose, onClosed }: { session: CashSession; onClose: () => void; onClosed: (r: any) => void }) {
  const [detail, setDetail] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const counted = Object.entries(detail).reduce((s, [k, n]) => s + Number(k) * (n as number), 0);
  async function close() {
    if (!confirm('Clôturer la caisse ? Plus aucune vente ne pourra y être enregistrée.')) return;
    try { const r = await api<any>(`/cash/sessions/${session.id}/close`, { method: 'POST', json: { detail, note: note || undefined } }); setResult(r); } catch (e) { setErr((e as Error).message); }
  }
  if (result) return (
    <Modal title={`Caisse ${result.number} clôturée`} onClose={() => onClosed(result)}>
      <div id="ticket" className="space-y-1 text-sm">
        {[['Fond de caisse', result.openingFloat], ['Encaissements espèces', result.cashIn], ['Remboursements', result.refunds === undefined ? undefined : -result.refunds], ['Dépenses de caisse', -result.expensesTotal], ['Attendu', result.expected], ['Compté', result.countedCash]].filter(([, v]) => v !== undefined).map(([l, v]) => <div key={l as string} className="flex justify-between"><span>{l}</span><b>{fcfa(v as number)}</b></div>)}
        <ByMethod m={result.byMethod} />
        <div className="mt-1 flex justify-between border-t border-ink-line pt-1"><span>Recette déclarée (compté − fond)</span><b>{fcfa(Math.max(0, (result.countedCash ?? 0) - (result.openingFloat ?? 0)))}</b></div>
        {result.diff === undefined ? <div className="mt-2 rounded-xl bg-brand-soft p-3 text-center font-bold text-brand">✓ Clôture enregistrée. Le contrôle est effectué par la direction.</div> : <div className={`mt-2 rounded-xl p-3 text-center text-2xl font-extrabold ${result.diff === 0 ? 'bg-brand-soft text-brand' : 'bg-red-50 text-red-700'}`}>{result.diff === 0 ? '✓ Caisse juste' : `Écart ${result.diff > 0 ? '+' : ''}${fcfa(result.diff)}`}</div>}
      </div>
      <div className="no-print mt-3 flex gap-2"><button className="btn" onClick={() => window.print()}>🖨 Imprimer</button><button className="btn-alt" onClick={() => onClosed(result)}>Terminer</button></div>
    </Modal>
  );
  return (
    <Modal title="🌙 Clôture de caisse" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          {[['Fond de départ', session.openingFloat], ['Espèces encaissées', session.cashIn], ['Dépenses', session.expensesTotal], ['Attendu en caisse', session.expected]].filter(([, v]) => v !== undefined).map(([l, v]) => <div key={l} className="rounded-xl bg-slate-50 p-2"><div className="text-xs text-ink-muted">{l}</div><b>{fcfa(v as number)}</b></div>)}
        </div>
        <ByMethod m={session.byMethod} />
        <p className="text-sm font-semibold">Comptez maintenant le contenu du tiroir{session.expected === undefined ? ' (sans connaître le montant attendu)' : ''} :</p>
        <CountGrid detail={detail} setDetail={setDetail} />
        <div className="grid gap-2 rounded-xl bg-amber-50 p-3 text-sm sm:grid-cols-3">
          <div><div className="text-xs text-ink-muted">Fond de départ à remettre dans le tiroir</div><b>{fcfa(session.openingFloat)}</b></div>
          <div><div className="text-xs text-ink-muted">Total compté</div><b>{fcfa(counted)}</b></div>
          <div><div className="text-xs text-ink-muted">Recette à déclarer (compté − fond)</div><b className="text-lg text-brand">{fcfa(Math.max(0, counted - session.openingFloat))}</b></div>
        </div>
        <p className="text-xs text-ink-muted">Retirez votre fond de départ : tout ce qui reste est votre <b>recette déclarée</b>. La direction la rapproche ensuite de la recette réelle.</p>
        <input className="w-full" placeholder="Observation (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} />
        <ErrorBox error={err} />
        <button className="btn w-full !py-3" onClick={close}>🔒 Clôturer la caisse</button>
      </div>
    </Modal>
  );
}

/** Depense payee en especes : la piece de caisse est generee aussitot, signee par la caissiere. */
export function ExpenseForm({ available, onClose, onDone }: { available: number | null; onClose: () => void; onDone: () => void }) {
  const meta = useMeta();
  const [f, setF] = useState({ category: 'transport', amount: '', label: '', beneficiary: '' });
  const [err, setErr] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<any>(null);
  async function save() {
    try { setVoucher(await api<any>('/cash/expenses', { method: 'POST', json: { ...f, amount: Number(f.amount) } })); } catch (e) { setErr((e as Error).message); }
  }
  if (voucher) return <Voucher v={voucher} onClose={() => { onDone(); }} />;
  return (
    <Modal title="💸 Dépense de caisse" onClose={onClose}>
      <div className="space-y-3">
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {meta && [...new Set(Object.values(meta.categories).map((c) => c.group ?? 'Autres'))].map((g) => (
            <div key={g}>
              <div className="mb-1 text-[11px] font-extrabold uppercase text-ink-muted">{g}</div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(meta.categories).filter(([, c]) => (c.group ?? 'Autres') === g).map(([k, c]) => <button type="button" key={k} onClick={() => setF({ ...f, category: k })} className={`rounded-xl px-2 py-2 text-left text-xs font-bold transition ${f.category === k ? 'bg-brand text-white shadow' : 'bg-slate-100 hover:bg-slate-200'}`}>{c.label}</button>)}
              </div>
            </div>
          ))}
        </div>
        <input type="number" min={1} className="w-full text-2xl font-extrabold" placeholder="Montant (FCFA)" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        {available !== null && <p className="text-xs text-ink-muted">Disponible en caisse : {fcfa(available)}</p>}
        <input className="w-full" placeholder="Nature précise de la dépense (obligatoire)" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        <input className="w-full" placeholder="Bénéficiaire (qui reçoit l’argent)" value={f.beneficiary} onChange={(e) => setF({ ...f, beneficiary: e.target.value })} />
        <ErrorBox error={err} />
        <button className="btn w-full" disabled={!f.label.trim() || !Number(f.amount)} onClick={save}>Valider et imprimer la pièce de caisse</button>
      </div>
    </Modal>
  );
}

export function Voucher({ v, onClose }: { v: any; onClose: () => void }) {
  return (
    <Modal title={`Pièce de caisse ${v.number}`} onClose={onClose}>
      <div id="ticket" className="space-y-2 text-sm">
        <div className="flex justify-between border-b-2 border-ink pb-1"><b>{v.establishment}</b><span className="font-extrabold">PIÈCE DE CAISSE N° {v.number}</span></div>
        <div className="flex justify-between"><span>Date : {dateTimeFr(v.createdAt)}</span><span>{v.session?.register} · {v.session?.number}</span></div>
        <div>Nature : <b>{v.categoryLabel}</b> — {v.label}</div>
        {v.beneficiary && <div>Bénéficiaire : <b>{v.beneficiary}</b></div>}
        <div className="rounded-lg bg-slate-50 p-2 text-center"><div className="text-2xl font-extrabold">{fcfa(v.amount)}</div><div className="text-xs italic">{v.amountInWords}</div></div>
        <div className="grid grid-cols-2 gap-4 pt-2 text-xs">
          <div><div className="font-bold">Caissier(ère) : {v.agent}</div>{v.agentSignature ? <img src={v.agentSignature} alt="signature" className="h-16" /> : <div className="h-16 text-ink-muted">(signature non enregistrée)</div>}</div>
          <div><div className="font-bold">Reçu par (signature) :</div><div className="mt-1 h-16 border-b border-dashed border-ink" /></div>
        </div>
      </div>
      <div className="no-print mt-3 flex gap-2"><button className="btn" onClick={() => printCashVoucher(v, 2)}>🖨 Imprimer la pièce de caisse (2 exemplaires)</button><button className="btn-alt" onClick={onClose}>Fermer</button></div>
    </Modal>
  );
}
