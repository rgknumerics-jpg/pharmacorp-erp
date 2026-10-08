import { useState } from 'react';
import { api, can, getSession } from '../lib/api';
import { Badge, ErrorBox, Field, Modal, PageTitle, useLoad } from '../components/ui';
import SignaturePad from '../components/SignaturePad';
import { AddMember, EditMember, RoleFull, RolesManager, roleLabel, setRoleLabels } from './TeamRoles';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Member { id: string; isActive: boolean; roleId: string; role: { id: string; name: string }; user: { id: string; email: string; fullName: string; signature: string | null } }
interface Role { id: string; name: string }
interface PriceCat { key: string; label: string; coefficient: number }
interface Pricing { vatRates: { label: string; rate: number }[]; coefficients: { exempt: number; taxed: number }; vatVisibility: Record<string, number[]>; priceCategories: PriceCat[]; rounding: number }

export default function Team() {
  const admin = can('users.write');
  const { data: members, error: membersError, reload } = useLoad(() => api<Member[]>('/users'));
  const { data: roles, error: rolesError, reload: reloadRoles } = useLoad(() => api<RoleFull[]>('/roles'));
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<Member | null>(null);
  const [sign, setSign] = useState(false);
  const [pin, setPin] = useState<Member | 'me' | null>(null);
  if (roles) setRoleLabels(roles);
  const me = getSession()?.user;
  return (
    <>
      <PageTitle title="Équipe et accès" sub="Agents, rôles et droits d’accès, signatures, taux de TVA et ce que chaque rôle peut voir" actions={<div className="flex gap-2"><button className="btn-alt" onClick={() => setSign(true)}>✍️ Ma signature</button><button className="btn-alt" onClick={() => setPin('me')}>🔑 Mon code POS</button>{admin && <button className="btn" onClick={() => setAdd(true)}>+ Agent</button>}</div>} />
      <ErrorBox error={membersError} />
      <div className="card overflow-auto">
        <table className="w-full"><thead><tr><th>Agent</th><th>Rôle</th><th>Signature</th><th>État</th>{admin && <th />}</tr></thead>
          <tbody>{members?.map((m) => <tr key={m.id}><td><b>{m.user.fullName}</b><div className="text-xs text-ink-muted">{m.user.email}</div></td><td>{roleLabel(m.role.name)}</td><td>{m.user.signature ? <img src={m.user.signature} alt="" className="h-10" /> : <span className="text-xs text-orange-700">à enregistrer</span>}</td><td>{m.isActive ? <Badge>actif</Badge> : <Badge tone="muted">inactif</Badge>}</td>{admin && <td className="whitespace-nowrap"><button className="btn-alt !py-0.5 text-xs" onClick={() => setEdit(m)}>Modifier</button> <button className="btn-alt !py-0.5 text-xs" onClick={() => setPin(m)}>🔑 Code POS</button></td>}</tr>)}</tbody></table>
      </div>
      {(can('roles.read') || can('roles.write')) && <RolesManager onChanged={() => { reloadRoles(); reload(); }} />}
      {can('tenant.manage') && roles && <Taxes roles={roles} />}
      {can('tenant.manage') && roles && <Scopes roles={roles} />}
      {add && (roles
        ? <AddMember roles={roles} onClose={() => setAdd(false)} onSaved={() => { setAdd(false); reload(); }} />
        : <Modal title="Nouvel agent" onClose={() => setAdd(false)}><ErrorBox error={rolesError ?? null} />{!rolesError && <p className="text-sm text-ink-muted">Chargement des rôles…</p>}</Modal>)}
      {edit && roles && <EditMember m={edit} roles={roles} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); reloadRoles(); }} />}
      {sign && <MySignature name={me?.fullName ?? ''} onClose={() => { setSign(false); reload(); }} />}
      {pin && <PosPin member={pin === 'me' ? null : pin} onClose={() => setPin(null)} />}
    </>
  );
}

/** Code personnel qui déverrouille les postes de caisse et identifie la personne qui travaille. */
function PosPin({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  async function save() {
    setErr(null);
    try { await api(member ? `/auth/pos-pin/${member.id}` : '/auth/pos-pin', { method: 'PUT', json: member ? { pin } : { pin, password } }); setOk(true); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title={member ? `Code POS de ${member.user.fullName}` : 'Mon code POS'} onClose={onClose}>
      {ok ? <div className="space-y-3"><div className="rounded-lg bg-brand-soft p-3 font-bold text-brand">✓ Code enregistré.</div><button className="btn" onClick={onClose}>Fermer</button></div> : (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">Code de 4 à 8 chiffres, propre à la personne. Au poste vendeur, au poste caisse ou en vente directe, le code suffit à identifier qui travaille. Deux personnes ne peuvent pas avoir le même code.</p>
          <input className="w-full text-center text-2xl tracking-[.4em]" type="password" inputMode="numeric" autoComplete="off" maxLength={8} placeholder="••••" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          {!member && <input className="w-full" type="password" autoComplete="current-password" placeholder="Votre mot de passe (confirmation)" value={password} onChange={(e) => setPassword(e.target.value)} />}
          <ErrorBox error={err} />
          <button className="btn" disabled={pin.length < 4 || (!member && !password)} onClick={save}>Enregistrer le code</button>
        </div>
      )}
    </Modal>
  );
}

function MySignature({ name, onClose }: { name: string; onClose: () => void }) {
  const [sig, setSig] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={`Signature de ${name}`} onClose={onClose}>
      <SignaturePad onChange={setSig} />
      <ErrorBox error={err} />
      <button className="btn mt-2" disabled={!sig} onClick={async () => { try { await api('/users/me/signature', { method: 'PUT', json: { signature: sig } }); onClose(); } catch (e) { setErr((e as Error).message); } }}>Enregistrer ma signature</button>
    </Modal>
  );
}

/** Taux de TVA de l'etablissement et perimetre TVA visible par role (produits, stock, ventes, cockpit). */
function Taxes({ roles }: { roles: Role[] }) {
  const { data, setData } = useLoad(() => api<Pricing>('/settings/pricing'));
  const [newRate, setNewRate] = useState({ label: '', rate: '' });
  const [newCat, setNewCat] = useState({ label: '', coefficient: '' });
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!data) return null;
  const save = async (p: Partial<Pricing>) => { setErr(null); setSaved(false); try { setData(await api<Pricing>('/settings/pricing', { method: 'PUT', json: p })); setSaved(true); } catch (e) { setErr((e as Error).message); } };
  const visible = (roleId: string) => data.vatVisibility[roleId] ?? null;
  const toggle = (roleId: string, rate: number) => {
    const cur = visible(roleId) ?? data.vatRates.map((r) => r.rate);
    const next = cur.includes(rate) ? cur.filter((r) => r !== rate) : [...cur, rate];
    const all = data.vatRates.every((r) => next.includes(r.rate));
    const vv: Record<string, any> = { ...data.vatVisibility };
    if (all) delete vv[roleId]; else vv[roleId] = next;
    save({ vatVisibility: vv });
  };
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="card space-y-2">
        <h3 className="font-extrabold">Taux de TVA</h3>
        <div className="flex flex-wrap gap-2">{data.vatRates.map((r) => <span key={r.label} className="flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">{r.label} ({r.rate} %)<button className="ml-1 text-red-700" title="Retirer" onClick={() => save({ vatRates: data.vatRates.filter((x) => x !== r) })}>✕</button></span>)}</div>
        <div className="flex gap-2"><input className="flex-1" placeholder="Libellé (ex. TVA réduite 5 %)" value={newRate.label} onChange={(e) => setNewRate({ ...newRate, label: e.target.value })} /><input type="number" step="0.01" min={0} max={100} className="w-24" placeholder="%" value={newRate.rate} onChange={(e) => setNewRate({ ...newRate, rate: e.target.value })} /><button className="btn" disabled={!newRate.label || newRate.rate === ''} onClick={() => { save({ vatRates: [...data.vatRates, { label: newRate.label, rate: Number(newRate.rate) }] }); setNewRate({ label: '', rate: '' }); }}>Ajouter</button></div>
        <div className="grid grid-cols-2 gap-2 text-sm"><Field label="Coef. prix exonéré"><input type="number" step="0.01" className="w-full" defaultValue={data.coefficients.exempt} onBlur={(e) => save({ coefficients: { ...data.coefficients, exempt: Number(e.target.value) } })} /></Field><Field label="Coef. prix avec TVA"><input type="number" step="0.01" className="w-full" defaultValue={data.coefficients.taxed} onBlur={(e) => save({ coefficients: { ...data.coefficients, taxed: Number(e.target.value) } })} /></Field></div>
      </div>
      <div className="card space-y-2 lg:col-span-2">
        <h3 className="font-extrabold">Catégories de prix (coefficient sur le prix d’achat)</h3>
        <table className="w-full text-sm"><thead><tr><th>Catégorie</th><th>Coefficient</th><th>Exemple : achat 1 000 F</th><th /></tr></thead>
          <tbody>{data.priceCategories.map((pc, i) => <tr key={pc.key}>
            <td><input className="w-full" defaultValue={pc.label} onBlur={(e) => e.target.value.trim() && e.target.value !== pc.label && save({ priceCategories: data.priceCategories.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></td>
            <td><input type="number" step="0.0001" min={0.5} max={9} className="w-28" defaultValue={pc.coefficient} onBlur={(e) => Number(e.target.value) !== pc.coefficient && save({ priceCategories: data.priceCategories.map((x, j) => (j === i ? { ...x, coefficient: Number(e.target.value) } : x)) })} /></td>
            <td className="font-bold">{Math.ceil(Math.round(1000 * pc.coefficient * 1000) / 1000 / data.rounding) * data.rounding} F</td>
            <td><button className="text-red-700" title="Retirer" onClick={() => save({ priceCategories: data.priceCategories.filter((_, j) => j !== i) })}>✕</button></td></tr>)}</tbody></table>
        <div className="flex flex-wrap items-center gap-2"><input className="flex-1" placeholder="Nouvelle catégorie (ex. Dispositifs médicaux)" value={newCat.label} onChange={(e) => setNewCat({ ...newCat, label: e.target.value })} /><input type="number" step="0.0001" className="w-28" placeholder="coef." value={newCat.coefficient} onChange={(e) => setNewCat({ ...newCat, coefficient: e.target.value })} /><button className="btn" disabled={!newCat.label || !Number(newCat.coefficient)} onClick={() => { save({ priceCategories: [...data.priceCategories, { key: '', label: newCat.label, coefficient: Number(newCat.coefficient) }] }); setNewCat({ label: '', coefficient: '' }); }}>Ajouter</button>
          <label className="ml-auto text-sm font-semibold">Arrondi du prix de vente au multiple supérieur de <select value={data.rounding} onChange={(e) => save({ rounding: Number(e.target.value) })}>{[1, 5, 10, 25, 50, 100].map((r) => <option key={r} value={r}>{r} F</option>)}</select></label></div>
      </div>
      <div className="card space-y-2">
        <h3 className="font-extrabold">Ce que chaque rôle voit (par taux de TVA)</h3>
        <p className="text-xs text-ink-muted">Produits, valeur du stock, mouvements, ventes et cockpit sont calculés sans les taux décochés.</p>
        <table className="w-full text-sm"><thead><tr><th>Rôle</th>{data.vatRates.map((r) => <th key={r.label} className="text-center">{r.rate} %</th>)}</tr></thead>
          <tbody>{roles.map((ro) => <tr key={ro.id}><td className="font-semibold">{ro.name}</td>{data.vatRates.map((r) => <td key={r.label} className="text-center"><input type="checkbox" checked={(visible(ro.id) ?? data.vatRates.map((x) => x.rate)).includes(r.rate)} onChange={() => toggle(ro.id, r.rate)} /></td>)}</tr>)}</tbody></table>
        <ErrorBox error={err} />{saved && <p className="text-xs font-bold text-brand">Enregistré ✓ (pris en compte à la prochaine requête de chaque utilisateur)</p>}
      </div>
    </div>
  );
}

/** Filtres fournisseurs et depots par role (en plus de la TVA) : stock, finances, recettes, comptabilite. */
function Scopes({ roles }: { roles: Role[] }) {
  const { data, setData } = useLoad(() => api<Record<string, any>>('/settings/pricing'));
  const { data: suppliers } = useLoad(() => api<{ id: string; name: string }[]>('/suppliers'));
  const { data: depots } = useLoad(() => api<{ id: string; name: string }[]>('/stock/depots'));
  const [err, setErr] = useState<string | null>(null);
  if (!data || !suppliers || !depots) return null;
  const matrix = (key: 'supplierVisibility' | 'depotVisibility', items: { id: string; name: string }[], title: string, hint: string) => {
    const vis = (data[key] ?? {}) as Record<string, string[]>;
    const toggle = async (roleId: string, id: string) => {
      const cur = vis[roleId] ?? items.map((x) => x.id);
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      const v: Record<string, any> = { ...vis };
      if (items.every((x) => next.includes(x.id))) delete v[roleId]; else v[roleId] = next;
      try { setData(await api('/settings/pricing', { method: 'PUT', json: { [key]: v } })); } catch (e) { setErr((e as Error).message); }
    };
    return (
      <div className="card overflow-auto">
        <h3 className="font-extrabold">{title}</h3><p className="text-xs text-ink-muted">{hint}</p>
        <table className="w-full text-sm"><thead><tr><th>Rôle</th>{items.map((x) => <th key={x.id} className="text-center">{x.name}</th>)}</tr></thead>
          <tbody>{roles.map((r) => <tr key={r.id}><td className="font-semibold">{r.name}</td>{items.map((x) => <td key={x.id} className="text-center"><input type="checkbox" checked={(vis[r.id] ?? items.map((i) => i.id)).includes(x.id)} onChange={() => toggle(r.id, x.id)} /></td>)}</tr>)}</tbody></table>
      </div>
    );
  };
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {matrix('supplierVisibility', suppliers, 'Ce que chaque rôle voit (par fournisseur)', 'Un produit est rattaché aux fournisseurs dont il porte le code (CIP). Stock, ventes, cockpit et comptabilité (achats, factures) suivent ce filtre.')}
      {matrix('depotVisibility', depots, 'Ce que chaque rôle voit (par dépôt)', 'Comptoir / rayons et réserves : niveaux, valeur et mouvements de stock.')}
      <ErrorBox error={err} />
    </div>
  );
}