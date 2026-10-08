import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@erp/database';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Referentiels de saisie de la fiche produit : DCI, familles therapeutiques et formes (repris de l'application
 * PHARMACORP Equivalence), laboratoires (annuaire DPM Congo). Plus : taux de TVA de l'etablissement,
 * equivalents a peremption proche, deconditionnement (lotage / delotage).
 */
const load = <T,>(f: string): T => JSON.parse(readFileSync(join(__dirname, f), 'utf8')) as T;
let REF: { dci: string[]; families: string[]; forms: string[] } | null = null;
let LABS: { name: string; agency: string }[] | null = null;
const ref = () => { if (!REF) REF = load<NonNullable<typeof REF>>('pharma.ref.json'); return REF; };
type DirItem = { type: string; name: string; [k: string]: unknown };
let DIR: { items: DirItem[] } | null = null;
const dir = () => { if (!DIR) DIR = load<{ items: DirItem[] }>('directory.json'); return DIR; };
const labs = () => { if (!LABS) LABS = load<NonNullable<typeof LABS>>('laboratories.dpm.json'); return LABS; };
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Commence par le terme d'abord, puis contient. */
function suggest(list: string[], q: string, take = 15) {
  const t = norm(q.trim());
  if (t.length < 2) return [];
  const starts = list.filter((x) => norm(x).startsWith(t));
  const contains = list.filter((x) => !norm(x).startsWith(t) && norm(x).includes(t));
  return [...starts, ...contains].slice(0, take);
}

type VatRate = { label: string; rate: number };
/** { roleId: liste } : role absent ou liste nulle = tout voir. */
const lists = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([, x]) => Array.isArray(x)).map(([k, x]) => [k, (x as unknown[]).map(String).slice(0, 200)])) as Prisma.InputJsonValue;
export type PriceCategory = { key: string; label: string; coefficient: number };
/** Coefficients usuels en officine (modifiables et completables par l'etablissement). */
export const DEFAULT_PRICE_CATEGORIES: PriceCategory[] = [
  { key: 'specialite', label: 'Médicaments de spécialité', coefficient: 1.408 },
  { key: 'generique', label: 'Médicaments génériques', coefficient: 1.58 },
  { key: 'parapharmacie', label: 'Parapharmacie', coefficient: 1.75 },
  { key: 'petite_chirurgie', label: 'Petite chirurgie', coefficient: 1.54 },
  { key: 'laits_farines', label: 'Farines et laits maternisés', coefficient: 1.075 },
];
/** Prix de vente = prix d'achat x coefficient, arrondi au multiple superieur de `rounding` FCFA (5 F par defaut). */
export function salePriceFrom(purchase: number, coefficient: number, rounding = 5) {
  const raw = purchase * coefficient;
  const step = Math.max(1, Math.round(rounding));
  return Math.ceil(Math.round(raw * 1000) / 1000 / step) * step;
}
const DEFAULT_VAT: VatRate[] = [{ label: 'Exonéré', rate: 0 }, { label: 'TVA 18 %', rate: 18 }];

@Injectable()
export class ReferentialsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  dci(q: string) { return suggest(ref().dci, q); }
  families(q?: string) { return q ? suggest(ref().families, q, 30) : ref().families; }
  forms() { return ref().forms; }
  /** Reprend les familles therapeutiques du referentiel comme categories de la pharmacie (sans doublon). */
  async importFamilies(user: AuthenticatedUser) {
    const r = await this.prisma.forTenant(user.tenantId, (tx) => tx.category.createMany({ data: ref().families.map((name) => ({ tenantId: user.tenantId, name: name.slice(0, 80) })), skipDuplicates: true }));
    return { created: r.count, total: ref().families.length };
  }
  async laboratories(tenantId: string, q: string) {
    // annuaire DPM + laboratoires deja saisis dans la pharmacie
    const own = await this.prisma.forTenant(tenantId, (tx) => tx.product.findMany({ where: { laboratory: { not: null } }, distinct: ['laboratory'], select: { laboratory: true }, take: 500 }));
    const names = [...new Set([...labs().map((l) => l.name), ...own.map((o) => o.laboratory as string)])];
    return suggest(names, q).map((name) => ({ name, agency: labs().find((l) => l.name === name)?.agency ?? null }));
  }

  async pricing(tenantId: string) {
    const p = await this.prisma.forTenant(tenantId, (tx) => tx.companyProfile.findUnique({ where: { tenantId }, select: { vatRates: true, priceCoefficients: true, vatVisibility: true, supplierVisibility: true, depotVisibility: true, priceCategories: true, priceRounding: true } }));
    return { vatRates: (p?.vatRates as VatRate[]) ?? DEFAULT_VAT, coefficients: (p?.priceCoefficients as { exempt: number; taxed: number }) ?? { exempt: 1.41, taxed: 1.6 }, vatVisibility: (p?.vatVisibility as Record<string, number[]>) ?? {}, supplierVisibility: (p?.supplierVisibility as Record<string, string[]>) ?? {}, depotVisibility: (p?.depotVisibility as Record<string, string[]>) ?? {}, priceCategories: ((p?.priceCategories as PriceCategory[]) ?? []).length ? (p!.priceCategories as PriceCategory[]) : DEFAULT_PRICE_CATEGORIES, rounding: p?.priceRounding ?? 5 };
  }
  async setPricing(user: AuthenticatedUser, body: { vatRates?: VatRate[]; coefficients?: { exempt: number; taxed: number }; vatVisibility?: Record<string, number[] | null>; supplierVisibility?: Record<string, string[] | null>; depotVisibility?: Record<string, string[] | null>; priceCategories?: PriceCategory[]; rounding?: number }) {
    const cats = body.priceCategories?.filter((x) => x && String(x.label).trim() && Number(x.coefficient) > 0 && Number(x.coefficient) < 10).map((x) => ({ key: (x.key || String(x.label)).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40), label: String(x.label).trim().slice(0, 60), coefficient: Math.round(Number(x.coefficient) * 10000) / 10000 }));
    if (body.rounding !== undefined && ![1, 5, 10, 25, 50, 100].includes(Number(body.rounding))) throw new BadRequestException('Arrondi : 1, 5, 10, 25, 50 ou 100 FCFA');
    const rates = (body.vatRates ?? []).filter((r) => r && String(r.label).trim() && Number.isFinite(Number(r.rate)) && r.rate >= 0 && r.rate <= 100).map((r) => ({ label: String(r.label).trim().slice(0, 40), rate: Math.round(Number(r.rate) * 100) / 100 }));
    if (body.vatRates && !rates.length) throw new BadRequestException('Au moins un taux de TVA est requis');
    const c = body.coefficients;
    if (c && (!(c.exempt > 0 && c.exempt < 10) || !(c.taxed > 0 && c.taxed < 10))) throw new BadRequestException('Coefficients incohérents');
    const data = { ...(body.vatRates ? { vatRates: rates as unknown as Prisma.InputJsonValue } : {}), ...(c ? { priceCoefficients: c as unknown as Prisma.InputJsonValue } : {}), ...(cats ? { priceCategories: cats as unknown as Prisma.InputJsonValue } : {}), ...(body.rounding !== undefined ? { priceRounding: Number(body.rounding) } : {}), ...(body.supplierVisibility ? { supplierVisibility: lists(body.supplierVisibility) } : {}), ...(body.depotVisibility ? { depotVisibility: lists(body.depotVisibility) } : {}), ...(body.vatVisibility ? { vatVisibility: Object.fromEntries(Object.entries(body.vatVisibility).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as number[]).map(Number)])) as Prisma.InputJsonValue } : {}) };
    await this.prisma.forTenant(user.tenantId, (tx) => tx.companyProfile.upsert({ where: { tenantId: user.tenantId }, create: { tenantId: user.tenantId, ...data }, update: data }));
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'pricing.changed', entityType: 'company_profile', entityId: user.tenantId, metadata: data as Prisma.InputJsonValue });
    return this.pricing(user.tenantId);
  }

  // ----- Annuaires (DPM, CAMU, structures de sante, pharmacies) -----
  /** Annuaire central (panneau PHARMACORP, partage avec Gardes et Equivalence) ; copie locale si hors ligne. */
  async directory(q = '', type?: string, take = 100) {
    const base = process.env.GARDES_API_URL ?? 'https://pharmacorp-gardes.netlify.app';
    try {
      const r = await fetch(`${base}/v1/directory?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type ?? '')}&take=${Math.min(take, 500)}`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) return { ...((await r.json()) as Record<string, unknown>), source: 'central' };
    } catch { /* hors ligne : copie embarquee */ }
    return { ...this.localDirectory(q, type, take), source: 'local' };
  }
  /** Proposition de modification / de complément : envoyée à l'annuaire central, validée par l'administrateur avant publication. */
  async proposeDirectory(body: Record<string, unknown>) {
    const base = process.env.GARDES_API_URL ?? 'https://pharmacorp-gardes.netlify.app';
    const r = await fetch(`${base}/v1/directory/propose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, source: 'ERP' }), signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r) throw new BadRequestException('Annuaire central injoignable : réessayez plus tard.');
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new BadRequestException(j.error ?? 'Proposition refusée');
    return j;
  }
  private localDirectory(q = '', type?: string, take = 100) {
    const t = norm(q.trim());
    const items = dir().items.filter((x) => (!type || x.type === type) && (!t || norm(Object.values(x).filter((v) => typeof v === 'string').join(' ')).includes(t)));
    const counts = dir().items.reduce<Record<string, number>>((m, x) => { m[x.type] = (m[x.type] ?? 0) + 1; return m; }, {});
    return { total: items.length, counts, items: items.slice(0, Math.min(take, 500)) };
  }

  // ----- Photos produits -----
  async setPhoto(user: AuthenticatedUser, productId: string, file?: { buffer: Buffer; mimetype: string; size: number }) {
    if (!file) throw new BadRequestException('Photo manquante');
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) throw new BadRequestException('Format accepté : JPEG, PNG ou WebP');
    if (file.size > 2_000_000) throw new BadRequestException('Photo trop lourde (2 Mo maximum)');
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      if (!(await tx.product.findUnique({ where: { id: productId } }))) throw new NotFoundException('Produit introuvable');
      await tx.productPhoto.upsert({ where: { productId }, create: { productId, tenantId: user.tenantId, mime: file.mimetype, data: file.buffer }, update: { mime: file.mimetype, data: file.buffer } });
    });
    return { ok: true };
  }
  photo(tenantId: string, productId: string) {
    return this.prisma.forTenant(tenantId, (tx) => tx.productPhoto.findUnique({ where: { productId } }));
  }
  async photoIds(tenantId: string) {
    return (await this.prisma.forTenant(tenantId, (tx) => tx.productPhoto.findMany({ select: { productId: true } }))).map((p) => p.productId);
  }

  /**
   * Equivalents : produits de meme DCI (et meme dosage si renseigne) ayant du stock, les lots qui perissent le plus tot
   * en premier. Sert a proposer a l'operateur un produit a ecouler. Simple suggestion : la substitution reste
   * une decision du pharmacien (loi n° 10-2010).
   */
  async equivalents(tenantId: string, productId: string, days = 120) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const p = await tx.product.findUnique({ where: { id: productId } });
      if (!p) throw new NotFoundException('Produit introuvable');
      if (!p.dci) return { product: p.name, dci: null, items: [] };
      const others = await tx.product.findMany({ where: { id: { not: p.id }, isActive: true, dci: { equals: p.dci, mode: 'insensitive' }, ...(p.dosage ? { OR: [{ dosage: null }, { dosage: { equals: p.dosage, mode: 'insensitive' } }] } : {}) }, take: 20 });
      if (!others.length) return { product: p.name, dci: p.dci, items: [] };
      const stock = await tx.inventoryMovement.groupBy({ by: ['productId', 'lotId'], where: { productId: { in: others.map((o) => o.id) } }, _sum: { quantity: true } });
      const lots = await tx.lot.findMany({ where: { id: { in: stock.map((s) => s.lotId).filter((x): x is string => !!x) }, status: 'available' } });
      const limit = new Date(Date.now() + days * 86_400_000);
      const items = others.map((o) => {
        const ol = stock.filter((s) => s.productId === o.id && (s._sum.quantity ?? 0) > 0).map((s) => ({ lot: lots.find((l) => l.id === s.lotId), qty: s._sum.quantity ?? 0 })).filter((x) => x.lot && (!x.lot.expiryDate || x.lot.expiryDate > new Date()));
        ol.sort((a, b) => (a.lot!.expiryDate?.getTime() ?? Infinity) - (b.lot!.expiryDate?.getTime() ?? Infinity));
        const first = ol[0];
        return { id: o.id, name: o.name, dosage: o.dosage, salePrice: o.salePrice, stock: ol.reduce((s, x) => s + x.qty, 0), nearestExpiry: first?.lot?.expiryDate ?? null, lotNumber: first?.lot?.lotNumber ?? null, expiresSoon: !!first?.lot?.expiryDate && first.lot.expiryDate <= limit };
      }).filter((x) => x.stock > 0).sort((a, b) => Number(b.expiresSoon) - Number(a.expiresSoon) || (a.nearestExpiry?.getTime() ?? Infinity) - (b.nearestExpiry?.getTime() ?? Infinity));
      return { product: p.name, dci: p.dci, items };
    });
  }

  /**
   * Deconditionnement (delotage) : `boxes` boites du lot passent en unites dans le produit "a l'unite" (meme numero de
   * lot, meme peremption) ; `boxes` negatif = reconditionnement (relotage) d'unites en boites completes.
   */
  async unpack(user: AuthenticatedUser, productId: string, body: { lotId: string; boxes: number }) {
    const boxes = Math.trunc(Number(body.boxes));
    if (!boxes) throw new BadRequestException('Nombre de boîtes requis');
    const result = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const p = await tx.product.findUnique({ where: { id: productId } });
      if (!p) throw new NotFoundException('Produit introuvable');
      if (!p.unitsPerBox || p.unitsPerBox < 2) throw new BadRequestException('Renseignez d’abord le nombre d’unités par boîte sur la fiche produit');
      const lot = await tx.lot.findFirst({ where: { id: body.lotId, productId } });
      if (!lot) throw new NotFoundException('Lot introuvable');
      let unit = p.unitProductId ? await tx.product.findUnique({ where: { id: p.unitProductId } }) : null;
      if (!unit) {
        unit = await tx.product.create({ data: { tenantId: user.tenantId, sku: `${p.sku}-U`.slice(0, 40), name: `${p.name} (à l'unité)`, dci: p.dci, form: p.form, dosage: p.dosage, laboratory: p.laboratory, categoryId: p.categoryId, unit: 'unité', salePrice: p.unitSalePrice ?? Math.ceil(p.salePrice / p.unitsPerBox), purchasePrice: Math.round(p.purchasePrice / p.unitsPerBox), vatRate: p.vatRate, trackLots: true, prescriptionRequired: p.prescriptionRequired, storage: p.storage } });
        await tx.product.update({ where: { id: p.id }, data: { unitProductId: unit.id } });
      }
      const unitLot = await tx.lot.upsert({ where: { tenantId_productId_lotNumber: { tenantId: user.tenantId, productId: unit.id, lotNumber: lot.lotNumber } }, create: { tenantId: user.tenantId, productId: unit.id, lotNumber: lot.lotNumber, expiryDate: lot.expiryDate, createdById: user.userId }, update: {} });
      const sum = async (pid: string, lid: string) => (await tx.inventoryMovement.aggregate({ where: { productId: pid, lotId: lid }, _sum: { quantity: true } }))._sum.quantity ?? 0;
      if (boxes > 0 && (await sum(p.id, lot.id)) < boxes) throw new BadRequestException('Stock de boîtes insuffisant sur ce lot');
      if (boxes < 0 && (await sum(unit.id, unitLot.id)) < -boxes * p.unitsPerBox) throw new BadRequestException('Unités insuffisantes pour reconstituer ces boîtes');
      const reason = boxes > 0 ? `Déconditionnement de ${boxes} boîte(s) en ${boxes * p.unitsPerBox} unité(s)` : `Reconditionnement de ${-boxes} boîte(s)`;
      await tx.inventoryMovement.create({ data: { tenantId: user.tenantId, productId: p.id, lotId: lot.id, quantity: -boxes, type: 'unpack', reason, createdById: user.userId, refType: 'product', refId: unit.id } });
      await tx.inventoryMovement.create({ data: { tenantId: user.tenantId, productId: unit.id, lotId: unitLot.id, quantity: boxes * p.unitsPerBox, type: 'unpack', reason, createdById: user.userId, refType: 'product', refId: p.id } });
      return { unitProductId: unit.id, unitName: unit.name, boxes, units: boxes * p.unitsPerBox, reason };
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'stock.unpacked', entityType: 'product', entityId: productId, metadata: result });
    return result;
  }
}

@Controller()
export class ReferentialsController {
  constructor(private readonly r: ReferentialsService) {}
  @Get('referentials/dci') @RequirePermissions('products.read') dci(@Query('q') q = '') { return this.r.dci(q); }
  @Get('referentials/laboratories') @RequirePermissions('products.read') labs(@CurrentUser() u: AuthenticatedUser, @Query('q') q = '') { return this.r.laboratories(u.tenantId, q); }
  @Get('referentials/families') @RequirePermissions('products.read') families(@Query('q') q?: string) { return this.r.families(q); }
  @Post('referentials/families/import') @RequirePermissions('products.write') importFamilies(@CurrentUser() u: AuthenticatedUser) { return this.r.importFamilies(u); }
  @Get('referentials/forms') @RequirePermissions('products.read') forms() { return this.r.forms(); }
  @Get('settings/pricing') @RequirePermissions('products.read') pricing(@CurrentUser() u: AuthenticatedUser) { return this.r.pricing(u.tenantId); }
  @Put('settings/pricing') @RequirePermissions('tenant.manage') setPricing(@CurrentUser() u: AuthenticatedUser, @Body() b: { vatRates?: VatRate[]; coefficients?: { exempt: number; taxed: number }; vatVisibility?: Record<string, number[] | null>; supplierVisibility?: Record<string, string[] | null>; depotVisibility?: Record<string, string[] | null>; priceCategories?: PriceCategory[]; rounding?: number }) { return this.r.setPricing(u, b); }
  @Post('directory/propose') @RequirePermissions('directory.read') proposeDirectory(@Body() b: Record<string, unknown>) { return this.r.proposeDirectory({ contact: b.contact, entryId: b.entryId, kind: b.kind, fields: b.fields, message: b.message, type: b.type }); }
  @Get('directory') @RequirePermissions('directory.read') directory(@Query('q') q = '', @Query('type') type?: string, @Query('take') take = '100') { return this.r.directory(q, type, Number(take) || 100); }
  @Get('product-photos/ids') @RequirePermissions('products.read') photoIds(@CurrentUser() u: AuthenticatedUser) { return this.r.photoIds(u.tenantId); }
  @Post('products/:id/photo') @RequirePermissions('products.write') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2_000_000 } }))
  setPhoto(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: { buffer: Buffer; mimetype: string; size: number }) { return this.r.setPhoto(u, id, file); }
  @Get('products/:id/photo') @RequirePermissions('products.read')
  async photo(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const p = await this.r.photo(u.tenantId, id);
    if (!p) { res.status(404).end(); return; }
    res.setHeader('Content-Type', p.mime); res.setHeader('Cache-Control', 'private, max-age=300'); res.end(Buffer.from(p.data));
  }
  @Get('products/:id/equivalents') @RequirePermissions('products.read') equivalents(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.r.equivalents(u.tenantId, id); }
  @Post('products/:id/unpack') @RequirePermissions('stock.write') unpack(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: { lotId: string; boxes: number }) { return this.r.unpack(u, id, b); }
}

@Module({ imports: [AuditLogModule], controllers: [ReferentialsController], providers: [ReferentialsService] })
export class ReferentialsModule {}
