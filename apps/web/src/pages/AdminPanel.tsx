import { useState } from 'react';
import { api } from '../lib/api';
import { ErrorBox, PageTitle, useLoad } from '../components/ui';
import { SettingsSection } from './CompanySettings';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const MODULES: [string, string, string, string][] = [
  ['online', '📱', 'Commandes en ligne', 'Application client, site web et application livreur. Active aussi le catalogue public.'],
  ['chat', '💬', 'Messagerie interne', 'Discussion d’équipe, messages privés, informations et alertes.'],
  ['suppliers', '🚚', 'Fournisseurs', 'Catalogues Laborex / Ubipharm / CEP, réclamations, retours et avoirs.'],
  ['plants', '🌿', 'Conseil plantes', 'Fiches de plantes médicinales, précautions et interactions.'],
  ['training', '🎓', 'Formation', 'Conseils du jour et quiz pour l’équipe.'],
  ['library', '📚', 'Bibliothèque', 'Textes légaux et documents de référence.'],
  ['directory', '📇', 'Annuaires santé', 'Délégués, laboratoires, agences, dépôts, districts et formations sanitaires.'],
  ['payroll', '👔', 'Paie', 'Salariés, bulletins, CNSS, ITS.'],
];

/** Panneau d'administration (titulaire / super-administrateur uniquement) : fonctions visibles, politique de caisse, protections et visibilités. */
export default function AdminPanel({ go }: { go: (p: string) => void }) {
  const { data, error, setData } = useLoad(() => api<any>('/company/settings'), []);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function toggle(key: string, on: boolean) {
    setErr(null); setMsg(null);
    const patch: any = { modules: { [key]: on } };
    if (key === 'online') patch.online = { enabled: on };
    try { const s = await api<any>('/company/settings', { method: 'PUT', json: patch }); setData(s); window.dispatchEvent(new CustomEvent('erp:settings', { detail: s })); setMsg(`« ${MODULES.find((m) => m[0] === key)?.[2]} » ${on ? 'activée : elle apparaît dans le menu' : 'désactivée : elle disparaît du menu pour tous'}.`); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <>
      <PageTitle title="Panneau d’administration" sub="Réservé au titulaire : rendez visibles ou non les fonctions, et décidez qui voit quoi" />
      <ErrorBox error={error ?? err} />
      <div className="card space-y-3">
        <div><h3 className="text-lg font-extrabold">Fonctions de l’ERP</h3><p className="text-xs text-ink-muted">Une fonction désactivée disparaît du menu de tous les agents ; ses données sont conservées et reviennent dès que vous la réactivez.</p></div>
        {msg && <div className="rounded-lg bg-brand-soft p-2 text-sm font-bold text-brand">{msg}</div>}
        <div className="grid gap-2 md:grid-cols-2">
          {MODULES.map(([k, icon, name, desc]) => {
            const on = data?.modules?.[k] !== false;
            return (
              <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ${on ? 'bg-emerald-50 ring-emerald-200' : 'bg-slate-100 ring-slate-200'}`}>
                <input type="checkbox" className="mt-1 h-5 w-5" checked={on} onChange={(e) => toggle(k, e.target.checked)} />
                <span className={on ? '' : 'opacity-60'}><b>{icon} {name}</b><span className="block text-xs text-ink-muted">{desc}</span></span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${on ? 'bg-brand text-white' : 'bg-slate-300 text-slate-700'}`}>{on ? 'Visible' : 'Masquée'}</span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="card mt-4 space-y-2">
        <h3 className="text-lg font-extrabold">Verrouillage des onglets</h3>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={!!data?.accessLock?.enabled} onChange={async (e) => { try { const s = await api<any>('/company/settings', { method: 'PUT', json: { accessLock: { enabled: e.target.checked } } }); setData(s); window.dispatchEvent(new CustomEvent('erp:settings', { detail: s })); setMsg(e.target.checked ? 'Verrouillage activé : chaque agent saisit son code personnel pour ouvrir un onglet.' : 'Verrouillage désactivé.'); } catch (x) { setErr((x as Error).message); } }} />
          <span><b>Code personnel pour ouvrir chaque onglet</b><span className="block text-xs text-ink-muted">Tous sauf vous (titulaire) : le code identifie la personne et chaque passage est enregistré dans le journal d’audit (qui est allé où, quand). Les codes se définissent dans Équipe et accès → Code POS.</span></span>
        </label>
      </div>
      <div className="card mt-4 space-y-2">
        <h3 className="text-lg font-extrabold">Qui voit quoi</h3>
        <p className="text-sm text-ink-muted">Les écrans, les taux de TVA, les fournisseurs et les dépôts visibles se règlent rôle par rôle. Ce qui est masqué à un rôle disparaît aussi des totaux qu’il consulte (valeur du stock, ventes, caisse).</p>
        <div className="flex flex-wrap gap-2"><button className="btn-alt" onClick={() => go('team')}>Droits des rôles, TVA, fournisseurs et dépôts visibles →</button></div>
      </div>
      <SettingsSection />
    </>
  );
}
