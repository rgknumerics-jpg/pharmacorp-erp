import { useState } from 'react';
import { api, getSession } from '../lib/api';
import { ErrorBox, Field, Modal, PageTitle, useDebounced, useLoad } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPES: [string, string, string][] = [
  ['', 'Tout', 'bg-slate-700'], ['delegue', 'Délégués médicaux', 'bg-violet-600'], ['laboratoire', 'Laboratoires', 'bg-sky-600'], ['agence', 'Agences de promotion', 'bg-indigo-600'],
  ['depot', 'Dépôts pharmaceutiques', 'bg-amber-600'], ['district', 'Districts sanitaires', 'bg-teal-600'], ['fosa', 'Formations sanitaires', 'bg-emerald-600'],
  ['camu', 'Conventionnés CAMU', 'bg-rose-600'], ['structure', 'Hôpitaux, cliniques, labos', 'bg-red-600'], ['pharmacie', 'Pharmacies', 'bg-green-700'],
];
const LABEL: Record<string, [string, string]> = Object.fromEntries(TYPES.map(([k, l, c]) => [k, [l, c]]));
const FIELDS: [string, string][] = [['phones', 'Téléphones / WhatsApp (séparés par une virgule)'], ['agency', 'Agence de promotion (pour un délégué)'], ['laboratories', 'Laboratoire(s) représenté(s) (séparés par une virgule)'], ['products', 'Produits / gammes suivis'], ['address', 'Adresse'], ['city', 'Ville'], ['district', 'District'], ['area', 'Aire de santé / quartier'], ['email', 'E-mail'], ['website', 'Site web'], ['manager', 'Responsable'], ['title', 'Fonction'], ['note', 'Note']];

export default function Directory() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [prop, setProp] = useState<any | 'new' | null>(null);
  const [done, setDone] = useState(false);
  const dq = useDebounced(q, 250);
  const { data, error } = useLoad(() => api<{ total: number; counts: Record<string, number>; items: any[] }>(`/directory?q=${encodeURIComponent(dq)}&type=${type}&take=200`), [dq, type]);
  return (
    <>
      <PageTitle title="Annuaires santé" sub="DPM Congo, CAMU, structures de santé : délégués, laboratoires, agences, dépôts, districts, formations sanitaires" actions={<button className="btn-alt" onClick={() => { setDone(false); setProp('new'); }}>+ Proposer une nouvelle fiche</button>} />
      {done && <div className="mb-3 rounded-lg bg-brand-soft p-3 text-sm font-bold text-brand">Merci ! Votre proposition a été transmise à l’administrateur : elle sera publiée (Pharmacies de garde, Équivalence, ERP) après vérification.</div>}
      <div className="card mb-3 space-y-2">
        <input className="w-full text-lg" placeholder="🔎 Nom, ville, district, agence…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-1">{TYPES.map(([k, l, c]) => <button key={k} onClick={() => setType(k)} className={`rounded-full px-3 py-1 text-xs font-bold transition ${type === k ? `${c} text-white shadow` : 'bg-slate-100 hover:bg-slate-200'}`}>{l}{k && data?.counts[k] ? ` · ${data.counts[k]}` : ''}</button>)}</div>
      </div>
      <ErrorBox error={error} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data?.items.map((x, i) => (
          <div key={i} className="card !p-3 transition hover:shadow-md">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${LABEL[x.type]?.[1] ?? 'bg-slate-500'}`}>{LABEL[x.type]?.[0] ?? x.type}</span>
            <div className="mt-1 font-extrabold">{x.name}</div>
            <div className="text-xs text-ink-muted">{[x.title, x.agency && x.agency !== 'Sans Agence' ? `Agence : ${x.agency}` : null, x.manager && `Responsable : ${x.manager}`, x.category, x.area, x.district && `District : ${x.district}`, x.arrondissement && x.arrondissement !== 'Non renseigné' ? x.arrondissement : null, x.department, x.city, x.address].filter(Boolean).join(' · ')}</div>
            {(x.agency && x.agency !== 'Sans Agence') || x.laboratories?.length > 0 || x.products ? <div className="mt-1 flex flex-wrap gap-1 text-[11px]">{x.agency && x.agency !== 'Sans Agence' && <button className="rounded bg-indigo-100 px-2 py-0.5 font-bold text-indigo-800" onClick={() => setQ(x.agency)}>🏢 {x.agency}</button>}{(x.laboratories ?? []).map((l: string) => <button key={l} className="rounded bg-sky-100 px-2 py-0.5 font-bold text-sky-800" onClick={() => setQ(l)}>🧪 {l}</button>)}{x.products && <span className="rounded bg-slate-100 px-2 py-0.5">{x.products}</span>}</div> : null}
            {x.phones?.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{x.phones.map((p: string) => <span key={p} className="inline-flex gap-1"><a className="rounded bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand" href={`tel:${p.replace(/\s/g, '')}`}>📞 {p}</a><a className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800" target="_blank" rel="noreferrer" href={`https://wa.me/${p.replace(/\D/g, '')}`}>💬</a></span>)}</div>}
            {x.email && <a className="text-xs text-brand underline" href={`mailto:${x.email}`}>{x.email}</a>}
            <div className="mt-1"><button className="text-xs font-bold text-brand underline" onClick={() => { setDone(false); setProp(x); }}>✏️ Proposer une modification ou un complément</button></div>
          </div>
        ))}
      </div>
      {data && <p className="mt-2 text-xs text-ink-muted">{data.total} résultat(s){data.total > data.items.length ? ` — ${data.items.length} affichés, précisez la recherche` : ''}. Sources publiques : DPM Congo, CAMU, OpenStreetMap.</p>}
      {prop && <Propose entry={prop === 'new' ? null : prop} onClose={() => setProp(null)} onSent={() => { setProp(null); setDone(true); }} />}
    </>
  );
}

/** Proposition de modification : elle arrive dans le panneau d'administration avec les coordonnées de son auteur, et n'est publiée qu'après validation. */
function Propose({ entry, onClose, onSent }: { entry: any | null; onClose: () => void; onSent: () => void }) {
  const me = getSession()?.user;
  const [f, setF] = useState<Record<string, string>>(() => ({ name: '', ...Object.fromEntries(FIELDS.map(([k]) => [k, Array.isArray(entry?.[k]) ? entry[k].join(', ') : String(entry?.[k] ?? '')])) }));
  const [type, setType] = useState('structure');
  const [msg, setMsg] = useState('');
  const [c, setC] = useState({ name: me?.fullName ?? '', email: me?.email ?? '', phone: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setErr(null);
    try { await api('/directory/propose', { method: 'POST', json: { entryId: entry?.id, kind: entry ? 'modification' : 'nouvelle', fields: f, message: msg, type: entry ? undefined : type, contact: c } }); onSent(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal title={entry ? entry.name : 'Proposer une nouvelle fiche'} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">Indiquez ce qui doit être corrigé ou complété et vos coordonnées : l’administrateur peut vous contacter pour vérifier. Rien n’est publié avant sa validation.</p>
        {!entry && <div className="grid gap-3 md:grid-cols-2"><Field label="Type de fiche"><select className="w-full" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.filter(([k]) => k).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field><Field label="Nom de la structure *"><input className="w-full" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>}
        <div className="grid gap-3 md:grid-cols-2">{FIELDS.map(([k, l]) => <Field key={k} label={l}><input className="w-full" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}</div>
        <Field label="Précisions"><textarea rows={3} className="w-full" maxLength={600} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Ex. nouveau numéro depuis le 1er octobre…" /></Field>
        <div className="rounded-xl bg-slate-50 p-3"><div className="mb-2 text-sm font-extrabold">Vos coordonnées</div><div className="grid gap-3 md:grid-cols-3"><Field label="Votre nom *"><input className="w-full" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field><Field label="Votre e-mail"><input type="email" className="w-full" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field><Field label="Téléphone / WhatsApp"><input className="w-full" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field></div></div>
        <ErrorBox error={err} />
        <button className="btn" disabled={busy} onClick={send}>{busy ? 'Envoi…' : 'Envoyer à l’administrateur'}</button>
      </div>
    </Modal>
  );
}
