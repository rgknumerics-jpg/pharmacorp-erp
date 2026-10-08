import { FormEvent, useState } from 'react';
import { api, can } from '../lib/api';
import { fcfa } from '../lib/format';
import { Badge, ErrorBox, Field, Modal, PageTitle, useDebounced, useLoad } from '../components/ui';
import { Insurers, Receivables } from './Credit';

interface Customer { id: string; name: string; phone?: string | null; email?: string | null; creditLimit: number; creditBalance: number; notes?: string | null }

export default function Customers() {
  const [tab, setTab] = useState<'list' | 'credit' | 'insurers'>('list');
  return (
    <>
      <PageTitle title="Clients" sub="Fichier clients, crédit, relances et tiers payant" />
      <div className="mb-3 flex gap-2">{([['list', 'Clients'], ['credit', 'Créances (balance âgée)'], ['insurers', 'Tiers payant']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'btn' : 'btn-alt'} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'list' && <CustomerList />}
      {tab === 'credit' && <Receivables />}
      {tab === 'insurers' && <Insurers />}
    </>
  );
}

function CustomerList() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, error, reload } = useLoad(() => api<Customer[]>(`/customers?q=${encodeURIComponent(dq)}&take=100`), [dq]);
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  const [repay, setRepay] = useState<Customer | null>(null);
  const write = can('customers.write');
  return (
    <>
      {write && <button className="btn mb-3" onClick={() => setEdit({ creditLimit: 0 })}>+ Nouveau client</button>}
      <div className="card mb-3"><input className="w-full" placeholder="🔎 Nom ou téléphone…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ErrorBox error={error} />
      <div className="card overflow-auto"><table className="w-full">
        <thead><tr><th>Client</th><th>Téléphone</th><th>Plafond</th><th>Doit</th><th /></tr></thead>
        <tbody>{data?.map((c) => (
          <tr key={c.id}><td><b>{c.name}</b><div className="text-xs text-ink-muted">{c.email}</div></td>
            <td>{c.phone ? <a className="text-brand underline" href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer">{c.phone}</a> : '—'}</td>
            <td>{fcfa(c.creditLimit)}</td><td>{c.creditBalance > 0 ? <Badge tone="warn">{fcfa(c.creditBalance)}</Badge> : '—'}</td>
            <td className="space-x-1">{write && <button className="btn-alt" onClick={() => setEdit(c)}>Modifier</button>}{write && c.creditBalance > 0 && <button className="btn" onClick={() => setRepay(c)}>Encaisser</button>}</td></tr>
        ))}</tbody>
      </table></div>
      {edit && <Form initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {repay && <Repay c={repay} onClose={() => setRepay(null)} onSaved={() => { setRepay(null); reload(); }} />}
    </>
  );
}

const KINDS: [string, string, string][] = [['particulier', '🙂 Particulier', 'bg-sky-500'], ['assure', '🛡️ Assuré / tiers payant', 'bg-violet-500'], ['entreprise', '🏢 Entreprise', 'bg-amber-500'], ['personnel', '🧑‍⚕️ Personnel', 'bg-emerald-600']];

function Form({ initial, onClose, onSaved }: { initial: Partial<Customer> & Record<string, any>; onClose: () => void; onSaved: () => void }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const [f, setF] = useState({
    name: initial.name ?? '', phone: initial.phone ?? '', email: initial.email ?? '', creditLimit: initial.creditLimit ?? 0, notes: initial.notes ?? '',
    kind: initial.kind ?? 'particulier', address: initial.address ?? '', city: initial.city ?? '', birthDate: initial.birthDate ? String(initial.birthDate).slice(0, 10) : '', company: initial.company ?? '',
    insurerId: initial.insurerId ?? '', insuranceNumber: initial.insuranceNumber ?? '', paymentTermDays: initial.paymentTermDays ?? 30, whatsappOptIn: initial.whatsappOptIn ?? false,
  });
  const { data: insurers } = useLoad(() => api<{ id: string; name: string; coverageRate: number }[]>('/insurers'));
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const opt = (k: keyof typeof f) => (f[k] !== '' && f[k] !== null ? { [k]: f[k] } : {});
      const body = { name: f.name.trim(), kind: f.kind, creditLimit: Number(f.creditLimit) || 0, paymentTermDays: Number(f.paymentTermDays) || 0, whatsappOptIn: f.whatsappOptIn, ...opt('phone'), ...opt('email'), ...opt('notes'), ...opt('address'), ...opt('city'), ...opt('birthDate'), ...opt('company'), ...opt('insurerId'), ...opt('insuranceNumber') };
      await api(initial.id ? `/customers/${initial.id}` : '/customers', { method: initial.id ? 'PATCH' : 'POST', json: body }); onSaved();
    } catch (er) { setError((er as Error).message); }
  }
  return (
    <Modal title={initial.id ? 'Modifier le client' : 'Nouveau client'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-3">
        <div className="flex flex-wrap gap-2">{KINDS.map(([k, l, c]) => <button type="button" key={k} onClick={() => set('kind', k)} className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${f.kind === k ? `${c} scale-105 text-white shadow` : 'bg-slate-100 hover:bg-slate-200'}`}>{l}</button>)}</div>
        <section className="space-y-3 rounded-xl border-l-4 border-sky-500 bg-sky-50/60 p-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={f.kind === 'entreprise' ? 'Raison sociale' : 'Nom et prénoms'} className="md:col-span-2"><input className="w-full text-base font-bold" value={f.name} onChange={(e) => set('name', e.target.value)} required minLength={2} /></Field>
            {f.kind !== 'entreprise' && <Field label="Date de naissance"><input type="date" className="w-full" value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></Field>}
            <Field label="Téléphone (06 … ou +242 06 …)"><input className="w-full" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="E-mail"><input type="email" className="w-full" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Ville"><input className="w-full" list="cities" value={f.city} onChange={(e) => set('city', e.target.value)} /><datalist id="cities">{['Brazzaville', 'Pointe-Noire', 'Dolisie', 'Nkayi', 'Owando', 'Ouesso', 'Impfondo', 'Madingou', 'Sibiti', 'Kinkala', 'Djambala', 'Ewo'].map((x) => <option key={x} value={x} />)}</datalist></Field>
            <Field label="Adresse / quartier" className="md:col-span-2"><input className="w-full" value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
            {(f.kind === 'entreprise' || f.kind === 'assure') && <Field label="Employeur / entreprise"><input className="w-full" value={f.company} onChange={(e) => set('company', e.target.value)} /></Field>}
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.whatsappOptIn} onChange={(e) => set('whatsappOptIn', e.target.checked)} /> Le client accepte de recevoir des messages WhatsApp (rappels, promotions)</label>
        </section>
        {f.kind === 'assure' && (
          <section className="grid gap-3 rounded-xl border-l-4 border-violet-500 bg-violet-50/60 p-3 md:grid-cols-2">
            <Field label="Organisme (tiers payant)"><select className="w-full" value={f.insurerId} onChange={(e) => set('insurerId', e.target.value)}><option value="">—</option>{insurers?.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.coverageRate} %)</option>)}</select></Field>
            <Field label="N° d’assuré / matricule"><input className="w-full" value={f.insuranceNumber} onChange={(e) => set('insuranceNumber', e.target.value)} /></Field>
          </section>
        )}
        <section className="grid gap-3 rounded-xl border-l-4 border-amber-500 bg-amber-50/60 p-3 md:grid-cols-2">
          <Field label="Plafond de crédit (FCFA) — 0 = pas de crédit"><input type="number" min={0} className="w-full" value={f.creditLimit || ''} placeholder="0" onChange={(e) => set('creditLimit', Number(e.target.value) || 0)} /></Field>
          <Field label="Délai de paiement (jours)"><input type="number" min={0} max={365} className="w-full" value={f.paymentTermDays} onChange={(e) => set('paymentTermDays', Number(e.target.value) || 0)} /></Field>
        </section>
        <Field label="Notes"><input className="w-full" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <ErrorBox error={error} /><button className="btn !px-6">💾 Enregistrer</button>
      </form>
    </Modal>
  );
}
function Repay({ c, onClose, onSaved }: { c: Customer; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(c.creditBalance);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`Encaisser une créance — ${c.name}`} onClose={onClose}>
      <p className="mb-2 text-sm">Solde dû : <b>{fcfa(c.creditBalance)}</b></p>
      <Field label="Montant reçu (FCFA)"><input type="number" min={1} max={c.creditBalance} className="w-full" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} /></Field>
      <ErrorBox error={error} />
      <button className="btn mt-3" onClick={async () => { try { await api(`/customers/${c.id}/repayments`, { method: 'POST', json: { amount } }); onSaved(); } catch (e) { setError((e as Error).message); } }}>Enregistrer le règlement</button>
    </Modal>
  );
}