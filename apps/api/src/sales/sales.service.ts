import { scopeOf, visibleProductIds } from '../common/vat-scope';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@erp/database';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { nextNumber } from '../common/numbering';
import { onSaleSettled } from '../online/online-events';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { emit } from '../accounting/outbox';
import { FiscalLine, vatIncluded } from '../fiscal/fiscal';
import { AddPaymentsDto, CreateSaleDto, PaymentInputDto } from './dto/sales.dto';

type Tx = Prisma.TransactionClient;

/** Meilleure promotion applicable a une ligne : % de remise, montant par unite, ou x achetes = y offerts. */
export function bestPromotion(promos: { name: string; type: string; value: number; buyQty: number; freeQty: number; productIds: unknown; categoryIds: unknown }[], p: { id: string; categoryId: string | null }, qty: number, unitPrice: number) {
  let best: { name: string; discount: number } | null = null;
  for (const pr of promos) {
    const prods = (pr.productIds as string[]) ?? [], cats = (pr.categoryIds as string[]) ?? [];
    if (prods.length || cats.length) { if (!prods.includes(p.id) && !(p.categoryId && cats.includes(p.categoryId))) continue; }
    const gross = unitPrice * qty;
    const d = pr.type === 'percent' ? Math.round((gross * Math.min(100, pr.value)) / 100) : pr.type === 'amount' ? Math.min(gross, pr.value * qty) : pr.buyQty > 0 && pr.freeQty > 0 ? Math.floor(qty / (pr.buyQty + pr.freeQty)) * pr.freeQty * unitPrice : 0;
    if (d > 0 && (!best || d > best.discount)) best = { name: pr.name, discount: d };
  }
  return best;
}
/** Auteur d'une action : un utilisateur, ou le systeme (webhook operateur) sans utilisateur. */
type Actor = { tenantId: string; userId?: string };

const ASYNC_METHODS = ['mtn_momo', 'airtel_money'];
const FULL = { items: { include: { product: { select: { name: true, sku: true, vatRate: true } }, lot: { select: { lotNumber: true, expiryDate: true } } } }, payments: true, customer: { select: { id: true, name: true, phone: true } } } satisfies Prisma.SaleInclude;

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------------------------

  /** Liste filtrable : numero, date, client, mode de paiement, statut, type (V vente / A assurance / B bon), vendeur ; contenu de chaque vente. */
  list(tenantId: string, opts: { from?: string; to?: string; status?: string; q?: string; kind?: string; customer?: string; method?: string; seller?: string; take: number; skip: number; roleId?: string }) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const ids = opts.roleId ? await visibleProductIds(tx, await scopeOf(tx, opts.roleId)) : null;
      const day = (s: string, end = false) => { const d = new Date(`${s.slice(0, 10)}T00:00:00+01:00`); if (end) d.setDate(d.getDate() + 1); return d; };
      const rows = await tx.sale.findMany({
        where: {
          // perimetre TVA du role : ventes comportant au moins un article d'un taux autorise
          ...(ids ? { items: { some: { productId: { in: ids } } } } : {}),
          ...(opts.status ? { status: opts.status as never } : {}),
          ...(opts.kind && ['V', 'A', 'B'].includes(opts.kind) ? { kind: opts.kind } : {}),
          ...(opts.q ? { number: { contains: opts.q.trim(), mode: 'insensitive' as const } } : {}),
          ...(opts.customer ? { customer: { name: { contains: opts.customer.trim(), mode: 'insensitive' as const } } } : {}),
          ...(opts.method ? { payments: { some: { method: opts.method as never } } } : {}),
          ...(opts.seller ? { sellerId: opts.seller } : {}),
          ...(opts.from || opts.to ? { createdAt: { ...(opts.from ? { gte: opts.from.length <= 10 ? day(opts.from) : new Date(opts.from) } : {}), ...(opts.to ? (opts.to.length <= 10 ? { lt: day(opts.to, true) } : { lte: new Date(opts.to) }) : {}) } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: opts.take,
        skip: opts.skip,
        include: { customer: { select: { name: true } }, payments: { select: { method: true, status: true, amount: true } }, items: { select: { quantity: true, lineTotal: true, product: { select: { name: true } } } } },
      });
      const uids = [...new Set(rows.flatMap((r) => [r.cashierId, r.sellerId]).filter(Boolean) as string[])];
      const users = uids.length ? await tx.user.findMany({ where: { id: { in: uids } }, select: { id: true, fullName: true } }) : [];
      const name = new Map(users.map((u) => [u.id, u.fullName]));
      return rows.map(({ items, ...r }) => ({ ...r, cashierName: r.cashierId ? name.get(r.cashierId) ?? null : null, sellerName: r.sellerId ? name.get(r.sellerId) ?? null : null, content: items.map((i) => `${i.quantity} × ${i.product.name}`).join(' · '), itemCount: items.length }));
    });
  }

  async findOne(tenantId: string, id: string, roleId?: string) {
    const { s, ids } = await this.prisma.forTenant(tenantId, async (tx) => ({ s: await tx.sale.findUnique({ where: { id }, include: FULL }), ids: roleId ? await visibleProductIds(tx, await scopeOf(tx, roleId)) : null }));
    if (!s) throw new NotFoundException('Vente introuvable');
    if (!ids) return s;
    // lignes des produits hors perimetre TVA du role masquees ; vente entierement masquee si plus aucune ligne
    const items = s.items.filter((i) => ids.includes(i.productId));
    if (!items.length) throw new NotFoundException('Vente introuvable');
    return { ...s, items, total: items.reduce((t, i) => t + i.lineTotal, 0) };
  }

  // ---------------------------------------------------------------------------------------------
  // Encaissement
  // ---------------------------------------------------------------------------------------------

  async create(user: AuthenticatedUser, dto: CreateSaleDto) {
    if (dto.idempotencyKey) {
      const dup = await this.prisma.forTenant(user.tenantId, (tx) =>
        tx.sale.findFirst({ where: { idempotencyKey: dto.idempotencyKey }, include: FULL }),
      );
      if (dup) return { ...dup, warnings: [] as string[], replayed: true };
    }
    const warnings: string[] = [];
    const canDiscount = user.permissions.includes('sales.discount');
    if ((dto.payments ?? []).some((p) => p.method === 'credit') && !user.permissions.includes('sales.credit')) {
      throw new ForbiddenException('Vous n’avez pas le droit de vendre à crédit (bon de pharmacie).');
    }

    const saleId = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const productIds = dto.items.map((i) => i.productId);
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const byId = new Map(products.map((p) => [p.id, p]));
      for (const l of dto.items) {
        const p = byId.get(l.productId);
        if (!p) throw new BadRequestException('Produit inconnu dans la vente');
        if (!p.isActive) throw new BadRequestException(`« ${p.name} » n'est plus vendu.`);
        if (l.discount && !canDiscount) throw new ForbiddenException('Vous n\'etes pas autorise a accorder une remise.');
        if (l.lotId && !l.overrideReason) throw new BadRequestException('Motif obligatoire pour vendre un lot hors ordre FEFO.');
      }
      await this.stock.lockProducts(tx, productIds);
      const today = new Date(new Date().toISOString().slice(0, 10));
      const promos = await tx.promotion.findMany({ where: { isActive: true, startDate: { lte: today }, endDate: { gte: today } } });

      let customer: { id: string; creditLimit: number; creditBalance: number; isActive: boolean } | null = null;
      if (dto.customerId) {
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${dto.customerId}::uuid FOR UPDATE`;
        customer = await tx.customer.findUnique({ where: { id: dto.customerId } });
        if (!customer || !customer.isActive) throw new NotFoundException('Client introuvable');
      }

      // type de vente : A = tiers payant (assurance), B = bon de pharmacie (credit), V = vente
      const kind = (dto.payments ?? []).some((p) => p.method === 'insurer') ? 'A' : (dto.payments ?? []).some((p) => p.method === 'credit') ? 'B' : 'V';
      let sellerId: string | null = null;
      if (dto.ticketId) {
        await tx.$queryRaw`SELECT id FROM sale_tickets WHERE id = ${dto.ticketId}::uuid FOR UPDATE`;
        const tk = await tx.saleTicket.findUnique({ where: { id: dto.ticketId } });
        if (!tk || tk.status !== 'open') throw new ConflictException('Ce ticket a déjà été encaissé ou annulé.');
        sellerId = tk.sellerId;
      }
      const number = await nextNumber(tx, user.tenantId, kind);
      const sale = await tx.sale.create({
        data: { tenantId: user.tenantId, number, kind, customerId: dto.customerId, cashierId: user.userId, sellerId, ticketId: dto.ticketId, idempotencyKey: dto.idempotencyKey },
      });
      if (dto.ticketId) await tx.saleTicket.update({ where: { id: dto.ticketId }, data: { status: 'paid', saleId: sale.id, closedAt: new Date() } });

      let subtotal = 0, discount = 0, vat = 0, idx = 0, cost = 0;
      const fiscalLines: FiscalLine[] = [];
      for (const l of dto.items) {
        const p = byId.get(l.productId)!;
        let unitPrice = p.salePrice;
        if (p.priceFree) {
          if (l.unitPrice === undefined) throw new BadRequestException(`Prix libre : saisissez le prix de « ${p.name} ».`);
          unitPrice = l.unitPrice;
        } else if (l.unitPrice !== undefined && l.unitPrice !== p.salePrice) {
          throw new BadRequestException(`Le prix de « ${p.name} » est fixe (${p.salePrice} FCFA).`);
        }
        const lineGross = unitPrice * l.quantity;
        // promotion automatique : la meilleure offre applicable a cette ligne (sans permission de remise)
        const promo = bestPromotion(promos, p, l.quantity, unitPrice);
        const lineDiscount = Math.min(lineGross, (l.discount ?? 0) + (promo?.discount ?? 0));
        if (lineDiscount > lineGross) throw new BadRequestException('Remise superieure au montant de la ligne.');

        const allocations = await this.stock.allocate(tx, p, l.quantity, l.lotId);
        let first = true;
        for (const a of allocations) {
          const rowGross = unitPrice * a.quantity;
          const rowDiscount = first ? lineDiscount : 0;
          const rowTotal = rowGross - rowDiscount;
          await tx.saleItem.create({
            data: {
              tenantId: user.tenantId, saleId: sale.id, productId: p.id, lotId: a.lotId, quantity: a.quantity,
              unitPrice, discount: rowDiscount, vatRate: p.vatRate, lineTotal: rowTotal, unitCost: p.purchasePrice,
              note: l.lotId ? `Derogation FEFO : ${l.overrideReason}` : a.oversold ? 'Survente toleree' : first && promo ? `Promotion : ${promo.name}` : null,
            },
          });
          await this.stock.addMovement(tx, {
            tenantId: user.tenantId, productId: p.id, lotId: a.lotId, quantity: -a.quantity, type: 'sale',
            refType: 'sale', refId: sale.id, reason: l.lotId ? `Derogation FEFO : ${l.overrideReason}` : undefined,
            idempotencyKey: dto.idempotencyKey ? `${dto.idempotencyKey}:${idx}` : undefined, createdById: user.userId,
          });
          idx += 1;
          subtotal += rowGross; discount += rowDiscount; vat += vatIncluded(rowTotal, p.vatRate);
          cost += p.purchasePrice * a.quantity;
          fiscalLines.push({ name: p.name, quantity: a.quantity, unitPrice, vatRate: p.vatRate, lineTotal: rowTotal });
          if (a.oversold) warnings.push(`Survente de ${a.quantity} unite(s) de « ${p.name} » : stock a regulariser.`);
          first = false;
        }
        if (p.prescriptionRequired) warnings.push(`« ${p.name} » : ordonnance requise (verification du pharmacien).`);
      }
      const total = subtotal - discount;
      await tx.sale.update({ where: { id: sale.id }, data: { subtotal, discount, vatAmount: vat, total } });
      const cust = dto.customerId ? await tx.customer.findUnique({ where: { id: dto.customerId }, select: { name: true, phone: true } }) : null;
      await emit(tx, user.tenantId, 'sale.created', { saleId: sale.id, number, date: new Date().toISOString(), total, vat, cost, lines: fiscalLines as unknown as Prisma.InputJsonValue, customer: cust });
      await this.addPayments(tx, user.tenantId, sale.id, total, 0, dto.payments ?? [], customer);
      await this.refreshSale(tx, sale.id);
      // fidelite : points gagnes sur la part payee hors points et hors avoir
      if (customer) {
        const prof = await tx.companyProfile.findUnique({ where: { tenantId: user.tenantId } });
        if (prof?.loyaltyEnabled && prof.loyaltySpendPerPoint > 0) {
          const eligible = (dto.payments ?? []).filter((x) => x.method !== 'loyalty' && x.method !== 'store_credit').reduce((s, x) => s + x.amount, 0);
          const pts = Math.floor(Math.min(eligible, total) / prof.loyaltySpendPerPoint);
          if (pts > 0) await tx.customer.update({ where: { id: customer.id }, data: { loyaltyPoints: { increment: pts } } });
        }
      }
      return sale.id;
    });

    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'sales.created', entityType: 'sale', entityId: saleId, metadata: { items: dto.items.length, payments: (dto.payments ?? []).map((p) => `${p.method}:${p.amount}`) } });
    if (warnings.some((w) => w.startsWith('Survente'))) {
      await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'stock.oversold', entityType: 'sale', entityId: saleId, metadata: { warnings } });
    }
    return { ...(await this.findOne(user.tenantId, saleId)), warnings, replayed: false };
  }

  /** Cree les tentatives de paiement d'une vente. Chaque tentative porte son propre statut (ARCHITECTURE.md section 12). */
  private async addPayments(
    tx: Tx,
    tenantId: string,
    saleId: string,
    total: number,
    alreadyCounted: number,
    inputs: PaymentInputDto[],
    customer: { id: string; creditLimit: number; creditBalance: number } | null,
  ) {
    const sum = inputs.reduce((s, p) => s + p.amount, 0);
    if (alreadyCounted + sum > total) throw new BadRequestException(`Les paiements (${alreadyCounted + sum}) depassent le total (${total}).`);
    let creditToAdd = 0;
    for (const p of inputs) {
      if (p.method === 'credit') {
        if (!customer) throw new BadRequestException('Un paiement a credit exige un client.');
        creditToAdd += p.amount;
        if (customer.creditBalance + creditToAdd > customer.creditLimit) {
          throw new ConflictException(`Plafond de credit depasse (plafond ${customer.creditLimit}, du ${customer.creditBalance}).`);
        }
      }
      if (p.method === 'loyalty' || p.method === 'store_credit') {
        if (!customer) throw new BadRequestException('Ce mode de paiement exige un client.');
        const c = await tx.customer.findUniqueOrThrow({ where: { id: customer.id } });
        if (p.method === 'store_credit') {
          if (p.amount > c.storeCredit) throw new ConflictException(`Avoir insuffisant (disponible : ${c.storeCredit} FCFA).`);
          await tx.customer.update({ where: { id: c.id }, data: { storeCredit: { decrement: p.amount } } });
        } else {
          const prof = await tx.companyProfile.findUnique({ where: { tenantId } });
          if (!prof?.loyaltyEnabled) throw new BadRequestException('Programme de fidélité non activé.');
          const pts = Math.ceil(p.amount / prof.loyaltyPointValue);
          if (pts > c.loyaltyPoints) throw new ConflictException(`Points insuffisants (${c.loyaltyPoints} points = ${c.loyaltyPoints * prof.loyaltyPointValue} FCFA).`);
          await tx.customer.update({ where: { id: c.id }, data: { loyaltyPoints: { decrement: pts } } });
        }
      }
      if (p.method === 'insurer') {
        if (!p.insurerId) throw new BadRequestException('Tiers payant : choisissez l\'organisme.');
        const ins = await tx.insurer.findUnique({ where: { id: p.insurerId } });
        if (!ins || !ins.isActive) throw new NotFoundException('Organisme introuvable');
        await tx.insurer.update({ where: { id: ins.id }, data: { balance: { increment: p.amount } } });
      }
      const status: PaymentStatus = ASYNC_METHODS.includes(p.method) ? 'pending_confirmation' : 'confirmed';
      const pay = await tx.payment.create({
        data: { tenantId, saleId, method: p.method, amount: p.amount, status, reference: p.reference, insurerId: p.method === 'insurer' ? p.insurerId : null, confirmedAt: status === 'confirmed' ? new Date() : null },
      });
      if (status === 'confirmed') await emit(tx, tenantId, 'payment.confirmed', { paymentId: pay.id, saleId, method: p.method, amount: p.amount, date: new Date().toISOString() });
    }
    if (creditToAdd && customer) await tx.customer.update({ where: { id: customer.id }, data: { creditBalance: { increment: creditToAdd } } });
  }

  /** Recalcule le montant paye et le statut : "completed" uniquement quand tout est confirme. */
  private async refreshSale(tx: Tx, saleId: string) {
    const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: { payments: true } });
    if (sale.status === 'void') return;
    const paid = sale.payments.filter((p) => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0);
    await tx.sale.update({ where: { id: saleId }, data: { paidAmount: paid, status: paid >= sale.total ? 'completed' : 'awaiting_payment' } });
    // commande en ligne liée : paiement validé -> la commande passe à « payée » et le livreur est notifié
    if (paid >= sale.total && sale.total > 0) await onSaleSettled(tx, sale.tenantId, saleId, true);
  }

  async addMorePayments(user: AuthenticatedUser, saleId: string, dto: AddPaymentsDto) {
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { payments: true } });
      if (!sale) throw new NotFoundException('Vente introuvable');
      if (sale.status === 'void') throw new ConflictException('Vente annulee');
      let customer = null;
      if (sale.customerId) {
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${sale.customerId}::uuid FOR UPDATE`;
        customer = await tx.customer.findUnique({ where: { id: sale.customerId } });
      }
      const counted = sale.payments.filter((p) => p.status !== 'failed' && p.status !== 'refunded').reduce((s, p) => s + p.amount, 0);
      await this.addPayments(tx, user.tenantId, saleId, sale.total, counted, dto.payments, customer);
      await this.refreshSale(tx, saleId);
    });
    return this.findOne(user.tenantId, saleId);
  }

  /** Confirmation d'un paiement Mobile Money (webhook de l'operateur ou verification manuelle du caissier). */
  async confirmPayment(user: Actor, paymentId: string, reference?: string) {
    const saleId = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const pay = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!pay) throw new NotFoundException('Paiement introuvable');
      if (pay.status !== 'pending_confirmation') throw new ConflictException('Ce paiement n\'est pas en attente de confirmation');
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'confirmed', confirmedAt: new Date(), reference: reference ?? pay.reference } });
      await emit(tx, user.tenantId, 'payment.confirmed', { paymentId, saleId: pay.saleId, method: pay.method, amount: pay.amount, date: new Date().toISOString() });
      await this.refreshSale(tx, pay.saleId);
      return pay.saleId;
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'payments.confirmed', entityType: 'payment', entityId: paymentId, metadata: { reference: reference ?? null } });
    return this.findOne(user.tenantId, saleId);
  }

  async failPayment(user: Actor, paymentId: string) {
    const saleId = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const pay = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!pay) throw new NotFoundException('Paiement introuvable');
      if (pay.status !== 'pending_confirmation') throw new ConflictException('Seul un paiement en attente peut etre marque en echec');
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'failed' } });
      await this.refreshSale(tx, pay.saleId);
      return pay.saleId;
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'payments.failed', entityType: 'payment', entityId: paymentId });
    return this.findOne(user.tenantId, saleId);
  }

  /** Annulation : le stock revient dans les memes lots, le credit est extourne, les paiements confirmes sont rembourses. */
  async voidSale(user: AuthenticatedUser, saleId: string, reason: string) {
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true, payments: true } });
      if (!sale) throw new NotFoundException('Vente introuvable');
      if (sale.status === 'void') throw new ConflictException('Vente deja annulee');
      await this.stock.lockProducts(tx, sale.items.map((i) => i.productId));
      for (const it of sale.items) {
        await this.stock.addMovement(tx, {
          tenantId: user.tenantId, productId: it.productId, lotId: it.lotId, quantity: it.quantity, type: 'sale_return',
          refType: 'sale', refId: sale.id, reason: `Annulation : ${reason}`, createdById: user.userId,
        });
      }
      const credit = sale.payments.filter((p) => p.method === 'credit' && p.status === 'confirmed').reduce((s, p) => s + p.amount, 0);
      if (credit && sale.customerId) {
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${sale.customerId}::uuid FOR UPDATE`;
        const c = await tx.customer.findUniqueOrThrow({ where: { id: sale.customerId } });
        await tx.customer.update({ where: { id: c.id }, data: { creditBalance: Math.max(0, c.creditBalance - credit) } });
      }
      // avoirs et points utilises : rendus au client
      if (sale.customerId) {
        const back = sale.payments.filter((x) => x.status === 'confirmed');
        const credit = back.filter((x) => x.method === 'store_credit').reduce((s, x) => s + x.amount, 0);
        const prof = await tx.companyProfile.findUnique({ where: { tenantId: user.tenantId } });
        const pts = prof?.loyaltyPointValue ? Math.ceil(back.filter((x) => x.method === 'loyalty').reduce((s, x) => s + x.amount, 0) / prof.loyaltyPointValue) : 0;
        const earned = prof?.loyaltyEnabled && prof.loyaltySpendPerPoint ? Math.floor(back.filter((x) => x.method !== 'loyalty' && x.method !== 'store_credit').reduce((s, x) => s + x.amount, 0) / prof.loyaltySpendPerPoint) : 0;
        if (credit || pts || earned) {
          const c = await tx.customer.findUniqueOrThrow({ where: { id: sale.customerId } });
          await tx.customer.update({ where: { id: c.id }, data: { storeCredit: { increment: credit }, loyaltyPoints: Math.max(0, c.loyaltyPoints + pts - earned) } });
        }
      }
      for (const p of sale.payments.filter((x) => x.method === 'insurer' && x.status === 'confirmed' && x.insurerId)) {
        await tx.insurer.update({ where: { id: p.insurerId! }, data: { balance: { decrement: p.amount } } });
      }
      await tx.payment.updateMany({ where: { saleId, status: 'confirmed' }, data: { status: 'refunded' } });
      await tx.payment.updateMany({ where: { saleId, status: 'pending_confirmation' }, data: { status: 'failed' } });
      await tx.sale.update({ where: { id: saleId }, data: { status: 'void', voidReason: reason, voidedAt: new Date() } });
      await emit(tx, user.tenantId, 'sale.voided', { saleId, number: sale.number, reason, date: new Date().toISOString() });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'sales.voided', entityType: 'sale', entityId: saleId, metadata: { reason } });
    return this.findOne(user.tenantId, saleId);
  }
}
