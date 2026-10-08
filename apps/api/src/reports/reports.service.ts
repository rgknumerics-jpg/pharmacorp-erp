import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tableau de bord : ventes du jour, repartition par moyen de paiement, alertes de stock et de peremption. */
  async dashboard(tenantId: string, canSeeMargin: boolean) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const [sales, byMethod, pendingPayments, pendingOcr, pendingLots] = await Promise.all([
        tx.sale.aggregate({ where: { createdAt: { gte: start }, status: { not: 'void' } }, _sum: { total: true, vatAmount: true }, _count: true }),
        tx.payment.groupBy({ by: ['method'], where: { createdAt: { gte: start }, status: 'confirmed' }, _sum: { amount: true } }),
        tx.payment.count({ where: { status: 'pending_confirmation' } }),
        tx.ocrDocument.count({ where: { status: 'pending_review' } }),
        tx.lot.count({ where: { status: 'pending_review' } }),
      ]);
      const [alerts] = await tx.$queryRaw<{ low: number; expired: number; expiring: number }[]>`
        WITH per_product AS (
          SELECT p.id, p.min_stock,
            COALESCE(SUM(CASE WHEN m.lot_id IS NULL OR (l.status = 'available' AND (l.expiry_date IS NULL OR l.expiry_date >= CURRENT_DATE)) THEN m.quantity ELSE 0 END), 0) AS sellable
          FROM products p
          LEFT JOIN inventory_movements m ON m.product_id = p.id
          LEFT JOIN lots l ON l.id = m.lot_id
          WHERE p.is_active = true GROUP BY p.id
        ), per_lot AS (
          SELECT l.id, l.expiry_date, COALESCE(SUM(m.quantity), 0) AS qty
          FROM lots l LEFT JOIN inventory_movements m ON m.lot_id = l.id
          WHERE l.expiry_date IS NOT NULL GROUP BY l.id
        )
        SELECT
          (SELECT COUNT(*) FROM per_product WHERE min_stock > 0 AND sellable < min_stock)::int AS low,
          (SELECT COUNT(*) FROM per_lot WHERE qty > 0 AND expiry_date < CURRENT_DATE)::int AS expired,
          (SELECT COUNT(*) FROM per_lot WHERE qty > 0 AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + 90)::int AS expiring`;
      let margin: number | null = null;
      if (canSeeMargin) {
        const [r] = await tx.$queryRaw<{ margin: number | null }[]>`
          SELECT COALESCE(SUM(si.line_total - si.unit_cost * si.quantity), 0)::int AS margin
          FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE s.created_at >= ${start} AND s.status <> 'void'`;
        margin = r?.margin ?? 0;
      }
      return {
        today: { count: sales._count, total: sales._sum.total ?? 0, vat: sales._sum.vatAmount ?? 0, margin },
        paymentsByMethod: byMethod.map((m) => ({ method: m.method, amount: m._sum.amount ?? 0 })),
        stockAlerts: { belowMinimum: alerts?.low ?? 0, expiredInStock: alerts?.expired ?? 0, expiringWithin90Days: alerts?.expiring ?? 0 },
        toProcess: { pendingMobileMoney: pendingPayments, ocrToReview: pendingOcr, lotsToValidate: pendingLots },
      };
    });
  }
}
