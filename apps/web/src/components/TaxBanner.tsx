import { useEffect, useState } from 'react';
import { api, can } from '../lib/api';
import { dateFr, fcfa } from '../lib/format';

export interface TaxAlert { obligation: string; label: string; period: string; due: string; level: 'overdue' | 'j7' | 'j14' | 'j30'; daysLeft: number; estimate: { amount: number; basis: string } | null; penaltyNote?: string; authority: string }

const STYLE = {
  overdue: 'overdue text-white',
  j7: 'bg-red-600 text-white',
  j14: 'bg-brand-orange text-white',
  j30: 'bg-amber-100 text-amber-900',
} as const;

const when = (a: TaxAlert) => (a.level === 'overdue' ? `en retard de ${-a.daysLeft} j` : a.daysLeft === 0 ? 'AUJOURD’HUI' : `dans ${a.daysLeft} j`);

/**
 * Bandeau fige en haut de l'ecran pour les administrateurs et pharmaciens : rappels a 1 mois, 2 semaines, 1 semaine
 * avant chaque echeance fiscale ou sociale, puis en rouge anime en cas de retard. Il ne disparait qu'une fois
 * l'echeance marquee "payee" dans le calendrier.
 */
export default function TaxBanner({ go }: { go: (p: string) => void }) {
  const [alerts, setAlerts] = useState<TaxAlert[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!can('tax.read')) return;
    const load = () => api<TaxAlert[]>('/tax/alerts').then(setAlerts).catch(() => undefined);
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, []);
  if (!alerts.length) return null;
  const top = alerts[0];
  const total = alerts.reduce((s, a) => s + (a.estimate?.amount ?? 0), 0);
  return (
    <div className={`tax-banner no-print ${STYLE[top.level]} px-4 py-2 shadow-md`} role="alert">
      <div className="mx-auto flex max-w-[1250px] flex-wrap items-center gap-3">
        <span className="badge-attn rounded-full bg-white/95 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-red-700"><span className="bell">🔔</span> Attention</span>
        <span className="flex-1 text-sm font-bold">
          {top.label} ({top.period}) — échéance {dateFr(top.due)}, <u>{when(top)}</u>{top.estimate?.amount ? ` · env. ${fcfa(top.estimate.amount)}` : ''}
          {alerts.length > 1 && <span className="font-semibold opacity-90"> · +{alerts.length - 1} autre(s) échéance(s) · total estimé {fcfa(total)}</span>}
        </span>
        <button className="rounded-lg bg-white/90 px-3 py-1 text-xs font-bold text-ink" onClick={() => setOpen((o) => !o)}>{open ? 'Masquer' : 'Détail'}</button>
        <button className="rounded-lg bg-white px-3 py-1 text-xs font-extrabold text-ink" onClick={() => go('tax')}>Ouvrir le calendrier</button>
      </div>
      {open && (
        <div className="mx-auto mt-2 max-w-[1250px] space-y-1 rounded-lg bg-white/95 p-2 text-sm text-ink">
          {alerts.map((a) => (
            <div key={a.obligation + a.period} className="flex flex-wrap justify-between gap-2 border-b border-ink-line py-1 last:border-0">
              <span><b>{a.label}</b> ({a.period}) — {a.authority}</span>
              <span className={a.level === 'overdue' || a.level === 'j7' ? 'font-extrabold text-red-700' : 'font-bold'}>{dateFr(a.due)} · {when(a)}{a.estimate ? ` · ${fcfa(a.estimate.amount)}` : ''}</span>
              {a.penaltyNote && <span className="w-full text-xs text-red-700">{a.penaltyNote}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}