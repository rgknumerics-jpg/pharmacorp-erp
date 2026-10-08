import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { nextNumber } from '../common/numbering';
import { PrismaService } from '../prisma/prisma.service';

export interface TicketLineInput { productId: string; quantity: number; unitPrice?: number; discount?: number }

/**
 * Tickets vendeur -> caisse : le vendeur saisit la vente d'après l'ordonnance, l'envoie ; la caissière voit arriver le flux
 * de tickets, en vérifie le contenu et encaisse (le ticket devient alors une vente). Aucun stock n'est touché avant l'encaissement.
 */
@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  private async enrich(tx: any, rows: any[]) {
    const pids = [...new Set(rows.flatMap((r) => (r.items as TicketLineInput[]).map((i) => i.productId)))];
    const products = pids.length ? await tx.product.findMany({ where: { id: { in: pids } }, select: { id: true, name: true, salePrice: true, priceFree: true, prescriptionRequired: true, dosage: true, form: true, sku: true, barcode: true, vatRate: true, trackLots: true } }) : [];
    const byId = new Map<string, any>(products.map((p: any) => [p.id, p]));
    const uids = [...new Set(rows.map((r) => r.sellerId).filter(Boolean))] as string[];
    const users = uids.length ? await tx.user.findMany({ where: { id: { in: uids } }, select: { id: true, fullName: true } }) : [];
    const uname = new Map<string, string>(users.map((u: any) => [u.id, u.fullName]));
    const cids = [...new Set(rows.map((r) => r.customerId).filter(Boolean))] as string[];
    const customers = cids.length ? await tx.customer.findMany({ where: { id: { in: cids } }, select: { id: true, name: true, phone: true, creditLimit: true, creditBalance: true } }) : [];
    const cust = new Map<string, any>(customers.map((c: any) => [c.id, c]));
    return rows.map((r) => {
      const lines = (r.items as TicketLineInput[]).map((i) => {
        const p = byId.get(i.productId);
        const unit = p?.priceFree ? i.unitPrice ?? 0 : p?.salePrice ?? 0;
        return { productId: i.productId, name: p?.name ?? 'Produit supprimé', quantity: i.quantity, unitPrice: unit, discount: i.discount ?? 0, lineTotal: unit * i.quantity - (i.discount ?? 0), prescriptionRequired: !!p?.prescriptionRequired, priceFree: !!p?.priceFree, product: p ?? null };
      });
      return { id: r.id, number: r.number, status: r.status, note: r.note, createdAt: r.createdAt, closedAt: r.closedAt, saleId: r.saleId, sellerId: r.sellerId, sellerName: r.sellerId ? uname.get(r.sellerId) ?? null : null, customer: r.customerId ? cust.get(r.customerId) ?? null : null, lines, total: lines.reduce((s: number, l: any) => s + l.lineTotal, 0) };
    });
  }

  async create(user: AuthenticatedUser, body: { items: TicketLineInput[]; customerId?: string; note?: string }) {
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw new BadRequestException('Ajoutez au moins un produit.');
    if (items.length > 200) throw new BadRequestException('Trop de lignes.');
    const canDiscount = user.permissions.includes('sales.discount');
    const t = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
      const byId = new Map(products.map((p) => [p.id, p]));
      const clean: TicketLineInput[] = [];
      for (const i of items) {
        const p = byId.get(i.productId);
        if (!p || !p.isActive) throw new BadRequestException('Produit inconnu ou retiré de la vente.');
        const q = Math.round(Number(i.quantity));
        if (!(q >= 1 && q <= 9999)) throw new BadRequestException(`Quantité invalide pour « ${p.name} ».`);
        if (i.discount && !canDiscount) throw new ForbiddenException('Vous n’êtes pas autorisé à accorder une remise.');
        if (p.priceFree && !(Number(i.unitPrice) >= 0)) throw new BadRequestException(`Prix libre : saisissez le prix de « ${p.name} ».`);
        clean.push({ productId: p.id, quantity: q, ...(p.priceFree ? { unitPrice: Math.round(Number(i.unitPrice)) } : {}), ...(i.discount ? { discount: Math.round(Number(i.discount)) } : {}) });
      }
      if (body.customerId && !(await tx.customer.findUnique({ where: { id: body.customerId } }))) throw new NotFoundException('Client introuvable');
      const number = await nextNumber(tx, user.tenantId, 'T');
      return tx.saleTicket.create({ data: { tenantId: user.tenantId, number, sellerId: user.userId, customerId: body.customerId || null, note: (body.note ?? '').trim().slice(0, 300) || null, items: clean as unknown as object } });
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'tickets.created', entityType: 'sale_ticket', entityId: t.id, metadata: { number: t.number, lines: items.length } });
    return this.one(user, t.id);
  }

  /** La caissière voit tous les tickets ; un vendeur seulement les siens. */
  async list(user: AuthenticatedUser, status = 'open') {
    const all = user.permissions.includes('sales.create');
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      const rows = await tx.saleTicket.findMany({ where: { status, ...(all ? {} : { sellerId: user.userId }) }, orderBy: { createdAt: status === 'open' ? 'asc' : 'desc' }, take: 100 });
      return this.enrich(tx, rows);
    });
  }

  async one(user: AuthenticatedUser, id: string) {
    const all = user.permissions.includes('sales.create');
    const r = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const row = await tx.saleTicket.findUnique({ where: { id } });
      if (!row || (!all && row.sellerId !== user.userId)) return null;
      return (await this.enrich(tx, [row]))[0];
    });
    if (!r) throw new NotFoundException('Ticket introuvable');
    return r;
  }

  async cancel(user: AuthenticatedUser, id: string, reason?: string) {
    const all = user.permissions.includes('sales.create');
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      const row = await tx.saleTicket.findUnique({ where: { id } });
      if (!row || (!all && row.sellerId !== user.userId)) throw new NotFoundException('Ticket introuvable');
      if (row.status !== 'open') throw new ConflictException('Ce ticket est déjà clos.');
      await tx.saleTicket.update({ where: { id }, data: { status: 'cancelled', closedAt: new Date(), note: [row.note, reason ? `Annulé : ${reason.slice(0, 120)}` : 'Annulé'].filter(Boolean).join(' — ') } });
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'tickets.cancelled', entityType: 'sale_ticket', entityId: id, metadata: { reason } });
    return { ok: true };
  }
}
