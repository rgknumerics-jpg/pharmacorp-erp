import { api } from '../lib/api';
import { fcfa } from '../lib/format';
import { Bars, Columns, Kpi } from '../components/charts';
import { ErrorBox, PageTitle, useLoad } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const LV: Record<string, string> = { rouge: 'border-red-600 bg-red-50', orange: 'border-brand-orange bg-orange-50', vert: 'border-brand bg-brand-soft', info: 'border-blue-400 bg-blue-50' };

export default function Cockpit({ go }: { go: (p: string) => void }) {
  const { data: c, error } = useLoad(() => api<any>('/analytics/cockpit'));
  const { data: ins } = useLoad(() => api<{ level: string; icon: string; text: string }[]>('/analytics/insights'));
  const { data: risks } = useLoad(() => api<{ id: string; level: string; category: string; title: string; detail: string; link?: string }[]>('/analytics/risks'));
  return (
    <>
      <PageTitle title="Cockpit" sub="Santé de l'entreprise, stock, commercial, clients — et ce qu'il faut faire maintenant" />
      <ErrorBox error={error} />
      {ins && ins.length > 0 && <div className="mb-4 space-y-2">{ins.map((i, k) => <div key={k} className={`rounded-xl border-l-4 px-3 py-2 text-sm font-semibold ${LV[i.level]}`}>{i.icon} {i.text}</div>)}</div>}
      {risks && risks.length > 0 && (
        <div className="card mb-4">
          <h3 className="mb-2 font-extrabold">🔴 Risques immédiats</h3>
          <div className="grid gap-2 md:grid-cols-2">{risks.map((r) => (
            <button key={r.id} onClick={() => r.link && go(r.link)} className={`rounded-xl border-l-4 p-2 text-left text-sm ${LV[r.level]}`}>
              <div className="text-[11px] font-bold uppercase text-ink-muted">{r.category}</div><b>{r.title}</b><div className="text-xs">{r.detail}</div>
            </button>
          ))}</div>
        </div>
      )}
      {c && (
        <div className="space-y-4">
          <section><h3 className="mb-2 font-extrabold">🟢 Santé de l'entreprise</h3>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
              <Kpi label="CA aujourd'hui" value={fcfa(c.health.caToday)} />
              <Kpi label="CA semaine" value={fcfa(c.health.caWeek)} />
              <Kpi label="CA mois" value={fcfa(c.health.caMonth)} sub={c.health.evolutionPct !== null ? `${c.health.evolutionPct > 0 ? '+' : ''}${c.health.evolutionPct} % vs mois dernier` : undefined} tone={c.health.evolutionPct >= 0 ? 'good' : 'warn'} />
              <Kpi label="Marge brute (mois)" value={fcfa(c.health.grossMarginMonth)} sub={`${c.health.marginRate} %`} />
              <Kpi label="Bénéfice estimé (mois)" value={fcfa(c.health.estimatedProfitMonth)} tone={c.health.estimatedProfitMonth >= 0 ? 'good' : 'bad'} />
              <Kpi label="Trésorerie" value={fcfa(c.health.treasury)} tone={c.health.treasury < 0 ? 'bad' : undefined} />
              <Kpi label="Créances" value={fcfa(c.health.receivables)} />
              <Kpi label="Dettes fournisseurs" value={fcfa(c.health.supplierDebt)} />
              <Kpi label="Valeur du stock" value={fcfa(c.health.stockValue)} />
            </div>
          </section>
          <section><h3 className="mb-2 font-extrabold">📦 Stock</h3>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
              <Kpi label="Produits" value={String(c.stock.products)} />
              <Kpi label="Ruptures" value={String(c.stock.ruptures)} tone={c.stock.ruptures ? 'bad' : 'good'} />
              <Kpi label="Stock faible / à commander" value={`${c.stock.low} / ${c.stock.toOrder}`} tone={c.stock.low ? 'warn' : undefined} />
              <Kpi label="Surstock" value={String(c.stock.overstock)} />
              <Kpi label="Stock dormant" value={fcfa(c.stock.dormantValue)} sub={c.stock.dormantEvolutionPct !== null ? `${c.stock.dormantEvolutionPct > 0 ? '+' : ''}${c.stock.dormantEvolutionPct} % sur 30 j` : undefined} tone={c.stock.dormantEvolutionPct > 0 ? 'warn' : undefined} />
              <Kpi label="Périmés en stock" value={fcfa(c.stock.expiredValue)} tone={c.stock.expiredValue ? 'bad' : 'good'} />
              <Kpi label="Lots < 90 jours" value={String(c.stock.expiringSoon)} />
              <Kpi label="Rotation" value={`${c.stock.rotationPerYear} / an`} />
              <Kpi label="Couverture" value={c.stock.coverDays !== null ? `${c.stock.coverDays} jours` : '—'} />
            </div>
          </section>
          <section><h3 className="mb-2 font-extrabold">💰 Commercial (30 jours)</h3>
            <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4"><Kpi label="Tickets" value={String(c.commercial.tickets30)} /><Kpi label="Panier moyen" value={fcfa(c.commercial.avgBasket)} /></div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="card"><h4 className="mb-2 font-bold">Plus vendus (quantité)</h4><Bars rows={c.commercial.topSold} value="qty" label="name" money={false} /></div>
              <div className="card"><h4 className="mb-2 font-bold">Plus rentables (marge)</h4><Bars rows={c.commercial.topProfitable} value="margin" label="name" /></div>
              <div className="card"><h4 className="mb-2 font-bold">Ventes par heure</h4><Columns rows={c.commercial.byHour} x="h" y="ca" /></div>
              <div className="card"><h4 className="mb-2 font-bold">Par vendeur</h4><Bars rows={c.commercial.bySeller} value="ca" label="seller" /></div>
              <div className="card"><h4 className="mb-2 font-bold">Par famille</h4><Bars rows={c.commercial.byCategory} value="ca" label="name" /></div>
              <div className="card"><h4 className="mb-2 font-bold">Par laboratoire</h4><Bars rows={c.commercial.byLaboratory} value="ca" label="name" /></div>
              <div className="card"><h4 className="mb-2 font-bold">Forte rotation</h4><Bars rows={c.commercial.highRotation} value="perDay" label="name" money={false} /></div>
              <div className="card"><h4 className="mb-2 font-bold">Faible rotation (mois de stock)</h4><Bars rows={c.commercial.lowRotation} value="monthsOfStock" label="name" money={false} color="bg-brand-orange" /></div>
              <div className="card"><h4 className="mb-2 font-bold">Trafic (tickets / semaine)</h4><Columns rows={c.commercial.traffic.map((t: any) => ({ ...t, w: new Date(t.week).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) }))} x="w" y="tickets" /></div>
            </div>
          </section>
          <section><h3 className="mb-2 font-extrabold">👥 Clients</h3>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Kpi label="Clients" value={String(c.clients.total ?? 0)} /><Kpi label="Nouveaux (30 j)" value={String(c.clients.new30 ?? 0)} />
              <Kpi label="Actifs (90 j)" value={String(c.clients.active90 ?? 0)} tone="good" /><Kpi label="Inactifs" value={String(c.clients.inactive ?? 0)} tone="warn" />
              <Kpi label="Fréquence (achats / 90 j)" value={String(c.clients.avgFrequency90)} />
            </div>
            <div className="card mt-2"><h4 className="mb-2 font-bold">Segmentation</h4><Bars rows={c.clients.segments} value="n" label="segment" money={false} /></div>
          </section>
        </div>
      )}
    </>
  );
}