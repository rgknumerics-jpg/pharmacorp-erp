import { useState } from 'react';
import { api } from '../lib/api';
import { dateTimeFr, fcfa, PAY_LABEL } from '../lib/format';
import { ErrorBox, Modal, useLoad } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Clôtures de caisse (responsables) : recette déclarée par la caissière (comptée − fond), recette attendue, écart et ventilation par mode de paiement. */
export default function CashClosings() {
  const { data, error } = useLoad(() => api<any[]>('/cash/sessions'));
  const [open, setOpen] = useState<any | null>(null);
  return (
    <div className="card overflow-auto">
      <ErrorBox error={error} />
      <p className="mb-2 text-xs text-ink-muted">La caissière retire son fond de départ et déclare le reste comme recette ; vous rapprochez ici sa déclaration de la recette réelle (attendu calculé par l’ERP).</p>
      <table className="w-full text-sm">
        <thead><tr><th>Caisse</th><th>Caissière</th><th>Ouverture</th><th>Clôture</th><th className="text-right">Fond</th><th className="text-right">Compté</th><th className="text-right">Recette déclarée</th><th className="text-right">Attendu</th><th className="text-right">Écart</th><th /></tr></thead>
        <tbody>
          {(data ?? []).map((s) => {
            const declared = s.countedCash === null ? null : Math.max(0, s.countedCash - s.openingFloat);
            return (
              <tr key={s.id}>
                <td>{s.register}<div className="text-xs text-ink-muted">{s.number}</div></td><td>{s.cashier}</td><td>{dateTimeFr(s.openedAt)}</td><td>{s.closedAt ? dateTimeFr(s.closedAt) : <span className="font-bold text-amber-700">ouverte</span>}</td>
                <td className="text-right">{fcfa(s.openingFloat)}</td><td className="text-right">{s.countedCash === null ? '—' : fcfa(s.countedCash)}</td><td className="text-right font-bold">{declared === null ? '—' : fcfa(declared)}</td>
                <td className="text-right">{s.expectedCash === null ? '—' : fcfa(s.expectedCash)}</td>
                <td className={`text-right font-bold ${s.diff ? (s.diff > 0 ? 'text-amber-700' : 'text-red-700') : 'text-brand'}`}>{s.diff === null ? '—' : s.diff === 0 ? '✓ juste' : `${s.diff > 0 ? '+' : ''}${fcfa(s.diff)}`}</td>
                <td><button className="btn-alt !py-0.5 text-xs" onClick={async () => setOpen(await api<any>(`/cash/sessions/${s.id}`))}>Détail</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {data && !data.length && <p className="p-4 text-center text-ink-muted">Aucune session de caisse.</p>}
      {open && (
        <Modal title={`${open.register} · ${open.number}`} onClose={() => setOpen(null)}>
          <div className="space-y-1 text-sm">
            {[['Fond de départ', open.openingFloat], ['Espèces encaissées', open.cashIn], ['Remboursements', -(open.refunds ?? 0)], ['Dépenses de caisse', -open.expensesTotal], ['Attendu en caisse', open.expected], ['Compté', open.countedCash]].filter(([, v]) => v !== undefined && v !== null).map(([l, v]) => <div key={l as string} className="flex justify-between"><span>{l}</span><b>{fcfa(v as number)}</b></div>)}
            {open.countedCash !== null && <div className="flex justify-between border-t border-ink-line pt-1"><span>Recette déclarée (compté − fond)</span><b>{fcfa(Math.max(0, open.countedCash - open.openingFloat))}</b></div>}
            {open.byMethod && Object.keys(open.byMethod).length > 0 && <div className="mt-2 rounded-xl bg-slate-50 p-2"><div className="mb-1 text-xs font-extrabold uppercase text-ink-muted">Encaissé par mode de paiement</div>{Object.entries(open.byMethod as Record<string, number>).map(([k, v]) => <div key={k} className="flex justify-between"><span>{PAY_LABEL[k] ?? k}</span><b>{fcfa(v)}</b></div>)}</div>}
            {open.note && <p className="text-xs italic">Observation : {open.note}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
