import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@erp/database';
import * as bcrypt from 'bcrypt';
import { AuditLogService } from '../audit-log/audit-log.service';
import { withSettings } from '../company/settings';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { nextNumber } from '../common/numbering';
import { normalizePhone } from '../common/phone.util';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { courseText, Hist, notify, ORDER_STATUS } from './online-events';
import { PortalAuth, PortalToken } from './portal-auth';

const METHODS = ['mtn_momo', 'airtel_money', 'cash'];
const NEXT_STAFF: Record<string, string[]> = { new: ['accepted', 'cancelled'], accepted: ['ready', 'cancelled'], ready: ['out', 'delivered', 'cancelled'], out: ['delivered'], delivered: [], cancelled: [] };
const hist = (o: { history: unknown }, action: string, by?: string | null): Prisma.InputJsonValue => [...(((o.history as Hist[]) ?? []).slice(-40)), { at: new Date().toISOString(), action, by: by ?? null }] as unknown as Prisma.InputJsonValue;

@Injectable()
export class OnlineService {
  constructor(private readonly prisma: PrismaService, private readonly auth: PortalAuth, private readonly sales: SalesService, private readonly audit: AuditLogService) {}

  // ------------------------------------------------------------------ pharmacie, catalogue
  async tenant(slug: string) {
    const t = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!t || !t.isActive) throw new NotFoundException('Pharmacie introuvable');
    const p = await this.prisma.forTenant(t.id, (tx) => tx.companyProfile.findUnique({ where: { tenantId: t.id }, select: { settings: true, legalName: true, address: true, city: true, phone: true } }));
    const online = withSettings(p?.settings).online;
    if (!online.enabled) throw new NotFoundException('Catalogue en ligne non activé');
    return { t, p, online };
  }

  async info(slug: string) {
    const { t, p, online } = await this.tenant(slug);
    // identite propre de l'appli client (ex. « Rive Gauche ») : si non renseignee, on retombe sur celle de la pharmacie.
    return {
      name: online.brandName || p?.legalName || t.name,
      tagline: online.tagline || null,
      logoUrl: online.logoUrl || null,
      primaryColor: online.primaryColor || null,
      address: p?.address ?? null, city: p?.city ?? null, phone: p?.phone ?? null,
      registration: online.registration, delivery: online.delivery,
    };
  }

  async catalog(slug: string, q?: string, category?: string, take?: string, skip?: string) {
    const { t, online } = await this.tenant(slug);
    const n = Math.min(60, Math.max(1, Number(take) || 30)), s = Math.max(0, Number(skip) || 0);
    return this.prisma.forTenant(t.id, async (tx) => {
      const used = new Set((await tx.product.groupBy({ by: ['categoryId'], where: { isActive: true, onlineVisible: true, prescriptionRequired: false, priceFree: false } })).map((g) => g.categoryId));
      const allCats = (await tx.category.findMany({ orderBy: { name: 'asc' } })).filter((c) => !online.hiddenCategoryIds.includes(c.id));
      const allowed = allCats.map((c) => c.id);
      const cats = allCats.filter((c) => used.has(c.id)); // seulement les catégories qui contiennent des produits proposés
      const where = {
        isActive: true, onlineVisible: true, prescriptionRequired: false, priceFree: false,
        OR: [{ categoryId: null }, { categoryId: { in: allowed } }],
        ...(category ? { categoryId: category } : {}),
        ...(q?.trim() ? { name: { contains: q.trim().slice(0, 60), mode: 'insensitive' as const } } : {}),
      };
      const [items, total] = await Promise.all([
        tx.product.findMany({ where, orderBy: { name: 'asc' }, take: n, skip: s, select: { id: true, name: true, dci: true, form: true, dosage: true, salePrice: true, categoryId: true } }),
        tx.product.count({ where }),
      ]);
      const ids = items.map((i) => i.id);
      const stock = ids.length ? await tx.inventoryMovement.groupBy({ by: ['productId'], where: { productId: { in: ids } }, _sum: { quantity: true } }) : [];
      const on = new Map(stock.map((x) => [x.productId, x._sum.quantity ?? 0]));
      return { total, categories: cats.map((c) => ({ id: c.id, name: c.name })), items: items.map((i) => ({ ...i, available: (on.get(i.id) ?? 0) > 0 })) };
    });
  }

  // ------------------------------------------------------------------ comptes clients
  async register(slug: string, b: { name?: string; phone?: string; email?: string; password?: string; address?: string }, ip?: string) {
    const { t, online } = await this.tenant(slug);
    if (!online.registration) throw new BadRequestException('Les inscriptions sont fermées.');
    const name = (b.name ?? '').trim().slice(0, 120), phone = normalizePhone(b.phone);
    const email = (b.email ?? '').trim().toLowerCase().slice(0, 160);
    if (name.length < 2) throw new BadRequestException('Indiquez votre nom.');
    // numero WhatsApp de contact (meme format que le telephone, section 24 : +242 0X XXX XX XX, le 0 est conserve)
    if (!phone) throw new BadRequestException('Numéro WhatsApp invalide (ex. 06 123 45 67).');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Adresse e-mail invalide.');
    if ((b.password ?? '').length < 6) throw new BadRequestException('Le mot de passe doit comporter au moins 6 caractères.');
    this.auth.guard(`reg:${ip}`);
    const acc = await this.prisma.forTenant(t.id, async (tx) => {
      if (await tx.customerAccount.findFirst({ where: { phone } })) throw new ConflictException('Un compte existe déjà avec ce numéro : connectez-vous.');
      let customer = await tx.customer.findFirst({ where: { phone, isActive: true } });
      if (!customer) customer = await tx.customer.create({ data: { tenantId: t.id, name, phone, email, address: (b.address ?? '').trim().slice(0, 200) || null, kind: 'particulier', source: 'online' } });
      else if (!customer.email) await tx.customer.update({ where: { id: customer.id }, data: { email } });
      return tx.customerAccount.create({ data: { tenantId: t.id, customerId: customer.id, phone, passwordHash: await bcrypt.hash(b.password as string, 10) } });
    });
    this.auth.fail(`reg:${ip}`);
    return { token: await this.auth.sign({ scope: 'customer', tenantId: t.id, sub: acc.id }), name, phone };
  }

  async login(slug: string, b: { phone?: string; password?: string }, ip?: string) {
    const { t } = await this.tenant(slug);
    const phone = normalizePhone(b.phone);
    const key = `login:${ip}:${phone}`;
    this.auth.guard(key);
    const acc = phone ? await this.prisma.forTenant(t.id, (tx) => tx.customerAccount.findFirst({ where: { phone } })) : null;
    if (!acc || !(await bcrypt.compare(b.password ?? '', acc.passwordHash))) { this.auth.fail(key); throw new BadRequestException('Téléphone ou mot de passe incorrect.'); }
    this.auth.ok(key);
    const c = await this.prisma.forTenant(t.id, async (tx) => { await tx.customerAccount.update({ where: { id: acc.id }, data: { lastLoginAt: new Date() } }); return tx.customer.findUnique({ where: { id: acc.customerId } }); });
    return { token: await this.auth.sign({ scope: 'customer', tenantId: t.id, sub: acc.id }), name: c?.name ?? '', phone: acc.phone };
  }

  private async account(slug: string, header: string | undefined) {
    const { t, online } = await this.tenant(slug);
    const p = await this.auth.verify(header, 'customer', t.id);
    const acc = await this.prisma.forTenant(t.id, (tx) => tx.customerAccount.findUnique({ where: { id: p.sub } }));
    if (!acc) throw new NotFoundException('Compte introuvable');
    return { t, online, acc };
  }

  async me(slug: string, header: string | undefined) {
    const { t, acc } = await this.account(slug, header);
    return this.prisma.forTenant(t.id, async (tx) => {
      const c = await tx.customer.findUnique({ where: { id: acc.customerId }, select: { name: true, phone: true, address: true } });
      const unread = await tx.portalNotification.count({ where: { recipientType: 'customer', recipientId: acc.id, readAt: null } });
      return { ...c, unread };
    });
  }

  // ------------------------------------------------------------------ commandes du client
  async createOrder(slug: string, header: string | undefined, b: { items?: { productId: string; quantity: number }[]; fulfilment?: string; address?: string; addressNote?: string; paymentMethod?: string; paymentRef?: string; note?: string; phone?: string }) {
    const { t, online, acc } = await this.account(slug, header);
    const fulfilment = b.fulfilment === 'pickup' ? 'pickup' : 'delivery';
    if (fulfilment === 'delivery' && !online.delivery) throw new BadRequestException('La livraison n’est pas proposée : choisissez le retrait en pharmacie.');
    const address = (b.address ?? '').trim().slice(0, 240);
    if (fulfilment === 'delivery' && address.length < 5) throw new BadRequestException('Indiquez votre adresse de livraison.');
    const method = METHODS.includes(b.paymentMethod ?? '') ? (b.paymentMethod as string) : null;
    if (!method) throw new BadRequestException('Choisissez le mode de paiement.');
    const lines = (Array.isArray(b.items) ? b.items : []).map((l) => ({ productId: String(l.productId), quantity: Math.round(Number(l.quantity)) })).filter((l) => l.productId && l.quantity >= 1 && l.quantity <= 20).slice(0, 40);
    if (!lines.length) throw new BadRequestException('Votre panier est vide.');
    const phone = normalizePhone(b.phone) ?? acc.phone;
    const order = await this.prisma.forTenant(t.id, async (tx) => {
      const prods = await tx.product.findMany({ where: { id: { in: lines.map((l) => l.productId) }, isActive: true, onlineVisible: true, prescriptionRequired: false, priceFree: false } });
      const by = new Map(prods.map((p) => [p.id, p]));
      const stock = await tx.inventoryMovement.groupBy({ by: ['productId'], where: { productId: { in: [...by.keys()] } }, _sum: { quantity: true } });
      const on = new Map(stock.map((x) => [x.productId, x._sum.quantity ?? 0]));
      const items = lines.map((l) => {
        const p = by.get(l.productId);
        if (!p || online.hiddenCategoryIds.includes(p.categoryId ?? '')) throw new BadRequestException('Un produit de votre panier n’est plus proposé.');
        if ((on.get(p.id) ?? 0) < l.quantity) throw new BadRequestException(`« ${p.name} » n’est plus disponible en quantité suffisante.`);
        return { productId: p.id, name: p.name, quantity: l.quantity, unitPrice: p.salePrice };
      });
      const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
      const ref = (b.paymentRef ?? '').trim().slice(0, 60) || null;
      return tx.onlineOrder.create({
        data: {
          tenantId: t.id, number: await nextNumber(tx, t.id, 'CO'), accountId: acc.id, customerId: acc.customerId, items: items as unknown as Prisma.InputJsonValue,
          subtotal, deliveryFee: 0, total: subtotal, fulfilment, address: fulfilment === 'delivery' ? address : null, addressNote: (b.addressNote ?? '').trim().slice(0, 160) || null, phone,
          paymentMethod: method, paymentRef: method === 'cash' ? null : ref, paymentStatus: method === 'cash' ? 'cod' : ref ? 'declared' : 'pending', note: (b.note ?? '').trim().slice(0, 300) || null,
          history: [{ at: new Date().toISOString(), action: 'Commande passée' }] as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return this.view(order);
  }

  private view(o: { id: string; number: string; status: string; items: unknown; total: number; fulfilment: string; address: string | null; paymentMethod: string; paymentStatus: string; createdAt: Date; history: unknown }) {
    return { id: o.id, number: o.number, status: o.status, statusLabel: ORDER_STATUS[o.status] ?? o.status, items: o.items, total: o.total, fulfilment: o.fulfilment, address: o.address, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, createdAt: o.createdAt, history: o.history };
  }

  async myOrders(slug: string, header: string | undefined) {
    const { t, acc } = await this.account(slug, header);
    return this.prisma.forTenant(t.id, async (tx) => (await tx.onlineOrder.findMany({ where: { accountId: acc.id }, orderBy: { createdAt: 'desc' }, take: 50 })).map((o) => this.view(o)));
  }

  /** Le client indique avoir payé (référence du transfert Mobile Money) : la pharmacie vérifie puis valide. */
  async declarePayment(slug: string, header: string | undefined, id: string, reference: string) {
    const { t, acc } = await this.account(slug, header);
    const ref = (reference ?? '').trim().slice(0, 60);
    if (ref.length < 4) throw new BadRequestException('Indiquez la référence de la transaction.');
    return this.prisma.forTenant(t.id, async (tx) => {
      const o = await tx.onlineOrder.findFirst({ where: { id, accountId: acc.id } });
      if (!o) throw new NotFoundException('Commande introuvable');
      if (o.paymentMethod === 'cash' || o.paymentStatus === 'paid') throw new ConflictException('Aucun paiement à déclarer pour cette commande.');
      if (o.status === 'cancelled') throw new ConflictException('Commande annulée.');
      return this.view(await tx.onlineOrder.update({ where: { id }, data: { paymentRef: ref, paymentStatus: 'declared', history: hist(o, 'Paiement déclaré par le client'), updatedAt: new Date() } }));
    });
  }

  async cancelMine(slug: string, header: string | undefined, id: string) {
    const { t, acc } = await this.account(slug, header);
    return this.prisma.forTenant(t.id, async (tx) => {
      const o = await tx.onlineOrder.findFirst({ where: { id, accountId: acc.id } });
      if (!o) throw new NotFoundException('Commande introuvable');
      if (o.status !== 'new') throw new ConflictException('La commande est déjà en préparation : appelez la pharmacie pour l’annuler.');
      return this.view(await tx.onlineOrder.update({ where: { id }, data: { status: 'cancelled', history: hist(o, 'Annulée par le client'), updatedAt: new Date() } }));
    });
  }

  async notifications(slug: string, header: string | undefined, type: 'customer' | 'courier', markRead = false) {
    const { t } = await this.tenant(slug);
    const p = await this.auth.verify(header, type, t.id);
    return this.prisma.forTenant(t.id, async (tx) => {
      if (markRead) await tx.portalNotification.updateMany({ where: { recipientType: type, recipientId: p.sub, readAt: null }, data: { readAt: new Date() } });
      const items = await tx.portalNotification.findMany({ where: { recipientType: type, recipientId: p.sub }, orderBy: { createdAt: 'desc' }, take: 30 });
      return { unread: items.filter((i) => !i.readAt).length, items };
    });
  }

  // ------------------------------------------------------------------ application livreur
  async courierLogin(slug: string, b: { phone?: string; pin?: string }, ip?: string) {
    const { t } = await this.tenant(slug);
    const phone = normalizePhone(b.phone);
    const key = `courier:${ip}:${phone}`;
    this.auth.guard(key);
    const c = phone ? await this.prisma.forTenant(t.id, (tx) => tx.courier.findFirst({ where: { phone, isActive: true } })) : null;
    if (!c || !(await bcrypt.compare(b.pin ?? '', c.pinHash))) { this.auth.fail(key); throw new BadRequestException('Téléphone ou code incorrect.'); }
    this.auth.ok(key);
    return { token: await this.auth.sign({ scope: 'courier', tenantId: t.id, sub: c.id }), name: c.name };
  }

  private async courier(slug: string, header: string | undefined): Promise<{ t: { id: string }; p: PortalToken }> {
    const { t } = await this.tenant(slug);
    const p = await this.auth.verify(header, 'courier', t.id);
    const c = await this.prisma.forTenant(t.id, (tx) => tx.courier.findUnique({ where: { id: p.sub } }));
    if (!c || !c.isActive) throw new NotFoundException('Compte livreur désactivé');
    return { t, p };
  }

  async courierOrders(slug: string, header: string | undefined) {
    const { t, p } = await this.courier(slug, header);
    const since = new Date(Date.now() - 24 * 3600_000);
    return this.prisma.forTenant(t.id, async (tx) => {
      const rows = await tx.onlineOrder.findMany({ where: { courierId: p.sub, OR: [{ status: { in: ['accepted', 'ready', 'out'] } }, { status: 'delivered', updatedAt: { gte: since } }] }, orderBy: { createdAt: 'asc' } });
      return rows.map((o) => ({ id: o.id, number: o.number, status: o.status, statusLabel: ORDER_STATUS[o.status], items: o.items, total: o.total, address: o.address, addressNote: o.addressNote, phone: o.phone, paymentStatus: o.paymentStatus, toCollect: o.paymentStatus === 'paid' ? 0 : o.total, text: courseText(o) }));
    });
  }

  async courierStatus(slug: string, header: string | undefined, id: string, status: string) {
    const { t, p } = await this.courier(slug, header);
    if (!['out', 'delivered'].includes(status)) throw new BadRequestException('Statut inconnu');
    return this.prisma.forTenant(t.id, async (tx) => {
      const o = await tx.onlineOrder.findFirst({ where: { id, courierId: p.sub } });
      if (!o) throw new NotFoundException('Course introuvable');
      if (!(NEXT_STAFF[o.status] ?? []).includes(status)) throw new ConflictException('Statut impossible à ce stade.');
      const label = status === 'out' ? 'Parti en livraison' : o.paymentStatus === 'paid' ? 'Livrée' : 'Livrée — espèces à encaisser';
      await tx.onlineOrder.update({ where: { id }, data: { status, history: hist(o, label, `livreur:${p.sub}`), updatedAt: new Date() } });
      await notify(tx, t.id, 'customer', o.accountId, o.id, status === 'out' ? 'Votre commande arrive' : 'Commande livrée', status === 'out' ? `Le livreur est en route avec la commande ${o.number}.` : `La commande ${o.number} a été livrée. Merci de votre confiance !`);
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ gestion par le personnel (ERP)
  async list(tenantId: string, status?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.onlineOrder.findMany({ where: status === 'open' ? { status: { in: ['new', 'accepted', 'ready', 'out'] } } : status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
      const [custs, couriers] = await Promise.all([
        tx.customer.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } }, select: { id: true, name: true } }),
        tx.courier.findMany({ select: { id: true, name: true, phone: true } }),
      ]);
      const cn = new Map(custs.map((c) => [c.id, c.name])), co = new Map(couriers.map((c) => [c.id, c]));
      return rows.map((o) => ({ ...o, statusLabel: ORDER_STATUS[o.status], customer: cn.get(o.customerId) ?? null, courier: o.courierId ? co.get(o.courierId) ?? null : null, next: NEXT_STAFF[o.status] ?? [] }));
    });
  }

  async summary(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const g = await tx.onlineOrder.groupBy({ by: ['status'], _count: { _all: true } });
      const declared = await tx.onlineOrder.count({ where: { paymentStatus: 'declared', status: { not: 'cancelled' } } });
      const n = (s: string) => g.find((x) => x.status === s)?._count._all ?? 0;
      return { new: n('new'), accepted: n('accepted'), ready: n('ready'), out: n('out'), toValidate: declared };
    });
  }

  /** Acceptation : la commande devient une vente (stock réservé, FEFO) ; si le client a déclaré un paiement Mobile Money, il est en attente de validation. */
  async accept(user: AuthenticatedUser, id: string) {
    const o = await this.prisma.forTenant(user.tenantId, (tx) => tx.onlineOrder.findUnique({ where: { id } }));
    if (!o) throw new NotFoundException('Commande introuvable');
    if (o.status !== 'new') throw new ConflictException('Commande déjà traitée.');
    const items = o.items as unknown as { productId: string; quantity: number }[];
    const momo = o.paymentMethod !== 'cash' && o.paymentRef;
    const sale = await this.sales.create(user, { items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })), customerId: o.customerId, payments: momo ? [{ method: o.paymentMethod as 'mtn_momo' | 'airtel_money', amount: o.total, reference: o.paymentRef as string }] : undefined, idempotencyKey: `online:${o.id}` } as never);
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      const fresh = await tx.onlineOrder.findUniqueOrThrow({ where: { id } });
      await tx.onlineOrder.update({ where: { id }, data: { status: 'accepted', saleId: (sale as { id: string }).id, history: hist(fresh, 'Acceptée — vente créée', user.userId), updatedAt: new Date() } });
      await notify(tx, user.tenantId, 'customer', o.accountId, o.id, 'Commande acceptée', `Votre commande ${o.number} est en préparation.`);
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'online.order_accepted', entityType: 'online_order', entityId: id, metadata: { number: o.number } });
    return this.one(user.tenantId, id);
  }

  async one(tenantId: string, id: string) {
    return (await this.list(tenantId)).find((o) => o.id === id);
  }

  async assign(user: AuthenticatedUser, id: string, courierId: string | null) {
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      const o = await tx.onlineOrder.findUnique({ where: { id } });
      if (!o) throw new NotFoundException('Commande introuvable');
      if (o.fulfilment !== 'delivery') throw new BadRequestException('Cette commande est à retirer en pharmacie.');
      if (['delivered', 'cancelled'].includes(o.status)) throw new ConflictException('Commande terminée.');
      if (courierId) {
        const c = await tx.courier.findFirst({ where: { id: courierId, isActive: true } });
        if (!c) throw new NotFoundException('Livreur introuvable');
        await tx.onlineOrder.update({ where: { id }, data: { courierId, history: hist(o, `Affectée à ${c.name}`, user.userId), updatedAt: new Date() } });
        await notify(tx, user.tenantId, 'courier', courierId, id, o.paymentStatus === 'paid' ? 'Nouvelle course (payée)' : 'Nouvelle course', courseText(o));
      } else await tx.onlineOrder.update({ where: { id }, data: { courierId: null, history: hist(o, 'Livreur retiré', user.userId), updatedAt: new Date() } });
    });
    return this.one(user.tenantId, id);
  }

  async setStatus(user: AuthenticatedUser, id: string, status: string, reason?: string) {
    const o = await this.prisma.forTenant(user.tenantId, (tx) => tx.onlineOrder.findUnique({ where: { id } }));
    if (!o) throw new NotFoundException('Commande introuvable');
    if (!(NEXT_STAFF[o.status] ?? []).includes(status) || status === 'accepted') throw new ConflictException(`Passage impossible de « ${ORDER_STATUS[o.status]} » à « ${ORDER_STATUS[status] ?? status} ».`);
    if (status === 'cancelled' && o.saleId) await this.sales.voidSale(user, o.saleId, (reason ?? 'Commande en ligne annulée').slice(0, 280));
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      const fresh = await tx.onlineOrder.findUniqueOrThrow({ where: { id } });
      await tx.onlineOrder.update({ where: { id }, data: { status, history: hist(fresh, ORDER_STATUS[status], user.userId), updatedAt: new Date() } });
      const msg: Record<string, string> = { ready: `Votre commande ${o.number} est prête${o.fulfilment === 'pickup' ? ' : vous pouvez la retirer en pharmacie' : ''}.`, out: `Votre commande ${o.number} est en route.`, delivered: `Votre commande ${o.number} est livrée.`, cancelled: `Votre commande ${o.number} a été annulée${reason ? ` : ${reason}` : ''}.` };
      await notify(tx, user.tenantId, 'customer', o.accountId, o.id, ORDER_STATUS[status], msg[status] ?? '');
      if (status === 'ready' && o.courierId) await notify(tx, user.tenantId, 'courier', o.courierId, o.id, 'Commande prête à emporter', courseText(o));
    });
    return this.one(user.tenantId, id);
  }

  /** Valide le paiement : Mobile Money vérifié par la pharmacie, ou espèces encaissées. Le livreur est alors notifié. */
  async confirmPayment(user: AuthenticatedUser, id: string) {
    const o = await this.prisma.forTenant(user.tenantId, (tx) => tx.onlineOrder.findUnique({ where: { id } }));
    if (!o) throw new NotFoundException('Commande introuvable');
    if (!o.saleId) throw new ConflictException('Acceptez d’abord la commande.');
    if (o.paymentStatus === 'paid') throw new ConflictException('Paiement déjà validé.');
    const sale = await this.sales.findOne(user.tenantId, o.saleId) as { payments: { id: string; status: string; method: string }[]; total: number; paidAmount: number };
    const pending = sale.payments.find((p) => p.status === 'pending_confirmation');
    if (pending) await this.sales.confirmPayment(user, pending.id, o.paymentRef ?? undefined);
    else {
      const due = sale.total - sale.paidAmount;
      await this.sales.addMorePayments(user, o.saleId, { payments: [{ method: o.paymentMethod as 'cash', amount: due, reference: o.paymentRef ?? undefined }] } as never);
      const again = await this.sales.findOne(user.tenantId, o.saleId) as { payments: { id: string; status: string }[] };
      const p2 = again.payments.find((p) => p.status === 'pending_confirmation');
      if (p2) await this.sales.confirmPayment(user, p2.id, o.paymentRef ?? undefined);
    }
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'online.payment_confirmed', entityType: 'online_order', entityId: id, metadata: { number: o.number } });
    return this.one(user.tenantId, id);
  }

  // ---- livreurs
  couriers(tenantId: string) { return this.prisma.forTenant(tenantId, (tx) => tx.courier.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, phone: true, isActive: true } })); }

  async saveCourier(user: AuthenticatedUser, id: string | null, b: { name?: string; phone?: string; pin?: string; isActive?: boolean }) {
    const name = (b.name ?? '').trim().slice(0, 80), phone = normalizePhone(b.phone);
    if (!id && (name.length < 2 || !phone)) throw new BadRequestException('Nom et téléphone valides requis.');
    if (b.pin !== undefined && b.pin !== '' && !/^\d{4,6}$/.test(b.pin)) throw new BadRequestException('Le code doit comporter 4 à 6 chiffres.');
    if (!id && !b.pin) throw new BadRequestException('Définissez un code (4 à 6 chiffres) pour le livreur.');
    const row = await this.prisma.forTenant(user.tenantId, async (tx) => {
      if (!id) {
        if (await tx.courier.findFirst({ where: { phone: phone as string } })) throw new ConflictException('Un livreur existe déjà avec ce numéro.');
        return tx.courier.create({ data: { tenantId: user.tenantId, name, phone: phone as string, pinHash: await bcrypt.hash(b.pin as string, 10) } });
      }
      return tx.courier.update({ where: { id }, data: { ...(name ? { name } : {}), ...(phone ? { phone } : {}), ...(b.pin ? { pinHash: await bcrypt.hash(b.pin, 10) } : {}), ...(typeof b.isActive === 'boolean' ? { isActive: b.isActive } : {}) } });
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: id ? 'online.courier_updated' : 'online.courier_created', entityType: 'courier', entityId: row.id });
    return { id: row.id, name: row.name, phone: row.phone, isActive: row.isActive };
  }
}
