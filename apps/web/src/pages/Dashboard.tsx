import { api } from '../lib/api';
import { fcfa, PAY_LABEL } from '../lib/format';
import { Badge, ErrorBox, PageTitle, useLoad } from '../components/ui';

interface Dash {
  today: { count: number; total: number; vat: number; margin: number | null };
  paymentsByMethod: { method: string; amount: number }[];
  stockAlerts: { belowMinimum: number; expiredInStock: number; expiringWithin90Days: number };
  toProcess: { pendingMobileMoney: number; ocrToReview: number; lotsToValidate: number };
}

export default function Dashboard({ go }: { go: (p: string) => void }) {
  const { data, error, reload } = useLoad(() => api<Dash>('/reports/dashboard'));
  const tile = (label: string, value: string | number, tone?: 'warn' | 'bad', to?: string) => (
    <button key={label} onClick={() => to && go(to)} className="card text-left transition hover:shadow">
      <div className="text-xs font-bold uppercase text-ink-muted">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-brand-orange' : ''}`}>{value}</div>
    </button>
  );
  return (
    <>
      <PageTitle title="Tableau de bord" sub="Activité du jour et points à traiter" actions={<button className="btn-alt" onClick={reload}>↻ Actualiser</button>} />
      <ErrorBox error={error} />
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {tile('Ventes du jour', data.today.count, undefined, 'sales')}
            {tile('Chiffre d’affaires', fcfa(data.today.total), undefined, 'sales')}
            {tile('TVA collectée', fcfa(data.today.vat))}
            {data.today.margin !== null && tile('Marge brute', fcfa(data.today.margin))}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {tile('Produits sous le seuil', data.stockAlerts.belowMinimum, data.stockAlerts.belowMinimum ? 'warn' : undefined, 'stock')}
            {tile('Lots périmés en stock', data.stockAlerts.expiredInStock, data.stockAlerts.expiredInStock ? 'bad' : undefined, 'stock')}
            {tile('Péremption < 90 jours', data.stockAlerts.expiringWithin90Days, data.stockAlerts.expiringWithin90Days ? 'warn' : undefined, 'stock')}
            {tile('Mobile Money à confirmer', data.toProcess.pendingMobileMoney, data.toProcess.pendingMobileMoney ? 'warn' : undefined, 'sales')}
            {tile('Documents OCR à vérifier', data.toProcess.ocrToReview, data.toProcess.ocrToReview ? 'warn' : undefined, 'receiving')}
            {tile('Lots à valider', data.toProcess.lotsToValidate, data.toProcess.lotsToValidate ? 'warn' : undefined, 'stock')}
          </div>
          <div className="card">
            <h3 className="mb-2 font-extrabold">Encaissements du jour par moyen de paiement</h3>
            {data.paymentsByMethod.length ? (
              <div className="flex flex-wrap gap-2">
                {data.paymentsByMethod.map((p) => <Badge key={p.method} tone="info">{PAY_LABEL[p.method] ?? p.method} : {fcfa(p.amount)}</Badge>)}
              </div>
            ) : <p className="text-sm text-ink-muted">Aucun encaissement aujourd’hui.</p>}
          </div>
        </div>
      )}
    </>
  );
}