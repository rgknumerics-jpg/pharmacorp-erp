import { useState } from 'react';
import { api } from '../lib/api';
import { dateTimeFr } from '../lib/format';
import { ErrorBox, PageTitle, useLoad } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const LABEL: Record<string, string> = {
  'sales.created': '🧾 a vendu', 'sales.voided': '↩️ a annulé / remboursé une vente', 'products.created': '➕ a créé un produit', 'products.updated': '✏️ a modifié un produit',
  'products.price_changed': '💲 a changé un prix', 'stock.adjusted': '📦 a modifié le stock', 'stock.lot_validated': '✅ a validé un lot', 'stock.lot_blocked': '⛔ a bloqué un lot', 'stock.oversold': '⚠️ a vendu sans stock',
  'purchases.goods_received': '🚚 a validé une réception (achat)', 'purchases.order_created': '📝 a créé une commande', 'purchases.invoice_created': '📄 a saisi une facture fournisseur', 'purchases.invoice_paid': '💸 a réglé un fournisseur', 'purchases.invoice_due_changed': '📅 a changé une échéance fournisseur',
  'payments.confirmed': '📲 a confirmé un paiement', 'payments.failed': '❌ a marqué un paiement en échec', 'customers.created': '👤 a créé un client', 'customers.credit_limit_set': '🏦 a changé un plafond de crédit', 'customers.credit_repaid': '💵 a encaissé une créance',
  'cash.closing': '🧮 a compté la caisse', 'ocr.validated': '📷 a validé un document OCR', 'ocr.rejected': '📷 a rejeté un document OCR', 'payroll.validated': '👔 a validé la paie', 'accounting.manual_entry': '📒 a saisi une écriture', 'accounting.reversed': '📒 a contre-passé une écriture',
  'tax.paid': '🗓️ a enregistré un paiement d’impôt', 'tax.filed': '🗓️ a déclaré un impôt', 'backup.manual': '💾 a sauvegardé', 'backup.restored': '♻️ a RESTAURÉ une sauvegarde', 'users.created': '👥 a créé un utilisateur', 'users.updated': '👥 a modifié un utilisateur', 'auth.login': '🔐 s’est connecté',
};
const FILTERS: [string, string][] = [['', 'Tout'], ['sales.created', 'Ventes'], ['sales.voided', 'Annulations / remboursements'], ['products.price_changed', 'Prix'], ['stock.', 'Stock'], ['purchases.', 'Achats'], ['cash.', 'Caisse'], ['payments.', 'Paiements'], ['customers.', 'Clients'], ['backup.', 'Sauvegardes']];

export default function Audit() {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const { data, error } = useLoad(() => api<any[]>(`/audit-logs?take=300${action ? `&action=${action}` : ''}${from ? `&from=${from}` : ''}`), [action, from]);
  const detail = (r: any) => {
    const m = r.metadata ?? {};
    if (r.action === 'products.price_changed' && m.before) return `prix de vente ${m.before.salePrice} → ${m.salePrice ?? m.before.salePrice}${m.purchasePrice !== undefined ? `, achat ${m.before.purchasePrice} → ${m.purchasePrice}` : ''}`;
    if (r.action === 'cash.closing') return `attendu ${m.expected}, compté ${m.counted}, écart ${m.diff}`;
    if (r.action === 'sales.voided' || r.action === 'stock.adjusted') return m.reason ?? '';
    return Object.entries(m).filter(([, v]) => v !== null && typeof v !== 'object').slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · ');
  };
  return (
    <>
      <PageTitle title="Journal d'audit" sub="Qui a créé, modifié, annulé, vendu, remboursé, changé un prix, modifié un stock, validé un achat — non modifiable" />
      <div className="card mb-3 flex flex-wrap items-center gap-2">{FILTERS.map(([k, l]) => <button key={k} className={action === k ? 'btn !py-1' : 'btn-alt !py-1'} onClick={() => setAction(k)}>{l}</button>)}<span className="ml-auto text-sm">Depuis <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></span></div>
      <ErrorBox error={error} />
      <div className="card overflow-auto"><table className="w-full">
        <thead><tr><th>Quand</th><th>Qui</th><th>Action</th><th>Détail</th></tr></thead>
        <tbody>{data?.map((r) => <tr key={r.id} className={r.action === 'backup.restored' || r.action === 'sales.voided' ? 'bg-orange-50' : ''}><td className="whitespace-nowrap">{dateTimeFr(r.createdAt)}</td><td><b>{r.userName}</b></td><td>{LABEL[r.action] ?? r.action}</td><td className="text-xs text-ink-muted">{detail(r)}</td></tr>)}</tbody>
      </table>{data?.length === 0 && <p className="p-3 text-sm text-ink-muted">Aucune action.</p>}</div>
    </>
  );
}