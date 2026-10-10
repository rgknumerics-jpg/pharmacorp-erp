import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateTransferRequestInput {
  targetTenantId: string;
  productName: string;
  targetProductId?: string;
  quantity: number;
  note?: string;
}

/**
 * Reseau de pharmacies (ARCHITECTURE.md -- Achats) : avant de commander chez un grossiste, verifier si une
 * consoeur du meme reseau a le produit en surstock. Les tenants qui partagent le meme `networkCode` se voient
 * mutuellement -- jamais au-dela. `transfer_requests` est volontairement hors RLS tenant_id classique (policy
 * dediee, voir la migration) : chaque lecture passe par `forTenant(callerTenantId, ...)` comme d'habitude,
 * Postgres filtre alors automatiquement aux lignes ou l'appelant est demandeur OU destinataire.
 */
@Injectable()
export class NetworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async settings(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const peers = t.networkCode
      ? await this.prisma.tenant.findMany({ where: { networkCode: t.networkCode, id: { not: tenantId }, isActive: true }, select: { id: true, name: true } })
      : [];
    return { networkCode: t.networkCode, peers };
  }

  async setNetworkCode(tenantId: string, code: string | null) {
    const trimmed = code?.trim() || null;
    if (trimmed && trimmed.length > 60) throw new BadRequestException('Code réseau trop long (60 caractères max).');
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { networkCode: trimmed } });
    await this.auditLog.record({ tenantId, action: 'network.code_changed', entityType: 'tenant', entityId: tenantId, metadata: { networkCode: trimmed } });
    return this.settings(tenantId);
  }

  /** Produits et stock des consoeurs du reseau correspondant a `query` -- jamais la propre pharmacie. */
  async findStock(tenantId: string, query: string) {
    const term = query.trim();
    if (term.length < 2) return [];
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (!t.networkCode) return [];
    const peers = await this.prisma.tenant.findMany({ where: { networkCode: t.networkCode, id: { not: tenantId }, isActive: true }, select: { id: true, name: true } });
    const results: { tenantId: string; tenantName: string; productId: string; productName: string; stock: number }[] = [];
    for (const peer of peers) {
      const rows = await this.prisma.forTenant(peer.id, async (tx) => {
        const found = await tx.product.findMany({
          where: { isActive: true, OR: [{ name: { contains: term, mode: 'insensitive' } }, { barcode: term }, { dci: { contains: term, mode: 'insensitive' } }] },
          take: 8,
        });
        if (!found.length) return [];
        const pid = found.map((p) => p.id);
        const sums = await tx.$queryRaw<{ pid: string; q: number }[]>`SELECT product_id AS pid, SUM(quantity)::int AS q FROM inventory_movements WHERE product_id = ANY(${pid}::uuid[]) AND depot_id IS NULL GROUP BY product_id`;
        const stock = new Map(sums.map((s) => [s.pid, s.q]));
        return found.map((p) => ({ productId: p.id, productName: p.name, stock: stock.get(p.id) ?? 0 }));
      });
      for (const r of rows) if (r.stock > 0) results.push({ tenantId: peer.id, tenantName: peer.name, ...r });
    }
    return results.sort((a, b) => b.stock - a.stock).slice(0, 30);
  }

  async create(user: AuthenticatedUser, dto: CreateTransferRequestInput) {
    const quantity = Math.trunc(Number(dto.quantity));
    if (!quantity || quantity < 1) throw new BadRequestException('Quantité invalide.');
    const productName = dto.productName?.trim();
    if (!productName) throw new BadRequestException('Produit requis.');
    const me = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    const target = await this.prisma.tenant.findUnique({ where: { id: dto.targetTenantId } });
    if (!target || !me.networkCode || target.networkCode !== me.networkCode) {
      throw new ForbiddenException('Cette pharmacie n’est pas (ou plus) dans votre réseau.');
    }
    const row = await this.prisma.forTenant(user.tenantId, (tx) =>
      tx.transferRequest.create({
        data: {
          requestingTenantId: user.tenantId,
          requestingTenantName: me.name,
          targetTenantId: target.id,
          targetTenantName: target.name,
          productName,
          targetProductId: dto.targetProductId,
          quantity,
          note: dto.note?.trim() || null,
          requestedById: user.userId,
        },
      }),
    );
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'transfer_requests.created', entityType: 'transfer_request', entityId: row.id, metadata: { targetTenantName: target.name, productName, quantity } });
    return row;
  }

  list(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) => tx.transferRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }));
  }

  private async getOwned(tenantId: string, id: string, side: 'requesting' | 'target', status: string | string[]) {
    const row = await this.prisma.forTenant(tenantId, (tx) => tx.transferRequest.findUnique({ where: { id } }));
    if (!row) throw new NotFoundException('Demande de transfert introuvable');
    const owner = side === 'requesting' ? row.requestingTenantId : row.targetTenantId;
    if (owner !== tenantId) throw new ForbiddenException('Non autorisé.');
    const allowed = Array.isArray(status) ? status : [status];
    if (!allowed.includes(row.status)) throw new BadRequestException(`Cette demande est au statut « ${row.status} ».`);
    return row;
  }

  async respond(user: AuthenticatedUser, id: string, action: 'accept' | 'reject') {
    await this.getOwned(user.tenantId, id, 'target', 'pending');
    const row = await this.prisma.forTenant(user.tenantId, (tx) =>
      tx.transferRequest.update({ where: { id }, data: { status: action === 'accept' ? 'accepted' : 'rejected', respondedById: user.userId } }),
    );
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: `transfer_requests.${action}ed`, entityType: 'transfer_request', entityId: id });
    return row;
  }

  async ship(user: AuthenticatedUser, id: string) {
    await this.getOwned(user.tenantId, id, 'target', 'accepted');
    const row = await this.prisma.forTenant(user.tenantId, (tx) => tx.transferRequest.update({ where: { id }, data: { status: 'shipped' } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'transfer_requests.shipped', entityType: 'transfer_request', entityId: id });
    return row;
  }

  async receive(user: AuthenticatedUser, id: string) {
    await this.getOwned(user.tenantId, id, 'requesting', 'shipped');
    const row = await this.prisma.forTenant(user.tenantId, (tx) => tx.transferRequest.update({ where: { id }, data: { status: 'received' } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'transfer_requests.received', entityType: 'transfer_request', entityId: id });
    return row;
  }

  async cancel(user: AuthenticatedUser, id: string) {
    await this.getOwned(user.tenantId, id, 'requesting', 'pending');
    const row = await this.prisma.forTenant(user.tenantId, (tx) => tx.transferRequest.update({ where: { id }, data: { status: 'cancelled' } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'transfer_requests.cancelled', entityType: 'transfer_request', entityId: id });
    return row;
  }
}
