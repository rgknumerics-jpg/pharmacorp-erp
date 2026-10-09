import { useEffect, useState } from 'react';
import { api, can } from '../lib/api';
import { ErrorBox, useLoad } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3">
      <input type="checkbox" className="mt-1" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span><b className="text-sm">{label}</b>{hint && <span className="block text-xs text-ink-muted">{hint}</span>}</span>
    </label>
  );
}

/** Listes personnalisées : l'utilisateur crée lui-même les formes et les emplacements (rayons) proposés dans la fiche produit. */
function ListEditor({ title, items, onChange, placeholder }: { title: string; items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [v, setV] = useState('');
  const add = () => { const x = v.trim(); if (x && !items.includes(x)) onChange([...items, x]); setV(''); };
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="mb-2 text-sm font-extrabold">{title}</div>
      <div className="mb-2 flex flex-wrap gap-1">{items.map((x) => <span key={x} className="rounded-full bg-white px-3 py-1 text-xs font-bold ring-1 ring-ink-line">{x} <button className="ml-1 text-red-600" onClick={() => onChange(items.filter((y) => y !== x))}>×</button></span>)}{!items.length && <span className="text-xs text-ink-muted">Aucun élément ajouté.</span>}</div>
      <div className="flex gap-2"><input className="flex-1" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /><button className="btn-alt" onClick={add}>Ajouter</button></div>
    </div>
  );
}

export function SettingsSection() {
  const write = can('company.manage');
  const { data, error, setData } = useLoad(() => api<any>('/company/settings'), []);
  const { data: cats } = useLoad(() => api<{ id: string; name: string }[]>('/categories'), []);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 3000); return () => clearTimeout(t); } }, [msg]);
  if (!data) return <ErrorBox error={error} />;
  const set = (k: string, patch: Record<string, unknown>) => setData({ ...data, [k]: { ...data[k], ...patch } });
  async function save() {
    setErr(null);
    try { setData(await api('/company/settings', { method: 'PUT', json: data })); setMsg('Réglages enregistrés.'); } catch (e) { setErr((e as Error).message); }
  }
  const hiddenCat = new Set<string>(data.online.hiddenCategoryIds);
  const dis = !write;
  return (
    <div className="card mt-4 space-y-5">
      <div>
        <h2 className="text-lg font-extrabold">Réglages de l’établissement</h2>
        <p className="text-sm text-ink-muted">Politique de caisse, protection des postes, listes personnalisées, mentions du ticket et application client.</p>
      </div>

      <section className="space-y-2">
        <h3 className="font-extrabold">💰 Caisse : ce que la caissière peut voir</h3>
        <p className="text-xs text-ink-muted">Pour éviter qu’un excédent soit prélevé, vous pouvez compter « à l’aveugle ». Le fond de départ, le fond de clôture et les dépenses restent toujours visibles. Vous (responsables) voyez tout, dans tous les cas : recette par mode de paiement (espèces, Mobile Money, chèque, virement, carte), attendu et écart.</p>
        <div className="grid gap-2 md:grid-cols-2">
          <Toggle on={data.cashPolicy.showTakings} onChange={(v) => set('cashPolicy', { showTakings: v })} label="Afficher la recette à la caissière" hint="Espèces encaissées, Mobile Money, chèque, virement, carte" />
          <Toggle on={data.cashPolicy.showExpected} onChange={(v) => set('cashPolicy', { showExpected: v })} label="Afficher l’attendu en caisse" hint="Montant attendu et écart à la clôture" />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-extrabold">🔒 Postes protégés par un code personnel</h3>
        <p className="text-xs text-ink-muted">Le code identifie la personne qui travaille (chacun a le sien : Équipe et accès → Code POS). Les ventes et la caisse sont alors à son nom.</p>
        <div className="grid gap-2 md:grid-cols-3">
          <Toggle on={data.posLock.seller} onChange={(v) => set('posLock', { seller: v })} label="Poste vendeur" />
          <Toggle on={data.posLock.cashier} onChange={(v) => set('posLock', { cashier: v })} label="Poste caisse" />
          <Toggle on={data.posLock.direct} onChange={(v) => set('posLock', { direct: v })} label="Vente directe" hint="Réservée au pharmacien" />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-extrabold">📋 Listes de la fiche produit</h3>
        <p className="text-xs text-ink-muted">Ajoutez ici vos propres formes galéniques et emplacements : ils seront proposés à la création d’un produit. (Catégories, organismes tiers payants et taux de TVA se créent dans leurs écrans respectifs.)</p>
        <div className="grid gap-3 md:grid-cols-2">
          <ListEditor title="Formes" items={data.lists.forms} onChange={(v) => set('lists', { forms: v })} placeholder="Ex. Collyre, Ovule, Sachet…" />
          <ListEditor title="Emplacements / rayons" items={data.lists.locations} onChange={(v) => set('lists', { locations: v })} placeholder="Ex. Rayon 3, Réfrigérateur, Vitrine…" />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-extrabold">📱 Application client, site web et livraison</h3>
        <p className="text-xs text-ink-muted">Les clients s’inscrivent depuis l’application de la pharmacie et voient la disponibilité des produits. Vous décidez des catégories visibles ; les produits se choisissent un à un dans la fiche produit.</p>
        <div className="grid gap-2 md:grid-cols-3">
          <Toggle on={data.online.enabled} onChange={(v) => set('online', { enabled: v })} label="Catalogue en ligne actif" />
          <Toggle on={data.online.registration} onChange={(v) => set('online', { registration: v })} label="Inscription des clients" />
          <Toggle on={data.online.delivery} onChange={(v) => set('online', { delivery: v })} label="Livraison" hint="Le livreur est notifié à chaque paiement validé" />
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="mb-2 text-sm font-extrabold">Habillage (nom, logo, couleur)</div>
          <p className="mb-2 text-xs text-ink-muted">Laissez vide pour reprendre le nom et le logo de la pharmacie. Renseignez ces champs si l’application client a sa propre marque (ex. « Rive Gauche »).</p>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="block text-xs font-bold text-ink-muted">Nom de la marque
              <input className="mt-1 w-full" placeholder="Ex. Rive Gauche" value={data.online.brandName} onChange={(e) => set('online', { brandName: e.target.value })} />
            </label>
            <label className="block text-xs font-bold text-ink-muted">Slogan
              <input className="mt-1 w-full" placeholder="Ex. Votre univers en harmonie, pour un Vous unique" value={data.online.tagline} onChange={(e) => set('online', { tagline: e.target.value })} />
            </label>
            <label className="block text-xs font-bold text-ink-muted">Logo (chemin ou URL)
              <input className="mt-1 w-full" placeholder="/brands/rive-gauche-logo.jpg" value={data.online.logoUrl} onChange={(e) => set('online', { logoUrl: e.target.value })} />
            </label>
            <label className="block text-xs font-bold text-ink-muted">Couleur principale
              <div className="mt-1 flex items-center gap-2">
                <input type="color" className="h-9 w-12 cursor-pointer rounded border border-ink-line p-0" value={data.online.primaryColor || '#16a34a'} onChange={(e) => set('online', { primaryColor: e.target.value })} />
                <input className="flex-1" placeholder="#EA7A1E" value={data.online.primaryColor} onChange={(e) => set('online', { primaryColor: e.target.value })} />
              </div>
            </label>
          </div>
          {(data.online.logoUrl || data.online.brandName) && (
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-white p-2 ring-1 ring-ink-line">
              {data.online.logoUrl && <img src={data.online.logoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />}
              <div>
                <div className="text-sm font-extrabold" style={data.online.primaryColor ? { color: data.online.primaryColor } : undefined}>{data.online.brandName || 'Aperçu'}</div>
                {data.online.tagline && <div className="text-xs text-ink-muted">{data.online.tagline}</div>}
              </div>
            </div>
          )}
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="mb-2 text-sm font-extrabold">Catégories visibles dans l’application client</div>
          <div className="flex flex-wrap gap-2">{cats?.map((c) => { const on = !hiddenCat.has(c.id); return <label key={c.id} className={`cursor-pointer rounded-full px-3 py-1 text-xs font-bold ${on ? 'bg-brand text-white' : 'bg-white ring-1 ring-ink-line line-through'}`}><input type="checkbox" className="hidden" checked={on} onChange={() => set('online', { hiddenCategoryIds: on ? [...hiddenCat, c.id] : [...hiddenCat].filter((x) => x !== c.id) })} />{c.name}</label>; })}{cats && !cats.length && <span className="text-xs text-ink-muted">Aucune catégorie créée.</span>}</div>
        </div>
      </section>

      <ErrorBox error={err} />
      {write && <div className="flex items-center gap-3"><button className="btn" disabled={dis} onClick={save}>Enregistrer les réglages</button>{msg && <span className="text-sm font-bold text-brand">✓ {msg}</span>}</div>}
    </div>
  );
}
