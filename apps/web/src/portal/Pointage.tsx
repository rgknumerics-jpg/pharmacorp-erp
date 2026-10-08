import { useCallback, useEffect, useState } from 'react';
import { PinPad } from '../components/PinPad';
import { papi, store } from './portalApi';

/* eslint-disable @typescript-eslint/no-explicit-any */
const hm = (d: string | null) => (d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—');

/** Poste de pointage : chaque agent saisit son code personnel à l'arrivée et au départ. Le poste doit être enregistré par l'administrateur (jeton secret). */
export default function Pointage({ slug }: { slug: string }) {
  const KEY = `clock.${slug}`;
  const [token, setToken] = useState<string>(() => store.get(KEY, ''));
  const [tk, setTk] = useState('');
  const [now, setNow] = useState(new Date());
  const [today, setToday] = useState<any[]>([]);
  const [last, setLast] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { if (token) papi(`/timeclock/${slug}/today`, { headers: { 'x-station-token': token } }).then(setToday).catch((e) => { if (e.status === 403) { setErr(e.message); } }); }, [slug, token]);
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, [load]);
  useEffect(() => { if (last) { const id = setTimeout(() => setLast(null), 6000); return () => clearTimeout(id); } }, [last]);

  if (!token) {
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6">
        <div className="text-center text-5xl">⏱️</div>
        <h1 className="text-center text-xl font-extrabold">Enregistrer ce poste de pointage</h1>
        <p className="text-sm text-slate-600">L’administrateur génère un code de poste dans l’ERP (Horaires → Postes de pointage). Saisissez-le ici une seule fois sur l’ordinateur qui servira au pointage.</p>
        <input className="w-full rounded-lg border border-slate-300 px-3 py-3 font-mono" placeholder="Code du poste" value={tk} onChange={(e) => setTk(e.target.value.trim())} />
        <button className="w-full rounded-xl bg-brand py-3 font-extrabold text-white disabled:opacity-40" disabled={tk.length < 10} onClick={async () => { try { await papi(`/timeclock/${slug}/today`, { headers: { 'x-station-token': tk } }); store.set(KEY, tk); setToken(tk); setErr(null); } catch (e) { setErr((e as Error).message); } }}>Enregistrer ce poste</button>
        {err && <p className="text-sm font-bold text-red-700">{err}</p>}
      </div>
    );
  }
  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 p-4 pb-10">
      <div className="text-center">
        <div className="text-5xl font-extrabold tabular-nums">{now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
        <div className="text-sm text-slate-600">{now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
      </div>
      {last ? (
        <div className={`mt-6 rounded-2xl p-6 text-center shadow ${last.action === 'arrivée' ? (last.late ? 'bg-amber-100' : 'bg-emerald-100') : 'bg-sky-100'}`}>
          <div className="text-5xl">{last.action === 'départ' ? '👋' : last.late ? '⏰' : '✅'}</div>
          <div className="mt-2 text-2xl font-extrabold">{last.name}</div>
          <div className="text-lg font-bold">{last.action === 'déjà' ? 'Déjà pointé à l’instant' : last.action === 'arrivée' ? `Arrivée ${hm(last.at)}` : `Départ ${hm(last.at)}`}</div>
          {last.action === 'arrivée' && <div className={last.late ? 'font-bold text-amber-800' : 'text-emerald-800'}>{last.late ? `Retard : ${last.late} min` : 'À l’heure'}</div>}
          {last.action === 'départ' && last.worked !== undefined && <div className="text-sky-900">Temps présent : {Math.floor(last.worked / 60)} h {String(last.worked % 60).padStart(2, '0')}</div>}
        </div>
      ) : (
        <PinPad icon="⏱️" title="Pointage" subtitle="Saisissez votre code personnel : arrivée ou départ." okLabel="Pointer" onSubmit={async (pin) => { setLast(await papi(`/timeclock/${slug}/punch`, { headers: { 'x-station-token': token }, json: { pin } })); load(); }} />
      )}
      {err && <p className="mt-2 text-center text-sm font-bold text-red-700">{err}</p>}
      <div className="mt-6 rounded-xl bg-white p-3 shadow-sm">
        <div className="mb-1 text-xs font-extrabold uppercase text-slate-500">Aujourd’hui</div>
        {today.map((r, i) => <div key={i} className="flex justify-between border-t border-slate-100 py-1 text-sm"><b>{r.name}</b><span>{hm(r.inAt)} → {hm(r.outAt)} {r.late > 0 && <span className="font-bold text-amber-700">(+{r.late} min)</span>}</span></div>)}
        {!today.length && <p className="text-sm text-slate-500">Personne n’a encore pointé.</p>}
      </div>
    </div>
  );
}
