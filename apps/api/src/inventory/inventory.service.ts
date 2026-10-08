import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { emit } from '../accounting/outbox';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { nextNumber } from '../common/numbering';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';

/**
 * Inventaire : on compte (par scan ou saisie), le systeme compare au stock theorique AU MOMENT DU COMPTAGE, valorise
 * les ecarts, et un responsable valide. La validation cree les mouvements d'ecart et l'ecriture comptable.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService, private readonly stock: StockService, private readonly auditLog: AuditLogService) {}

  sessions(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) => tx.inventorySession.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { _count: { select: { counts: true } } } }));
  }

  async open(user: AuthenticatedUser, scope: 'full' | 'partial', note?: string) {
    const s = await this.prisma.forTenant(user.tenantId, async (tx) => {
      if (await tx.inventorySession.findFirst({ where: { status: 'open' } })) throw new ConflictException('Un inventaire est déjà en cours : terminez-le ou annulez-le.');
      return tx.inventorySession.create({ data: { tenantId: user.tenantId, number: await nextNumber(tx, user.tenantId, 'INV'), scope, note, createdById: user.userId } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'inventory.opened', entityType: 'inventory_session', entityId: s.id, metadata: { scope } });
    return s;
  }

  /** Saisie d'un comptage (remplace le precedent pour le meme produit / lot). */
  async count(user: AuthenticatedUser, sessionId: string, productId: string, lotId: string | null, counted: number) {
    if (!Number.isInteger(counted) || counted < 0) throw new BadRequestException('Quantité comptée invalide');
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      const s = await tx.inventorySession.findUnique({ where: { id: sessionId } });
      if (!s || s.status !== 'open') throw new ConflictException('Inventaire clos ou introuvable');
      const p = await tx.product.findUnique({ where: { id: productId } });
      if (!p) throw new NotFoundException('Produit introuvable');
      if (p.trackLots && !lotId) throw new BadRequestException('Indiquez le lot compté (produit géré par lot).');
      const expected = lotId ? await this.stock.lotBalance(tx, lotId) : (await tx.inventoryMovement.aggregate({ where: { productId, lotId: null }, _sum: { quantity: true } }))._sum.quantity ?? 0;
      const existing = await tx.inventoryCount.findFirst({ where: { sessionId, productId, lotId } });
      return existing
        ? tx.inventoryCount.update({ where: { id: existing.id }, data: { counted, expected, countedById: user.userId, countedAt: new Date() } })
        : tx.inventoryCount.create({ data: { tenantId: user.tenantId, sessionId, productId, lotId, expected, counted, countedById: user.userId } });
    });
  }

  async report(tenantId: string, sessionId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const s = await tx.inventorySession.findUnique({ where: { id: sessionId } });
      if (!s) throw new NotFoundException('Inventaire introuvable');
      const counts = await tx.inventoryCount.findMany({ where: { sessionId } });
      const products = new Map((await tx.product.findMany({ where: { id: { in: counts.map((c) => c.productId) } } })).map((p) => [p.id, p]));
      const lots = new Map((await tx.lot.findMany({ where: { id: { in: counts.map((c) => c.lotId).filter((x): x is string => !!x) } } })).map((l) => [l.id, l]));
      const lines = counts.map((c) => { const p = products.get(c.productId)!; const diff = c.counted - c.expected; return { id: c.id, productId: c.productId, name: p.name, sku: p.sku, lot: c.lotId ? lots.get(c.lotId)?.lotNumber ?? null : null, expiryDate: c.lotId ? lots.get(c.lotId)?.expiryDate ?? null : null, expected: c.expected, counted: c.counted, diff, value: diff * p.purchasePrice }; })
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      const notCounted = s.scope === 'full' ? await tx.$queryRaw<{ name: string; qty: number }[]>`
        SELECT p.name, SUM(m.quantity)::int AS qty FROM products p JOIN inventory_movements m ON m.product_id = p.id
        WHERE p.is_active AND p.id NOT IN (SELECT product_id FROM inventory_counts WHERE session_id = ${sessionId}::uuid)
        GROUP BY p.id HAVING SUM(m.quantity) <> 0 ORDER BY p.name LIMIT 300` : [];
      return { session: s, lines, totals: { lines: lines.length, gains: lines.filter((l) => l.value > 0).reduce((t, l) => t + l.value, 0), losses: lines.filter((l) => l.value < 0).reduce((t, l) => t + l.value, 0), net: lines.reduce((t, l) => t + l.value, 0) }, notCounted };
    });
  }

  async validate(user: AuthenticatedUser, sessionId: string) {
    const rep = await this.report(user.tenantId, sessionId);
    if (rep.session.status !== 'open') throw new ConflictException('Inventaire déjà clos');
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      await this.stock.lockProducts(tx, rep.lines.map((l) => l.productId));
      for (const l of rep.lines.filter((x) => x.diff !== 0)) {
        const c = await tx.inventoryCount.findUniqueOrThrow({ where: { id: l.id } });
        const p = await tx.product.findUniqueOrThrow({ where: { id: c.productId } });
        const mv = await tx.inventoryMovement.create({ data: { tenantId: user.tenantId, productId: c.productId, lotId: c.lotId, quantity: l.diff, type: 'inventory', refType: 'inventory_session', refId: sessionId, reason: `Inventaire ${rep.session.number}`, createdById: user.userId } });
        await emit(tx, user.tenantId, 'stock.adjusted', { movementId: mv.id, productId: p.id, quantity: l.diff, unitCost: p.purchasePrice, reason: `Écart d'inventaire ${rep.session.number}`, date: new Date().toISOString() });
      }
      await tx.inventorySession.update({ where: { id: sessionId }, data: { status: 'validated', validatedById: user.userId, validatedAt: new Date() } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'inventory.validated', entityType: 'inventory_session', entityId: sessionId, metadata: { number: rep.session.number, ...rep.totals } });
    return this.report(user.tenantId, sessionId);
  }

  async cancel(user: AuthenticatedUser, sessionId: string) {
    await this.prisma.forTenant(user.tenantId, (tx) => tx.inventorySession.update({ where: { id: sessionId }, data: { status: 'cancelled' } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'inventory.cancelled', entityType: 'inventory_session', entityId: sessionId });
    return { ok: true };
  }
}