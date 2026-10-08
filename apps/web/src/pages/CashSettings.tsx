import { useEffect, useState } from 'react';
import { api, can } from '../lib/api';
import { useShift } from '../components/CashDesk';
import { dateTimeFr, fcfa } from '../lib/format';
import { Badge, ErrorBox, Field, PageTitle, useLoad } from '../components/ui';

interface Shift { number: number; start: string; end: string }
interface CashRegisters { guardActive: boolean; ordinary: Shift[]; guard: Shift[] }
interface ReserveMove { id: string; type: string; amount: number; toRegister: string | null; note: string | null; createdBy: string | null; createdAt: string }
interface Variance { id: string; kind: 'deficit' | 'surplus'; amount: number; status: string; note: string | null; cashierName: string | null; createdAt: string; session: { number: string; register: string } }
const MOVE_LABEL: Record<string, string> = { opening: 'Fonds initial', deposit: 'Alimentation', transfer_out: 'Vers une caisse', bank_deposit: 'Dépôt en banque' };
const STATUS_LABEL: Record<string, string> = { open: 'À traiter', justified: 'Justifié', reimbursed: 'Remboursé', banked: 'Envoyé en banque' };

/** Paramétrage des caisses : horaires en semaine ordinaire et en semaine de garde, et bascule du mode garde. */
export default function CashSettings() {
  const admin = can('company.manage');
  const { data, setData } = useLoad(() => api<{ cashRegisters: CashRegisters }>('/company/settings'));
  const shift = useShift();
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [ordinary, setOrdinary] = useState<Shift[]>([]);
  const [guard, setGuard] = useState<Shift[]>([]);
  useEffect(() => { if (data) { setOrdinary(data.cashRegisters.ordinary); setGuard(data.cashRegisters.guard); } }, [data]);
  if (!data) return null;
  const cfg = data.cashRegisters;
  const save = async (next: Partial<CashRegisters>) => {
    setErr(null); setSaved(false);
    try { setData(await api<{ cashRegisters: CashRegisters }>('/company/settings', { method: 'PUT', json: { cashRegisters: { ...cfg, ...next } } })); setSaved(true); } catch (e) { setErr((e as Error).message); }
  };
  const Table = ({ title, hint, list, onChange }: { title: string; hint: string; list: Shift[]; onChange: (l: Shift[]) => void }) => (
    <div className="card space-y-2">
      <h3 className="font-extrabold">{title}</h3>
      <p className="text-xs text-ink-muted">{hint}</p>
      <table className="w-full text-sm">
        <thead><tr><th>Caisse n°</th><th>Début</th><th>Fin</th><th /></tr></thead>
        <tbody>
          {list.map((s, i) => (
            <tr key={i}>
              <td><input type="number" min={1} max={9} disabled={!admin} className="w-20" value={s.number} onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, number: Math.max(1, Number(e.target.value) || 1) } : x)))} /></td>
              <td><input type="time" disabled={!admin} value={s.start} onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} /></td>
              <td><input type="time" disabled={!admin} value={s.end} onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} /></td>
              <td>{admin && <button className="text-red-700" title="Retirer" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {admin && <button className="btn-alt" onClick={() => onChange([...list, { number: list.length + 1, start: '08:00', end: '18:00' }])}>+ Ajouter une caisse</button>}
      {admin && <button className="btn-alt ml-2" onClick={() => save(title.includes('ordinaire') ? { ordinary: list } : { guard: list })}>Enregistrer</button>}
    </div>
  );
  return (
    <>
      <PageTitle title="Caisses" sub="Horaires des postes de caisse ; détection automatique de la caisse en service d’après l’heure de connexion" />
      <div className="card mb-3">
        {shift?.active ? (
          <p className="text-sm">Actuellement en service : <b className="text-brand">{shift.register}</b> ({shift.start}–{shift.end}){shift.guardActive ? ' · semaine de garde' : ''}.</p>
        ) : (
          <p className="text-sm text-ink-muted">Aucun créneau ne couvre l’heure actuelle d’après les horaires ci-dessous.</p>
        )}
        {admin && (
          <label className="mt-2 flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked={cfg.guardActive} onChange={(e) => save({ guardActive: e.target.checked })} />
            Mode garde actif (3 caisses, dont le poste de nuit) — à activer au début de la garde, à désactiver à la fin
          </label>
        )}
      </div>
      <ErrorBox error={err} />{saved && <p className="mb-2 text-xs font-bold text-brand">Enregistré ✓</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Table title="Semaine ordinaire (2 caisses)" hint="Ex. caisse 1 de 8h à 13h30, caisse 2 de 13h30 à 19h." list={ordinary} onChange={setOrdinary} />
        <Table title="Semaine de garde (3 caisses)" hint="Le 3ᵉ poste (nuit) peut traverser minuit, ex. 19h à 8h le lendemain." list={guard} onChange={setGuard} />
      </div>
      <p className="mt-3 text-xs text-ink-muted">Quand une caissière ouvre sa caisse pendant un de ces créneaux, le numéro de caisse est proposé automatiquement. 30 minutes avant la fin de son créneau, puis toutes les 10 minutes, un rappel lui demande de préparer la passation.</p>
      {can('reports.read') && <ReserveFund />}
      {can('reports.read') && <VarianceRegister />}
    </>
  );
}

/** Fonds de roulement : tresorerie de reserve qui approvisionne les caisses a sec. Reserve au manager : la caissiere ne le voit pas. */
function ReserveFund() {
  const { data, setData, error } = useLoad(() => api<{ balance: number; moves: ReserveMove[] }>('/cash/reserve'));
  const [f, setF] = useState({ type: 'deposit', amount: '', toRegister: 'Caisse 1', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setErr(null);
    try { setData(await api('/cash/reserve/moves', { method: 'POST', json: { type: f.type, amount: Number(f.amount), toRegister: f.type === 'transfer_out' ? f.toRegister : undefined, note: f.note || undefined } })); setF({ ...f, amount: '', note: '' }); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="card mt-4 space-y-3">
      <h3 className="font-extrabold">💰 Fonds de roulement</h3>
      <p className="text-xs text-ink-muted">Trésorerie de réserve pour la monnaie : elle n’alimente pas directement les ventes, elle sert à réapprovisionner graduellement une caisse quand la monnaie s’y tarit.</p>
      <ErrorBox error={error ?? err} />
      <div className="rounded-xl bg-gradient-to-r from-brand to-emerald-700 p-3 text-center text-white"><div className="text-xs uppercase opacity-80">Solde actuel</div><div className="text-3xl font-extrabold">{data ? fcfa(data.balance) : '—'}</div></div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Mouvement"><select className="w-full" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="deposit">Alimentation (banque/coffre → fonds)</option>
          <option value="transfer_out">Vers une caisse à sec</option>
          <option value="bank_deposit">Dépôt en banque (retrait du fonds)</option>
          <option value="opening">Fonds initial</option>
        </select></Field>
        <Field label="Montant (FCFA)"><input type="number" min={1} className="w-full" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        {f.type === 'transfer_out' && <Field label="Caisse approvisionnée"><select className="w-full" value={f.toRegister} onChange={(e) => setF({ ...f, toRegister: e.target.value })}>{['Caisse 1', 'Caisse 2', 'Caisse 3'].map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>}
        <Field label="Note (facultatif)"><input className="w-full" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <button className="btn" disabled={busy || !Number(f.amount)} onClick={submit}>Enregistrer le mouvement</button>
      <table className="w-full text-sm">
        <thead><tr><th>Date</th><th>Mouvement</th><th>Caisse</th><th className="text-right">Montant</th><th>Par</th><th>Note</th></tr></thead>
        <tbody>{data?.moves.map((m) => <tr key={m.id}><td className="whitespace-nowrap">{dateTimeFr(m.createdAt)}</td><td>{MOVE_LABEL[m.type] ?? m.type}</td><td>{m.toRegister ?? '—'}</td><td className={`text-right font-bold ${m.type === 'transfer_out' || m.type === 'bank_deposit' ? 'text-red-700' : 'text-brand'}`}>{m.type === 'transfer_out' || m.type === 'bank_deposit' ? '−' : '+'}{fcfa(m.amount)}</td><td>{m.createdBy}</td><td className="text-xs text-ink-muted">{m.note}</td></tr>)}</tbody>
      </table>
      {data?.moves.length === 0 && <p className="text-sm text-ink-muted">Aucun mouvement encore.</p>}
    </div>
  );
}

/** Registre des écarts de caisse (déficit/excédent) : justification, remboursement, ou dépôt en banque pour les excédents. */
function VarianceRegister() {
  const [status, setStatus] = useState('open');
  const { data, reload, error } = useLoad(() => api<Variance[]>(`/cash/variances${status ? `?status=${status}` : ''}`), [status]);
  const [err, setErr] = useState<string | null>(null);
  async function resolve(id: string, s: string) {
    setErr(null);
    const note = s !== 'open' ? window.prompt('Note (facultatif)') ?? undefined : undefined;
    try { await api(`/cash/variances/${id}/resolve`, { method: 'POST', json: { status: s, note } }); reload(); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="card mt-4 space-y-3">
      <h3 className="font-extrabold">⚖️ Écarts de caisse (déficits et excédents)</h3>
      <p className="text-xs text-ink-muted">Un déficit avertit la caissière par message interne : elle doit le justifier ou le rembourser. Les excédents sont à déposer en banque, une fois par mois.</p>
      <div className="flex gap-2">{[['open', 'À traiter'], ['justified', 'Justifiés'], ['reimbursed', 'Remboursés'], ['banked', 'En banque'], ['', 'Tous']].map(([k, l]) => <button key={k} className={status === k ? 'btn' : 'btn-alt'} onClick={() => setStatus(k)}>{l}</button>)}</div>
      <ErrorBox error={error ?? err} />
      <table className="w-full text-sm">
        <thead><tr><th>Date</th><th>Caissière</th><th>Caisse</th><th>Nature</th><th className="text-right">Montant</th><th>Statut</th><th /></tr></thead>
        <tbody>{data?.map((v) => (
          <tr key={v.id}>
            <td className="whitespace-nowrap">{dateTimeFr(v.createdAt)}</td><td>{v.cashierName}</td><td>{v.session.register} · {v.session.number}</td>
            <td><Badge tone={v.kind === 'deficit' ? 'bad' : 'info'}>{v.kind === 'deficit' ? 'Déficit' : 'Excédent'}</Badge></td>
            <td className="text-right font-bold">{fcfa(v.amount)}</td>
            <td>{STATUS_LABEL[v.status] ?? v.status}</td>
            <td className="space-x-1 whitespace-nowrap">{v.status === 'open' && <>
              <button className="btn-alt !py-0.5 text-xs" onClick={() => resolve(v.id, 'justified')}>Justifié</button>
              <button className="btn-alt !py-0.5 text-xs" onClick={() => resolve(v.id, 'reimbursed')}>Remboursé</button>
              {v.kind === 'surplus' && <button className="btn-alt !py-0.5 text-xs" onClick={() => resolve(v.id, 'banked')}>En banque</button>}
            </>}</td>
          </tr>
        ))}</tbody>
      </table>
      {data?.length === 0 && <p className="text-sm text-ink-muted">Aucun écart dans cette catégorie.</p>}
    </div>
  );
}
