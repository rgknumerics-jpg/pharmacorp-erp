import { fcfa } from '../lib/format';

/** Barres horizontales simples (sans dependance) : libelle, valeur, part. */
export function Bars({ rows, value, label, money = true, color = 'bg-brand' }: { rows: Record<string, unknown>[]; value: string; label: string; money?: boolean; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(Number(r[value]) || 0)));
  return (
    <div className="space-y-1">
      {rows.map((r, i) => (
        <div key={i} className="text-sm">
          <div className="flex justify-between gap-2"><span className="truncate">{String(r[label] ?? '—')}</span><b>{money ? fcfa(Number(r[value])) : String(r[value])}</b></div>
          <div className="h-1.5 rounded bg-slate-100"><div className={`h-1.5 rounded ${color}`} style={{ width: `${(Math.abs(Number(r[value]) || 0) / max) * 100}%` }} /></div>
        </div>
      ))}
      {rows.length === 0 && <p className="text-xs text-ink-muted">Pas encore de données.</p>}
    </div>
  );
}

/** Colonnes verticales (ex. ventes par heure). */
export function Columns({ rows, x, y, height = 90 }: { rows: Record<string, unknown>[]; x: string; y: string; height?: number }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[y]) || 0));
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-1 flex-col items-center justify-end" title={`${r[x]} : ${r[y]}`}>
          <div className="w-full rounded-t bg-brand-orange" style={{ height: `${((Number(r[y]) || 0) / max) * (height - 16)}px` }} />
          <span className="text-[10px] text-ink-muted">{String(r[x])}</span>
        </div>
      ))}
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'warn' }) {
  const c = tone === 'good' ? 'text-brand' : tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-brand-orange' : '';
  return (
    <div className="card !p-3">
      <div className="text-[11px] font-bold uppercase text-ink-muted">{label}</div>
      <div className={`text-xl font-extrabold ${c}`}>{value}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}