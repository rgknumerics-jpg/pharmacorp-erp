import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { nextNumber } from '../common/numbering';
import { PrismaService } from '../prisma/prisma.service';
import { CipReferenceService, providerKey } from './cip-reference.service';
import { buildOrderFile, nameKey, nameTokens, parseCatalogCsv, resolveFormat, similarity } from './order-export';

export const CLAIM_NATURES: Record<string, string> = {
  non_livre: 'Produit non livré',
  erreur_livraison: 'Erreur de livraison (autre produit livré)',
  avarie: 'Produit avarié / cassé',
  peremption: 'Péremption trop courte / périmé',
  autre: 'Autre',
};
export const CLAIM_STATUS: Record<string, string> = { a_traiter: 'À déclarer', declare: 'Déclarée au fournisseur', accepte: 'Acceptée (avoir attendu)', refuse: 'Refusée', avoir_recu: 'Avoir reçu', clos: 'Clôturée' };
const NEXT: Record<string, string[]> = { a_traiter: ['declare', 'clos'], declare: ['accepte', 'refuse', 'clos'], accepte: ['avoir_recu', 'clos'], refuse: ['declare', 'clos'], avoir_recu: ['clos'], clos: [] };
const CLAIM_DELAY_DAYS = 7;
const day = (d = new Date()) => new Date(`${new Date(d.getTime() + 3600_000).toISOString().slice(0, 10)}T00:00:00Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

interface Hist { at: string; by: string | null; action: string; note?: string }

@Injectable()
export class SupplierHubService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService, private readonly ref: CipReferenceService) {}

  // ------------------------------------------------------------------ vue d'ensemble
  async overview(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const sups = await tx.supplier.findMany({ where: { isActive: true }, orderBy: [{ isWholesaler: 'desc' }, { name: 'asc' }] });
      const cat = await tx.supplierCatalogItem.groupBy({ by: ['supplierId', 'matchState'], _count: { _all: true } });
      const unav = await tx.supplierCatalogItem.groupBy({ by: ['supplierId'], where: { available: false }, _count: { _all: true } });
      const claims = await tx.supplierClaim.findMany({ where: { status: { in: ['a_traiter', 'declare', 'accepte'] } }, select: { supplierId: true, status: true, deadline: true } });
      const today = day();
      return sups.map((s) => {
        const c = cat.filter((x) => x.supplierId === s.id);
        const n = (st: string[]) => c.filter((x) => st.includes(x.matchState)).reduce((t, x) => t + x._count._all, 0);
        const mine = claims.filter((x) => x.supplierId === s.id);
        return {
          ...s,
          catalog: { total: c.reduce((t, x) => t + x._count._all, 0), linked: n(['exact', 'linked']), suggested: n(['suggested']), unmatched: n(['none']), unavailable: unav.find((u) => u.supplierId === s.id)?._count._all ?? 0 },
          claims: { open: mine.length, toDeclare: mine.filter((x) => x.status === 'a_traiter').length, late: mine.filter((x) => x.status === 'a_traiter' && x.deadline < today).length, urgent: mine.filter((x) => x.status === 'a_traiter' && x.deadline >= today && daysBetween(today, x.deadline) <= 2).length },
        };
      });
    });
  }

  // ------------------------------------------------------------------ catalogue du grossiste
  /** Importe le fichier catalogue d'un grossiste (modèle Laborex, SEP/CEP, Ubipharm…) : CIP, désignation, DCI, disponibilité ; relie les produits ; apprend le format du fichier de commande. */
  async importCatalog(user: AuthenticatedUser, supplierId: string, file?: { buffer: Buffer; originalname: string }) {
    if (!file) throw new BadRequestException('Fichier manquant');
    if (file.buffer.length > 8 * 1024 * 1024) throw new BadRequestException('Fichier trop volumineux (8 Mo maximum).');
    let parsed;
    try { parsed = parseCatalogCsv(file.buffer); } catch (e) { throw new BadRequestException((e as Error).message); }
    if (!parsed.rows.length) throw new BadRequestException('Aucune ligne valide (CIP numérique attendu).');
    const rowsByCip = new Map(parsed.rows.map((r) => [r.cip, r]));
    const rows = [...rowsByCip.values()];

    const stats = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const sup = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!sup) throw new NotFoundException('Fournisseur introuvable');
      const products = await tx.product.findMany({ where: { isActive: true }, select: { id: true, name: true, barcode: true, sku: true, supplierCodes: true } });
      const existing = new Map((await tx.supplierCatalogItem.findMany({ where: { supplierId } })).map((i) => [i.cip, i]));

      const byCode = new Map<string, string>(), byBarcode = new Map<string, string>(), byName = new Map<string, string | null>();
      const buckets = new Map<string, typeof products>();
      for (const p of products) {
        const code = (p.supplierCodes as Record<string, string> | null)?.[supplierId];
        if (code) byCode.set(code, p.id);
        if (p.barcode) byBarcode.set(p.barcode, p.id);
        byBarcode.set(p.sku, p.id);
        const k = nameKey(p.name);
        byName.set(k, byName.has(k) ? null : p.id);
        const first = nameTokens(p.name)[0]?.slice(0, 4);
        if (first) buckets.set(first, [...(buckets.get(first) ?? []), p]);
      }

      const out = { cips: [] as string[], des: [] as string[], dcis: [] as string[], avs: [] as boolean[], pids: [] as string[], sts: [] as string[], sids: [] as string[], scs: [] as number[] };
      const link = { pids: [] as string[], cips: [] as string[] };
      let exact = 0, suggested = 0, none = 0;
      for (const r of rows) {
        const ex = existing.get(r.cip);
        let productId: string | null = null, state = 'none', sid: string | null = null, score = 0;
        if (ex?.productId && (ex.matchState === 'linked' || ex.matchState === 'exact')) { productId = ex.productId; state = ex.matchState; }
        else if (byCode.has(r.cip)) { productId = byCode.get(r.cip)!; state = 'exact'; }
        else if (byBarcode.has(r.cip)) { productId = byBarcode.get(r.cip)!; state = 'exact'; link.pids.push(productId); link.cips.push(r.cip); }
        else {
          const nk = nameKey(r.designation);
          const byN = byName.get(nk);
          if (byN) { productId = byN; state = 'exact'; link.pids.push(productId); link.cips.push(r.cip); }
          else {
            const first = nameTokens(r.designation)[0]?.slice(0, 4);
            const cands = first ? buckets.get(first) ?? [] : [];
            let best: { id: string; s: number } | null = null, second = 0;
            for (const p of cands) { const s = similarity(r.designation, p.name); if (!best || s > best.s) { second = best?.s ?? 0; best = { id: p.id, s }; } else if (s > second) second = s; }
            if (best && best.s >= 75 && best.s - second >= 8) { sid = best.id; score = best.s; state = 'suggested'; }
          }
        }
        if (state === 'exact' || state === 'linked') exact++; else if (state === 'suggested') suggested++; else none++;
        out.cips.push(r.cip); out.des.push(r.designation); out.dcis.push(r.dci); out.avs.push(r.available); out.pids.push(productId ?? ''); out.sts.push(state); out.sids.push(sid ?? ''); out.scs.push(score);
      }
      // en blocs de 1 000 lignes
      for (let i = 0; i < out.cips.length; i += 1000) {
        const s = (a: unknown[]) => a.slice(i, i + 1000);
        await tx.$executeRaw`
          INSERT INTO supplier_catalog_items (id, tenant_id, supplier_id, cip, designation, dci, available, product_id, match_state, suggested_product_id, score, updated_at)
          SELECT gen_random_uuid(), ${user.tenantId}::uuid, ${supplierId}::uuid, u.cip, u.des, u.dci, u.av, NULLIF(u.pid, '')::uuid, u.st, NULLIF(u.sid, '')::uuid, u.sc, now()
          FROM unnest(${s(out.cips)}::text[], ${s(out.des)}::text[], ${s(out.dcis)}::text[], ${s(out.avs)}::boolean[], ${s(out.pids)}::text[], ${s(out.sts)}::text[], ${s(out.sids)}::text[], ${s(out.scs)}::int[]) AS u(cip, des, dci, av, pid, st, sid, sc)
          ON CONFLICT (tenant_id, supplier_id, cip) DO UPDATE SET designation = EXCLUDED.designation, dci = EXCLUDED.dci, available = EXCLUDED.available,
            product_id = EXCLUDED.product_id, match_state = EXCLUDED.match_state, suggested_product_id = EXCLUDED.suggested_product_id, score = EXCLUDED.score, updated_at = now()`;
      }
      if (link.pids.length) {
        await tx.$executeRaw`
          UPDATE products p SET supplier_codes = p.supplier_codes || jsonb_build_object(${supplierId}::text, u.cip)
          FROM unnest(${link.pids}::uuid[], ${link.cips}::text[]) AS u(pid, cip) WHERE p.id = u.pid`;
      }
      await tx.supplier.update({ where: { id: supplierId }, data: { exportFormat: parsed.format as unknown as Prisma.InputJsonValue, isWholesaler: true } });
      return { total: rows.length, available: rows.filter((r) => r.available).length, unavailable: rows.filter((r) => !r.available).length, linked: exact, suggested, unmatched: none, skipped: parsed.skipped, newLinks: link.pids.length };
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'suppliers.catalog_imported', entityType: 'supplier', entityId: supplierId, metadata: { file: file.originalname, ...stats } });
    return { ...stats, format: parsed.format };
  }

  async catalog(tenantId: string, supplierId: string, q: string | undefined, state: string | undefined, take: number, skip: number) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const where: Prisma.SupplierCatalogItemWhereInput = { supplierId };
      if (q) where.OR = [{ cip: { contains: q.trim() } }, { designation: { contains: q.trim(), mode: 'insensitive' } }, { dci: { contains: q.trim(), mode: 'insensitive' } }];
      if (state === 'linked') where.matchState = { in: ['exact', 'linked'] };
      else if (state === 'suggested') where.matchState = 'suggested';
      else if (state === 'none') where.matchState = 'none';
      else if (state === 'unavailable') where.available = false;
      const [items, total] = await Promise.all([tx.supplierCatalogItem.findMany({ where, orderBy: [{ designation: 'asc' }], take, skip }), tx.supplierCatalogItem.count({ where })]);
      const pids = [...new Set(items.flatMap((i) => [i.productId, i.suggestedProductId]).filter(Boolean) as string[])];
      const prods = pids.length ? await tx.product.findMany({ where: { id: { in: pids } }, select: { id: true, name: true, salePrice: true } }) : [];
      const name = new Map(prods.map((p) => [p.id, p]));
      return { total, items: items.map((i) => ({ ...i, product: i.productId ? name.get(i.productId) ?? null : null, suggested: i.suggestedProductId ? name.get(i.suggestedProductId) ?? null : null })) };
    });
  }

  /** Relie (ou délie) une ligne du catalogue à un produit : le CIP du grossiste est alors inscrit sur la fiche produit. */
  async link(user: AuthenticatedUser, supplierId: string, itemId: string, productId: string | null) {
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      const it = await tx.supplierCatalogItem.findFirst({ where: { id: itemId, supplierId } });
      if (!it) throw new NotFoundException('Ligne introuvable');
      if (it.productId) { // retire l'ancien lien
        const old = await tx.product.findUnique({ where: { id: it.productId }, select: { supplierCodes: true } });
        const codes = { ...((old?.supplierCodes as Record<string, string>) ?? {}) };
        if (codes[supplierId] === it.cip) { delete codes[supplierId]; await tx.product.update({ where: { id: it.productId }, data: { supplierCodes: codes } }); }
      }
      if (productId) {
        const p = await tx.product.findUnique({ where: { id: productId }, select: { supplierCodes: true } });
        if (!p) throw new NotFoundException('Produit introuvable');
        await tx.product.update({ where: { id: productId }, data: { supplierCodes: { ...((p.supplierCodes as Record<string, string>) ?? {}), [supplierId]: it.cip } } });
        await tx.supplierCatalogItem.update({ where: { id: itemId }, data: { productId, matchState: 'linked', suggestedProductId: null, score: 0 } });
      } else await tx.supplierCatalogItem.update({ where: { id: itemId }, data: { productId: null, matchState: 'none', suggestedProductId: null, score: 0 } });
    });
    return { ok: true };
  }

  /** Accepte d'un coup les rapprochements proposés dont le score atteint le seuil. */
  async acceptSuggestions(user: AuthenticatedUser, supplierId: string, minScore: number) {
    const n = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const items = await tx.supplierCatalogItem.findMany({ where: { supplierId, matchState: 'suggested', score: { gte: Math.max(60, Math.min(100, minScore)) }, suggestedProductId: { not: null } } });
      const pids = items.map((i) => i.suggestedProductId as string), cips = items.map((i) => i.cip);
      if (!items.length) return 0;
      await tx.$executeRaw`UPDATE products p SET supplier_codes = p.supplier_codes || jsonb_build_object(${supplierId}::text, u.cip) FROM unnest(${pids}::uuid[], ${cips}::text[]) AS u(pid, cip) WHERE p.id = u.pid`;
      await tx.$executeRaw`UPDATE supplier_catalog_items SET product_id = suggested_product_id, suggested_product_id = NULL, match_state = 'linked', score = 0 WHERE id = ANY(${items.map((i) => i.id)}::uuid[])`;
      return items.length;
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'suppliers.suggestions_accepted', entityType: 'supplier', entityId: supplierId, metadata: { count: n, minScore } });
    return { accepted: n };
  }

  // ------------------------------------------------------------------ commande : aperçu avant export
  async previewOrder(user: AuthenticatedUser, supplierId: string, lines: { productId: string; quantity: number }[]) {
    const clean = (Array.isArray(lines) ? lines : []).map((l) => ({ productId: String(l.productId), quantity: Math.max(0, Math.round(Number(l.quantity)) || 0) })).filter((l) => l.productId).slice(0, 500);
    if (!clean.length) throw new BadRequestException('Aucune ligne.');
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      const sup = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!sup) throw new NotFoundException('Fournisseur introuvable');
      const prods = new Map((await tx.product.findMany({ where: { id: { in: clean.map((l) => l.productId) } }, select: { id: true, name: true, dci: true, barcode: true, supplierCodes: true } })).map((p) => [p.id, p]));
      const cat = await tx.supplierCatalogItem.findMany({ where: { supplierId, productId: { in: clean.map((l) => l.productId) } } });
      const catBy = new Map(cat.map((c) => [c.productId as string, c]));
      return {
        supplier: { id: sup.id, name: sup.name, abbreviation: sup.abbreviation, format: resolveFormat(sup.exportFormat) },
        lines: clean.filter((l) => prods.has(l.productId)).map((l) => {
          const p = prods.get(l.productId)!;
          const c = catBy.get(l.productId);
          const cip = (p.supplierCodes as Record<string, string> | null)?.[supplierId] ?? c?.cip ?? null;
          return { productId: p.id, name: p.name, dci: p.dci ?? '', quantity: l.quantity, cip, hasCip: !!cip, available: c ? c.available : null, designation: c?.designation || p.name };
        }),
      };
    });
  }

  // ------------------------------------------------------------------ réclamations, retours, avoirs
  async createClaim(user: AuthenticatedUser, b: { supplierId: string; nature: string; productId?: string; productName?: string; cip?: string; quantity?: number; receiptId?: string; blNumber?: string; deliveredAt?: string; detail?: string; returnGoods?: boolean }) {
    if (!CLAIM_NATURES[b.nature]) throw new BadRequestException('Nature de réclamation inconnue');
    const claim = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const sup = await tx.supplier.findUnique({ where: { id: b.supplierId } });
      if (!sup) throw new NotFoundException('Fournisseur introuvable');
      let name = (b.productName ?? '').trim(), cip = (b.cip ?? '').trim() || null, blNumber = (b.blNumber ?? '').trim() || null;
      let delivered = b.deliveredAt && /^\d{4}-\d{2}-\d{2}$/.test(b.deliveredAt) ? new Date(`${b.deliveredAt}T00:00:00Z`) : null;
      if (b.productId) {
        const p = await tx.product.findUnique({ where: { id: b.productId }, select: { name: true, supplierCodes: true } });
        if (!p) throw new NotFoundException('Produit introuvable');
        name = name || p.name;
        cip = cip || (p.supplierCodes as Record<string, string> | null)?.[b.supplierId] || null;
      }
      if (b.receiptId) {
        const r = await tx.goodsReceipt.findUnique({ where: { id: b.receiptId } });
        if (!r) throw new NotFoundException('Réception introuvable');
        delivered = delivered ?? day(r.createdAt);
        blNumber = blNumber || r.supplierRef || r.number;
      }
      if (name.length < 2) throw new BadRequestException('Indiquez le produit concerné.');
      const delivery = delivered ?? day();
      const qty = Math.max(1, Math.min(99999, Math.round(Number(b.quantity) || 1)));
      const hist: Hist[] = [{ at: new Date().toISOString(), by: user.userId, action: 'Réclamation créée' }];
      return tx.supplierClaim.create({
        data: {
          tenantId: user.tenantId, number: await nextNumber(tx, user.tenantId, 'RC'), supplierId: b.supplierId, receiptId: b.receiptId || null, blNumber, productId: b.productId || null, productName: name.slice(0, 200), cip,
          quantity: qty, nature: b.nature, detail: (b.detail ?? '').trim().slice(0, 400) || null, returnGoods: !!b.returnGoods || b.nature === 'avarie' || b.nature === 'peremption',
          deliveredAt: delivery, deadline: addDays(delivery, CLAIM_DELAY_DAYS), history: hist as unknown as Prisma.InputJsonValue, createdById: user.userId,
        },
      });
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'suppliers.claim_created', entityType: 'supplier_claim', entityId: claim.id, metadata: { number: claim.number, nature: claim.nature, product: claim.productName } });
    return claim;
  }

  async claims(tenantId: string, f: { status?: string; supplierId?: string; nature?: string; q?: string; late?: boolean }) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const today = day();
      const rows = await tx.supplierClaim.findMany({
        where: {
          ...(f.status === 'open' ? { status: { in: ['a_traiter', 'declare', 'accepte'] } } : f.status ? { status: f.status } : {}),
          ...(f.supplierId ? { supplierId: f.supplierId } : {}),
          ...(f.nature ? { nature: f.nature } : {}),
          ...(f.q ? { OR: [{ productName: { contains: f.q, mode: 'insensitive' } }, { number: { contains: f.q, mode: 'insensitive' } }, { blNumber: { contains: f.q, mode: 'insensitive' } }] } : {}),
          ...(f.late ? { status: 'a_traiter', deadline: { lt: today } } : {}),
        },
        orderBy: [{ deadline: 'asc' }], take: 300,
      });
      const sups = new Map((await tx.supplier.findMany({ select: { id: true, name: true, abbreviation: true, contacts: true, phone: true, email: true } })).map((s) => [s.id, s]));
      return rows.map((r) => {
        const daysLeft = daysBetween(today, r.deadline);
        const pending = r.status === 'a_traiter';
        return { ...r, supplier: sups.get(r.supplierId) ?? null, natureLabel: CLAIM_NATURES[r.nature] ?? r.nature, statusLabel: CLAIM_STATUS[r.status] ?? r.status, daysLeft, late: pending && daysLeft < 0, urgent: pending && daysLeft >= 0 && daysLeft <= 2, next: NEXT[r.status] ?? [] };
      });
    });
  }

  async claimsSummary(tenantId: string) {
    const rows = await this.claims(tenantId, {});
    const open = rows.filter((r) => ['a_traiter', 'declare', 'accepte'].includes(r.status));
    return {
      byStatus: Object.fromEntries(Object.keys(CLAIM_STATUS).map((k) => [k, rows.filter((r) => r.status === k).length])),
      toDeclare: open.filter((r) => r.status === 'a_traiter').length,
      late: open.filter((r) => r.late).length,
      urgent: open.filter((r) => r.urgent).length,
      awaitingCredit: open.filter((r) => r.status === 'declare' || r.status === 'accepte').length,
      creditReceived: rows.filter((r) => r.status === 'avoir_recu' || (r.status === 'clos' && r.creditAmount > 0)).reduce((s, r) => s + r.creditAmount, 0),
      delayDays: CLAIM_DELAY_DAYS,
    };
  }

  async updateClaim(user: AuthenticatedUser, id: string, b: { status?: string; notes?: string; creditNoteRef?: string; creditAmount?: number; declaredVia?: string; detail?: string }) {
    const c = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const cur = await tx.supplierClaim.findUnique({ where: { id } });
      if (!cur) throw new NotFoundException('Réclamation introuvable');
      const hist = ((cur.history as unknown as Hist[]) ?? []).slice(-60);
      const data: Prisma.SupplierClaimUpdateInput = { updatedAt: new Date() };
      if (b.notes !== undefined) data.notes = String(b.notes).trim().slice(0, 500) || null;
      if (b.detail !== undefined) data.detail = String(b.detail).trim().slice(0, 400) || null;
      if (b.status && b.status !== cur.status) {
        if (!(NEXT[cur.status] ?? []).includes(b.status)) throw new ConflictException(`Passage impossible de « ${CLAIM_STATUS[cur.status]} » à « ${CLAIM_STATUS[b.status] ?? b.status} ».`);
        data.status = b.status;
        if (b.status === 'declare') {
          data.declaredAt = new Date();
          data.declaredVia = ['mail', 'whatsapp', 'extranet', 'telephone', 'visite'].includes(b.declaredVia ?? '') ? b.declaredVia : null;
        }
        if (b.status === 'avoir_recu') {
          const amount = Math.round(Number(b.creditAmount));
          if (!(amount >= 0)) throw new BadRequestException('Indiquez le montant de l’avoir (0 si retour sans valeur).');
          data.creditAmount = amount;
          data.creditNoteRef = (b.creditNoteRef ?? '').trim().slice(0, 60) || null;
        }
        hist.push({ at: new Date().toISOString(), by: user.userId, action: CLAIM_STATUS[b.status], note: b.notes?.slice(0, 120) });
        data.history = hist as unknown as Prisma.InputJsonValue;
      }
      return tx.supplierClaim.update({ where: { id }, data });
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'suppliers.claim_updated', entityType: 'supplier_claim', entityId: id, metadata: { number: c.number, status: c.status } });
    return c;
  }

  /** Texte prêt à envoyer (e-mail / WhatsApp) pour déclarer ou relancer une réclamation. */
  async claimMessage(tenantId: string, id: string, reminder: boolean) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const c = await tx.supplierClaim.findUnique({ where: { id } });
      if (!c) throw new NotFoundException('Réclamation introuvable');
      const sup = await tx.supplier.findUniqueOrThrow({ where: { id: c.supplierId } });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const contacts = ((sup.contacts as { name: string; role?: string; phone?: string; email?: string }[]) ?? []).filter((x) => x.phone || x.email);
      const subject = `${reminder ? 'RELANCE — ' : ''}Réclamation ${c.number} : ${CLAIM_NATURES[c.nature]} — ${tenant.name}`;
      const body = [
        `Bonjour,`, '',
        reminder ? `Nous vous relançons au sujet de notre réclamation ${c.number} (déclarée le ${c.declaredAt ? c.declaredAt.toISOString().slice(0, 10) : 'n.c.'}), restée sans réponse.` : `Nous vous signalons l’anomalie suivante sur notre livraison :`,
        `• Nature : ${CLAIM_NATURES[c.nature]}`,
        `• Produit : ${c.productName}${c.cip ? ` (CIP ${c.cip})` : ''} — quantité : ${c.quantity}`,
        c.blNumber ? `• Bon de livraison / facture : ${c.blNumber}` : '',
        `• Date de livraison : ${c.deliveredAt.toISOString().slice(0, 10)}`,
        c.detail ? `• Détail : ${c.detail}` : '',
        c.returnGoods ? `• Retour de marchandise : le produit est tenu à votre disposition.` : '',
        '', `Merci de nous établir l’avoir correspondant ou de procéder à l’échange.`, '', `Cordialement,`, tenant.name,
      ].filter((x) => x !== '').join('\n');
      const first = contacts[0];
      const mailto = first?.email ? `mailto:${first.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : sup.email ? `mailto:${sup.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null;
      const phone = (first?.phone ?? sup.phone ?? '').replace(/[^\d]/g, '');
      return { subject, body, mailto, waLink: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(`${subject}\n\n${body}`)}` : null, contacts, supplier: sup.name };
    });
  }
  /** Les trois grossistes principaux (Laborex, Ubipharm, CEP/SEP) : créés s'ils n'existent pas, un seul par grossiste. */
  async wholesalers(user: AuthenticatedUser) {
    const defs: { key: string; label: string; name: string; abbreviation: string }[] = [
      { key: 'laborex', label: 'Laborex', name: 'LABOREX', abbreviation: 'LBX' },
      { key: 'ubipharm', label: 'Ubipharm', name: 'UBIPHARM', abbreviation: 'UBI' },
      { key: 'cep', label: 'CEP / SEP', name: 'CEP (SEP)', abbreviation: 'CEP' },
    ];
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      const all = await tx.supplier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
      const withCat = new Set((await tx.supplierCatalogItem.groupBy({ by: ['supplierId'] })).map((x) => x.supplierId));
      const out: { key: string; label: string; supplierId: string }[] = [];
      for (const d of defs) {
        const cands = all.filter((s) => providerKey(s.name, s.abbreviation) === d.key);
        let pick = cands.find((s) => withCat.has(s.id)) ?? cands.find((s) => s.name.toUpperCase() === d.name) ?? cands.find((s) => s.isWholesaler) ?? cands[0];
        if (!pick) pick = await tx.supplier.create({ data: { tenantId: user.tenantId, name: d.name, abbreviation: d.abbreviation, isWholesaler: true } });
        else if (!pick.isWholesaler) await tx.supplier.update({ where: { id: pick.id }, data: { isWholesaler: true, abbreviation: pick.abbreviation ?? d.abbreviation } });
        out.push({ key: d.key, label: d.label, supplierId: pick.id });
      }
      return out;
    });
  }

  async referenceStats() {
    const all = await this.ref.all();
    const by: Record<string, number> = {};
    for (const r of all) for (const p of r.providers) by[p] = (by[p] ?? 0) + 1;
    return { total: all.length, byProvider: by };
  }

  /** Référentiel CIP : à partir d'un libellé, retrouve dans les catalogues des grossistes (Laborex, Ubipharm, CEP…) le code de chaque fournisseur. */
  async lookup(tenantId: string, q: string) {
    const toks = nameTokens(q);
    if (toks.length < 1 || q.trim().length < 3) return [];
    return this.prisma.forTenant(tenantId, async (tx) => {
      const withCat = (await tx.supplierCatalogItem.groupBy({ by: ['supplierId'] })).map((x) => x.supplierId);
      const sups = await tx.supplier.findMany({ where: { isActive: true, id: { in: withCat } }, select: { id: true, name: true, abbreviation: true } });
      const out: { supplierId: string; supplier: string; abbreviation: string | null; cip: string; designation: string; dci: string; available: boolean; score: number }[] = [];
      for (const s of sups) {
        const cand = await tx.supplierCatalogItem.findMany({ where: { supplierId: s.id, designation: { contains: toks[0], mode: 'insensitive' } }, take: 400 });
        const best = cand.map((c) => ({ c, score: similarity(q, c.designation) })).filter((x) => x.score >= 60).sort((a, b) => b.score - a.score).slice(0, 3);
        for (const { c, score } of best) out.push({ supplierId: s.id, supplier: s.name, abbreviation: s.abbreviation, cip: c.cip, designation: c.designation, dci: c.dci, available: c.available, score });
      }
      // référentiel commun : complète les fournisseurs sans catalogue importé (ou sans correspondance)
      const allSups = await tx.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true, abbreviation: true } });
      const hits = await this.ref.search(q, 60, 6);
      for (const s of allSups) {
        if (out.some((o) => o.supplierId === s.id)) continue;
        const key = providerKey(s.name, s.abbreviation);
        const h = key ? hits.find((x) => x.providers.includes(key)) : undefined;
        if (h) out.push({ supplierId: s.id, supplier: s.name, abbreviation: s.abbreviation, cip: h.cip, designation: h.designation, dci: h.dci, available: true, score: h.score });
      }
      return out.sort((a, b) => b.score - a.score);
    });
  }

  /** Complète automatiquement les CIP des produits qui n'en ont pas (grossistes Laborex, CEP, Ubipharm), d'après le référentiel commun et les catalogues importés. */
  async enrich(user: AuthenticatedUser, minScore = 92): Promise<{ scanned: number; filled: number; products: number; suppliers: number }> {
    const picks = await this.wholesalers(user); // les trois grossistes principaux uniquement
    const { sups, prods } = await this.prisma.forTenant(user.tenantId, async (tx) => ({
      sups: picks.map((w) => ({ id: w.supplierId, key: w.key as string | null })),
      prods: await tx.product.findMany({ where: { isActive: true }, select: { id: true, name: true, supplierCodes: true } }),
    }));
    if (!sups.length) return { scanned: prods.length, filled: 0, products: 0, suppliers: 0 };
    const ids: string[] = [], codesJson: string[] = [];
    let filled = 0;
    for (const p of prods) {
      const codes = { ...((p.supplierCodes as Record<string, string> | null) ?? {}) };
      const need = sups.filter((s) => !codes[s.id]);
      if (!need.length) continue;
      const hits = await this.ref.search(p.name, minScore, 6);
      let changed = false;
      for (const s of need) { const h = hits.find((x) => x.providers.includes(s.key as string)); if (h) { codes[s.id] = h.cip; filled++; changed = true; } }
      if (changed) { ids.push(p.id); codesJson.push(JSON.stringify(codes)); }
    }
    for (let k = 0; k < ids.length; k += 500) {
      const i = ids.slice(k, k + 500), c = codesJson.slice(k, k + 500);
      await this.prisma.forTenant(user.tenantId, (tx) => tx.$executeRaw`UPDATE products p SET supplier_codes = u.codes::jsonb FROM unnest(${i}::uuid[], ${c}::text[]) AS u(pid, codes) WHERE p.id = u.pid`);
    }
    const stats = { scanned: prods.length, filled, products: ids.length, suppliers: sups.length };
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'suppliers.cip_enriched', entityType: 'supplier', entityId: user.tenantId, metadata: stats });
    return stats;
  }
}

export { buildOrderFile };
