import { useState } from 'react';
import { api, can } from '../lib/api';
import { dateFr, fcfa } from '../lib/format';
import { Badge, ErrorBox, Field, Modal, PageTitle, useLoad } from '../components/ui';

interface Item { obligation: string; label: string; authority: string; basis: string; note?: string; period: string; legalDue: string; due: string; status: string; amount: number | null; reference: string | null; level: string | null; daysLeft: number }

const LEVEL: Record<string, ['ok' | 'warn' | 'bad' | 'muted' | 'info', string]> = { overdue: ['bad', 'en retard'], j7: ['bad', '< 1 semaine'], j14: ['warn', '< 2 semaines'], j30: ['info', '< 1 mois'] };

export default function Tax() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, error, reload } = useLoad(() => api<{ items: Item[]; profile: { taxRegime: string; incomeTax: string; employeesCount: number } }>(`/tax/calendar?year=${year}`), [year]);
  const [mark, setMark] = useState<Item | null>(null);
  const [filter, setFilter] = useState<'todo' | 'all'>('todo');
  const items = (data?.items ?? []).filter((i) => filter === 'all' || i.status !== 'paid');
  const byMonth = new Map<string, Item[]>();
  for (const i of items) { const k = i.due.slice(0, 7); byMonth.set(k, [...(byMonth.get(k) ?? []), i]); }
  return (
    <>
      <PageTitle title="Calendrier fiscal et social" sub="Échéances 2026 selon la note ACPCE (loi de finances 2026, CGI art. 461 bis : le 15 du mois, le 20 en août). Date reportée au dernier jour ouvré précédent si nécessaire."
        actions={<div className="flex gap-1"><button className="btn-alt" onClick={() => setYear(year - 1)}>←</button><span className="self-center px-2 font-extrabold">{year}</span><button className="btn-alt" onClick={() => setYear(year + 1)}>→</button></div>} />
      <ErrorBox error={error} />
      {data && <p className="mb-2 text-sm text-ink-muted">Profil : régime {data.profile.taxRegime === 'forfait' ? 'forfaitaire (IGF)' : 'réel'}, {data.profile.incomeTax}, {data.profile.employeesCount} salarié(s). Seules les obligations qui vous concernent sont listées — à ajuster dans « Ma structure ».</p>}
      <div className="mb-3 flex gap-2"><button className={filter === 'todo' ? 'btn' : 'btn-alt'} onClick={() => setFilter('todo')}>À faire</button><button className={filter === 'all' ? 'btn' : 'btn-alt'} onClick={() => setFilter('all')}>Tout</button></div>
      <div className="space-y-3">
        {[...byMonth.entries()].map(([m, list]) => (
          <div key={m} className="card">
            <h3 className="mb-2 font-extrabold capitalize">{new Date(`${m}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3>
            <table className="w-full"><tbody>
              {list.map((i) => (
                <tr key={i.obligation + i.period}>
                  <td className="w-28 font-bold">{dateFr(i.due)}{i.due !== i.legalDue && <div className="text-xs font-normal text-ink-muted">(légal : {dateFr(i.legalDue)})</div>}</td>
                  <td><b>{i.label}</b> <span className="text-xs text-ink-muted">· période {i.period}</span><div className="text-xs text-ink-muted">{i.basis} — {i.authority}{i.note ? ` — ${i.note}` : ''}</div></td>
                  <td className="w-40">{i.status === 'paid' ? <Badge>payé {i.amount ? fcfa(i.amount) : ''}</Badge> : i.status === 'filed' ? <Badge tone="info">déclaré</Badge> : i.level ? <Badge tone={LEVEL[i.level][0]}>{LEVEL[i.level][1]}</Badge> : <Badge tone="muted">à venir</Badge>}</td>
                  <td className="w-32">{can('tax.manage') && i.status !== 'paid' && <button className="btn-alt !py-1" onClick={() => setMark(i)}>Enregistrer</button>}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        ))}
        {byMonth.size === 0 && data && <p className="card text-sm text-ink-muted">Aucune échéance restante pour {year}. 🎉</p>}
      </div>
      {mark && <MarkModal item={mark} onClose={() => setMark(null)} onSaved={() => { setMark(null); reload(); }} />}
    </>
  );
}

function MarkModal({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const { data: est } = useLoad(() => api<{ amount: number; basis: string } | null>(`/tax/estimate?obligation=${item.obligation}&period=${encodeURIComponent(item.period)}`));
  const [status, setStatus] = useState<'filed' | 'paid'>('paid');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try { await api('/tax/filings', { method: 'POST', json: { obligation: item.obligation, period: item.period, dueDate: item.due, status, ...(amount ? { amount: Number(amount) } : {}), ...(reference ? { reference } : {}) } }); onSaved(); } catch (e) { setError((e as Error).message); }
  }
  return (
    <Modal title={`${item.label} — ${item.period}`} onClose={onClose}>
      <div className="space-y-3">
        {est && <div className="rounded-lg bg-brand-soft p-2 text-sm"><b>Estimation ERP : {fcfa(est.amount)}</b><div className="text-xs text-ink-muted">{est.basis}</div><button className="mt-1 text-xs font-bold text-brand underline" onClick={() => setAmount(String(est.amount))}>Reprendre ce montant</button></div>}
        <Field label="Statut"><select className="w-full" value={status} onChange={(e) => setStatus(e.target.value as 'filed' | 'paid')}><option value="filed">Déclaré (pas encore payé)</option><option value="paid">Déclaré et payé</option></select></Field>
        <Field label="Montant payé (FCFA)"><input type="number" className="w-full" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="N° de quittance / accusé E-TAX ou FOUTA"><input className="w-full" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <ErrorBox error={error} />
        <button className="btn" onClick={save}>Enregistrer</button>
      </div>
    </Modal>
  );
}