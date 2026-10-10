import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Journal des ruptures : un produit recherche a la vente, trouve a 0 en stock. */
@Injectable()
export class StockoutsService {
  private readonly logger = new Logger(StockoutsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Appele depuis la recherche de vente -- jamais attendu par l'appelant (ne doit pas ralentir la caisse). */
  logMisses(tenantId: string, userId: string | undefined, items: { productId: string; name: string }[]): void {
    if (!items.length) return;
    this.prisma
      .forTenant(tenantId, (tx) =>
        tx.stockoutLog.createMany({
          data: items.map((i) => ({ tenantId, productId: i.productId, productName: i.name, userId })),
        }),
      )
      .catch((e) => this.logger.warn(`Journal des ruptures : ecriture ignoree (${(e as Error).message})`));
  }

  async list(tenantId: string, take = 100, skip = 0) {
    const rows = await this.prisma.forTenant(tenantId, (tx) =>
      tx.stockoutLog.findMany({ orderBy: { createdAt: 'desc' }, take, skip }),
    );
    const users = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]),
    );
    return rows.map((r) => ({ ...r, userName: r.userId ? users.get(r.userId) ?? '—' : '—' }));
  }

  /** Produits les plus recherches en rupture sur la periode -- alimente les propositions d'achat. */
  async summary(tenantId: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.forTenant(tenantId, (tx) =>
      tx.stockoutLog.groupBy({ by: ['productId', 'productName'], where: { createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { productName: 'desc' } }, take: 50 }),
    );
    return rows.map((r) => ({ productId: r.productId, productName: r.productName, count: r._count._all }));
  }
}
