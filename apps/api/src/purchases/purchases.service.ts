import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { nextNumber } from '../common/numbering';
import { normalizePhone } from '../common/phone.util';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { emit } from '../accounting/outbox';
import { CreatePurchaseOrderDto, CreateSupplierDto, ReceiveGoodsDto, UpdateSupplierDto } from './dto/purchases.dto';

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ----- Fournisseurs -----
  suppliers(tenantId: string, q?: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.supplier.findMany({ where: { isActive: true, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) }, orderBy: { name: 'asc' }, take: 200 }),
    );
  }

  createSupplier(tenantId: string, dto: CreateSupplierDto) {
    const phone = dto.phone ? normalizePhone(dto.phone) : null;
    if (dto.phone && !phone) throw new BadRequestException('Numero de telephone invalide');
    const { contacts, ...rest } = dto;
    return this.prisma.forTenant(tenantId, (tx) => tx.supplier.create({ data: { ...rest, phone, tenantId, ...(contacts ? { contacts: JSON.parse(JSON.stringify(contacts)) } : {}) } }));
  }

  async updateSupplier(tenantId: string, id: string, dto: UpdateSupplierDto) {
    const phone = dto.phone !== undefined ? normalizePhone(dto.phone) : undefined;
    return this.prisma.forTenant(tenantId, async (tx) => {
      if (!(await tx.supplier.findUnique({ where: { id } }))) throw new NotFoundException('Fournisseur introuvable');
      const { contacts, ...rest } = dto;
      return tx.supplier.update({ where: { id }, data: { ...rest, ...(phone !== undefined ? { phone } : {}), ...(contacts ? { contacts: JSON.parse(JSON.stringify(contacts)) } : {}) } });
    });
  }

  // ----- Commandes fournisseurs -----
  orders(tenantId: string, status?: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.purchaseOrder.findMany({
        where: status ? { status: status as never } : {},
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { supplier: { select: { name: true } }, _count: { select: { items: true } } },
      }),
    );
  }

  async order(tenantId: string, id: string) {
    const po = await this.prisma.forTenant(tenantId, (tx) =>
      tx.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, items: { include: { product: { select: { name: true, sku: true } } } } } }),
    );
    if (!po) throw new NotFoundException('Commande introuvable');
    return po;
  }

  async createOrder(user: AuthenticatedUser, dto: CreatePurchaseOrderDto) {
    const po = await this.prisma.forTenant(user.tenantId, async (tx) => {
      if (!(await tx.supplier.findUnique({ where: { id: dto.supplierId } }))) throw new NotFoundException('Fournisseur introuvable');
      const products = await tx.product.findMany({ where: { id: { in: dto.items.map((i) => i.productId) } } });
      if (products.length !== new Set(dto.items.map((i) => i.productId)).size) throw new BadRequestException('Produit inconnu dans la commande');
      const number = await nextNumber(tx, user.tenantId, 'CF');
      return tx.purchaseOrder.create({
        data: {
          tenantId: user.tenantId,
          number,
          supplierId: dto.supplierId,
          status: dto.send ? 'ordered' : 'draft',
          notes: dto.notes,
          expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : undefined,
          createdById: user.userId,
          items: {
            create: dto.items.map((i) => ({
              tenantId: user.tenantId,
              productId: i.productId,
              quantity: i.quantity,
              unitCost: i.unitCost ?? products.find((p) => p.id === i.productId)!.purchasePrice,
            })),
          },
        },
        include: { items: true },
      });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'purchases.order_created', entityType: 'purchase_order', entityId: po.id, metadata: { number: po.number } });
    return po;
  }

  async setOrderStatus(user: AuthenticatedUser, id: string, status: 'ordered' | 'cancelled') {
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!po) throw new NotFoundException('Commande introuvable');
      if (['received', 'cancelled'].includes(po.status)) throw new ConflictException('Commande deja cloturee');
      if (status === 'cancelled' && po.status === 'partially_received') throw new ConflictException('Commande partiellement recue : clôturez par une reception');
      return tx.purchaseOrder.update({ where: { id }, data: { status } });
    });
  }

  // ----- Receptions -----
  receipts(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.goodsReceipt.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { supplier: { select: { name: true } }, _count: { select: { items: true } } } }),
    );
  }

  async receipt(tenantId: string, id: string) {
    const r = await this.prisma.forTenant(tenantId, (tx) =>
      tx.goodsReceipt.findUnique({ where: { id }, include: { supplier: true, items: { include: { lot: true } } } }),
    );
    if (!r) throw new NotFoundException('Reception introuvable');
    return r;
  }

  /**
   * Reception de marchandise : cree (ou retrouve) les lots, ajoute les mouvements de stock positifs, met a jour la
   * commande liee. Utilisee par la saisie manuelle ET par la validation d'un bon de livraison OCR.
   * `opts.reviewedBy` = personne ayant verifie les lignes OCR : les lots a faible confiance restent bloques
   * a la vente tant qu'un AUTRE professionnel ne les a pas valides.
   */
  async receive(
    user: AuthenticatedUser,
    dto: ReceiveGoodsDto,
    opts: { ocrDocumentId?: string } = {},
  ) {
    const receipt = await this.prisma.forTenant(user.tenantId, async (tx) => {
      if (dto.depotId && dto.depotId !== 'main' && !(await tx.depot.findFirst({ where: { id: dto.depotId, isActive: true } }))) throw new NotFoundException('Dépôt de réception introuvable');
      const productIds = dto.lines.map((l) => l.productId);
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const byId = new Map(products.map((p) => [p.id, p]));
      for (const l of dto.lines) {
        const p = byId.get(l.productId);
        if (!p) throw new BadRequestException('Produit inconnu dans la reception');
        if (p.trackLots && (!l.lotNumber || !l.expiryDate)) {
          throw new BadRequestException(`Numero de lot et date de peremption obligatoires pour « ${p.name} ».`);
        }
        if (l.expiryDate && new Date(l.expiryDate).getTime() < Date.now() - 86_400_000) {
          throw new BadRequestException(`Date de peremption depassee pour « ${p.name} » : ne pas receptionner.`);
        }
      }
      if (dto.supplierId && !(await tx.supplier.findUnique({ where: { id: dto.supplierId } }))) throw new NotFoundException('Fournisseur introuvable');
      let po: Prisma.PurchaseOrderGetPayload<{ include: { items: true } }> | null = null;
      if (dto.purchaseOrderId) {
        po = await tx.purchaseOrder.findUnique({ where: { id: dto.purchaseOrderId }, include: { items: true } });
        if (!po) throw new NotFoundException('Commande introuvable');
        if (po.status === 'cancelled' || po.status === 'received') throw new ConflictException('Cette commande est deja cloturee');
      }

      await this.stock.lockProducts(tx, productIds);
      const number = await nextNumber(tx, user.tenantId, 'BR');
      const created = await tx.goodsReceipt.create({
        data: {
          tenantId: user.tenantId,
          number,
          purchaseOrderId: dto.purchaseOrderId,
          supplierId: dto.supplierId ?? po?.supplierId,
          supplierRef: dto.supplierRef,
          ocrDocumentId: opts.ocrDocumentId,
          receivedById: user.userId,
        },
      });

      for (const l of dto.lines) {
        const product = byId.get(l.productId)!;
        let lotId: string | null = null;
        if (product.trackLots) {
          const expiry = new Date(l.expiryDate!);
          const existing = await tx.lot.findUnique({
            where: { tenantId_productId_lotNumber: { tenantId: user.tenantId, productId: product.id, lotNumber: l.lotNumber! } },
          });
          if (existing) {
            if (existing.expiryDate && existing.expiryDate.toISOString().slice(0, 10) !== expiry.toISOString().slice(0, 10)) {
              throw new ConflictException(`Le lot ${l.lotNumber} de « ${product.name} » existe deja avec une autre date de peremption.`);
            }
            lotId = existing.id;
          } else {
            const lot = await tx.lot.create({
              data: {
                tenantId: user.tenantId,
                productId: product.id,
                lotNumber: l.lotNumber!,
                expiryDate: expiry,
                status: l.lowConfidence ? 'pending_review' : 'available',
                createdById: user.userId,
              },
            });
            lotId = lot.id;
          }
        }
        await tx.goodsReceiptItem.create({
          data: {
            tenantId: user.tenantId,
            receiptId: created.id,
            productId: product.id,
            lotId,
            quantity: l.quantity,
            unitCost: l.unitCost ?? 0,
            expiryDate: l.expiryDate ? new Date(l.expiryDate) : null,
          },
        });
        await this.stock.addMovement(tx, {
          tenantId: user.tenantId,
          productId: product.id,
          lotId,
          quantity: l.quantity,
          type: 'reception',
          refType: 'goods_receipt',
          refId: created.id,
          createdById: user.userId,
          depotId: dto.depotId && dto.depotId !== 'main' ? dto.depotId : null,
        });
        if (dto.updateCosts && l.unitCost && l.unitCost > 0) {
          await tx.product.update({ where: { id: product.id }, data: { purchasePrice: l.unitCost } });
        }
        if (po) {
          const item = po.items.find((i) => i.productId === product.id);
          if (item) await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQty: { increment: l.quantity } } });
        }
      }

      // facture a payer : echeance selon les conditions du fournisseur (0 = comptant), modifiable ensuite
      const supplierIdFinal = dto.supplierId ?? po?.supplierId;
      const amountDue = dto.lines.reduce((s, l) => s + l.quantity * (l.unitCost ?? 0), 0);
      if (supplierIdFinal && amountDue > 0) {
        const sup = await tx.supplier.findUniqueOrThrow({ where: { id: supplierIdFinal } });
        await tx.supplierInvoice.create({ data: { tenantId: user.tenantId, supplierId: sup.id, receiptId: created.id, number: dto.supplierRef ?? number, issueDate: new Date(), dueDate: new Date(Date.now() + sup.paymentTermDays * 86_400_000), amount: amountDue } });
      }
      await emit(tx, user.tenantId, 'goods.received', { receiptId: created.id, number, supplierRef: dto.supplierRef ?? null, amount: dto.lines.reduce((s, l) => s + l.quantity * (l.unitCost ?? 0), 0), date: new Date().toISOString() });

      if (po) {
        const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
        const done = items.every((i) => i.receivedQty >= i.quantity);
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: done ? 'received' : 'partially_received' } });
      }
      return created;
    });

    await this.auditLog.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'purchases.goods_received',
      entityType: 'goods_receipt',
      entityId: receipt.id,
      metadata: { number: receipt.number, lines: dto.lines.length, ocrDocumentId: opts.ocrDocumentId ?? null },
    });
    return this.receipt(user.tenantId, receipt.id);
  }
}
