import { FormEvent, useState } from 'react';
import { printPayslips } from '../lib/printDocs';
import { api, can, getSession } from '../lib/api';
import { fcfa } from '../lib/format';
import { Badge, ErrorBox, Field, Modal, PageTitle, useLoad } from '../components/ui';

interface Item { label: string; amount: number; kind?: string }
interface Employee {
  id: string; fullName: string; jobTitle?: string | null; category?: string | null; cnssNumber?: string | null; matricule?: string | null; familySituation?: string | null;
  baseSalary: number; seniorityRate: number; taxParts: number; fixedEarnings: Item[]; fixedAllowances: Item[]; isActive: boolean;
}
interface Detail {
  gross: number; net: number; employerCost: number; netToPay?: number; dueTotal?: number; allowancesTotal?: number; deductionsTotal?: number;
  lines?: { baseSalary: number; seniorityRate: number; seniority: number; earnings: Item[]; afterSocial: number; taxBaseMonthly: number };
  allowances?: Item[]; deductions?: Item[];
  employee: { cnss: number; camu: number; its: number; tol: number; total: number }; employer: { cnss: number; camu: number; tusTax: number; tusSocial: number; total: number }; bases: { parts: number };
}
interface Slip { id: string; gross: number; bonuses: number; net: number; detail: Detail; employee: { fullName: string; jobTitle?: string | null; cnssNumber?: string | null; matricule?: string | null; category?: string | null; familySituation?: string | null } }
interface Run { id: string; period: string; status: string; totals: Record<string, number>; payslips: Slip[] }
interface Vars { earnings: Item[]; allowances: Item[]; deductions: Item[] }

const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthFr = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const DEDUCTIONS: [string, string][] = [['acompte', 'Acompte quinzaine'], ['avance', 'Avances'], ['pret', 'Prêt'], ['pharmacie', 'Pharmacie (achats)'], ['nature', 'Avantages en nature']];
const EMPTY_VARS: Vars = { earnings: [], allowances: [], deductions: [] };

export default function Payroll() {
  const { data: staff, reload } = useLoad(() => api<Employee[]>('/payroll/employees'));
  const { data: runs, reload: reloadRuns } = useLoad(() => api<{ id: string; period: string; status: string }[]>('/payroll/runs'));
  const { data: params, reload: reloadParams } = useLoad(() => api<Record<string, any>>('/payroll/parameters')); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [period, setPeriod] = useState(prevMonth());
  const [run, setRun] = useState<Run | null>(null);
  const [edit, setEdit] = useState<Partial<Employee> | null>(null);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [vars, setVars] = useState<Record<string, Vars>>({});
  const [error, setError] = useState<string | null>(null);
  const write = can('payroll.write');
  const active = (staff ?? []).filter((e) => e.isActive);

  const v = (id: string): Vars => ({ earnings: vars[id]?.earnings ?? [], allowances: vars[id]?.allowances ?? [], deductions: vars[id]?.deductions ?? [] });
  const setDeduction = (id: string, kind: string, label: string, amount: number) => setVars((s) => ({ ...s, [id]: { ...v(id), deductions: [...v(id).deductions.filter((d) => d.kind !== kind), ...(amount > 0 ? [{ kind, label, amount }] : [])] } }));
  const setOne = (id: string, key: 'earnings' | 'allowances', label: string, amount: number) => setVars((s) => ({ ...s, [id]: { ...v(id), [key]: amount > 0 ? [{ label, amount }] : [] } }));

  async function compute() { setError(null); try { setRun(await api<Run>('/payroll/runs', { method: 'POST', json: { period, variables: vars } })); reloadRuns(); } catch (e) { setError((e as Error).message); } }
  async function open(id: string) {
    const r = await api<Run>(`/payroll/runs/${id}`); setRun(r); setPeriod(r.period);
    // reprend les variables saisies pour ce mois (recalcul possible tant que la paie n'est pas validee)
    setVars(Object.fromEntries(r.payslips.map((p) => [(p as unknown as { employeeId: string }).employeeId, ((p.detail as unknown as { variables?: Vars }).variables ?? EMPTY_VARS)])));
  }
  async function validate() { if (!run || !confirm('Valider la paie ? Les bulletins seront figés et comptabilisés.')) return; try { setRun(await api<Run>(`/payroll/runs/${run.id}/validate`, { method: 'POST', json: {} })); reloadRuns(); } catch (e) { setError((e as Error).message); } }
  async function toggle(key: 'camu' | 'tol', on: boolean) {
    if (!params) return;
    const next = key === 'camu' ? { ...params, camu: on ? { employee: 2.27, employer: 4.55 } : { employee: 0, employer: 0 } } : { ...params, tol: on ? { centre: 5000, peripherie: 1000 } : { centre: 0, peripherie: 0 } };
    try { await api('/payroll/parameters', { method: 'PUT', json: { parameters: next } }); reloadParams(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <PageTitle title="Paie" sub="Salariés, variables du mois et bulletins au format de la pharmacie — CNSS, ITS, montants repris dans le calendrier fiscal" actions={write && <button className="btn" onClick={() => setEdit({ taxParts: 1, baseSalary: 0, seniorityRate: 0, fixedEarnings: [], fixedAllowances: [] })}>+ Salarié</button>} />
      {params && (
        <div className="mb-3 flex flex-wrap items-center gap-4 rounded-lg bg-orange-50 p-2 text-xs text-orange-900">
          <span>Barème ITS et répartition CNSS : valeurs par défaut <b>à faire confirmer par votre comptable</b>.</span>
          <label className="flex items-center gap-1 font-bold"><input type="checkbox" disabled={!write} checked={params.camu?.employee > 0} onChange={(e) => toggle('camu', e.target.checked)} /> CAMU (2,27 % / 4,55 %)</label>
          <label className="flex items-center gap-1 font-bold"><input type="checkbox" disabled={!write} checked={params.tol?.centre > 0} onChange={(e) => toggle('tol', e.target.checked)} /> TOL</label>
        </div>
      )}
      <ErrorBox error={error} />

      <div className="card overflow-auto">
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <h3 className="mr-auto font-extrabold">Variables du mois</h3>
          <Field label="Mois"><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
          {write && <button className="btn" onClick={compute}>Calculer les bulletins</button>}
        </div>
        <table className="w-full text-sm">
          <thead><tr><th>Salarié</th><th className="text-right">Base + ancienneté</th><th>Prime du mois</th><th>Indemnité du mois</th>{DEDUCTIONS.map(([k, l]) => <th key={k}>{l}</th>)}<th /></tr></thead>
          <tbody>
            {active.map((e, i) => (
              <tr key={e.id} className={i % 2 ? 'bg-slate-50' : ''}>
                <td><b>{e.fullName}</b><div className="text-xs text-ink-muted">{e.jobTitle}{e.category && ` · ${e.category}`} · {e.taxParts} part(s)</div></td>
                <td className="text-right">{fcfa(e.baseSalary + Math.round((e.baseSalary * e.seniorityRate) / 100))}<div className="text-xs text-ink-muted">{e.seniorityRate ? `dont ${e.seniorityRate} %` : ''}{e.fixedEarnings?.length ? ` + ${e.fixedEarnings.map((x) => x.label).join(', ')}` : ''}</div></td>
                <td><input type="number" min={0} className="w-24" placeholder="0" value={v(e.id).earnings[0]?.amount || ''} onChange={(x) => setOne(e.id, 'earnings', 'Prime du mois', Number(x.target.value))} /></td>
                <td><input type="number" min={0} className="w-24" placeholder="0" value={v(e.id).allowances[0]?.amount || ''} onChange={(x) => setOne(e.id, 'allowances', 'Indemnité du mois', Number(x.target.value))} /></td>
                {DEDUCTIONS.map(([k, l]) => <td key={k}><input type="number" min={0} className="w-24" placeholder="0" value={v(e.id).deductions.find((d) => d.kind === k)?.amount || ''} onChange={(x) => setDeduction(e.id, k, l, Number(x.target.value))} /></td>)}
                <td>{write && <button className="btn-alt !py-1" onClick={() => setEdit(e)}>✎</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {staff?.length === 0 && <p className="text-sm text-ink-muted">Aucun salarié : cliquez sur « + Salarié ».</p>}
        {(staff ?? []).some((e) => !e.isActive) && <p className="mt-2 text-xs text-ink-muted">Inactifs : {(staff ?? []).filter((e) => !e.isActive).map((e) => <button key={e.id} className="underline" onClick={() => setEdit(e)}>{e.fullName}</button>)}</p>}
      </div>

      <div className="card mt-4 space-y-3">
        <div className="flex flex-wrap gap-1"><span className="mr-2 font-extrabold">Paies</span>{runs?.map((r) => <button key={r.id} className="btn-alt !py-1" onClick={() => open(r.id)}>{r.period} {r.status === 'validated' ? '✓' : '(brouillon)'}</button>)}</div>
        {run && (
          <div>
            <div className="mb-2 flex items-center justify-between"><span className="flex flex-wrap items-center gap-2"><b>Paie de {monthFr(run.period)}</b><button className="btn-alt !py-1 text-xs" onClick={() => printPayslips(run.payslips, run.period, 3)}>🖨 Imprimer tous les bulletins (3 exemplaires chacun)</button></span>{run.status === 'validated' ? <Badge>validée et comptabilisée</Badge> : write && <button className="btn" onClick={validate}>Valider</button>}</div>
            <table className="w-full text-sm"><thead><tr><th>Salarié</th><th className="text-right">Brut</th><th className="text-right">CNSS + IRPP</th><th className="text-right">Indemnités</th><th className="text-right">Retenues</th><th className="text-right">Net à payer</th><th /></tr></thead>
              <tbody>{run.payslips.map((p, i) => <tr key={p.id} className={i % 2 ? 'bg-slate-50' : ''}><td>{p.employee.fullName}</td><td className="text-right">{fcfa(p.gross)}</td><td className="text-right">{fcfa(p.detail.employee.total)}</td><td className="text-right">{fcfa(p.detail.allowancesTotal ?? 0)}</td><td className="text-right">{fcfa(p.detail.deductionsTotal ?? 0)}</td><td className="text-right font-bold">{fcfa(p.detail.netToPay ?? p.net)}</td><td><button className="btn-alt !py-1" onClick={() => setSlip(p)}>Bulletin</button></td></tr>)}</tbody></table>
            <div className="mt-2 grid grid-cols-2 gap-1 text-sm md:grid-cols-4">
              {[['Masse brute', run.totals.gross], ['Net à verser', run.totals.netToPay ?? run.totals.net], ['CNSS à verser', (run.totals.cnssEmployee ?? 0) + (run.totals.cnssEmployer ?? 0)], ['ITS / IRPP', run.totals.its], ['TUS', (run.totals.tusTax ?? 0) + (run.totals.tusSocial ?? 0)], ['CAMU', (run.totals.camuEmployee ?? 0) + (run.totals.camuEmployer ?? 0)], ['Coût employeur', run.totals.employerCost]].map(([l, x]) => <div key={l as string} className="rounded-lg bg-slate-50 p-2"><div className="text-xs text-ink-muted">{l}</div><b>{fcfa((x as number) ?? 0)}</b></div>)}
            </div>
          </div>
        )}
      </div>
      {edit && <EmployeeForm initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {slip && run && <SlipView slip={slip} period={run.period} onClose={() => setSlip(null)} />}
    </>
  );
}

function ItemsEditor({ title, items, onChange, suggestions }: { title: string; items: Item[]; onChange: (i: Item[]) => void; suggestions: string[] }) {
  return (
    <div className="rounded-lg border border-ink-line p-2">
      <div className="mb-1 text-xs font-bold uppercase text-ink-muted">{title}</div>
      {items.map((it, k) => (
        <div key={k} className="mb-1 flex gap-1">
          <input className="flex-1" list={`sugg-${title}`} value={it.label} onChange={(e) => onChange(items.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)))} />
          <input type="number" min={0} className="w-28" value={it.amount} onChange={(e) => onChange(items.map((x, j) => (j === k ? { ...x, amount: Number(e.target.value) } : x)))} />
          <button type="button" className="btn-alt !px-2" onClick={() => onChange(items.filter((_, j) => j !== k))}>✕</button>
        </div>
      ))}
      <datalist id={`sugg-${title}`}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      <button type="button" className="btn-alt !py-1 text-xs" onClick={() => onChange([...items, { label: suggestions[0] ?? '', amount: 0 }])}>+ Ajouter</button>
    </div>
  );
}

function EmployeeForm({ initial, onClose, onSaved }: { initial: Partial<Employee>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    fullName: initial.fullName ?? '', jobTitle: initial.jobTitle ?? '', category: initial.category ?? '', matricule: initial.matricule ?? '', familySituation: initial.familySituation ?? '',
    cnssNumber: initial.cnssNumber ?? '', baseSalary: initial.baseSalary ?? 0, seniorityRate: initial.seniorityRate ?? 0, taxParts: initial.taxParts ?? 1, isActive: initial.isActive ?? true,
    fixedEarnings: initial.fixedEarnings ?? [], fixedAllowances: initial.fixedAllowances ?? [],
  });
  const [error, setError] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    const clean = (l: Item[]) => l.filter((x) => x.label.trim() && x.amount > 0).map((x) => ({ label: x.label.trim(), amount: Number(x.amount) }));
    const body = {
      fullName: f.fullName, jobTitle: f.jobTitle || undefined, category: f.category || undefined, matricule: f.matricule || undefined, familySituation: f.familySituation || undefined, cnssNumber: f.cnssNumber || undefined,
      baseSalary: Number(f.baseSalary), seniorityRate: Number(f.seniorityRate), taxParts: Number(f.taxParts), fixedEarnings: clean(f.fixedEarnings), fixedAllowances: clean(f.fixedAllowances), ...(initial.id ? { isActive: f.isActive } : {}),
    };
    try { await api(initial.id ? `/payroll/employees/${initial.id}` : '/payroll/employees', { method: initial.id ? 'PATCH' : 'POST', json: body }); onSaved(); } catch (er) { setError((er as Error).message); }
  }
  const seniority = Math.round((Number(f.baseSalary) * Number(f.seniorityRate)) / 100);
  return (
    <Modal title={initial.id ? 'Modifier le salarié' : 'Nouveau salarié'} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-3"><Field label="Nom et prénoms"><input className="w-full" required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field><Field label="N° matricule"><input className="w-full" value={f.matricule} onChange={(e) => setF({ ...f, matricule: e.target.value })} /></Field></div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Emploi"><input className="w-full" list="emplois" value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} /><datalist id="emplois">{['Pharmacien', 'Auxiliaire en pharmacie', 'Caissier(ère)', 'Vendeur(se)', 'Gardien de nuit', 'Agent d’entretien', 'Livreur', 'Comptable'].map((x) => <option key={x} value={x} />)}</datalist></Field>
          <Field label="Catégorie professionnelle"><input className="w-full" placeholder="ex. 3e cat." value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
          <Field label="Situation de famille"><select className="w-full" value={f.familySituation} onChange={(e) => setF({ ...f, familySituation: e.target.value })}><option value="">—</option>{['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf(ve)', 'Union libre'].map((x) => <option key={x}>{x}</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Field label="Salaire de base"><input type="number" className="w-full" value={f.baseSalary} onChange={(e) => setF({ ...f, baseSalary: Number(e.target.value) })} /></Field>
          <Field label={`Ancienneté % (= ${fcfa(seniority)})`}><input type="number" step="0.5" min={0} className="w-full" value={f.seniorityRate} onChange={(e) => setF({ ...f, seniorityRate: Number(e.target.value) })} /></Field>
          <Field label="Parts fiscales (IRPP)"><input type="number" step="0.5" min={1} max={6.5} className="w-full" value={f.taxParts} onChange={(e) => setF({ ...f, taxParts: Number(e.target.value) })} /></Field>
          <Field label="N° CNSS"><input className="w-full" value={f.cnssNumber} onChange={(e) => setF({ ...f, cnssNumber: e.target.value })} /></Field>
        </div>
        <ItemsEditor title="Primes fixes (soumises CNSS / IRPP)" items={f.fixedEarnings} onChange={(l) => setF({ ...f, fixedEarnings: l })} suggestions={['Prime de risque', 'Prime de caisse', 'Prime de responsabilité', 'Prime de diplôme', 'Prime de monnaie', 'Prime de rendement']} />
        <ItemsEditor title="Indemnités fixes (non soumises, ajoutées après impôt)" items={f.fixedAllowances} onChange={(l) => setF({ ...f, fixedAllowances: l })} suggestions={['Prime de transport', 'Allocations familiales', 'Rations']} />
        {initial.id && <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Salarié actif</label>}
        <ErrorBox error={error} /><button className="btn">Enregistrer</button>
      </form>
    </Modal>
  );
}

/** Bulletin au format de la pharmacie (modele papier : brut, retenues sociales, IRPP, a ajouter, a retenir, net). */
function SlipView({ slip, period, onClose }: { slip: Slip; period: string; onClose: () => void }) {
  const d = slip.detail, l = d.lines;
  const tenant = getSession()?.tenant.name ?? '';
  const row = (label: string, v: number | null, opts: { bold?: boolean; sub?: string } = {}) => (
    <tr className={opts.bold ? 'border-t border-ink-line' : ''}><td className={opts.bold ? 'font-extrabold' : ''}>{label}{opts.sub && <span className="text-xs text-ink-muted"> {opts.sub}</span>}</td><td className={`text-right tabular-nums ${opts.bold ? 'font-extrabold' : ''}`}>{v === null ? '' : fcfa(v)}</td></tr>
  );
  const section = (t: string) => <tr><td colSpan={2} className="pt-3 text-xs font-bold uppercase text-brand">● {t}</td></tr>;
  return (
    <Modal title={`Bulletin de paie — ${monthFr(period)}`} onClose={onClose}>
      <div id="ticket" className="space-y-2 text-sm">
        <div className="flex items-start justify-between border-b-2 border-ink pb-2"><div className="font-extrabold">{tenant}</div><div className="text-right"><div className="text-lg font-extrabold">BULLETIN DE PAYE</div><div>Mois de {monthFr(period)}</div></div></div>
        <div className="grid grid-cols-2 gap-x-4 text-xs">
          <div>Nom : <b>{slip.employee.fullName}</b></div><div>N° matricule : <b>{slip.employee.matricule ?? '—'}</b></div>
          <div>Situation de famille : {slip.employee.familySituation ?? '—'}</div><div>Catégorie : {slip.employee.category ?? '—'}</div>
          <div>Emploi : {slip.employee.jobTitle ?? '—'}</div><div>N° CNSS : {slip.employee.cnssNumber ?? '—'}</div>
        </div>
        <table className="w-full"><tbody>
          {row('Salaire de base', l?.baseSalary ?? d.gross - slip.bonuses)}
          {l && l.seniority > 0 && row('Ancienneté', l.seniority, { sub: `(${fcfa(l.baseSalary)} × ${l.seniorityRate} %)` })}
          {l?.earnings.map((e, i) => <tr key={i}><td>{e.label}</td><td className="text-right tabular-nums">{fcfa(e.amount)}</td></tr>)}
          {slip.bonuses > 0 && row('Primes', slip.bonuses)}
          {row('SALAIRE BRUT', d.gross, { bold: true })}
          {section('Retenues sociales')}
          {row('CNSS 4 %', d.employee.cnss, { sub: `sur ${fcfa(d.gross)}` })}
          {d.employee.camu > 0 && row('CAMU 2,27 %', d.employee.camu)}
          {d.employee.tol > 0 && row('TOL', d.employee.tol)}
          {l && row('Salaire après retenues sociales', l.afterSocial, { bold: true })}
          {row('Précompte IRPP', d.employee.its, { sub: l ? `(base ${fcfa(l.taxBaseMonthly)}, ${d.bases.parts} part(s))` : '' })}
          {row('TOTAL', d.net, { bold: true })}
          {(d.allowances?.length ?? 0) > 0 && <>{section('À ajouter')}{d.allowances!.map((a, i) => <tr key={i}><td>{a.label}</td><td className="text-right tabular-nums">{fcfa(a.amount)}</td></tr>)}{row('Montant des sommes dues', d.dueTotal ?? d.net, { bold: true })}</>}
          {(d.deductions?.length ?? 0) > 0 && <>{section('À retenir')}{d.deductions!.map((a, i) => <tr key={i}><td>{a.label}</td><td className="text-right tabular-nums">{fcfa(a.amount)}</td></tr>)}{row('Montant des déductions effectuées', d.deductionsTotal ?? 0, { bold: true })}</>}
          <tr className="border-y-2 border-ink"><td className="py-1 text-base font-extrabold">NET À PAYER ►</td><td className="text-right text-base font-extrabold">{fcfa(d.netToPay ?? d.net)}</td></tr>
        </tbody></table>
        <div className="grid grid-cols-2 pt-6 text-xs text-ink-muted"><div>Signature de l’employé</div><div className="text-right">Signature de l’employeur</div></div>
        <details className="no-print text-xs text-ink-muted"><summary>Charges patronales</summary>CNSS {fcfa(d.employer.cnss)} · CAMU {fcfa(d.employer.camu)} · TUS {fcfa(d.employer.tusTax + d.employer.tusSocial)} · coût total {fcfa(d.employerCost)}</details>
      </div>
      <div className="no-print mt-3 flex flex-wrap items-center gap-2">
        <button className="btn" onClick={() => printPayslips([slip], period, 3)}>🖨 Imprimer en 3 exemplaires</button>
        <span className="text-xs text-ink-muted">pharmacie · comptabilité · archive</span>
      </div>
    </Modal>
  );
}
