import { useEffect, useMemo, useState } from 'react';
import { api, can } from '../lib/api';
import { Badge, ErrorBox, Field, Modal, useLoad } from '../components/ui';
import SignaturePad from '../components/SignaturePad';

/* Gestion des rôles et des droits (réservée aux comptes qui ont « roles.write » ; lecture pour « roles.read »). */

export interface Perm { code: string; description: string; group: string; label: string }
export interface RoleFull { id: string; name: string; label?: string | null; locked: boolean; members: number; permissions: { permission: { code: string } }[] }
export interface Catalog { groups: string[]; items: Perm[] }

/** Onglets de l'ERP et droit qui les ouvre (même liste que le menu). */
export const TABS: [string, string][] = [
  ['Cockpit (+ Résumé du jour)', 'analytics.read'], ['Recommandations', 'advisor.read'], ['Conseil plantes', 'plants.read'],
  ['Poste vendeur (POS)', 'sales.ticket'], ['Poste caisse (POS)', 'sales.create'], ['Ventes', 'sales.read'], ['Caisses', 'sales.create'], ['Produits', 'products.read'], ['Stock', 'stock.read'],
  ['Achats', 'purchases.read'], ['Fournisseurs', 'purchases.read'], ['Commandes en ligne', 'online.manage'], ['Réception / OCR', 'ocr.use'], ['Clients', 'customers.read'], ['Finances', 'finance.read'],
  ['Comptabilité', 'accounting.read'], ['Calendrier fiscal', 'tax.read'], ['Paie', 'payroll.read'], ['Formation', 'training.use'],
  ['Journal d’audit', 'audit.read'], ['Reprise des données', 'migration.run'], ['Sauvegardes', 'backup.manage'], ['Équipe et accès', 'users.read'],
  ['Annuaires santé', 'directory.read'], ['Ma structure', 'company.view'], ['Bibliothèque', 'library.read'],
];

const codesOf = (r: RoleFull) => r.permissions.map((p) => p.permission.code);

/** Noms usuels des rôles standard (l'identifiant technique reste en anglais). */
const ROLE_FR: Record<string, string> = { owner: 'Titulaire', manager: 'Gérant', pharmacist: 'Pharmacien', cashier: 'Caissier(ère)', seller: 'Vendeur(se)', accountant: 'Comptable', employee: 'Employé' };
let LABELS: Record<string, string> = {};
/** Mémorise les noms affichés choisis par l'administrateur (rôle technique -> nom). */
export const setRoleLabels = (roles: { name: string; label?: string | null }[]) => { LABELS = Object.fromEntries(roles.filter((r) => r.label).map((r) => [r.name, r.label as string])); };
export const roleLabel = (name: string) => LABELS[name] ?? ROLE_FR[name] ?? name;

/** Grille de cases à cocher groupées par rubrique. */
function PermGrid({ catalog, value, onChange, disabled }: { catalog: Catalog; value: Set<string>; onChange: (s: Set<string>) => void; disabled?: boolean }) {
  const toggle = (c: string) => { const n = new Set(value); if (n.has(c)) n.delete(c); else n.add(c); onChange(n); };
  const setGroup = (codes: string[], on: boolean) => { const n = new Set(value); codes.forEach((c) => (on ? n.add(c) : n.delete(c))); onChange(n); };
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {catalog.groups.map((g) => {
        const items = catalog.items.filter((i) => i.group === g);
        if (!items.length) return null;
        const codes = items.map((i) => i.code);
        const nOn = codes.filter((c) => value.has(c)).length;
        return (
          <div key={g} className="rounded-xl border border-ink-line p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <b>{g} <span className="text-xs font-normal text-ink-muted">({nOn}/{codes.length})</span></b>
              {!disabled && <span className="text-xs"><button type="button" className="font-bold text-brand underline" onClick={() => setGroup(codes, true)}>tout</button> · <button type="button" className="font-bold text-ink-muted underline" onClick={() => setGroup(codes, false)}>aucun</button></span>}
            </div>
            {items.map((i) => (
              <label key={i.code} className="flex items-start gap-2 py-0.5 text-sm" title={i.description}>
                <input type="checkbox" className="mt-1" checked={value.has(i.code)} disabled={disabled} onChange={() => toggle(i.code)} />
                <span>{i.label}</span>
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Rubriques (onglets) ouvertes par un jeu de droits. */
export function TabsPreview({ perms }: { perms: Set<string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {TABS.map(([label, perm]) => <span key={label} className={`rounded-full px-2 py-0.5 text-xs font-bold ${perms.has(perm) ? 'bg-brand-soft text-brand' : 'bg-slate-100 text-slate-400 line-through'}`}>{label}</span>)}
    </div>
  );
}

/** Roles : liste, droits par rubrique, création, suppression. */
export function RolesManager({ onChanged }: { onChanged: () => void }) {
  const writable = can('roles.write');
  const { data: roles, reload, error } = useLoad(() => api<RoleFull[]>('/roles'));
  const { data: catalog } = useLoad(() => api<Catalog>('/roles/permissions/catalog'));
  const [selId, setSelId] = useState<string | null>(null);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const sel = roles?.find((r) => r.id === selId) ?? null;
  if (roles) setRoleLabels(roles);
  const [label, setLabel] = useState('');

  useEffect(() => { if (!selId && roles?.length) setSelId(roles[0].id); }, [roles, selId]);
  useEffect(() => { if (sel) { setPerms(new Set(codesOf(sel))); setName(sel.name); setLabel(sel.label ?? roleLabel(sel.name)); setMsg(null); setErr(null); } }, [selId, roles]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => !!sel && (perms.size !== codesOf(sel).length || codesOf(sel).some((c) => !perms.has(c))), [sel, name, perms]);

  async function save() {
    if (!sel) return;
    setErr(null); setMsg(null);
    try { await api(`/roles/${sel.id}`, { method: 'PUT', json: { permissions: [...perms] } }); setMsg('Rôle enregistré ✓ — les agents concernés verront le changement à leur prochaine connexion.'); reload(); onChanged(); } catch (e) { setErr((e as Error).message); }
  }
  async function saveLabel() {
    if (!sel) return;
    setErr(null); setMsg(null);
    try { await api(`/roles/${sel.id}/label`, { method: 'PUT', json: { label } }); setMsg('Nom du rôle enregistré ✓'); reload(); onChanged(); } catch (e) { setErr((e as Error).message); }
  }
  async function remove() {
    if (!sel || !confirm(`Supprimer le rôle « ${roleLabel(sel.name)} » ?`)) return;
    setErr(null);
    try { await api(`/roles/${sel.id}`, { method: 'DELETE' }); setSelId(null); reload(); onChanged(); } catch (e) { setErr((e as Error).message); }
  }

  if (error) return <div className="card mt-4"><ErrorBox error={error} /></div>;
  if (!roles || !catalog) return <div className="card mt-4 text-sm text-ink-muted">Chargement des rôles…</div>;
  return (
    <div className="card mt-4 space-y-3" id="roles">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-lg font-extrabold">Rôles et droits d’accès</h3><p className="text-xs text-ink-muted">Cochez, pour chaque rôle, les rubriques et les actions autorisées. Les filtres par TVA, fournisseur et dépôt se règlent plus bas.</p></div>
        {writable && <button className="btn" onClick={() => setCreating(true)}>+ Nouveau rôle</button>}
      </div>
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="space-y-1">
          {roles.map((r) => (
            <button key={r.id} onClick={() => setSelId(r.id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold ${r.id === selId ? 'bg-brand-soft text-brand' : 'hover:bg-slate-50'}`}>
              <span>{roleLabel(r.name)}</span><span className="text-xs font-normal text-ink-muted">{r.members} agent{r.members > 1 ? 's' : ''}</span>
            </button>
          ))}
        </div>
        {sel && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Nom affiché du rôle"><input className="w-64" value={label} disabled={!writable} maxLength={40} onChange={(e) => setLabel(e.target.value)} /></Field>
              {writable && <button className="btn-alt" disabled={label.trim().length < 2 || label.trim() === (sel.label ?? roleLabel(sel.name))} onClick={saveLabel}>✎ Enregistrer le nom</button>}
              {sel.locked && <Badge tone="info">titulaire : tous les droits, non modifiable</Badge>}
            </div>
            <div><div className="mb-1 text-xs font-bold uppercase text-ink-muted">Rubriques ouvertes</div><TabsPreview perms={perms} /></div>
            <PermGrid catalog={catalog} value={perms} onChange={setPerms} disabled={!writable || sel.locked} />
            <ErrorBox error={err} />
            {msg && <p className="text-sm font-bold text-brand">{msg}</p>}
            {writable && !sel.locked && (
              <div className="flex flex-wrap gap-2">
                <button className="btn" disabled={!dirty} onClick={save}>💾 Enregistrer le rôle</button>
                <button className="btn-alt text-red-700" onClick={remove}>Supprimer</button>
              </div>
            )}
          </div>
        )}
      </div>
      {creating && <NewRole roles={roles} catalog={catalog} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelId(id); reload(); onChanged(); }} />}
    </div>
  );
}

function NewRole({ roles, catalog, onClose, onCreated }: { roles: RoleFull[]; catalog: Catalog; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const r = roles.find((x) => x.id === from); if (r) setPerms(new Set(codesOf(r))); }, [from]); // eslint-disable-line react-hooks/exhaustive-deps
  async function create() { try { const r = await api<{ id: string }>('/roles', { method: 'POST', json: { name, permissions: [...perms] } }); onCreated(r.id); } catch (e) { setErr((e as Error).message); } }
  return (
    <Modal title="Nouveau rôle" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Nom du rôle (ex. Vendeur, Magasinier, Préparateur)"><input className="w-full" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label="Partir des droits d’un rôle existant"><select className="w-full" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">— aucun (tout décoché) —</option>{roles.map((r) => <option key={r.id} value={r.id}>{roleLabel(r.name)}</option>)}</select></Field>
        </div>
        <TabsPreview perms={perms} />
        <PermGrid catalog={catalog} value={perms} onChange={setPerms} />
        <ErrorBox error={err} />
        <button className="btn" disabled={name.trim().length < 2} onClick={create}>Créer le rôle</button>
      </div>
    </Modal>
  );
}

/** Création d'un agent : identité, rôle (avec rappel de ce que le rôle ouvre) et signature. */
export function AddMember({ roles, onClose, onSaved }: { roles: RoleFull[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ fullName: '', email: '', password: '', roleId: roles.find((r) => r.name === 'cashier')?.id ?? roles[0]?.id ?? '' });
  const [signature, setSignature] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const role = roles.find((r) => r.id === f.roleId);
  const perms = new Set(role ? codesOf(role) : []);
  async function save() { try { await api('/users', { method: 'POST', json: { ...f, ...(signature ? { signature } : {}) } }); onSaved(); } catch (e) { setErr((e as Error).message); } }
  return (
    <Modal title="Nouvel agent" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Nom et prénoms"><input className="w-full" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} autoFocus /></Field>
          <Field label="Rôle"><select className="w-full" value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.id}>{roleLabel(r.name)}</option>)}</select></Field>
          <Field label="E-mail (identifiant)"><input type="email" className="w-full" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Mot de passe initial (8 car. min.)"><input type="password" className="w-full" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="mb-1 text-xs font-bold uppercase text-ink-muted">Ce que ce rôle ouvre ({role ? roleLabel(role.name) : '—'})</div>
          <TabsPreview perms={perms} />
          <p className="mt-2 text-xs text-ink-muted">Pour changer les droits, modifiez le rôle dans « Rôles et droits d’accès » (plus bas) ou créez un rôle sur mesure. Les filtres par TVA, fournisseur et dépôt s’appliquent par rôle.</p>
        </div>
        <Field label="Signature de l’agent (apposée sur ses pièces de caisse)"><SignaturePad onChange={setSignature} /></Field>
        <ErrorBox error={err} /><button className="btn" disabled={!f.fullName || !f.email || f.password.length < 8 || !f.roleId} onClick={save}>Créer l’agent</button>
      </div>
    </Modal>
  );
}

/** Modification d'un agent : rôle et activation. */
export function EditMember({ m, roles, onClose, onSaved }: { m: { id: string; isActive: boolean; roleId: string; user: { fullName: string; email: string } }; roles: RoleFull[]; onClose: () => void; onSaved: () => void }) {
  const [roleId, setRoleId] = useState(m.roleId);
  const [active, setActive] = useState(m.isActive);
  const [err, setErr] = useState<string | null>(null);
  const role = roles.find((r) => r.id === roleId);
  async function save() { try { await api(`/users/${m.id}`, { method: 'PATCH', json: { roleId, isActive: active } }); onSaved(); } catch (e) { setErr((e as Error).message); } }
  return (
    <Modal title={`Agent : ${m.user.fullName}`} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="text-sm text-ink-muted">{m.user.email}</div>
        <Field label="Rôle"><select className="w-full max-w-sm" value={roleId} onChange={(e) => setRoleId(e.target.value)}>{roles.map((r) => <option key={r.id} value={r.id}>{roleLabel(r.name)}</option>)}</select></Field>
        <TabsPreview perms={new Set(role ? codesOf(role) : [])} />
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Compte actif</label>
        <p className="text-xs text-ink-muted">Le changement s’applique à la prochaine connexion de l’agent.</p>
        <ErrorBox error={err} /><button className="btn" onClick={save}>Enregistrer</button>
      </div>
    </Modal>
  );
}
