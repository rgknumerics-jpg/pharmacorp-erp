import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { emit } from '../accounting/outbox';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { nextNumber } from '../common/numbering';
import { AnalyticsService } from './analytics.service';
import { GardeDto, PayInvoiceDto, SupplierInvoiceDto } from './analytics.dto';
import { buildOrderFile, resolveFormat } from '../suppliers/order-export';

/** Factures fournisseurs et echeances de paiement ; semaines de garde. */
@Injectable()
export class PurchasingService {
  constructor(private readonly prisma: PrismaService, private readonly auditLog: AuditLogService, private readonly analytics: AnalyticsService) {}

  /** Commande en un clic : la proposition de reapprovisionnement devient des bons de commande (un par fournisseur). */
  async ordersFromProposal(user: AuthenticatedUser, supplierIds?: string[], overrides?: Record<string, number>) {
    const re = await this.analytics.reorder(user.tenantId);
    const lines = re.products.filter((p) => p.supplierId && (overrides?.[p.productId] ?? p.orderQty) > 0 && (!supplierIds?.length || supplierIds.includes(p.supplierId)));
    if (!lines.length) throw new BadRequestException('Rien à commander pour le moment.');
    const bySup = new Map<string, typeof lines>();
    for (const l of lines) bySup.set(l.supplierId!, [...(bySup.get(l.supplierId!) ?? []), l]);
    const created = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const out = [];
      for (const [sid, ls] of bySup) {
        const products = new Map((await tx.product.findMany({ where: { id: { in: ls.map((l) => l.productId) } } })).map((p) => [p.id, p]));
        out.push(await tx.purchaseOrder.create({ data: { tenantId: user.tenantId, number: await nextNumber(tx, user.tenantId, 'CF'), supplierId: sid, status: 'draft', notes: re.garde?.reinforceNow ? 'Inclut le renfort de la semaine de garde' : 'Proposition automatique de réapprovisionnement', createdById: user.userId,
          items: { create: ls.map((l) => ({ tenantId: user.tenantId, productId: l.productId, quantity: overrides?.[l.productId] ?? l.orderQty, unitCost: products.get(l.productId)?.purchasePrice ?? 0 })) } } }));
      }
      return out;
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'purchases.order_created', entityType: 'purchase_order', metadata: { orders: created.map((o) => o.number), source: 'proposition' } });
    return Promise.all(created.map((o) => this.orderMessage(user.tenantId, o.id)));
  }

  /** Bon de commande a partir de lignes choisies (ex. ventes de la journee) : un fournisseur, ses CIP, fichier CSV pour son extranet. */
  async orderFromLines(user: AuthenticatedUser, supplierId: string, lines: { productId: string; quantity: number }[]) {
    const clean = (Array.isArray(lines) ? lines : []).map((l) => ({ productId: String(l.productId), quantity: Math.round(Number(l.quantity)) })).filter((l) => l.productId && l.quantity >= 1 && l.quantity <= 99999);
    if (!clean.length) throw new BadRequestException('Aucune ligne à commander.');
    if (clean.length > 500) throw new BadRequestException('Trop de lignes (500 maximum).');
    const po = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const sup = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!sup || !sup.isActive) throw new NotFoundException('Fournisseur introuvable');
      const products = new Map((await tx.product.findMany({ where: { id: { in: clean.map((l) => l.productId) } } })).map((p) => [p.id, p]));
      const merged = new Map<string, number>();
      for (const l of clean) if (products.has(l.productId)) merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.quantity);
      if (!merged.size) throw new BadRequestException('Produits inconnus.');
      return tx.purchaseOrder.create({ data: { tenantId: user.tenantId, number: await nextNumber(tx, user.tenantId, 'CF'), supplierId, status: 'draft', notes: 'Créé depuis les statistiques de vente', createdById: user.userId, items: { create: [...merged].map(([productId, quantity]) => ({ tenantId: user.tenantId, productId, quantity, unitCost: products.get(productId)?.purchasePrice ?? 0 })) } } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'purchases.order_created', entityType: 'purchase_order', entityId: po.id, metadata: { number: po.number, source: 'statistiques de vente', lines: clean.length } });
    return this.orderMessage(user.tenantId, po.id);
  }
  /**
   * Propositions de commande selon l'objectif :
   *  - day    : ce qui est sorti dans la journée (réassort à l'identique) ;
   *  - month  : demande attendue sur l'horizon (moyenne des 30 et 90 derniers jours) moins le stock ;
   *  - season : même période de l'an dernier (N-1) et d'il y a deux ans (N-2), corrigée de la tendance du chiffre d'affaires de l'année ;
   *  - garde  : demande de la prochaine garde (renfort) à commander avant qu'elle commence.
   */
  async proposals(tenantId: string, mode: string, opt: { date?: string; to?: string; horizon?: number }) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const DAY = 86_400_000;
      const sod = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const now = new Date();
      const today = sod(now);
      const shiftY = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear() - n, d.getUTCMonth(), d.getUTCDate()));
      const sold = async (from: Date, to: Date) => {
        const rows = await tx.$queryRaw<{ pid: string; q: number }[]>`SELECT si.product_id AS pid, SUM(si.quantity)::int AS q FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.status <> 'void' AND s.created_at >= ${from} AND s.created_at < ${to} GROUP BY si.product_id`;
        return new Map(rows.map((r) => [r.pid, r.q]));
      };
      const revenue = async (from: Date, to: Date) => (await tx.$queryRaw<{ v: number }[]>`SELECT COALESCE(SUM(total),0)::float AS v FROM sales WHERE status <> 'void' AND created_at >= ${from} AND created_at < ${to}`)[0]?.v ?? 0;
      const stock = await tx.$queryRaw<{ id: string; name: string; sku: string; on_hand: number; min_stock: number; safety: number; purchase_price: number }[]>`
        SELECT p.id, p.name, p.sku, p.min_stock, p.safety_stock AS safety, p.purchase_price, COALESCE((SELECT SUM(m.quantity) FROM inventory_movements m WHERE m.product_id = p.id), 0)::int AS on_hand FROM products p WHERE p.is_active`;
      const horizon = Math.min(120, Math.max(3, Math.round(opt.horizon ?? 30)));
      const info: Record<string, unknown> = { mode, horizon };
      const exp = new Map<string, { expected: number; sold: number; n1: number; n2: number }>();
      const put = (pid: string, patch: Partial<{ expected: number; sold: number; n1: number; n2: number }>) => exp.set(pid, { expected: 0, sold: 0, n1: 0, n2: 0, ...(exp.get(pid) ?? {}), ...patch });

      if (mode === 'day') {
        const d = opt.date && /^\d{4}-\d{2}-\d{2}$/.test(opt.date) ? new Date(`${opt.date}T00:00:00Z`) : today;
        let e = opt.to && /^\d{4}-\d{2}-\d{2}$/.test(opt.to) ? new Date(`${opt.to}T00:00:00Z`) : d;
        if (e < d) e = d;
        const m = await sold(d, new Date(e.getTime() + DAY));
        for (const [pid, q] of m) put(pid, { sold: q, expected: q });
        info.label = d.getTime() === e.getTime() ? `Ventes du ${d.toISOString().slice(0, 10)}` : `Ventes du ${d.toISOString().slice(0, 10)} au ${e.toISOString().slice(0, 10)}`;
      } else if (mode === 'season') {
        const to = new Date(today.getTime() + horizon * DAY);
        const [m1, m2] = await Promise.all([sold(shiftY(today, 1), shiftY(to, 1)), sold(shiftY(today, 2), shiftY(to, 2))]);
        // tendance : chiffre d'affaires des 90 derniers jours vs mêmes 90 jours l'an dernier
        const [rNow, rPrev] = await Promise.all([revenue(new Date(today.getTime() - 90 * DAY), today), revenue(shiftY(new Date(today.getTime() - 90 * DAY), 1), shiftY(today, 1))]);
        const growth = rPrev > 0 ? Math.min(1.8, Math.max(0.6, rNow / rPrev)) : 1;
        const last = await sold(new Date(today.getTime() - 30 * DAY), today);
        for (const pid of new Set([...m1.keys(), ...m2.keys()])) {
          const a = m1.get(pid) ?? 0, b = m2.get(pid) ?? 0;
          const base = a && b ? a * 0.65 + b * 0.35 : a || b;
          put(pid, { n1: a, n2: b, sold: last.get(pid) ?? 0, expected: Math.ceil(base * growth) });
        }
        info.growth = Math.round(growth * 100) / 100;
        info.hasHistory = m1.size + m2.size > 0;
        info.label = `Saison : ${horizon} jours à partir d'aujourd'hui, d'après N-1 et N-2, tendance ×${Math.round(growth * 100) / 100}`;
      } else {
        // month / garde : moyenne des ventes récentes (30 j pondéré 60 %, 90 j 40 %)
        const [m30, m90] = await Promise.all([sold(new Date(today.getTime() - 30 * DAY), today), sold(new Date(today.getTime() - 90 * DAY), today)]);
        let days = horizon, uplift = 0;
        if (mode === 'garde') {
          const g = await tx.gardePeriod.findFirst({ where: { endDate: { gte: today } }, orderBy: { startDate: 'asc' } });
          if (!g) { info.garde = null; info.label = 'Aucune garde programmée (Achats → Semaines de garde).'; return { info, lines: [] as unknown[] }; }
          days = Math.round((g.endDate.getTime() - g.startDate.getTime()) / DAY) + 1; uplift = g.upliftPct;
          info.garde = { start: g.startDate, end: g.endDate, upliftPct: g.upliftPct, daysToGarde: Math.round((g.startDate.getTime() - today.getTime()) / DAY) };
          info.label = `Garde du ${g.startDate.toISOString().slice(0, 10)} au ${g.endDate.toISOString().slice(0, 10)} (+${g.upliftPct} %)`;
        } else info.label = `Demande attendue sur ${days} jours (moyenne 30 et 90 jours)`;
        for (const pid of new Set([...m30.keys(), ...m90.keys()])) {
          const daily = (m30.get(pid) ?? 0) / 30 * 0.6 + (m90.get(pid) ?? 0) / 90 * 0.4;
          put(pid, { sold: m30.get(pid) ?? 0, expected: Math.ceil(daily * days * (1 + uplift / 100)) });
        }
      }
      // fournisseur habituel (dernière réception) et produits détaillables (boîte + unités)
      const sup = new Map((await tx.$queryRaw<{ pid: string; sid: string; name: string }[]>`SELECT DISTINCT ON (gi.product_id) gi.product_id AS pid, gr.supplier_id AS sid, su.name FROM goods_receipt_items gi JOIN goods_receipts gr ON gr.id = gi.receipt_id JOIN suppliers su ON su.id = gr.supplier_id WHERE gr.supplier_id IS NOT NULL ORDER BY gi.product_id, gr.created_at DESC`).map((r) => [r.pid, { id: r.sid, name: r.name }]));
      const dets = await tx.$queryRaw<{ id: string; unit_id: string; upb: number }[]>`SELECT id, unit_product_id AS unit_id, units_per_box AS upb FROM products WHERE unit_product_id IS NOT NULL AND units_per_box > 1`;
      const parentOf = new Map(dets.map((d) => [d.unit_id, d])), childOf = new Map(dets.map((d) => [d.id, d]));
      const byId = new Map(stock.map((p) => [p.id, p]));
      const ids = new Set<string>();
      for (const id of exp.keys()) ids.add(parentOf.get(id)?.id ?? id);
      const lines = [...ids].map((id) => {
        const p = byId.get(id); if (!p) return null;
        const e = exp.get(id) ?? { expected: 0, sold: 0, n1: 0, n2: 0 };
        const d = childOf.get(id);
        const s = sup.get(id);
        if (d) {
          // produit détaillable : on raisonne en unités ; une boîte entière n'est commandée que si le reste ne couvre plus le besoin
          const c = exp.get(d.unit_id) ?? { expected: 0, sold: 0, n1: 0, n2: 0 };
          const child = byId.get(d.unit_id);
          const stockUnits = Math.max(0, p.on_hand) * d.upb + Math.max(0, child?.on_hand ?? 0);
          const soldUnits = e.sold * d.upb + c.sold, expectedUnits = e.expected * d.upb + c.expected;
          const needUnits = mode === 'day' ? soldUnits - stockUnits : expectedUnits + p.safety * d.upb - stockUnits;
          const minBoxes = p.min_stock > p.on_hand && !child?.on_hand ? p.min_stock - p.on_hand : 0;
          const suggested = Math.max(Math.ceil(Math.max(0, needUnits) / d.upb), minBoxes);
          return { productId: p.id, name: p.name, sku: p.sku, stock: p.on_hand, stockUnits, detail: true, unitsPerBox: d.upb, sold: soldUnits, expected: expectedUnits, n1: e.n1 * d.upb + c.n1, n2: e.n2 * d.upb + c.n2, suggested, value: suggested * p.purchase_price, supplierId: s?.id ?? null, supplierName: s?.name ?? null };
        }
        const suggested = mode === 'day' ? e.expected : Math.max(0, e.expected + p.safety - Math.max(0, p.on_hand), p.min_stock > p.on_hand ? p.min_stock - p.on_hand : 0);
        return { productId: p.id, name: p.name, sku: p.sku, stock: p.on_hand, stockUnits: null as number | null, detail: false, unitsPerBox: null as number | null, sold: e.sold, expected: e.expected, n1: e.n1, n2: e.n2, suggested, value: suggested * p.purchase_price, supplierId: s?.id ?? null, supplierName: s?.name ?? null };
      })
        .filter((l): l is NonNullable<typeof l> => !!l && l.suggested > 0)
        .sort((x, y) => y.value - x.value)
        .slice(0, 600);
      return { info, lines, total: { lines: lines.length, value: lines.reduce((s, l) => s + l.value, 0) } };
    });
  }
  /** Commande en un clic : les lignes choisies sont réparties par fournisseur habituel (ou le fournisseur par défaut), un bon de commande et un fichier d'export par fournisseur. */
  async ordersFromGroups(user: AuthenticatedUser, lines: { productId: string; quantity: number; supplierId?: string | null }[], defaultSupplierId?: string | null) {
    const groups = new Map<string, { productId: string; quantity: number }[]>();
    let unassigned = 0;
    for (const l of (Array.isArray(lines) ? lines : []).slice(0, 600)) {
      const sid = l.supplierId || defaultSupplierId;
      const qty = Math.max(0, Math.round(Number(l.quantity)) || 0);
      if (!qty || !l.productId) continue;
      if (!sid) { unassigned++; continue; }
      groups.set(sid, [...(groups.get(sid) ?? []), { productId: l.productId, quantity: qty }]);
    }
    if (!groups.size) throw new BadRequestException(unassigned ? 'Aucun fournisseur habituel pour ces produits : choisissez un fournisseur par défaut.' : 'Aucune ligne à commander.');
    const orders = [];
    for (const [sid, ls] of groups) orders.push(await this.orderFromLines(user, sid, ls));
    return { orders, unassigned };
  }

  /** Message de commande pret a envoyer au fournisseur (WhatsApp, sans API payante, ou copie pour e-mail). */
  async orderMessage(tenantId: string, poId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { supplier: true, items: { include: { product: { select: { name: true, sku: true, barcode: true, supplierCodes: true } } } } } });
      // chaque ligne porte le code article du grossiste (CIP de sa base), sinon l'EAN
      const code = (p: { barcode: string | null; supplierCodes: unknown }) => (p.supplierCodes as Record<string, string> | null)?.[po!.supplierId] ?? p.barcode ?? '';
      if (!po) throw new NotFoundException('Commande introuvable');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const text = [`*Bon de commande ${po.number}*`, `${tenant.name} → ${po.supplier.name}`, '', ...po.items.map((i) => `• ${i.quantity} × ${code(i.product) ? `[${code(i.product)}] ` : ''}${i.product.name}`), '', `Total : ${po.items.length} ligne(s), ${po.items.reduce((s, i) => s + i.quantity, 0)} unité(s).`, 'Merci de confirmer la disponibilité et le délai de livraison.'].join('\n');
      // fichier de commande aux CIP du grossiste, au format exact de son extranet (modèle appris de son fichier : Laborex, SEP/CEP…)
      const cat = await tx.supplierCatalogItem.findMany({ where: { supplierId: po.supplierId, productId: { in: po.items.map((i) => i.productId) } } });
      const catBy = new Map(cat.map((c) => [c.productId as string, c]));
      const prodDci = new Map((await tx.product.findMany({ where: { id: { in: po.items.map((i) => i.productId) } }, select: { id: true, dci: true } })).map((p) => [p.id, p.dci ?? '']));
      const format = resolveFormat(po.supplier.exportFormat);
      const file = buildOrderFile(format, po.items.map((i) => ({ cip: code(i.product), quantite: i.quantity, designation: catBy.get(i.productId)?.designation || i.product.name, dci: catBy.get(i.productId)?.dci || prodDci.get(i.productId) || '' })));
      const csv = file.text;
      const abbr = (po.supplier.abbreviation || po.supplier.name).replace(/[^A-Za-z0-9]+/g, '');
      const fileInfo = { name: `${po.number}-${abbr}.csv`, mime: 'text/csv;charset=utf-8', base64: file.bytes.toString('base64') };
      const missingCodes = po.items.filter((i) => !(i.product.supplierCodes as Record<string, string> | null)?.[po.supplierId]).map((i) => i.product.name);
      const unavailable = po.items.filter((i) => catBy.get(i.productId)?.available === false).map((i) => i.product.name);
      return { id: po.id, number: po.number, supplier: po.supplier.name, status: po.status, lines: po.items.length, text, csv, file: fileInfo, unavailable, missingCodes, waLink: po.supplier.phone ? `https://wa.me/${po.supplier.phone}?text=${encodeURIComponent(text)}` : null, email: po.supplier.email };
    });
  }

  invoices(tenantId: string, status?: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.supplierInvoice.findMany({ where: status ? { status } : {}, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }], take: 300, include: { supplier: { select: { name: true, paymentTermDays: true } } } }),
    );
  }

  async createInvoice(user: AuthenticatedUser, dto: SupplierInvoiceDto) {
    const inv = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const sup = await tx.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!sup) throw new NotFoundException('Fournisseur introuvable');
      const issue = new Date(dto.issueDate);
      const due = dto.dueDate ? new Date(dto.dueDate) : new Date(issue.getTime() + sup.paymentTermDays * 86_400_000);
      if (due < issue) throw new BadRequestException("L'échéance ne peut pas précéder la date de facture.");
      return tx.supplierInvoice.create({ data: { tenantId: user.tenantId, supplierId: sup.id, number: dto.number, issueDate: issue, dueDate: due, amount: dto.amount, notes: dto.notes } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'purchases.invoice_created', entityType: 'supplier_invoice', entityId: inv.id, metadata: { number: inv.number, amount: inv.amount, dueDate: inv.dueDate.toISOString().slice(0, 10) } });
    return inv;
  }

  async setDueDate(user: AuthenticatedUser, id: string, dueDate: string) {
    const inv = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const cur = await tx.supplierInvoice.findUnique({ where: { id } });
      if (!cur) throw new NotFoundException('Facture introuvable');
      return tx.supplierInvoice.update({ where: { id }, data: { dueDate: new Date(dueDate) } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'purchases.invoice_due_changed', entityType: 'supplier_invoice', entityId: id, metadata: { dueDate } });
    return inv;
  }

  async pay(user: AuthenticatedUser, id: string, dto: PayInvoiceDto) {
    const inv = await this.prisma.forTenant(user.tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM supplier_invoices WHERE id = ${id}::uuid FOR UPDATE`;
      const cur = await tx.supplierInvoice.findUnique({ where: { id }, include: { supplier: true } });
      if (!cur) throw new NotFoundException('Facture introuvable');
      if (cur.status === 'paid') throw new ConflictException('Facture déjà réglée');
      if (dto.amount > cur.amount - cur.paidAmount) throw new BadRequestException(`Le montant dépasse le reste dû (${cur.amount - cur.paidAmount}).`);
      const paid = cur.paidAmount + dto.amount;
      await emit(tx, user.tenantId, 'supplier.paid', { invoiceId: id, supplierName: cur.supplier.name, number: cur.number, amount: dto.amount, method: dto.method ?? 'cash', date: new Date().toISOString() });
      return tx.supplierInvoice.update({ where: { id }, data: { paidAmount: paid, status: paid >= cur.amount ? 'paid' : 'open', paidAt: paid >= cur.amount ? new Date() : null } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'purchases.invoice_paid', entityType: 'supplier_invoice', entityId: id, metadata: { amount: dto.amount, method: dto.method ?? 'cash', reference: dto.reference ?? null } });
    return inv;
  }

  gardes(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) => tx.gardePeriod.findMany({ where: { endDate: { gte: new Date(Date.now() - 60 * 86_400_000) } }, orderBy: { startDate: 'asc' } }));
  }

  async addGarde(user: AuthenticatedUser, dto: GardeDto) {
    if (new Date(dto.endDate) < new Date(dto.startDate)) throw new BadRequestException('La fin précède le début.');
    const g = await this.prisma.forTenant(user.tenantId, (tx) => tx.gardePeriod.create({ data: { tenantId: user.tenantId, startDate: new Date(dto.startDate), endDate: new Date(dto.endDate), upliftPct: dto.upliftPct ?? 50, note: dto.note } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'garde.created', entityType: 'garde_period', entityId: g.id, metadata: { startDate: dto.startDate, endDate: dto.endDate } });
    return g;
  }

  async deleteGarde(user: AuthenticatedUser, id: string) {
    await this.prisma.forTenant(user.tenantId, (tx) => tx.gardePeriod.delete({ where: { id } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'garde.deleted', entityType: 'garde_period', entityId: id });
    return { ok: true };
  }
}