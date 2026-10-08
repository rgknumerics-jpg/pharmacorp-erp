import { Prisma } from '@erp/database';

type Tx = Prisma.TransactionClient;
export interface Hist { at: string; action: string; by?: string | null }

export const ORDER_STATUS: Record<string, string> = { new: 'Nouvelle', accepted: 'Acceptée, en préparation', ready: 'Prête', out: 'En livraison', delivered: 'Livrée', cancelled: 'Annulée' };

export async function notify(tx: Tx, tenantId: string, recipientType: 'courier' | 'customer', recipientId: string, orderId: string | null, title: string, body: string) {
  await tx.portalNotification.create({ data: { tenantId, recipientType, recipientId, orderId, title, body: body.slice(0, 300) } });
}

const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ')} FCFA`;

/** Texte de course pour le livreur. */
export function courseText(o: { number: string; address: string | null; addressNote: string | null; phone: string; total: number; paymentStatus: string }) {
  return `${o.number} · ${o.address ?? 'Retrait'}${o.addressNote ? ` (${o.addressNote})` : ''} · tél. ${o.phone} · ${o.paymentStatus === 'paid' ? 'DÉJÀ PAYÉE' : `à encaisser : ${fcfa(o.total)}`}`;
}

/**
 * Appelé chaque fois qu'une vente change d'état de paiement : quand la vente d'une commande en ligne est soldée,
 * la commande passe à « payée » et le livreur est notifié (celui qui est affecté, sinon tous les livreurs actifs).
 */
export async function onSaleSettled(tx: Tx, tenantId: string, saleId: string, settled: boolean) {
  if (!settled) return;
  const o = await tx.onlineOrder.findFirst({ where: { saleId } });
  if (!o || o.paymentStatus === 'paid') return;
  const hist = ((o.history as unknown as Hist[]) ?? []).slice(-40);
  hist.push({ at: new Date().toISOString(), action: 'Paiement validé' });
  await tx.onlineOrder.update({ where: { id: o.id }, data: { paymentStatus: 'paid', history: hist as unknown as Prisma.InputJsonValue, updatedAt: new Date() } });
  if (o.fulfilment === 'delivery') {
    const text = courseText({ ...o, paymentStatus: 'paid' });
    const targets = o.courierId ? [o.courierId] : (await tx.courier.findMany({ where: { isActive: true }, select: { id: true } })).map((c) => c.id);
    for (const id of targets) await notify(tx, tenantId, 'courier', id, o.id, 'Paiement validé — course à prendre', text);
  }
  await notify(tx, tenantId, 'customer', o.accountId, o.id, 'Paiement reçu', `Votre paiement de la commande ${o.number} est validé. Merci !`);
}
