import { useState } from 'react';
import { api, can } from '../lib/api';
import { dateFr, fcfa } from '../lib/format';
import { Badge, ErrorBox, Field, Modal, useLoad } from '../components/ui';

interface Rec { customerId: string; name: string; phone?: string | null; balance: number; creditLimit: number; paymentTermDays: number; overdue: number; oldestDays: number; buckets: { current: number; d31_60: number; d61_90: number; over90: number }; open: { sale: string; date: string; amount: number; ageDays: number }[] }
interface Insurer { id: string; name: string; coverageRate: number; paymentTermDays: number; balance: number; isActive: boolean }

/** Balance agee des clients a credit, avec relance WhatsApp pre-remplie. */
export function Receivables() {
  const { data, error } = useLoad(() => api<Rec[]>('/receivables'));
  const tot = (k: keyof Rec['buckets']) => data?.reduce((s, r) => s + r.buckets[k], 0) ?? 0;
  const remind = (r: Rec) => {
    const msg = `Bonjour ${r.name}, sauf erreur de notre part, votre compte présente un solde de ${fcfa(r.balance)}${r.overdue ? ` dont ${fcfa(r.overdue)} échu` : ''}. Merci de passer le régler à la pharmacie. Bonne journée.`;
    window.open(`https://wa.me/${r.phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };
  return (
    <>
      <ErrorBox error={error} />
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">{[['0 – 30 j', tot('current'), ''], ['31 – 60 j', tot('d31_60'), 'text-brand-orange'], ['61 – 90 j', tot('d61_90'), 'text-orange-700'], ['+ de 90 j', tot('over90'), 'text-red-700']].map(([l, v, c]) => <div key={l as string} className="card"><div className="text-xs font-bold uppercase text-ink-muted">{l}</div><div className={`text-xl font-extrabold ${c}`}>{fcfa(v as number)}</div></div>)}</div>
      <div className="card overflow-auto"><table className="w-full">
        <thead><tr><th>Client</th><th className="text-right">Solde dû</th><th className="text-right">Échu</th><th>Ancienneté</th><th>Détail</th><th /></tr></thead>
        <tbody>{data?.map((r) => (
          <tr key={r.customerId}><td><b>{r.name}</b><div className="text-xs text-ink-muted">délai {r.paymentTermDays} j · plafond {fcfa(r.creditLimit)}</div></td>
            <td className="text-right font-bold">{fcfa(r.balance)}</td><td className="text-right">{r.overdue ? <Badge tone="bad">{fcfa(r.overdue)}</Badge> : '—'}</td>
            <td>{r.oldestDays} j</td><td className="text-xs">{r.open.map((o) => `${o.sale} (${dateFr(o.date)}) ${fcfa(o.amount)}`).join(' · ')}</td>
            <td>{r.phone && <button className="btn-alt !py-1" onClick={() => remind(r)}>💬 Relancer</button>}</td></tr>
        ))}</tbody>
      </table>{data?.length === 0 && <p className="p-3 text-sm text-ink-muted">Aucune créance en cours.</p>}</div>
    </>
  );
}

/** Organismes de tiers payant : prise en charge, releve, reglements. */
export function Insurers() {
  const { data, error, reload } = useLoad(() => api<Insurer[]>('/insurers'));
  const [edit, setEdit] = useState<Partial<Insurer> | null>(null);
  const [settle, setSettle] = useState<Insurer | null>(null);
  const [stmt, setStmt] = useState<{ insurer: Insurer; lines: { date: string; sale: string; patient: string | null; amount: number }[] } | null>(null);
  const write = can('customers.write');
  return (
    <>
      {write && <button className="btn mb-3" onClick={() => setEdit({ coverageRate: 80, paymentTermDays: 60 })}>+ Organisme</button>}
      <ErrorBox error={error} />
      <div className="card overflow-auto"><table className="w-full">
        <thead><tr><th>Organisme</th><th>Prise en charge</th><th className="text-right">Nous doit</th><th /></tr></thead>
        <tbody>{data?.map((i) => <tr key={i.id}><td><b>{i.name}</b><div className="text-xs text-ink-muted">paiement à {i.paymentTermDays} j</div></td><td>{i.coverageRate} %</td><td className="text-right font-bold">{fcfa(i.balance)}</td>
          <td className="space-x-1 text-right"><button className="btn-alt !py-1" onClick={async () => setStmt(await api(`/insurers/${i.id}/statement`))}>Relevé</button>{write && i.balance > 0 && <button className="btn !py-1" onClick={() => setSettle(i)}>Règlement reçu</button>}{write && <button className="btn-alt !py-1" onClick={() => setEdit(i)}>✎</button>}</td></tr>)}</tbody>
      </table></div>
      {edit && <InsurerForm initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {settle && <Settle ins={settle} onClose={() => setSettle(null)} onSaved={() => { setSettle(null); reload(); }} />}
      {stmt && <Modal title={`Relevé — ${stmt.insurer.name}`} onClose={() => setStmt(null)} wide>
        <table className="w-full"><thead><tr><th>Date</th><th>Vente</th><th>Patient</th><th className="text-right">Part organisme</th></tr></thead><tbody>{stmt.lines.map((l, k) => <tr key={k}><td>{dateFr(l.date)}</td><td>{l.sale}</td><td>{l.patient ?? '—'}</td><td className="text-right">{fcfa(l.amount)}</td></tr>)}</tbody></table>
        <p className="mt-2 font-bold">Solde dû : {fcfa(stmt.insurer.balance)}</p><button className="btn mt-2" onClick={() => window.print()}>🖨 Imprimer le bordereau</button>
      </Modal>}
    </>
  );
}

function InsurerForm({ initial, onClose, onSaved }: { initial: Partial<Insurer>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: initial.name ?? '', coverageRate: initial.coverageRate ?? 80, paymentTermDays: initial.paymentTermDays ?? 60 });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={initial.id ? 'Modifier l’organisme' : 'Nouvel organisme'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nom (assurance, mutuelle, employeur)"><input className="w-full" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Prise en charge (%)"><input type="number" className="w-full" value={f.coverageRate} onChange={(e) => setF({ ...f, coverageRate: Number(e.target.value) })} /></Field><Field label="Délai de paiement (jours)"><input type="number" className="w-full" value={f.paymentTermDays} onChange={(e) => setF({ ...f, paymentTermDays: Number(e.target.value) })} /></Field></div>
        <ErrorBox error={error} />
        <button className="btn" onClick={async () => { try { await api(initial.id ? `/insurers/${initial.id}` : '/insurers', { method: initial.id ? 'PATCH' : 'POST', json: f }); onSaved(); } catch (e) { setError((e as Error).message); } }}>Enregistrer</button>
      </div>
    </Modal>
  );
}

function Settle({ ins, onClose, onSaved }: { ins: Insurer; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(ins.balance);
  const [method, setMethod] = useState('card');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`Règlement — ${ins.name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Montant reçu"><input type="number" className="w-full" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        <Field label="Mode"><select className="w-full" value={method} onChange={(e) => setMethod(e.target.value)}><option value="card">Virement / banque</option><option value="cash">Espèces</option><option value="mtn_momo">MTN MoMo</option><option value="airtel_money">Airtel Money</option></select></Field>
        <Field label="Référence"><input className="w-full" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <ErrorBox error={error} />
        <button className="btn" onClick={async () => { try { await api(`/insurers/${ins.id}/settlements`, { method: 'POST', json: { amount, method, ...(reference ? { reference } : {}) } }); onSaved(); } catch (e) { setError((e as Error).message); } }}>Enregistrer</button>
      </div>
    </Modal>
  );
}