import { useState } from 'react';
import { api, can, getSession } from '../lib/api';
import { Badge, ErrorBox, Field, PageTitle, useLoad } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const hm = (d: string | null) => (d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—');
const dur = (m: number | null) => (m === null ? '—' : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`);

/** Contrôle des horaires : rapport des arrivées et départs, retards, postes de pointage et horaires de travail. */
export default function Timeclock() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const { data, error } = useLoad(() => api<any>(`/timeclock/report?from=${from}&to=${to}`), [from, to]);
  const { data: stations, reload: reloadSt } = useLoad(() => api<any[]>('/timeclock/stations'), []);
  const { data: settings, setData: setSettings } = useLoad(() => api<any>('/company/settings'), []);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const slug = getSession()?.tenant.slug ?? '';
  const url = `${location.origin}/pointage/${slug}`;
  async function addStation() { setErr(null); try { setFresh(await api<any>('/timeclock/stations', { method: 'POST', json: { name } })); setName(''); reloadSt(); } catch (e) { setErr((e as Error).message); } }
  async function saveHours() { setErr(null); setMsg(null); try { setSettings(await api('/company/settings', { method: 'PUT', json: { attendance: settings.attendance } })); setMsg('Horaires enregistrés ✓'); } catch (e) { setErr((e as Error).message); } }
  const att = settings?.attendance;
  return (
    <>
      <PageTitle title="Horaires et pointage" sub="Arrivées, départs et retards : chacun pointe avec son code personnel sur un poste enregistré" />
      <ErrorBox error={error ?? err} />
      <div className="card mb-4 space-y-3">
        <h3 className="font-extrabold">Poste de pointage</h3>
        <p className="text-sm text-ink-muted">Ouvrez cette adresse sur l’ordinateur de l’entrée ou du comptoir : <b className="break-all font-mono">{url}</b>. Le poste doit être enregistré avec un code secret généré ci-dessous ; sans lui, aucun pointage n’est accepté. Chaque agent saisit son code personnel (Équipe et accès → Code POS).</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Nom du poste"><input className="w-56" placeholder="Ex. Entrée, Comptoir" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {can('users.write') && <button className="btn" disabled={name.trim().length < 2} onClick={addStation}>Générer un code de poste</button>}
        </div>
        {fresh && <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-sm"><b>Poste « {fresh.name} » créé.</b> Code à saisir <u>une seule fois</u> sur l’ordinateur (il ne sera plus affiché) :<div className="mt-1 select-all break-all rounded bg-white p-2 font-mono text-base font-bold">{fresh.token}</div></div>}
        <table className="w-full text-sm"><thead><tr><th>Poste</th><th>Dernier pointage</th><th>État</th><th /></tr></thead>
          <tbody>{stations?.map((s) => <tr key={s.id}><td><b>{s.name}</b></td><td>{s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleString('fr-FR') : 'jamais'}</td><td>{s.isActive ? <Badge>actif</Badge> : <Badge tone="muted">désactivé</Badge>}</td><td className="text-right">{can('users.write') && <button className="btn-alt !py-0.5 text-xs" onClick={async () => { await api(`/timeclock/stations/${s.id}`, { method: 'PATCH', json: { isActive: !s.isActive } }); reloadSt(); }}>{s.isActive ? 'Désactiver' : 'Réactiver'}</button>}</td></tr>)}</tbody></table>
        {att && can('company.manage') && (
          <div className="flex flex-wrap items-end gap-3 rounded-xl bg-slate-50 p-3">
            <Field label="Heure d’arrivée attendue"><input type="time" value={att.start} onChange={(e) => setSettings({ ...settings, attendance: { ...att, start: e.target.value } })} /></Field>
            <Field label="Heure de départ"><input type="time" value={att.end} onChange={(e) => setSettings({ ...settings, attendance: { ...att, end: e.target.value } })} /></Field>
            <Field label="Tolérance (minutes)"><input type="number" min={0} max={120} className="w-24" value={att.tolerance} onChange={(e) => setSettings({ ...settings, attendance: { ...att, tolerance: Number(e.target.value) } })} /></Field>
            <button className="btn-alt" onClick={saveHours}>Enregistrer les horaires</button>{msg && <span className="text-sm font-bold text-brand">{msg}</span>}
          </div>
        )}
      </div>

      <div className="card">
        <div className="mb-2 flex flex-wrap items-end gap-2"><h3 className="mr-auto font-extrabold">Rapport des horaires</h3>
          <Field label="Du"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="Au"><input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></Field></div>
        {data && (
          <>
            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.summary.map((s: any) => <div key={s.name} className="rounded-xl bg-slate-50 p-3 text-sm"><b>{s.name}</b><div className="text-xs text-ink-muted">{s.days} jour(s) · {dur(s.workedMinutes)}</div><div className={s.lateDays ? 'font-bold text-amber-700' : 'text-brand'}>{s.lateDays ? `${s.lateDays} retard(s), ${s.lateMinutes} min au total` : 'Aucun retard'}</div></div>)}
              {!data.summary.length && <p className="text-sm text-ink-muted">Aucun pointage sur la période.</p>}
            </div>
            <div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>Jour</th><th>Agent</th><th>Arrivée</th><th>Départ</th><th>Présent</th><th>Retard</th><th>Poste</th><th>Adresse réseau</th></tr></thead>
              <tbody>{data.lines.map((l: any) => <tr key={l.id}><td>{new Date(l.day).toLocaleDateString('fr-FR')}</td><td><b>{l.name}</b></td><td>{hm(l.inAt)}</td><td>{l.outAt ? hm(l.outAt) : <span className="text-amber-700">présent</span>}</td><td>{dur(l.worked)}</td><td>{l.late > 0 ? <span className="font-bold text-red-700">+{l.late} min</span> : '—'}</td><td>{l.station}</td><td className="text-xs text-ink-muted">{l.ip}</td></tr>)}</tbody></table></div>
          </>
        )}
      </div>
    </>
  );
}
