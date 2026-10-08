import { ReactNode, useCallback, useEffect, useState } from 'react';
import { papi } from '../portal/portalApi';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Contrôle de la licence : sans clé valide (installation diffusée à l'équipe), on demande la clé fournie ; sinon l'ERP s'ouvre normalement. */
export default function LicenseGate({ children }: { children: ReactNode }) {
  const [s, setS] = useState<any | null>(null);
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => papi('/license/status').then(setS).catch(() => setS((x: any) => x ?? { valid: true, offline: true })), []);
  useEffect(() => { load(); const id = setInterval(load, 5 * 60_000); return () => clearInterval(id); }, [load]);
  if (!s) return null;
  if (s.valid) {
    return (
      <>
        {s.enforced && typeof s.daysLeft === 'number' && s.daysLeft <= 7 && <div className="bg-amber-500 px-4 py-1.5 text-center text-sm font-bold text-white">Licence « {s.edition ?? 'test'} » : expire dans {s.daysLeft} jour(s) ({s.expires}). Demandez une nouvelle clé.</div>}
        {children}
      </>
    );
  }
  async function activate() {
    setBusy(true); setErr(null);
    try { setS(await papi('/license/activate', { json: { key } })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-900 to-emerald-700 p-4">
      <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
        <img src="/logo-erp.png" alt="PHARMACORP ERP" className="mx-auto h-16 object-contain" />
        <h1 className="text-center text-xl font-extrabold">Activation de la licence</h1>
        <p className="rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700">{s.reason ?? 'Licence requise.'}</p>
        <p className="text-sm text-slate-600">Collez la clé de licence reçue de PHARMACORP. Pour une licence liée à cet ordinateur, communiquez-lui d’abord l’identifiant ci-dessous.</p>
        <div className="flex items-center justify-between rounded-lg bg-slate-100 p-2 text-sm"><span>Identifiant de ce poste : <b className="font-mono">{s.machineId}</b></span><button className="rounded-lg bg-white px-2 py-1 text-xs font-bold ring-1 ring-slate-300" onClick={() => navigator.clipboard?.writeText(s.machineId)}>Copier</button></div>
        <textarea rows={5} className="w-full rounded-lg border border-slate-300 p-2 font-mono text-xs" placeholder="PCERP.xxxxxxxx.xxxxxxxx" value={key} onChange={(e) => setKey(e.target.value)} />
        {err && <p className="text-sm font-bold text-red-700">{err}</p>}
        <button className="w-full rounded-xl bg-emerald-700 py-3 text-lg font-extrabold text-white disabled:opacity-40" disabled={busy || key.trim().length < 20} onClick={activate}>{busy ? 'Vérification…' : 'Activer'}</button>
      </div>
    </div>
  );
}
