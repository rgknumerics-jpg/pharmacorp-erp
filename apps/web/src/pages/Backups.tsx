import { useState } from 'react';
import { api, apiBlob, getSession } from '../lib/api';
import { dateTimeFr } from '../lib/format';
import { Badge, ErrorBox, Field, Modal, PageTitle, useLoad } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TRIG: Record<string, string> = { manual: 'manuelle', auto: 'automatique', pre_restore: 'sécurité avant restauration' };

export default function Backups() {
  const { data, error, reload, setData } = useLoad(() => api<any>('/backups'));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [restore, setRestore] = useState<any>(null);
  const hash = location.hash;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); setMsg(null); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  if (!data) return <ErrorBox error={error} />;
  const s = data.settings;
  return (
    <>
      <PageTitle title="Sauvegardes" sub="Copies de toutes vos données : manuelles, automatiques, dans Google Drive — et restauration" />
      {hash.includes('drive=ok') && <div className="mb-3 rounded-lg bg-brand-soft p-2 text-sm font-bold text-brand">Google Drive connecté.</div>}
      {hash.includes('drive=error') && <div className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">Connexion Google Drive échouée : {decodeURIComponent(hash.split('message=')[1] ?? '')}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-2">
          <h3 className="font-extrabold">Sauvegarder maintenant</h3>
          <p className="text-sm text-ink-muted">Dernière : {s.lastBackupAt ? dateTimeFr(s.lastBackupAt) : 'jamais'} {s.lastStatus && `· ${s.lastStatus}`}</p>
          <button className="btn" disabled={busy} onClick={() => run(async () => { const r = await api<any>('/backups', { method: 'POST' }); setMsg(`Sauvegarde ${r.fileName} (${Math.round(r.sizeBytes / 1024)} Ko) ${r.destination === 'drive' ? 'envoyée sur Google Drive' : 'conservée sur le serveur'}${r.driveError ? ` — Drive : ${r.driveError}` : ''}.`); reload(); })}>💾 Sauvegarder</button>
          <h3 className="pt-2 font-extrabold">Sauvegarde automatique</h3>
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={s.autoEnabled} onChange={(e) => run(async () => setData(await api('/backups/settings', { method: 'PUT', json: { autoEnabled: e.target.checked } })))} /> Activée</label>
          <Field label="Fréquence"><select className="w-full" value={s.frequencyHours} onChange={(e) => run(async () => setData(await api('/backups/settings', { method: 'PUT', json: { frequencyHours: Number(e.target.value) } })))}><option value={6}>Toutes les 6 heures</option><option value={12}>Toutes les 12 heures</option><option value={24}>Chaque jour</option><option value={168}>Chaque semaine</option></select></Field>
        </div>
        <div className="card space-y-2">
          <h3 className="font-extrabold">Google Drive</h3>
          {!s.driveConfigured ? (
            <div className="space-y-2 text-sm">
              <p className="text-ink-muted">Google Drive n’est pas encore préparé sur ce serveur. En attendant, vos sauvegardes sont conservées sur l’ordinateur et téléchargeables (copiez-les sur une clé USB ou un disque externe).</p>
              <details className="rounded-lg bg-slate-50 p-2 text-xs"><summary className="cursor-pointer font-bold">Comment préparer Google Drive (une seule fois, par l’administrateur)</summary>
                <ol className="ml-4 mt-1 list-decimal space-y-1">
                  <li>Sur <b>console.cloud.google.com</b>, créez un projet puis activez l’API « Google Drive ».</li>
                  <li>« Identifiants » → créer un « ID client OAuth » de type Application Web.</li>
                  <li>URI de redirection autorisée : <code className="rounded bg-white px-1">{`${(import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'}/backups/drive/callback`}</code></li>
                  <li>Dans le fichier de configuration du serveur (<code>.env</code>), renseignez <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> et <code>GOOGLE_REDIRECT_URI</code> (la même adresse qu’à l’étape 3), puis relancez l’ERP.</li>
                  <li>Revenez ici : le bouton « Connecter Google Drive » apparaît. Les sauvegardes automatiques partiront alors dans le dossier « PHARMACORP ERP - Sauvegardes ».</li>
                </ol>
              </details>
            </div>)
            : s.driveConnected ? <><p className="text-sm">Connecté : <b>{s.driveAccount ?? 'compte Google'}</b> — dossier « PHARMACORP ERP - Sauvegardes ».</p><button className="btn-alt" onClick={() => run(async () => setData(await api('/backups/drive/disconnect', { method: 'POST' })))}>Déconnecter</button></>
              : <button className="btn" onClick={() => run(async () => { const r = await api<{ url: string }>('/backups/drive/auth-url'); location.href = r.url; })}>Connecter Google Drive</button>}
          <p className="text-xs text-ink-muted">L’application n’accède qu’aux fichiers qu’elle crée dans votre Drive.</p>
          <h3 className="pt-2 font-extrabold">Restaurer depuis un fichier</h3>
          <input type="file" accept=".gz,application/gzip" onChange={(e) => e.target.files?.[0] && setRestore({ file: e.target.files[0] })} />
        </div>
      </div>
      {msg && <div className="mt-3 rounded-lg bg-brand-soft p-2 text-sm">{msg}</div>}<ErrorBox error={err} />
      <div className="card mt-4 overflow-auto"><h3 className="mb-2 font-extrabold">Historique</h3><table className="w-full">
        <thead><tr><th>Date</th><th>Type</th><th>Destination</th><th>Taille</th><th /></tr></thead>
        <tbody>{data.records.map((r: any) => <tr key={r.id}><td>{dateTimeFr(r.createdAt)}</td><td>{TRIG[r.trigger] ?? r.trigger}</td><td>{r.destination === 'drive' ? <Badge>Google Drive</Badge> : <Badge tone="muted">serveur</Badge>}{r.error && <div className="text-xs text-red-700">{r.error}</div>}</td><td>{Math.round(r.sizeBytes / 1024)} Ko</td>
          <td className="space-x-1 text-right">{(r.hasLocalCopy || r.driveFileId) && <><button className="btn-alt !py-1" onClick={() => run(async () => { const b = await apiBlob(`/backups/${r.id}/download`); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = r.fileName; a.click(); })}>Télécharger</button><button className="btn-red !py-1" onClick={() => setRestore(r)}>Restaurer</button></>}</td></tr>)}</tbody>
      </table></div>
      {restore && <RestoreModal target={restore} onClose={() => setRestore(null)} onDone={(m) => { setRestore(null); setMsg(m); reload(); }} />}
    </>
  );
}

function RestoreModal({ target, onClose, onDone }: { target: any; onClose: () => void; onDone: (m: string) => void }) {
  const slug = getSession()?.tenant.slug ?? '';
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    try {
      if (target.file) { const form = new FormData(); form.append('file', target.file); form.append('confirm', confirm); await api('/backups/restore-file', { method: 'POST', form }); }
      else await api(`/backups/${target.id}/restore`, { method: 'POST', json: { confirm } });
      onDone('Restauration terminée. Une sauvegarde de sécurité de l’état précédent a été créée automatiquement.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal title="Restaurer une sauvegarde" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="rounded-lg bg-red-50 p-2 font-semibold text-red-800">Toutes les données actuelles (produits, stock, ventes, comptabilité, paie…) seront remplacées par celles de la sauvegarde {target.file ? `« ${target.file.name} »` : `du ${dateTimeFr(target.createdAt)}`}. Les comptes utilisateurs et le journal d’audit sont conservés. Une sauvegarde de sécurité est faite juste avant.</p>
        <Field label={`Pour confirmer, saisissez l’identifiant de l’établissement : ${slug}`}><input className="w-full" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        <ErrorBox error={error} />
        <button className="btn-red" disabled={busy || confirm !== slug} onClick={go}>{busy ? 'Restauration…' : 'Restaurer'}</button>
      </div>
    </Modal>
  );
}