import { Prisma } from '@erp/database';

/** Types d'evenements metier publies dans l'outbox (consommes par la comptabilite et le SFEC). */
export type OutboxType =
  | 'cash.expense'
  | 'sale.created'
  | 'sale.voided'
  | 'payment.confirmed'
  | 'goods.received'
  | 'credit.repaid'
  | 'stock.adjusted'
  | 'payroll.validated'
  | 'insurer.paid'
  | 'supplier.paid';

/**
 * Ecrit un evenement dans la MEME transaction que l'operation metier (ARCHITECTURE.md section 2, pattern outbox) :
 * si la vente est enregistree, l'evenement l'est aussi ; si la transaction echoue, aucun des deux n'existe.
 */
export function emit(tx: Prisma.TransactionClient, tenantId: string, type: OutboxType, payload: Prisma.InputJsonValue) {
  return tx.outboxEvent.create({ data: { tenantId, type, payload } });
}