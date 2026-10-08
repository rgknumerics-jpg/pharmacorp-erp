import { useState } from 'react';
import { api } from '../lib/api';
import { dateFr, fcfa } from '../lib/format';
import { Bars, Kpi } from '../components/charts';
import { Badge, ErrorBox, PageTitle, useLoad } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Finance() {
  const now = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10));
  const { data: f, error } = useLoad(() => api<any>(`/analytics/finance?from=${from}&to=${to}`), [from, to]);
  const [m, setM] = useState<'byProduct' | 'byCategory' | 'bySupplier' | 'byStore'>('byProduct');
  return (
    <>
      <PageTitle title="Finances" sub="Où va l'argent : du chiffre d'affaires au résultat, trésorerie et prévisions" actions={<div className="flex items-center gap-1"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><span>→</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>} />
      <ErrorBox error={error} />
      {f && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card"><h3 className="mb-2 font-extrabold">Du CA au résultat</h3>
              <table className="w-full"><tbody>{f.waterfall.map((w: any) => (
                <tr key={w.label} className={w.subtotal ? 'bg-brand-soft' : ''}><td className={w.subtotal ? 'font-extrabold' : 'pl-5'}>{w.subtotal ? '' : '└ '}{w.label}</td><td className={`text-right ${w.subtotal ? 'font-extrabold' : ''} ${w.amount < 0 ? 'text-red-700' : ''}`}>{fcfa(w.amount)}</td></tr>
              ))}</tbody></table><p className="mt-1 text-xs text-ink-muted">Taux de marge brute : {f.marginRate} %</p></div>
            <div className="card"><h3 className="mb-2 font-extrabold">Trésorerie</h3>
              <div className="grid grid-cols-2 gap-2"><Kpi label="Caisse" value={fcfa(f.treasury.cash)} /><Kpi label="Banque" value={fcfa(f.treasury.bank)} /><Kpi label="MTN MoMo" value={fcfa(f.treasury.mtn)} /><Kpi label="Airtel Money" value={fcfa(f.treasury.airtel)} /></div>
              <h4 className="mb-1 mt-3 font-bold">Prévision</h4>
              <table className="w-full text-sm"><thead><tr><th>Horizon</th><th className="text-right">Ventes</th><th className="text-right">Créances</th><th className="text-right">Fournisseurs</th><th className="text-right">Salaires</th><th className="text-right">Solde prévu</th></tr></thead>
                <tbody>{f.forecast.map((h: any) => <tr key={h.days}><td>{h.days} j</td><td className="text-right">+{fcfa(h.salesIn)}</td><td className="text-right">+{fcfa(h.receivablesIn)}</td><td className="text-right">−{fcfa(h.supplierOut)}</td><td className="text-right">−{fcfa(h.payroll)}</td><td className={`text-right font-extrabold ${h.balance < 0 ? 'text-red-700' : 'text-brand'}`}>{fcfa(h.balance)}</td></tr>)}</tbody></table>
              <p className="mt-1 text-xs text-ink-muted">Hors impôts : voir le calendrier fiscal (montants estimés).</p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card"><h3 className="mb-2 font-extrabold">Créances et dettes</h3>
              <div className="grid grid-cols-2 gap-2"><Kpi label="Clients à crédit" value={fcfa(f.receivables.customers)} /><Kpi label="Tiers payant" value={fcfa(f.receivables.insurers)} /><Kpi label="Fournisseurs" value={fcfa(f.supplierDebt.total)} /><Kpi label="… dont échu" value={fcfa(f.supplierDebt.overdue)} tone={f.supplierDebt.overdue ? 'bad' : 'good'} /></div>
              <h4 className="mb-1 mt-3 font-bold">Prochaines échéances fournisseurs</h4>
              {f.supplierDebt.upcoming.map((u: any) => <div key={u.id} className="flex justify-between border-b border-ink-line py-1 text-sm"><span>{dateFr(u.dueDate)} · {u.supplier} ({u.number}) {u.late && <Badge tone="bad">en retard</Badge>}</span><b>{fcfa(u.due)}</b></div>)}
            </div>
            <div className="card"><div className="mb-2 flex flex-wrap gap-1">{([['byProduct', 'Par produit'], ['byCategory', 'Par famille'], ['bySupplier', 'Par fournisseur'], ['byStore', 'Par point de vente']] as const).map(([k, l]) => <button key={k} className={m === k ? 'btn !py-1' : 'btn-alt !py-1'} onClick={() => setM(k)}>{l}</button>)}</div>
              <h3 className="mb-2 font-extrabold">Marges</h3>
              <table className="w-full text-sm"><thead><tr><th>Nom</th><th className="text-right">CA</th><th className="text-right">Marge</th><th className="text-right">Taux</th></tr></thead>
                <tbody>{f.margins[m].map((r: any) => <tr key={r.name}><td>{r.name}</td><td className="text-right">{fcfa(r.ca)}</td><td className="text-right">{fcfa(r.margin)}</td><td className="text-right"><Badge tone={r.rate < 15 ? 'warn' : 'ok'}>{r.rate} %</Badge></td></tr>)}</tbody></table>
              {m === 'byStore' && <p className="mt-1 text-xs text-ink-muted">Multi-pharmacies : chaque officine supplémentaire apparaîtra ici.</p>}
            </div>
          </div>
          <div className="card"><h3 className="mb-2 font-extrabold">Répartition des dépenses</h3><Bars rows={f.waterfall.filter((w: any) => !w.subtotal && w.amount < 0).map((w: any) => ({ label: w.label, v: -w.amount }))} value="v" label="label" color="bg-brand-orange" /></div>
        </div>
      )}
    </>
  );
}