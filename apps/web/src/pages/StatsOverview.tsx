import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fcfa, PAY_LABEL } from '../lib/format';
import { ErrorBox, useLoad } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const addDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const DOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const PALETTE = ['#0a7a3f', '#f58a07', '#0ea5e9', '#8b5cf6', '#ef4444', '#14b8a6', '#eab308', '#64748b'];
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(Math.round(n)));

/** Courbe en aire avec dégradé, points survolables et repères. */
function AreaChart({ data }: { data: { d: string; ca: number }[] }) {
  const W = 760, H = 220, P = { l: 44, r: 12, t: 14, b: 26 };
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return <p className="p-6 text-center text-sm text-ink-muted">Pas assez de jours pour tracer une courbe.</p>;
  const max = Math.max(1, ...data.map((x) => x.ca)) * 1.1;
  const x = (i: number) => P.l + (i / (data.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const line = data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.ca).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1)},${H - P.b} L${x(0)},${H - P.b} Z`;
  const avg = data.reduce((s, p) => s + p.ca, 0) / data.length;
  const best = data.reduce((b, p, i) => (p.ca > data[b].ca ? i : b), 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHover(null)}>
      <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0a7a3f" stopOpacity=".45" /><stop offset="100%" stopColor="#0a7a3f" stopOpacity="0" /></linearGradient></defs>
      {[0, 0.25, 0.5, 0.75, 1].map((k) => <g key={k}><line x1={P.l} x2={W - P.r} y1={y(max * k)} y2={y(max * k)} stroke="#e2e8f0" strokeDasharray="3 4" /><text x={P.l - 6} y={y(max * k) + 4} textAnchor="end" fontSize="10" fill="#64748b">{compact(max * k)}</text></g>)}
      <line x1={P.l} x2={W - P.r} y1={y(avg)} y2={y(avg)} stroke="#f58a07" strokeDasharray="6 4" /><text x={W - P.r} y={y(avg) - 4} textAnchor="end" fontSize="10" fill="#f58a07" fontWeight="700">moyenne {compact(avg)}</text>
      <path d={area} fill="url(#ga)" /><path d={line} fill="none" stroke="#0a7a3f" strokeWidth="2.5" strokeLinejoin="round" />
      {data.map((p, i) => <g key={p.d}><rect x={x(i) - (W / data.length) / 2} y={P.t} width={W / data.length} height={H - P.t - P.b} fill="transparent" onMouseEnter={() => setHover(i)} />{(i === best || hover === i) && <circle cx={x(i)} cy={y(p.ca)} r={hover === i ? 5 : 4} fill={i === best ? '#f58a07' : '#0a7a3f'} stroke="#fff" strokeWidth="2" />}</g>)}
      {[0, Math.floor(data.length / 2), data.length - 1].map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fontSize="10" fill="#64748b">{new Date(data[i].d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</text>)}
      {hover !== null && <g><line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="#0a7a3f" strokeOpacity=".3" /><g transform={`translate(${Math.min(Math.max(x(hover) - 70, P.l), W - 150)},${P.t})`}><rect width="140" height="38" rx="8" fill="#0b1f15" opacity=".92" /><text x="8" y="15" fontSize="10" fill="#cbd5e1">{new Date(data[hover].d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}</text><text x="8" y="31" fontSize="13" fontWeight="800" fill="#fff">{fcfa(data[hover].ca)}</text></g></g>}
    </svg>
  );
}

function Donut({ rows, label, value }: { rows: any[]; label: string; value: string }) {
  const total = rows.reduce((s, r) => s + r[value], 0) || 1;
  let acc = 0; const R = 54, C = 2 * Math.PI * R;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 140 140" className="h-36 w-36 -rotate-90">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#f1f5f9" strokeWidth="22" />
        {rows.map((r, i) => { const len = (r[value] / total) * C; const el = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="22" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />; acc += len; return el; })}
        <g className="rotate-90" style={{ transformOrigin: '70px 70px' }}><text x="70" y="66" textAnchor="middle" fontSize="11" fill="#64748b">Total</text><text x="70" y="82" textAnchor="middle" fontSize="13" fontWeight="800" fill="#0b1f15">{compact(total)}</text></g>
      </svg>
      <div className="min-w-[160px] flex-1 space-y-1 text-sm">{rows.map((r, i) => <div key={i} className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="flex-1 truncate">{label === 'method' ? PAY_LABEL[r.method] ?? r.method : r[label]}</span><b>{Math.round((r[value] / total) * 100)} %</b></div>)}</div>
    </div>
  );
}

function Heatmap({ rows }: { rows: { dow: number; h: number; n: number }[] }) {
  const grid = useMemo(() => { const m = new Map(rows.map((r) => [`${r.dow}-${r.h}`, r.n])); return m; }, [rows]);
  const max = Math.max(1, ...rows.map((r) => r.n));
  const hours = Array.from({ length: 16 }, (_, i) => i + 7); // 7 h → 22 h
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="overflow-auto">
      <table className="w-full border-separate border-spacing-1 text-center text-[10px]"><thead><tr><th />{hours.map((h) => <th key={h} className="font-normal text-ink-muted">{h}h</th>)}</tr></thead>
        <tbody>{order.map((d) => <tr key={d}><td className="pr-1 text-right text-xs font-bold text-ink-muted">{DOW[d]}</td>{hours.map((h) => { const n = grid.get(`${d}-${h}`) ?? 0; const k = n / max; return <td key={h} title={`${DOW[d]} ${h} h : ${n} ticket(s)`} className="h-6 rounded" style={{ background: n ? `rgba(10,122,63,${0.12 + k * 0.88})` : '#f1f5f9', color: k > 0.55 ? '#fff' : '#0b1f15' }}>{n || ''}</td>; })}</tr>)}</tbody></table>
      <p className="mt-1 text-xs text-ink-muted">Nombre de tickets par jour de la semaine et par heure : repérez les heures de pointe pour organiser l’équipe.</p>
    </div>
  );
}

function Kpi({ label, value, sub, evo, icon }: { label: string; value: string; sub?: string; evo?: number | null; icon: string }) {
  return (
    <div className="card relative overflow-hidden !p-3"><div className="absolute -right-3 -top-3 text-6xl opacity-10">{icon}</div>
      <div className="text-[11px] font-bold uppercase text-ink-muted">{label}</div><div className="text-2xl font-extrabold">{value}</div>
      <div className="flex items-center gap-2 text-xs">{evo !== undefined && evo !== null && <span className={`rounded-full px-2 py-0.5 font-bold ${evo >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>{evo >= 0 ? '▲' : '▼'} {Math.abs(evo).toLocaleString('fr-FR')} %</span>}{sub && <span className="text-ink-muted">{sub}</span>}</div></div>
  );
}

/** Statistiques en images : indicateurs avec évolution, courbe des ventes, heures de pointe, modes de paiement, meilleurs produits. */
export default function StatsOverview() {
  const [from, setFrom] = useState(addDays(-29));
  const [to, setTo] = useState(addDays(0));
  const { data, error, loading } = useLoad(() => api<any>(`/sales/stats-overview?from=${from}&to=${to}`), [from, to]);
  const k = data?.kpis;
  const quick = (a: number) => { setFrom(addDays(a)); setTo(addDays(0)); };
  const topMax = Math.max(1, ...(data?.top ?? []).map((t: any) => t.ca));
  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold">Du<input type="date" className="block" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs font-bold">Au<input type="date" className="block" value={to} min={from} max={addDays(0)} onChange={(e) => setTo(e.target.value)} /></label>
        {[['7 jours', -6], ['30 jours', -29], ['90 jours', -89], ['1 an', -364]].map(([l, n]) => <button key={l as string} className="btn-alt !py-1" onClick={() => quick(Number(n))}>{l}</button>)}
        {loading && <span className="text-sm text-ink-muted">Calcul…</span>}
        <span className="ml-auto text-xs text-ink-muted">Comparé à la période précédente de même durée</span>
      </div>
      <ErrorBox error={error} />
      {k && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon="💰" label="Chiffre d’affaires" value={fcfa(k.ca)} evo={k.caEvolution} sub={`${fcfa(k.perDay)} / jour`} />
            <Kpi icon="🧾" label="Tickets" value={k.tickets.toLocaleString('fr-FR')} evo={k.ticketsEvolution} sub={`${k.units.toLocaleString('fr-FR')} articles`} />
            <Kpi icon="🛍" label="Panier moyen" value={fcfa(k.basket)} evo={k.basketPrev ? Math.round(((k.basket - k.basketPrev) / k.basketPrev) * 1000) / 10 : null} />
            {k.margin !== null ? <Kpi icon="📈" label="Marge brute" value={fcfa(k.margin)} sub={`${k.marginRate} % du CA`} /> : <Kpi icon="📦" label="Articles vendus" value={k.units.toLocaleString('fr-FR')} />}
          </div>
          <div className="card"><div className="mb-1 font-extrabold">Chiffre d’affaires par jour</div><AreaChart data={data.daily} /></div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="card"><div className="mb-2 font-extrabold">Heures de pointe</div><Heatmap rows={data.heat} /></div>
            <div className="card space-y-4"><div><div className="mb-2 font-extrabold">Modes de paiement</div><Donut rows={data.payments} label="method" value="amount" /></div><div><div className="mb-2 font-extrabold">Types de ventes</div><Donut rows={data.kinds.map((x: any) => ({ ...x, name: ({ V: 'Ventes', A: 'Assurances', B: 'Bons de pharmacie' } as Record<string, string>)[x.kind] ?? x.kind }))} label="name" value="ca" /></div></div>
            <div className="card"><div className="mb-2 font-extrabold">Les 10 meilleurs produits</div>
              <div className="space-y-2">{data.top.map((t: any, i: number) => <div key={i} className="text-sm"><div className="flex justify-between gap-2"><span className="truncate"><b className="mr-1 text-ink-muted">{i + 1}.</b>{t.name}</span><b className="whitespace-nowrap">{fcfa(t.ca)}</b></div>
                <div className="flex items-center gap-2"><div className="h-2 flex-1 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${(t.ca / topMax) * 100}%`, background: PALETTE[i % PALETTE.length] }} /></div><span className="w-24 text-right text-[11px] text-ink-muted">{t.qty} u.{t.margin !== null ? ` · marge ${compact(t.margin)}` : ''}</span></div></div>)}</div></div>
            <div className="card"><div className="mb-2 font-extrabold">Chiffre d’affaires par famille</div><Donut rows={data.categories} label="name" value="ca" /></div>
          </div>
        </>
      )}
    </div>
  );
}
