import { api } from '../lib/api';
import { fcfa } from '../lib/format';
import { Badge, ErrorBox, PageTitle, useLoad } from '../components/ui';

interface Insight { id: string; category: string; severity: 'urgent' | 'important' | 'conseil'; title: string; detail: string; action?: string; amount?: number; legalBasis?: string; link?: string }
const CAT: Record<string, string> = { fiscal: '🧾 Fiscalité', tresorerie: '💰 Trésorerie', stock: '📦 Stock', clients: '👥 Clients', marge: '📈 Marges', conformite: '⚖️ Conformité', paie: '👔 Paie' };
const SEV = { urgent: ['bad', 'Urgent', 'border-red-600'], important: ['warn', 'Important', 'border-brand-orange'], conseil: ['info', 'Conseil', 'border-blue-400'] } as const;

export default function Advisor({ go }: { go: (p: string) => void }) {
  const { data, error, reload } = useLoad(() => api<{ insights: Insight[]; disclaimer: string; generatedAt: string }>('/advisor/insights'));
  return (
    <>
      <PageTitle title="Recommandations" sub="Trésorerie, fiscalité, stock, crédit clients, marges — avec des actions concrètes" actions={<button className="btn-alt" onClick={reload}>↻ Actualiser</button>} />
      <ErrorBox error={error} />
      {data && (
        <div className="space-y-3">
          {data.insights.length === 0 && <div className="card">Aucun point d’attention : votre activité est sous contrôle. 🎉</div>}
          {data.insights.map((i) => (
            <div key={i.id} className={`card border-l-4 ${SEV[i.severity][2]}`}>
              <div className="flex flex-wrap items-center gap-2"><Badge tone={SEV[i.severity][0]}>{SEV[i.severity][1]}</Badge><span className="text-xs font-bold text-ink-muted">{CAT[i.category]}</span>{i.amount ? <span className="ml-auto font-extrabold">{fcfa(i.amount)}</span> : null}</div>
              <h3 className="mt-1 font-extrabold">{i.title}</h3>
              <p className="text-sm">{i.detail}</p>
              {i.action && <p className="mt-1 rounded-lg bg-brand-soft p-2 text-sm"><b>👉 À faire : </b>{i.action}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">{i.legalBasis && <span>📚 {i.legalBasis}</span>}{i.link && <button className="font-bold text-brand underline" onClick={() => go(i.link!)}>Ouvrir</button>}</div>
            </div>
          ))}
          <p className="text-xs text-ink-muted">{data.disclaimer}</p>
        </div>
      )}
    </>
  );
}