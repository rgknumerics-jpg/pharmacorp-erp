import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { nextNumber } from '../common/numbering';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateProductHoldInput {
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  productId: string;
  quantity: number;
  dueDays?: number;
}

const DAY = 86_400_000;

/**
 * Avoirs clients (ARCHITECTURE.md -- Ventes) : produit indisponible en stock mais trouvable chez un grossiste.
 * Reservation tracee et imprimable, validee par un role habilite (sales.hold) -- ne touche ni le stock ni la
 * caisse ; la vente/encaissement reel se fait normalement au retrait, via le poste de vente.
 */
@Injectable()
export class ProductHoldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateProductHoldInput) {
    if (!user.permissions.includes('sales.hold')) {
      throw new ForbiddenException('Validation du titulaire ou d’un rôle habilité requise pour délivrer un avoir.');
    }
    const quantity = Math.trunc(Number(dto.quantity));
    if (!quantity || quantity < 1) throw new BadRequestException('Quantité invalide.');
    const customerName = dto.customerName?.trim();
    if (!customerName) throw new BadRequestException('Nom du client requis.');
    const dueDays = Math.min(90, Math.max(1, Math.trunc(Number(dto.dueDays ?? 30))));

    const row = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const product = await tx.product.findUnique({ where: { id: dto.productId } });
      if (!product) throw new NotFoundException('Produit introuvable');
      const number = await nextNumber(tx, user.tenantId, 'AV');
      return tx.productHold.create({
        data: {
          tenantId: user.tenantId,
          number,
          customerId: dto.customerId || null,
          customerName,
          customerPhone: dto.customerPhone?.trim() || null,
          productId: product.id,
          productName: product.name,
          quantity,
          unitPrice: product.salePrice,
          dueAt: new Date(Date.now() + dueDays * DAY),
          createdById: user.userId,
        },
      });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'product_holds.created', entityType: 'product_hold', entityId: row.id, metadata: { number: row.number, productName: row.productName, quantity } });
    return row;
  }

  async list(tenantId: string, status?: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.productHold.findMany({ where: { ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 300 }),
    );
  }

  async fulfill(user: AuthenticatedUser, id: string) {
    if (!user.permissions.includes('sales.hold')) throw new ForbiddenException('Non autorisé.');
    const row = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const h = await tx.productHold.findUnique({ where: { id } });
      if (!h) throw new NotFoundException('Avoir introuvable');
      if (h.status !== 'open') throw new BadRequestException('Cet avoir est déjà soldé ou annulé.');
      return tx.productHold.update({ where: { id }, data: { status: 'fulfilled', fulfilledAt: new Date(), fulfilledById: user.userId } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'product_holds.fulfilled', entityType: 'product_hold', entityId: row.id, metadata: { number: row.number } });
    return row;
  }

  async cancel(user: AuthenticatedUser, id: string) {
    if (!user.permissions.includes('sales.hold')) throw new ForbiddenException('Non autorisé.');
    const row = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const h = await tx.productHold.findUnique({ where: { id } });
      if (!h) throw new NotFoundException('Avoir introuvable');
      if (h.status !== 'open') throw new BadRequestException('Cet avoir est déjà soldé ou annulé.');
      return tx.productHold.update({ where: { id }, data: { status: 'cancelled' } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'product_holds.cancelled', entityType: 'product_hold', entityId: row.id, metadata: { number: row.number } });
    return row;
  }
}
