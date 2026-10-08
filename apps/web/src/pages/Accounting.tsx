import { useState } from 'react';
import { api, can } from '../lib/api';
import { dateFr, dateTimeFr, fcfa } from '../lib/format';
import { Badge, ErrorBox, PageTitle, useLoad } from '../components/ui';

interface Balance { rows: { account: string; name: string; debit: number; credit: number; balance: number }[]; totalDebit: number; totalCredit: number }
interface Entry { id: string; number: string; journalCode: string; date: string; label: string; reversalOfId: string | null; lines: { id: string; accountCode: string; debit: number; credit: number }[] }
interface LedgerRow { date: string; number: string; journal: string; label: string; debit: number; credit: number; balance: number }
interface Fiscal { id: string; kind: string; number: string; status: string; attempts: number; nextAttemptAt: string; certificationRef: string | null; lastError: string | null; createdAt: string }

const JOURNALS: Record<string, string> = { VE: 'Ventes', AC: 'Achats', CA: 'Caisse', BQ: 'Banque', MM: 'Mobile Money', OD: 'Opérations diverses' };
const FISCAL: Record<string, [string, 'ok' | 'warn' | 'bad' | 'muted']> = { certified: ['certifiée', 'ok'], provisional: ['provisoire — certification différée', 'warn'], pending: ['en file', 'muted'], rejected: ['rejetée — à corriger', 'bad'] };

export default function Accounting() {
  const [tab, setTab] = useState<'statements' | 'balance' | 'journal' | 'ledger' | 'sfec'>('statements');
  const [msg, setMsg] = useState<string | null>(null);
  async function run(path: string) { setMsg(null); try { const r = await api<Record<string, number>>(path, { method: 'POST', json: {} }); setMsg(Object.entries(r).map(([k, v]) => `${k} : ${v}`).join(' · ')); } catch (e) { setMsg((e as Error).message); } }
  return (
    <>
      <PageTitle title="Comptabilité" sub="SYSCOHADA — écritures générées automatiquement à chaque vente, encaissement, réception et ajustement"
        actions={can('accounting.write') && <button className="btn-alt" onClick={() => run('/accounting/outbox/process')}>↻ Comptabiliser maintenant</button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        {([['statements', 'États financiers'], ['balance', 'Balance'], ['journal', 'Journaux'], ['ledger', 'Grand livre'], ['sfec', 'Factures normalisées (SFEC)']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'btn' : 'btn-alt'} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {msg && <div className="mb-3 rounded-lg bg-brand-soft px-3 py-2 text-sm font-semibold">{msg}</div>}
      {tab === 'statements' && <Statements />}
      {tab === 'balance' && <BalanceView />}
      {tab === 'journal' && <Journal />}
      {tab === 'ledger' && <Ledger />}
      {tab === 'sfec' && <Sfec onRun={run} />}
    </>
  );
}

interface St { year: number; system: string; deadline: string; notice: string; income: Record<string, number>; balance: { actif: Record<string, number>; passif: Record<string, number>; totalActif: number; totalPassif: number; equilibre: boolean } }
function Statements() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, error } = useLoad(() => api<St>(`/accounting/statements?year=${year}`), [year]);
  const L = (label: string, v: number, strong = false) => <tr><td className={strong ? 'font-extrabold' : ''}>{label}</td><td className={`text-right ${strong ? 'font-extrabold' : ''} ${v < 0 ? 'text-red-700' : ''}`}>{fcfa(v)}</td></tr>;
  return (
    <>
      <div className="card mb-3 flex items-center gap-2"><button className="btn-alt" onClick={() => setYear(year - 1)}>←</button><b>Exercice {year}</b><button className="btn-alt" onClick={() => setYear(year + 1)}>→</button><button className="btn-alt ml-auto" onClick={() => window.print()}>🖨 Imprimer</button></div>
      <ErrorBox error={error} />
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card"><h3 className="mb-2 font-extrabold">Compte de résultat</h3><table className="w-full"><tbody>
            {L('Ventes de marchandises', data.income.ventesMarchandises)}{L('Coût d’achat des marchandises vendues', -data.income.achatsMarchandises)}{L(`Marge commerciale (${data.income.tauxMarge} %)`, data.income.margeCommerciale, true)}
            {L('Valeur ajoutée', data.income.valeurAjoutee, true)}{L('Impôts et taxes', -data.income.impotsTaxes)}{L('Charges de personnel', -data.income.chargesPersonnel)}
            {L('Excédent brut d’exploitation (EBE)', data.income.ebe, true)}{L('Dotations nettes', data.income.reprises - data.income.dotations)}{L('Résultat d’exploitation', data.income.resultatExploitation, true)}
            {L('Résultat financier', data.income.resultatFinancier)}{L('Résultat HAO', data.income.resultatHAO)}{L('Impôt sur le résultat', -data.income.impotResultat)}{L('RÉSULTAT NET', data.income.resultatNet, true)}
          </tbody></table></div>
          <div className="card"><h3 className="mb-2 font-extrabold">Bilan au 31/12/{data.year}</h3><table className="w-full"><tbody>
            <tr><td colSpan={2} className="text-xs font-bold uppercase text-ink-muted">Actif</td></tr>
            {L('Actif immobilisé', data.balance.actif.actifImmobilise)}{L('Stocks', data.balance.actif.stocks)}{L('Créances', data.balance.actif.creances)}{L('Trésorerie-actif', data.balance.actif.tresorerieActif)}{L('Total actif', data.balance.totalActif, true)}
            <tr><td colSpan={2} className="pt-2 text-xs font-bold uppercase text-ink-muted">Passif</td></tr>
            {L('Capitaux propres (dont résultat)', data.balance.passif.capitauxPropres)}{L('… dont résultat de l’exercice', data.balance.passif.dontResultat)}{L('Passif circulant (fournisseurs, État, social)', data.balance.passif.passifCirculant)}{L('Trésorerie-passif', data.balance.passif.tresoreriePassif)}{L('Total passif', data.balance.totalPassif, true)}
          </tbody></table>{data.balance.equilibre ? <Badge>Bilan équilibré</Badge> : <Badge tone="bad">Déséquilibre : vérifier les à-nouveaux</Badge>}</div>
          <div className="card lg:col-span-2 text-sm"><p>📐 {data.system}</p><p>⏱️ {data.deadline}</p><p className="text-xs text-ink-muted">{data.notice}</p></div>
        </div>
      )}
    </>
  );
}

function BalanceView() {
  const { data, error } = useLoad(() => api<Balance>('/accounting/trial-balance'));
  const { data: rec } = useLoad(() => api<{ salesWithoutEntry: unknown[]; gap: number }>('/accounting/reconciliation'));
  return (
    <>
      <ErrorBox error={error} />
      {rec && <div className="mb-3">{rec.salesWithoutEntry.length === 0 ? <Badge>Rapprochement ventes ↔ comptabilité : aucun écart</Badge> : <Badge tone="bad">{rec.salesWithoutEntry.length} vente(s) non comptabilisée(s)</Badge>}</div>}
      <div className="card overflow-auto"><table className="w-full">
        <thead><tr><th>Compte</th><th>Intitulé</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th className="text-right">Solde</th></tr></thead>
        <tbody>
          {data?.rows.map((r) => <tr key={r.account}><td><b>{r.account}</b></td><td>{r.name}</td><td className="text-right">{fcfa(r.debit)}</td><td className="text-right">{fcfa(r.credit)}</td><td className={`text-right font-bold ${r.balance < 0 ? 'text-blue-700' : ''}`}>{fcfa(Math.abs(r.balance))} {r.balance > 0 ? 'D' : r.balance < 0 ? 'C' : ''}</td></tr>)}
          {data && <tr><td colSpan={2} className="font-extrabold">Totaux</td><td className="text-right font-extrabold">{fcfa(data.totalDebit)}</td><td className="text-right font-extrabold">{fcfa(data.totalCredit)}</td><td>{data.totalDebit === data.totalCredit ? <Badge>équilibrée</Badge> : <Badge tone="bad">déséquilibre</Badge>}</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

function Journal() {
  const [j, setJ] = useState('');
  const { data, error, reload } = useLoad(() => api<Entry[]>(`/accounting/entries?take=200${j ? `&journal=${j}` : ''}`), [j]);
  const [err, setErr] = useState<string | null>(null);
  async function reverse(id: string) { const r = prompt('Motif de la contre-passation'); if (!r) return; try { await api(`/accounting/entries/${id}/reverse`, { method: 'POST', json: { reason: r } }); reload(); } catch (e) { setErr((e as Error).message); } }
  return (
    <>
      <div className="card mb-3 flex flex-wrap gap-2"><button className={!j ? 'btn' : 'btn-alt'} onClick={() => setJ('')}>Tous</button>{Object.entries(JOURNALS).map(([k, l]) => <button key={k} className={j === k ? 'btn' : 'btn-alt'} onClick={() => setJ(k)}>{l}</button>)}</div>
      <ErrorBox error={error ?? err} />
      <div className="space-y-2">{data?.map((e) => (
        <div key={e.id} className="card !p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span><b>{e.number}</b> · {dateFr(e.date)} · {e.label} {e.reversalOfId && <Badge tone="warn">contre-passation</Badge>}</span>
            {can('accounting.write') && !e.reversalOfId && <button className="btn-alt !py-1" onClick={() => reverse(e.id)}>Contre-passer</button>}</div>
          <table className="mt-1 w-full"><tbody>{e.lines.map((l) => <tr key={l.id}><td className="w-24">{l.accountCode}</td><td className="text-right">{l.debit ? fcfa(l.debit) : ''}</td><td className="text-right">{l.credit ? fcfa(l.credit) : ''}</td></tr>)}</tbody></table>
        </div>
      ))}</div>
    </>
  );
}

function Ledger() {
  const [account, setAccount] = useState('571');
  const { data, error } = useLoad(() => api<LedgerRow[]>(`/accounting/ledger/${encodeURIComponent(account)}`), [account]);
  return (
    <>
      <div className="card mb-3 flex items-center gap-2"><span className="text-sm font-bold">Compte</span>
        <select value={account} onChange={(e) => setAccount(e.target.value)}>{[['571', 'Caisse'], ['5215', 'MTN MoMo'], ['5216', 'Airtel Money'], ['521', 'Banque'], ['411', 'Clients'], ['401', 'Fournisseurs'], ['311', 'Marchandises'], ['701', 'Ventes'], ['4431', 'TVA collectée'], ['658', 'Pertes']].map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}</select></div>
      <ErrorBox error={error} />
      <div className="card overflow-auto"><table className="w-full">
        <thead><tr><th>Date</th><th>Pièce</th><th>Libellé</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th className="text-right">Solde</th></tr></thead>
        <tbody>{data?.map((r, i) => <tr key={i}><td>{dateFr(r.date)}</td><td>{r.number}</td><td>{r.label}</td><td className="text-right">{r.debit ? fcfa(r.debit) : ''}</td><td className="text-right">{r.credit ? fcfa(r.credit) : ''}</td><td className="text-right font-bold">{fcfa(r.balance)}</td></tr>)}</tbody>
      </table>{data?.length === 0 && <p className="p-3 text-sm text-ink-muted">Aucun mouvement.</p>}</div>
    </>
  );
}

function Sfec({ onRun }: { onRun: (p: string) => void }) {
  const { data, error, reload } = useLoad(() => api<Fiscal[]>('/sfec/invoices'));
  return (
    <>
      <p className="mb-2 text-sm text-ink-muted">La caisse ne s’arrête jamais : si le service SFEC est indisponible, la facture est émise en provisoire puis certifiée automatiquement dès son retour.</p>
      {can('sfec.manage') && <button className="btn-alt mb-3" onClick={async () => { await onRun('/sfec/process'); reload(); }}>Lancer la certification</button>}
      <ErrorBox error={error} />
      <div className="card overflow-auto"><table className="w-full">
        <thead><tr><th>Document</th><th>Statut</th><th>Référence de certification</th><th>Essais</th><th>Émis</th></tr></thead>
        <tbody>{data?.map((f) => <tr key={f.id}><td><b>{f.number}</b> {f.kind === 'credit_note' && <Badge tone="info">avoir</Badge>}</td><td><Badge tone={FISCAL[f.status]?.[1] ?? 'muted'}>{FISCAL[f.status]?.[0] ?? f.status}</Badge>{f.lastError && f.status !== 'certified' && <div className="text-xs text-ink-muted">{f.lastError} · prochain essai {dateTimeFr(f.nextAttemptAt)}</div>}</td><td className="text-xs">{f.certificationRef ?? '—'}</td><td>{f.attempts}</td><td>{dateTimeFr(f.createdAt)}</td></tr>)}</tbody>
      </table></div>
    </>
  );
}